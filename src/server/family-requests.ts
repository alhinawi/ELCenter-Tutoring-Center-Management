import { z } from "zod";
import type { AppContext } from "./app";
import { identity, ownedStudent } from "./portal-access";
import { assert } from "./security";
export async function familyRequests(c: AppContext) {
  const link = await identity(c);
  assert(link.kind !== "teacher", 403, "Family account required");
  const student = await ownedStudent(c, c.req.param("id")!),
    a = c.get("actor"),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1),
    status = z
      .enum(["", "pending", "accepted", "rejected", "closed"])
      .parse(c.req.query("status") ?? ""),
    kind = z
      .enum(["", "absence_excuse", "meeting", "contact"])
      .parse(c.req.query("kind") ?? ""),
    where =
      "org_id=? AND student_id=? AND user_id=? AND (?='' OR status=?) AND (?='' OR kind=?)",
    args = [a.org_id, student.id, a.user_id, status, status, kind, kind];
  const count = await c.env.DB.prepare(
    "SELECT count(*) total FROM el_portal_requests WHERE " + where,
  )
    .bind(...args)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    "SELECT id,kind,subject,body,requested_on,status,response,created_at FROM el_portal_requests WHERE " +
      where +
      " ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?",
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
