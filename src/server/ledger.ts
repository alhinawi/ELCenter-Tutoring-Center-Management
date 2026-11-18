import type { AppContext } from "./app";
import { permit } from "./app";
import { z } from "zod";
import { assert } from "./security";
import { calendarDate as ledgerDate } from "./dates";
export async function readLedger(c: AppContext) {
  const cursorSchema = z
    .object({
      v: z.literal(1),
      org: z.uuid(),
      branch: z.uuid().nullable(),
      from: ledgerDate,
      to: ledgerDate,
      date: ledgerDate,
      created: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
      id: z.uuid(),
    })
    .strict();
  permit(c, "finance");
  const a = c.get("actor"),
    from = ledgerDate.parse(c.req.query("from") ?? "2020-01-01"),
    to = ledgerDate.parse(c.req.query("to") ?? "2100-12-31"),
    limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(25)
      .parse(c.req.query("limit") ?? 25);
  assert(from <= to, 400, "Invalid date range");
  let cursor: z.infer<typeof cursorSchema> | null = null;
  const encoded = c.req.query("cursor");
  if (encoded) {
    assert(encoded.length <= 1600, 400, "Invalid ledger cursor");
    try {
      cursor = cursorSchema.parse(
        JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/"))),
      );
    } catch {
      assert(false, 400, "Invalid ledger cursor");
    }
  }
  if (cursor)
    assert(
      cursor.org === a.org_id &&
        cursor.branch === a.branch_id &&
        cursor.from === from &&
        cursor.to === to,
      400,
      "Ledger cursor does not match current account scope or date filters",
    );
  const where =
    "j.org_id=? AND j.status='posted' AND (? IS NULL OR j.branch_id=?) AND j.date>=? AND j.date<=?";
  const after = cursor
    ? " AND (j.date<? OR (j.date=? AND j.created_at<?) OR (j.date=? AND j.created_at=? AND j.id<?))"
    : "";
  const args: unknown[] = [
    a.org_id,
    a.branch_id,
    a.branch_id,
    from,
    to,
    ...(cursor
      ? [
          cursor.date,
          cursor.date,
          cursor.created,
          cursor.date,
          cursor.created,
          cursor.id,
        ]
      : []),
  ];
  const selected = (
    await c.env.DB.prepare(
      `SELECT j.id,j.date,j.created_at FROM el_journals j WHERE ${where}${after} ORDER BY j.date DESC,j.created_at DESC,j.id DESC LIMIT ?`,
    )
      .bind(...args, limit + 1)
      .all<{ id: string; date: string; created_at: string }>()
  ).results;
  const more = selected.length > limit,
    journals = selected.slice(0, limit),
    last = journals.at(-1);
  const rows = journals.length
    ? (
        await c.env.DB.prepare(
          `SELECT j.id,l.id line_id,j.date,j.reference,j.memo,j.source_type,j.reverse_of,j.branch_id,l.account_id,ac.code,ac.name account_name,l.debit,l.credit FROM el_journals j JOIN el_journal_lines l ON l.journal_id=j.id AND l.org_id=j.org_id JOIN el_accounts ac ON ac.id=l.account_id AND ac.org_id=l.org_id WHERE ${where} AND j.id IN (${journals.map(() => "?").join(",")}) ORDER BY j.date DESC,j.created_at DESC,j.id DESC,ac.code,l.id`,
        )
          .bind(
            a.org_id,
            a.branch_id,
            a.branch_id,
            from,
            to,
            ...journals.map((j) => j.id),
          )
          .all()
      ).results
    : [];
  const next =
    more && last
      ? btoa(
          JSON.stringify({
            v: 1,
            org: a.org_id,
            branch: a.branch_id,
            from,
            to,
            date: last.date,
            created: last.created_at,
            id: last.id,
          }),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "")
      : null;
  return c.json({
    data: rows,
    from,
    to,
    journal_count: journals.length,
    page_size: limit,
    next_cursor: next,
    has_more: !!next,
  });
}
