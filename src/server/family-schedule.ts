import { Temporal } from "@js-temporal/polyfill";
import type { AppContext } from "./app";
import { ownedStudent } from "./portal-access";
import { calendarDate } from "./dates";
import { assert } from "./security";
import { now } from "./db";
export async function familySchedule(c: AppContext) {
  const student = await ownedStudent(c, c.req.param("id")!),
    a = c.get("actor"),
    { from, to, zone, start, end } = await scheduleWindow(c, 1, 120);
  const rows = await c.env.DB.prepare(
    "SELECT cs.id,cs.starts_at,cs.ends_at,cs.topic,cs.status,g.name group_name,t.name teacher_name,cl.name classroom_name FROM el_class_sessions cs JOIN el_groups g ON g.id=cs.group_id AND g.org_id=cs.org_id JOIN el_teachers t ON t.id=cs.teacher_id AND t.org_id=cs.org_id JOIN el_classrooms cl ON cl.id=cs.classroom_id AND cl.org_id=cs.org_id WHERE cs.org_id=? AND cs.starts_at>=? AND cs.starts_at<? AND EXISTS(SELECT 1 FROM el_enrollments en WHERE en.org_id=cs.org_id AND en.group_id=cs.group_id AND en.student_id=? AND en.status='active') ORDER BY cs.starts_at,cs.id LIMIT 1001",
  )
    .bind(a.org_id, start, end, student.id)
    .all();
  assert(
    rows.results.length <= 1000,
    409,
    "Family schedule exceeds1000 sessions. Narrow the dates; no partial schedule was returned.",
  );
  return c.json({
    student: { id: student.id, name: student.name, code: student.code },
    data: rows.results,
    from,
    to,
    timezone: zone,
    total: rows.results.length,
  });
}

export async function scheduleWindow(
  c: AppContext,
  pastDays: number,
  futureDays: number,
) {
  const a = c.get("actor"),
    organization = await c.env.DB.prepare(
      "SELECT timezone FROM el_organizations WHERE id=?",
    )
      .bind(a.org_id)
      .first<{ timezone: string }>(),
    zone = organization!.timezone,
    today = Temporal.Instant.fromEpochMilliseconds(now() * 1000)
      .toZonedDateTimeISO(zone)
      .toPlainDate(),
    from = calendarDate.parse(
      c.req.query("from") ?? today.subtract({ days: pastDays }).toString(),
    ),
    to = calendarDate.parse(
      c.req.query("to") ?? today.add({ days: futureDays }).toString(),
    ),
    first = Temporal.PlainDate.from(from),
    last = Temporal.PlainDate.from(to),
    days = first.until(last).days;
  assert(
    days >= 0 && days < 370,
    400,
    "Choose an inclusive schedule range of370 calendar days or fewer",
  );
  const start = Number(first.toZonedDateTime(zone).epochMilliseconds) / 1000,
    end =
      Number(last.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds) /
      1000;
  return { from, to, zone, start, end };
}
