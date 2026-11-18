import { Temporal } from "@js-temporal/polyfill";
import type { Database } from "./db";
export async function lowAttendanceReminders(
  db: Database,
  org: string,
  time: number,
  zone: string,
) {
  const rules = await db
    .prepare(
      "SELECT low_attendance,attendance_days,attendance_threshold,attendance_minimum FROM el_automation_settings WHERE org_id=?",
    )
    .bind(org)
    .first<{
      low_attendance: number;
      attendance_days: number;
      attendance_threshold: number;
      attendance_minimum: number;
    }>();
  if (!rules?.low_attendance) return [];
  const today = Temporal.Instant.fromEpochMilliseconds(time * 1000)
      .toZonedDateTimeISO(zone)
      .toPlainDate(),
    from =
      today
        .subtract({ days: rules.attendance_days - 1 })
        .toZonedDateTime({ timeZone: zone, plainTime: "00:00" })
        .epochMilliseconds / 1000,
    month = today.toString().slice(0, 7);
  // Only ended, explicitly recorded sessions in currently active enrollments. Unrecorded and excused are not absences.
  const cte = `WITH counts AS (SELECT st.id,st.name,st.branch_id,COUNT(*) total,SUM(CASE WHEN a.status IN ('present','late','left_early') THEN 1 ELSE 0 END) attended FROM el_students st JOIN el_attendance a ON a.org_id=st.org_id AND a.student_id=st.id JOIN el_class_sessions s ON s.org_id=a.org_id AND s.id=a.session_id JOIN el_groups g ON g.org_id=s.org_id AND g.id=s.group_id JOIN el_enrollments en ON en.org_id=st.org_id AND en.student_id=st.id AND en.group_id=g.id AND en.status='active' AND en.is_demo=0 WHERE st.org_id=? AND st.status IN ('new','active') AND st.is_demo=0 AND a.is_demo=0 AND s.is_demo=0 AND g.is_demo=0 AND g.status='active' AND g.branch_id=st.branch_id AND s.branch_id=st.branch_id AND s.status<>'cancelled' AND s.starts_at>=? AND s.ends_at<=? AND a.status<>'excused' GROUP BY st.id,st.name,st.branch_id HAVING COUNT(*)>=? AND SUM(CASE WHEN a.status IN ('present','late','left_early') THEN 1 ELSE 0 END)*100 < COUNT(*)*?)`;
  const source = `FROM counts st JOIN el_portal_links l ON l.org_id=? AND ((l.kind='student' AND l.student_id=st.id) OR(l.kind='guardian' AND EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.org_id=l.org_id AND sg.student_id=st.id AND sg.guardian_id=l.guardian_id))) JOIN el_memberships m ON m.org_id=l.org_id AND m.user_id=l.user_id JOIN el_roles r ON r.id=m.role_id JOIN el_automation_settings ats ON ats.org_id=m.org_id`;
  const eligible = `ats.low_attendance=1 AND ats.attendance_days=? AND ats.attendance_threshold=? AND ats.attendance_minimum=? AND m.status='active' AND (m.branch_id IS NULL OR m.branch_id=st.branch_id) AND ((l.kind='student' AND r.system_key='student') OR(l.kind='guardian' AND r.system_key='parent_guardian' AND EXISTS(SELECT 1 FROM el_guardians pg WHERE pg.org_id=l.org_id AND pg.id=l.guardian_id AND pg.is_demo=0 AND pg.status='active' AND (m.branch_id IS NULL OR m.branch_id=pg.branch_id)))) AND NOT EXISTS(SELECT 1 FROM el_notification_preferences np WHERE np.org_id=m.org_id AND np.user_id=m.user_id AND np.in_app=0)`;
  const args = [
    org,
    from,
    time,
    rules.attendance_minimum,
    rules.attendance_threshold,
    org,
    rules.attendance_days,
    rules.attendance_threshold,
    rules.attendance_minimum,
  ];
  const rows = (
    await db
      .prepare(
        `${cte} SELECT st.*,l.user_id ${source} WHERE ${eligible} AND NOT EXISTS(SELECT 1 FROM el_automation_events ev WHERE ev.org_id=m.org_id AND ev.user_id=m.user_id AND ev.kind='low_attendance' AND ev.entity_id=st.id AND ev.period=?) ORDER BY st.id,l.user_id LIMIT 100`,
      )
      .bind(...args, month)
      .all<Record<string, any>>()
  ).results;
  return rows.map((st) => ({
    user: st.user_id,
    kind: "low_attendance",
    entity: st.id,
    period: month,
    title: "Attendance follow-up / متابعة الحضور",
    body:
      st.name +
      " · " +
      st.attended +
      "/" +
      st.total +
      " recorded sessions attended / حصة حضور من الحصص المسجلة · " +
      today.subtract({ days: rules.attendance_days - 1 }).toString() +
      " – " +
      today.toString() +
      " (" +
      zone +
      ")",
    recheck: {
      sql: `EXISTS(${cte.replace("WHERE st.org_id=?", "WHERE st.id=? AND st.org_id=?")} SELECT 1 ${source} WHERE ${eligible} AND st.id=? AND l.user_id=? AND st.name=? AND st.total=? AND st.attended=?)`,
      args: [st.id, ...args, st.id, st.user_id, st.name, st.total, st.attended],
    },
  }));
}
