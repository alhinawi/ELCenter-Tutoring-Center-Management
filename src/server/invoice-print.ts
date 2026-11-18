import type { Hono } from "hono";
import { z } from "zod";
import { permit, audit, type AppContext } from "./app";
import { now, type Database } from "./db";
import { assert } from "./security";
export const invoicePrintDefaults = {
  issuer_name: "",
  contact_text: "",
  invoice_footer: "",
  receipt_footer: "",
  accent: "blue",
};
const schema = z
  .object({
    issuer_name: z.string().trim().max(160),
    contact_text: z.string().trim().max(600),
    invoice_footer: z.string().trim().max(1000),
    receipt_footer: z.string().trim().max(1000),
    accent: z.enum(["blue", "navy", "teal"]),
  })
  .strict();
export async function invoicePrintSnapshot(
  db: Database,
  org: string,
  id: string,
) {
  return db
    .prepare(
      "SELECT issuer_name,contact_text,invoice_footer,receipt_footer,accent,captured_at FROM el_invoice_print_snapshots WHERE org_id=? AND invoice_id=?",
    )
    .bind(org, id)
    .first();
}
export function captureInvoicePrint(db: Database, org: string, id: string) {
  return db
    .prepare(
      "INSERT INTO el_invoice_print_snapshots(invoice_id,org_id,issuer_name,contact_text,invoice_footer,receipt_footer,accent,captured_at) SELECT i.id,i.org_id,COALESCE(NULLIF(p.issuer_name,''),o.name),COALESCE(p.contact_text,''),COALESCE(p.invoice_footer,''),COALESCE(p.receipt_footer,''),COALESCE(p.accent,'blue'),? FROM el_invoices i JOIN el_organizations o ON o.id=i.org_id LEFT JOIN el_invoice_print_settings p ON p.org_id=i.org_id WHERE i.org_id=? AND i.id=? AND i.status='draft'",
    )
    .bind(now(), org, id);
}
export function registerInvoicePrint(app: Hono<any>) {
  app.get("/api/finance/print-settings", async (c: AppContext) => {
    permit(c, "finance");
    return c.json({
      data:
        (await c.env.DB.prepare(
          "SELECT issuer_name,contact_text,invoice_footer,receipt_footer,accent FROM el_invoice_print_settings WHERE org_id=?",
        )
          .bind(c.get("actor").org_id)
          .first()) ?? invoicePrintDefaults,
    });
  });
  app.put("/api/finance/print-settings", async (c: AppContext) => {
    permit(c, "finance", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = schema.parse(await c.req.json()),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_invoice_print_settings WHERE org_id=?",
      )
        .bind(a.org_id)
        .first();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_invoice_print_settings(org_id,issuer_name,contact_text,invoice_footer,receipt_footer,accent,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET issuer_name=excluded.issuer_name,contact_text=excluded.contact_text,invoice_footer=excluded.invoice_footer,receipt_footer=excluded.receipt_footer,accent=excluded.accent,updated_at=excluded.updated_at",
      ).bind(
        a.org_id,
        d.issuer_name,
        d.contact_text,
        d.invoice_footer,
        d.receipt_footer,
        d.accent,
        now(),
      ),
      audit(c, "finance_print_settings", a.org_id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
}
