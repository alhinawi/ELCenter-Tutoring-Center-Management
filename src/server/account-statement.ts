import type { Hono } from "hono";
import { z } from "zod";
import { calendarDate as date } from "./dates";
import { permit, audit, type AppContext } from "./app";
import { assert } from "./security";
import { now } from "./db";
export function registerAccountStatement(app: Hono<any>) {
  app.post("/api/finance/account-statement", async (c: AppContext) => {
    permit(c, "finance");
    permit(c, "finance", "export");
    const d = z
        .object({ account_id: z.uuid(), from: date, to: date })
        .strict()
        .parse(await c.req.json()),
      a = c.get("actor");
    assert(d.from <= d.to, 400, "Invalid statement date range");
    assert(
      await c.env.DB.prepare(
        "SELECT id FROM el_accounts WHERE org_id=? AND id=?",
      )
        .bind(a.org_id, d.account_id)
        .first(),
      404,
      "Account not found",
    );
    const generated = now();
    const result = (
      await c.env.DB.prepare(
        `WITH base AS (
   SELECT l.id line_id,j.id journal_id,j.date,j.created_at,j.reference,j.memo,j.branch_id,j.source_type,j.reverse_of,l.debit,l.credit
   FROM el_journal_lines l JOIN el_journals j ON j.org_id=l.org_id AND j.id=l.journal_id
   WHERE l.org_id=? AND l.account_id=? AND j.status='posted' AND (? IS NULL OR j.branch_id=?) AND j.date<=?
  ), opening AS (SELECT COALESCE(sum(debit-credit),0) amount FROM base WHERE date<?), period AS (SELECT * FROM base WHERE date>=?)
  SELECT ac.code,ac.name account_name,org.currency,o.amount opening,p.*,
   count(p.line_id) OVER() period_count,
   o.amount+sum(COALESCE(p.debit,0)-COALESCE(p.credit,0)) OVER(ORDER BY p.date,p.created_at,p.journal_id,p.line_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_balance
  FROM el_accounts ac JOIN el_organizations org ON org.id=ac.org_id CROSS JOIN opening o LEFT JOIN period p ON 1=1
  WHERE ac.org_id=? AND ac.id=? ORDER BY p.date,p.created_at,p.journal_id,p.line_id LIMIT 5001`,
      )
        .bind(
          a.org_id,
          d.account_id,
          a.branch_id,
          a.branch_id,
          d.to,
          d.from,
          d.from,
          a.org_id,
          d.account_id,
        )
        .all<Record<string, any>>()
    ).results;
    const first = result[0];
    assert(first, 404, "Account not found");
    assert(
      first.period_count <= 5000,
      409,
      "Statement exceeds 5000 movements. Narrow the date range; no partial export was prepared.",
    );
    const rows = result
      .filter((r) => r.line_id)
      .map(
        ({ code, account_name, currency, opening, period_count, ...r }) => r,
      );
    const summary = {
      opening: first.opening,
      debit: rows.reduce((n, r) => n + r.debit, 0),
      credit: rows.reduce((n, r) => n + r.credit, 0),
      closing: rows.at(-1)?.running_balance ?? first.opening,
    };
    assert(
      Object.values(summary).every(Number.isSafeInteger) &&
        rows.every((r) => Number.isSafeInteger(r.running_balance)),
      503,
      "Statement values exceed safe integer precision",
    );
    await c.env.DB.batch([
      audit(c, "account_statement", d.account_id, "export", null, {
        ...d,
        branch_id: a.branch_id,
        generated_at: generated,
        row_count: rows.length,
        ...summary,
      }),
    ]);
    c.header("Cache-Control", "private, no-store");
    return c.json({
      account: { id: d.account_id, code: first.code, name: first.account_name },
      currency: first.currency,
      from: d.from,
      to: d.to,
      branch_id: a.branch_id,
      generated_at: generated,
      balance_basis: "debit_minus_credit",
      summary,
      data: rows,
      row_count: rows.length,
      max_rows: 5000,
    });
  });
}
