import { z } from "zod";
import type { AppContext } from "./app";
import { ownedStudent } from "./portal-access";
export async function familyResults(c: AppContext) {
  const student = await ownedStudent(c, c.req.param("id")!),
    a = c.get("actor"),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1),
    where =
      "r.org_id=? AND r.student_id=? AND r.status='final' AND e.status<>'draft'";
  const count = await c.env.DB.prepare(
    "SELECT count(*) total FROM el_exam_results r JOIN el_exams e ON e.id=r.exam_id AND e.org_id=r.org_id WHERE " +
      where,
  )
    .bind(a.org_id, student.id)
    .first<{ total: number }>();
  const rows = await c.env.DB.prepare(
    "SELECT r.id,r.exam_id,r.score,r.feedback,e.max_score,e.pass_score,e.name,e.scheduled_at,g.name group_name FROM el_exam_results r JOIN el_exams e ON e.id=r.exam_id AND e.org_id=r.org_id JOIN el_groups g ON g.id=e.group_id AND g.org_id=e.org_id WHERE " +
      where +
      " ORDER BY e.scheduled_at DESC,r.id DESC LIMIT 20 OFFSET ?",
  )
    .bind(a.org_id, student.id, (page - 1) * 20)
    .all();
  return c.json({
    student: { id: student.id, name: student.name, code: student.code },
    data: rows.results,
    total: count?.total ?? 0,
    page,
    page_size: 20,
  });
}
