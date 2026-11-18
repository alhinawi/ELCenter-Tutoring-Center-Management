import { Temporal } from "@js-temporal/polyfill";
import type { Database } from "./db";
export async function upcomingExamReminders(
  db: Database,
  org: string,
  time: number,
  zone: string,
) {
  const settings = await db
    .prepare(
      "SELECT upcoming_exams,exam_days FROM el_automation_settings WHERE org_id=?",
    )
    .bind(org)
    .first<{ upcoming_exams: number; exam_days: number }>();
  if (!settings?.upcoming_exams) return [];
  const until =
    Number(
      Temporal.Instant.fromEpochMilliseconds(time * 1000)
        .toZonedDateTimeISO(zone)
        .add({ days: settings.exam_days }).epochMilliseconds,
    ) / 1000;
  const source = `FROM el_exams e JOIN el_groups g ON g.id=e.group_id AND g.org_id=e.org_id JOIN el_enrollments en ON en.group_id=g.id AND en.org_id=g.org_id AND en.status='active' JOIN el_students st ON st.id=en.student_id AND st.org_id=en.org_id JOIN el_portal_links l ON l.org_id=st.org_id AND ((l.kind='student' AND l.student_id=st.id) OR (l.kind='guardian' AND EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.org_id=st.org_id AND sg.student_id=st.id AND sg.guardian_id=l.guardian_id))) JOIN el_memberships m ON m.org_id=l.org_id AND m.user_id=l.user_id JOIN el_roles r ON r.id=m.role_id JOIN el_automation_settings ats ON ats.org_id=e.org_id`;
  const eligible = `e.org_id=? AND e.is_demo=0 AND g.is_demo=0 AND st.is_demo=0 AND e.status='published' AND g.status='active' AND e.branch_id=g.branch_id AND st.branch_id=g.branch_id AND st.status IN ('new','active') AND e.scheduled_at>=? AND e.scheduled_at<=? AND m.status='active' AND ats.upcoming_exams=1 AND ats.exam_days=? AND ((l.kind='student' AND r.system_key='student') OR(l.kind='guardian' AND r.system_key='parent_guardian' AND EXISTS(SELECT 1 FROM el_guardians pg WHERE pg.org_id=l.org_id AND pg.id=l.guardian_id AND pg.status='active' AND pg.is_demo=0 AND (m.branch_id IS NULL OR m.branch_id=pg.branch_id)))) AND (m.branch_id IS NULL OR m.branch_id=e.branch_id) AND NOT EXISTS(SELECT 1 FROM el_notification_preferences np WHERE np.org_id=m.org_id AND np.user_id=m.user_id AND np.in_app=0)`;
  const args = [org, time, until, settings.exam_days];
  // One notice per exam/student/recipient/scheduled timestamp. A changed schedule gets a fresh notice.
  // Keep siblings separate so the notice never identifies the wrong child.
  const rows = (
    await db
      .prepare(
        `SELECT e.id,e.scheduled_at,e.name,st.id student_id,st.name student_name,l.user_id ${source} WHERE ${eligible} AND NOT EXISTS(SELECT 1 FROM el_automation_events ev WHERE ev.org_id=e.org_id AND ev.user_id=l.user_id AND ev.kind='upcoming_exam' AND ev.entity_id=e.id||':'||st.id AND ev.period=CAST(e.scheduled_at AS TEXT)) ORDER BY e.scheduled_at,e.id,st.id,l.user_id LIMIT 100`,
      )
      .bind(...args)
      .all<Record<string, any>>()
  ).results;
  return rows.map((e) => ({
    user: e.user_id,
    kind: "upcoming_exam",
    entity: e.id + ":" + e.student_id,
    period: String(e.scheduled_at),
    title: "Upcoming exam / امتحان قريب",
    body:
      e.student_name +
      " · " +
      e.name +
      " · " +
      Temporal.Instant.fromEpochMilliseconds(e.scheduled_at * 1000)
        .toZonedDateTimeISO(zone)
        .toPlainDateTime()
        .toString()
        .slice(0, 16) +
      " (" +
      zone +
      ")",
    recheck: {
      sql: `EXISTS(SELECT 1 ${source} WHERE ${eligible} AND e.id=? AND st.id=? AND l.user_id=? AND e.scheduled_at=? AND e.name=? AND st.name=?)`,
      args: [
        ...args,
        e.id,
        e.student_id,
        e.user_id,
        e.scheduled_at,
        e.name,
        e.student_name,
      ],
    },
  }));
}
