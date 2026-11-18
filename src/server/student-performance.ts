import { z } from "zod";
import { permit, type AppContext } from "./app";
import { searchPattern } from "./db";

export async function studentPerformance(c: AppContext) {
  permit(c, "reports");
  const a = c.get("actor"),
    page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(c.req.query("page") ?? 1),
    q = z
      .string()
      .max(100)
      .parse(c.req.query("q") ?? ""),
    status = z
      .enum([
        "",
        "new",
        "active",
        "inactive",
        "suspended",
        "graduated",
        "withdrawn",
        "pending",
      ])
      .parse(c.req.query("status") ?? "");
  const where =
      "s.org_id=? AND (? IS NULL OR s.branch_id=?) AND s.name LIKE ? AND (?='' OR s.status=?)",
    args = [
      a.org_id,
      a.branch_id,
      a.branch_id,
      searchPattern(q),
      status,
      status,
    ];
  const count = await c.env.DB.prepare(
    "SELECT count(*) total FROM el_students s WHERE " + where,
  )
    .bind(...args)
    .first<{ total: number }>();
  // Page students first. Aggregates read only that page's scoped source activity,
  // avoiding a join cross product of attendance and exam rows.
  const rows = await c.env.DB.prepare(
    `WITH selected AS (
    SELECT s.id,s.name,s.code,s.branch_id,s.status FROM el_students s WHERE ${where} ORDER BY s.name,s.id LIMIT 20 OFFSET ?
  ) SELECT s.*,
    (SELECT count(*) FROM el_attendance at JOIN el_class_sessions cs ON cs.id=at.session_id AND cs.org_id=at.org_id WHERE at.org_id=? AND at.student_id=s.id AND (? IS NULL OR cs.branch_id=?)) attendance_count,
    (SELECT count(*) FROM el_attendance at JOIN el_class_sessions cs ON cs.id=at.session_id AND cs.org_id=at.org_id WHERE at.org_id=? AND at.student_id=s.id AND at.status<>'excused' AND (? IS NULL OR cs.branch_id=?)) attendance_eligible,
    (SELECT count(*) FROM el_attendance at JOIN el_class_sessions cs ON cs.id=at.session_id AND cs.org_id=at.org_id WHERE at.org_id=? AND at.student_id=s.id AND at.status IN ('present','late','left_early') AND (? IS NULL OR cs.branch_id=?)) attended_count,
    (SELECT count(*) FROM el_exam_results r JOIN el_exams ex ON ex.id=r.exam_id AND ex.org_id=r.org_id WHERE r.org_id=? AND r.student_id=s.id AND r.status='final' AND (? IS NULL OR ex.branch_id=?)) exam_count,
    (SELECT round(100.0*sum(r.score)/NULLIF(sum(ex.max_score),0),1) FROM el_exam_results r JOIN el_exams ex ON ex.id=r.exam_id AND ex.org_id=r.org_id WHERE r.org_id=? AND r.student_id=s.id AND r.status='final' AND (? IS NULL OR ex.branch_id=?)) exam_percent
    FROM selected s ORDER BY s.name,s.id`,
  )
    .bind(
      ...args,
      (page - 1) * 20,
      a.org_id,
      a.branch_id,
      a.branch_id,
      a.org_id,
      a.branch_id,
      a.branch_id,
      a.org_id,
      a.branch_id,
      a.branch_id,
      a.org_id,
      a.branch_id,
      a.branch_id,
      a.org_id,
      a.branch_id,
      a.branch_id,
    )
    .all<Record<string, any>>();
  return c.json({
    data: rows.results.map((s) => ({
      ...s,
      attendance_percent: s.attendance_eligible
        ? Math.round((1000 * s.attended_count) / s.attendance_eligible) / 10
        : null,
    })),
    total: count?.total ?? 0,
    page,
    page_size: 20,
  });
}
