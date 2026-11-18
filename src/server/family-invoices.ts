import { z } from "zod";
import type { AppContext } from "./app";
import { ownedStudent } from "./portal-access";
export async function familyInvoices(c: AppContext) {
  const student = await ownedStudent(c, c.req.param("id")!),
    a = c.get("actor"),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1),
    status = z.enum(["", "issued", "void"]).parse(c.req.query("status") ?? ""),
    where =
      "i.org_id=? AND i.student_id=? AND i.status<>'draft' AND (?='' OR i.status=?)",
    args = [a.org_id, student.id, status, status];
  const count = await c.env.DB.prepare(
    "SELECT count(*) total FROM el_invoices i WHERE " + where,
  )
    .bind(...args)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    "SELECT i.id,i.number,i.date,i.due_date,i.total,i.currency,i.status,COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.org_id=i.org_id AND p.invoice_id=i.id),0) paid FROM el_invoices i WHERE " +
      where +
      " ORDER BY i.date DESC,i.id DESC LIMIT 20 OFFSET ?",
  )
    .bind(...args, (page - 1) * 20)
    .all();
  return c.json({
    student: { id: student.id, name: student.name, code: student.code },
    data: rows.results,
    total: count?.total ?? 0,
    page,
    page_size: 20,
  });
}
