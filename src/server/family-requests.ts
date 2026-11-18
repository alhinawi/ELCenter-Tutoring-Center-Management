import { z } from "zod";
import { permit, type AppContext } from "./app";
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

export async function staffRequests(c: AppContext) {
  permit(c, "students");
  const a = c.get("actor"),
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
      "r.org_id=? AND (? IS NULL OR r.branch_id=?) AND (?='' OR r.status=?) AND (?='' OR r.kind=?)",
    args = [a.org_id, a.branch_id, a.branch_id, status, status, kind, kind];
  const count = await c.env.DB.prepare(
      "SELECT count(*) total FROM el_portal_requests r WHERE " + where,
    )
      .bind(...args)
      .first<{ total: number }>(),
    rows = await c.env.DB.prepare(
      "SELECT r.id,r.kind,r.subject,r.body,r.requested_on,r.status,r.response,r.created_at,s.name student_name FROM el_portal_requests r JOIN el_students s ON s.id=r.student_id AND s.org_id=r.org_id WHERE " +
        where +
        " ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?",
    )
      .bind(...args, (page - 1) * 20)
      .all();
  return c.json({
    data: rows.results,
    total: count?.total ?? 0,
    page,
    page_size: 20,
  });
}
