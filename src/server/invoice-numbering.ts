import type { Hono } from "hono";
import { z } from "zod";
import { permit, audit, type AppContext } from "./app";
import { now } from "./db";
import { assert } from "./security";
export const invoiceNumberDefaults = {
  enabled: 0,
  prefix: "INV-",
  next_number: 1,
};
export function registerInvoiceNumbering(app: Hono<any>) {
  app.get("/api/finance/numbering", async (c: AppContext) => {
    permit(c, "finance");
    return c.json({
      data:
        (await c.env.DB.prepare(
          "SELECT enabled,prefix,next_number FROM el_invoice_number_sequences WHERE org_id=?",
        )
          .bind(c.get("actor").org_id)
          .first()) ?? invoiceNumberDefaults,
    });
  });
  app.put("/api/finance/numbering", async (c: AppContext) => {
    permit(c, "finance", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = z
      .object({
        enabled: z.boolean(),
        prefix: z.string().regex(/^[A-Z0-9][A-Z0-9/_-]{0,15}$/),
        next_number: z.number().int().min(1).max(999999999),
        expected_next: z.number().int().min(1).max(999999999),
      })
      .strict()
      .parse(await c.req.json());
    const before = await c.env.DB.prepare(
      "SELECT enabled,prefix,next_number FROM el_invoice_number_sequences WHERE org_id=?",
    )
      .bind(a.org_id)
      .first<{ enabled: number; prefix: string; next_number: number }>();
    assert(
      d.expected_next === (before?.next_number ?? 1),
      409,
      "Numbering changed; refresh before saving",
    );
    assert(
      d.next_number >= (before?.next_number ?? 1),
      409,
      "Invoice sequence cannot move backwards",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_invoice_number_sequences(org_id,enabled,prefix,next_number,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET enabled=excluded.enabled,prefix=excluded.prefix,next_number=CASE WHEN next_number=? THEN excluded.next_number ELSE 0 END,updated_at=excluded.updated_at",
      ).bind(
        a.org_id,
        d.enabled ? 1 : 0,
        d.prefix,
        d.next_number,
        now(),
        d.expected_next,
      ),
      audit(c, "invoice_numbering", a.org_id, "settings", before, d),
    ]);
    return c.json({ ok: true });
  });
}
