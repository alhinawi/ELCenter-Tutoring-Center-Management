import type { AppContext } from "./app";
import { identity } from "./portal-access";
import { scheduleWindow } from "./family-schedule";
import { assert } from "./security";
export async function teacherSchedule(c: AppContext) {
  const link = await identity(c),
    a = c.get("actor");
  assert(link.kind === "teacher", 403, "Teacher profile required");
  const { from, to, zone, start, end } = await scheduleWindow(c, 7, 90);
  const rows = await c.env.DB.prepare(
    "SELECT cs.id,cs.starts_at,cs.ends_at,cs.topic,cs.status,g.name group_name,t.name teacher_name,cl.name classroom_name FROM el_class_sessions cs JOIN el_groups g ON g.id=cs.group_id AND g.org_id=cs.org_id JOIN el_teachers t ON t.id=cs.teacher_id AND t.org_id=cs.org_id JOIN el_classrooms cl ON cl.id=cs.classroom_id AND cl.org_id=cs.org_id WHERE cs.org_id=? AND cs.teacher_id=? AND (? IS NULL OR cs.branch_id=?) AND cs.starts_at>=? AND cs.starts_at<? ORDER BY cs.starts_at,cs.id LIMIT 1001",
  )
    .bind(a.org_id, link.teacher_id, a.branch_id, a.branch_id, start, end)
    .all();
  assert(
    rows.results.length <= 1000,
    409,
    "Teacher schedule exceeds 1000 sessions. Narrow the dates; no partial schedule was returned.",
  );
  return c.json({
    data: rows.results,
    from,
    to,
    timezone: zone,
    total: rows.results.length,
  });
}
