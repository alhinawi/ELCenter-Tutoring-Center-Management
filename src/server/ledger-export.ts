import type { Hono } from "hono";
import { z } from "zod";
import { calendarDate as date } from "./dates";
import { permit, audit, type AppContext } from "./app";
import { assert } from "./security";
import { now } from "./db";
export function registerLedgerExport(app: Hono<any>) {
  app.post("/api/finance/ledger-export", async (c: AppContext) => {
    permit(c, "finance");
    permit(c, "finance", "export");
    const a = c.get("actor"),
      d = z
        .object({ from: date, to: date })
        .strict()
        .parse(await c.req.json());
    assert(d.from <= d.to, 400, "Invalid ledger export range");
    const generated = now();
    const result = (
      await c.env.DB.prepare(
        `WITH base AS (
 SELECT l.id line_id,l.account_id,j.id journal_id,j.date,j.created_at,j.reference,j.memo,j.branch_id,j.source_type,j.reverse_of,l.debit,l.credit
 FROM el_journal_lines l JOIN el_journals j ON j.id=l.journal_id AND j.org_id=l.org_id
 WHERE l.org_id=? AND j.status='posted' AND (? IS NULL OR j.branch_id=?) AND j.date<=?
 ), opening AS (SELECT account_id,sum(debit-credit) amount FROM base WHERE date<? GROUP BY account_id), period AS (SELECT * FROM base WHERE date>=?)
 SELECT org.currency,ac.id selected_account_id,ac.code,ac.name account_name,COALESCE(o.amount,0) opening,p.*,
 count(*) OVER() statement_rows,count(p.line_id) OVER() period_count,
 COALESCE(o.amount,0)+sum(COALESCE(p.debit,0)-COALESCE(p.credit,0)) OVER(PARTITION BY ac.id ORDER BY p.date,p.created_at,p.journal_id,p.line_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) running_balance
 FROM el_organizations org LEFT JOIN el_accounts ac ON ac.org_id=org.id AND EXISTS(SELECT 1 FROM base b WHERE b.account_id=ac.id)
 LEFT JOIN opening o ON o.account_id=ac.id LEFT JOIN period p ON p.account_id=ac.id
 WHERE org.id=? ORDER BY p.date,p.created_at,p.journal_id,ac.code,p.line_id LIMIT 5001`,
      )
        .bind(
          a.org_id,
          a.branch_id,
          a.branch_id,
          d.to,
          d.from,
          d.from,
          a.org_id,
        )
        .all<Record<string, any>>()
    ).results;
    const first = result[0];
    assert(first, 404, "Organization not found");
    assert(
      first.statement_rows <= 5000,
      409,
      "Ledger export exceeds 5000 statement rows, including accounts with opening history but no period movements. Narrow dates or use an account statement. No partial ledger was prepared.",
    );
    const accounts = new Map<string, Record<string, any>>();
    for (const r of result) {
      if (!r.selected_account_id) continue;
      let ac = accounts.get(r.selected_account_id);
      if (!ac) {
        ac = {
          id: r.selected_account_id,
          code: r.code,
          name: r.account_name,
          opening: r.opening,
          debit: 0,
          credit: 0,
          closing: r.opening,
        };
        accounts.set(ac.id, ac);
      }
      if (r.line_id) {
        ac.debit += r.debit;
        ac.credit += r.credit;
        ac.closing = ac.opening + ac.debit - ac.credit;
      }
    }
    const rows = result
      .filter((r) => r.line_id)
      .map(
        ({
          currency,
          selected_account_id,
          opening,
          statement_rows,
          period_count,
          ...r
        }) => r,
      );
    const summary = {
      opening: [...accounts.values()].reduce((n, v) => n + v.opening, 0),
      debit: rows.reduce((n, v) => n + v.debit, 0),
      credit: rows.reduce((n, v) => n + v.credit, 0),
      closing: [...accounts.values()].reduce((n, v) => n + v.closing, 0),
    };
    assert(
      Object.values(summary).every(Number.isSafeInteger) &&
        [...accounts.values()].every((v) =>
          [v.opening, v.debit, v.credit, v.closing].every(Number.isSafeInteger),
        ) &&
        rows.every((v) => Number.isSafeInteger(v.running_balance)),
      503,
      "Ledger values exceed safe integer precision",
    );
    assert(
      summary.debit === summary.credit &&
        summary.opening === 0 &&
        summary.closing === 0,
      503,
      "Ledger is not balanced; no export was prepared",
    );
    await c.env.DB.batch([
      audit(c, "ledger_export", a.org_id, "export", null, {
        ...d,
        branch_id: a.branch_id,
        generated_at: generated,
        row_count: rows.length,
        account_count: accounts.size,
        ...summary,
      }),
    ]);
    c.header("Cache-Control", "private, no-store");
    return c.json({
      from: d.from,
      to: d.to,
      branch_id: a.branch_id,
      currency: first.currency,
      generated_at: generated,
      balance_basis: "debit_minus_credit",
      accounts: [...accounts.values()].sort((a, b) =>
        a.code.localeCompare(b.code),
      ),
      summary,
      data: rows,
      row_count: rows.length,
      account_count: accounts.size,
      max_statement_rows: 5000,
    });
  });
}
