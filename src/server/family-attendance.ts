import { z } from "zod";
import type { AppContext } from "./app";
import { ownedStudent } from "./portal-access";
export async function familyAttendance(c: AppContext) {
  const student = await ownedStudent(c, c.req.param("id")!),
    a = c.get("actor"),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1),
    status = z
      .enum(["", "present", "absent", "late", "excused", "left_early"])
      .parse(c.req.query("status") ?? ""),
    where = "at.org_id=? AND at.student_id=? AND (?='' OR at.status=?)",
    args = [a.org_id, student.id, status, status];
  const count = await c.env.DB.prepare(
    "SELECT count(*) total FROM el_attendance at WHERE " + where,
  )
    .bind(...args)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    "SELECT at.id,at.status,at.arrival,at.departure,cs.starts_at,cs.topic,cs.status session_status,g.name group_name FROM el_attendance at JOIN el_class_sessions cs ON cs.id=at.session_id AND cs.org_id=at.org_id JOIN el_groups g ON g.id=cs.group_id AND g.org_id=cs.org_id WHERE " +
      where +
      " ORDER BY cs.starts_at DESC,at.id DESC LIMIT 20 OFFSET ?",
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
