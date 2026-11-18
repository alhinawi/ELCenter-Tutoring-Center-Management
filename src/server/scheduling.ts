import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { assert } from "./security";
import { uid, now } from "./db";
import { permit, scope, audit, type AppContext } from "./app";
import { record } from "./academic";
const timestamp = z.number().int().min(1577836800).max(4102444800),
  text = z.string().trim().max(1000).default("");
const sessionSchema = z
  .object({
    group_id: z.uuid(),
    teacher_id: z.uuid(),
    classroom_id: z.uuid(),
    starts_at: timestamp,
    ends_at: timestamp,
    topic: text,
    notes: text,
    status: z
      .enum(["scheduled", "completed", "cancelled"])
      .default("scheduled"),
    repeat_weeks: z.number().int().min(1).max(10).default(1),
  })
  .refine((d) => d.ends_at > d.starts_at && d.ends_at - d.starts_at <= 28800, {
    message: "Session must last between 1 second and 8 hours",
  });
async function session(c: AppContext, id: string) {
  const s = await c.env.DB.prepare(
    "SELECT * FROM el_class_sessions WHERE id=? AND org_id=?",
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(s, 404, "Session not found");
  scope(c, s.branch_id);
  return s;
}
export async function timezone(c: AppContext) {
  return (await c.env.DB.prepare(
    "SELECT timezone FROM el_organizations WHERE id=?",
  )
    .bind(c.get("actor").org_id)
    .first<{ timezone: string }>())!.timezone;
}
async function validate(c: AppContext, d: z.infer<typeof sessionSchema>) {
  const g = await record(c, "groups", d.group_id);
  assert(
    g.status === "active" || d.status === "cancelled",
    409,
    "Choose an active group",
  );
  const a = c.get("actor");
  const teacher = await c.env.DB.prepare(
    "SELECT t.id FROM el_teachers t JOIN el_teacher_branches b ON b.teacher_id=t.id WHERE t.id=? AND t.org_id=? AND b.branch_id=? AND t.status='active'",
  )
    .bind(d.teacher_id, a.org_id, g.branch_id)
    .first();
  assert(teacher, 409, "Teacher is not available at this branch");
  const room = await c.env.DB.prepare(
    "SELECT capacity FROM el_classrooms WHERE id=? AND org_id=? AND branch_id=? AND status='active'",
  )
    .bind(d.classroom_id, a.org_id, g.branch_id)
    .first<{ capacity: number }>();
  assert(
    room && room.capacity >= g.capacity,
    409,
    "Classroom unavailable or too small",
  );
  const tz = await timezone(c);
  return { g, tz };
}
async function validateWindow(
  c: AppContext,
  d: z.infer<typeof sessionSchema>,
  branch: string,
  tz: string,
) {
  if (d.status === "cancelled") return;
  const start = Temporal.Instant.fromEpochMilliseconds(
      d.starts_at * 1000,
    ).toZonedDateTimeISO(tz),
    end = Temporal.Instant.fromEpochMilliseconds(
      d.ends_at * 1000,
    ).toZonedDateTimeISO(tz);
  assert(
    start.toPlainDate().equals(end.toPlainDate()),
    400,
    "Session cannot cross local midnight",
  );
  const group = await c.env.DB.prepare(
    "SELECT start_date,end_date FROM el_groups WHERE id=?",
  )
    .bind(d.group_id)
    .first<{ start_date: string; end_date: string }>();
  assert(
    group &&
      start.toPlainDate().toString() >= group.start_date &&
      end.toPlainDate().toString() <= group.end_date,
    409,
    "Session date is outside the group date range",
  );
  const holiday = await c.env.DB.prepare(
    "SELECT id FROM el_holidays WHERE org_id=? AND (branch_id IS NULL OR branch_id=?) AND date=?",
  )
    .bind(c.get("actor").org_id, branch, start.toPlainDate().toString())
    .first();
  assert(!holiday, 409, "This date is an organization or branch holiday");
  const availability = (
    await c.env.DB.prepare(
      "SELECT weekday,from_minute,to_minute FROM el_teacher_availability WHERE org_id=? AND teacher_id=?",
    )
      .bind(c.get("actor").org_id, d.teacher_id)
      .all<{ weekday: number; from_minute: number; to_minute: number }>()
  ).results;
  if (availability.length)
    assert(
      availability.some(
        (x) =>
          x.weekday === start.dayOfWeek % 7 &&
          x.from_minute <= start.hour * 60 + start.minute &&
          x.to_minute >= end.hour * 60 + end.minute,
      ),
      409,
      "Outside teacher availability",
    );
}
export function registerScheduling(app: Hono<any>) {
  app.get("/api/sessions", async (c: AppContext) => {
    permit(c, "sessions");
    const a = c.get("actor"),
      from = Number(c.req.query("from")) || now() - 31 * 86400,
      to = Number(c.req.query("to")) || now() + 62 * 86400;
    assert(
      to > from && to - from <= 370 * 86400,
      400,
      "Choose a date range of one year or less",
    );
    const group = c.req.query("group") || null,
      branch = c.req.query("branch") || a.branch_id || null;
    if (branch) scope(c, branch);
    const rows = await c.env.DB.prepare(
      "SELECT s.*,g.name group_name,t.name teacher_name,r.name room_name FROM el_class_sessions s JOIN el_groups g ON g.id=s.group_id JOIN el_teachers t ON t.id=s.teacher_id JOIN el_classrooms r ON r.id=s.classroom_id WHERE s.org_id=? AND (? IS NULL OR s.branch_id=?) AND (? IS NULL OR s.group_id=?) AND s.starts_at<? AND s.ends_at>? ORDER BY s.starts_at LIMIT 1000",
    )
      .bind(a.org_id, branch, branch, group, group, to, from)
      .all();
    return c.json({ data: rows.results });
  });
  app.post("/api/sessions", async (c: AppContext) => {
    permit(c, "sessions", "create");
    const d = sessionSchema.parse(await c.req.json()),
      { g, tz } = await validate(c, d),
      a = c.get("actor");
    const statements = [],
      ids = [];
    for (let i = 0; i < d.repeat_weeks; i++) {
      const start = Temporal.Instant.fromEpochMilliseconds(d.starts_at * 1000)
          .toZonedDateTimeISO(tz)
          .add({ weeks: i }),
        end = Temporal.Instant.fromEpochMilliseconds(d.ends_at * 1000)
          .toZonedDateTimeISO(tz)
          .add({ weeks: i });
      const occurrence = {
        ...d,
        starts_at: Number(start.epochMilliseconds) / 1000,
        ends_at: Number(end.epochMilliseconds) / 1000,
      };
      await validateWindow(c, occurrence, g.branch_id, tz);
      const id = uid();
      ids.push(id);
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,notes,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id,
          a.org_id,
          g.branch_id,
          d.group_id,
          d.teacher_id,
          d.classroom_id,
          occurrence.starts_at,
          occurrence.ends_at,
          d.topic,
          d.notes,
          d.status,
        ),
      );
    }
    await c.env.DB.batch([
      ...statements,
      audit(c, "sessions", ids[0], "schedule", null, {
        ...d,
        count: ids.length,
        timezone: tz,
      }),
    ]);
    return c.json({ ids }, 201);
  });
  app.put("/api/sessions/:id", async (c: AppContext) => {
    permit(c, "sessions", "edit");
    const id = c.req.param("id")!,
      before = await session(c, id),
      d = sessionSchema.parse(await c.req.json()),
      { g, tz } = await validate(c, d);
    assert(
      g.branch_id === before.branch_id,
      409,
      "Sessions cannot move between branches",
    );
    await validateWindow(c, d, g.branch_id, tz);
    if (before.status === "completed")
      assert(
        d.status === "completed" &&
          before.starts_at === d.starts_at &&
          before.ends_at === d.ends_at &&
          before.group_id === d.group_id,
        409,
        "Completed session time and group are locked",
      );
    const attendance = await c.env.DB.prepare(
      "SELECT id FROM el_attendance WHERE session_id=? LIMIT 1",
    )
      .bind(id)
      .first();
    if (attendance)
      assert(
        d.status !== "cancelled" &&
          before.starts_at === d.starts_at &&
          before.group_id === d.group_id,
        409,
        "Recorded attendance locks the session time and group",
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_class_sessions SET group_id=?,teacher_id=?,classroom_id=?,starts_at=?,ends_at=?,topic=?,notes=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?",
      ).bind(
        d.group_id,
        d.teacher_id,
        d.classroom_id,
        d.starts_at,
        d.ends_at,
        d.topic,
        d.notes,
        d.status,
        id,
        c.get("actor").org_id,
      ),
      audit(c, "session", id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/scheduling/rules", async (c: AppContext) => {
    permit(c, "sessions");
    const a = c.get("actor");
    const availability = await c.env.DB.prepare(
      "SELECT a.*,t.name teacher_name FROM el_teacher_availability a JOIN el_teachers t ON t.id=a.teacher_id WHERE a.org_id=? AND (? IS NULL OR t.branch_id=?)",
    )
      .bind(a.org_id, a.branch_id, a.branch_id)
      .all();
    const holidays = await c.env.DB.prepare(
      "SELECT * FROM el_holidays WHERE org_id=? AND (? IS NULL OR branch_id IS NULL OR branch_id=?) ORDER BY date",
    )
      .bind(a.org_id, a.branch_id, a.branch_id)
      .all();
    return c.json({
      availability: availability.results,
      holidays: holidays.results,
      timezone: await timezone(c),
    });
  });
  app.post("/api/scheduling/availability", async (c: AppContext) => {
    permit(c, "sessions", "manage");
    const d = z
      .object({
        teacher_id: z.uuid(),
        weekday: z.number().int().min(0).max(6),
        from_minute: z.number().int().min(0).max(1439),
        to_minute: z.number().int().min(1).max(1440),
      })
      .refine((x) => x.to_minute > x.from_minute)
      .parse(await c.req.json());
    await record(c, "teachers", d.teacher_id);
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_teacher_availability(id,org_id,teacher_id,weekday,from_minute,to_minute) VALUES(?,?,?,?,?,?)",
      ).bind(
        id,
        c.get("actor").org_id,
        d.teacher_id,
        d.weekday,
        d.from_minute,
        d.to_minute,
      ),
      audit(c, "availability", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/scheduling/holidays", async (c: AppContext) => {
    permit(c, "sessions", "manage");
    const d = z
      .object({
        branch_id: z.uuid().nullable(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        name: z.string().min(1).max(160),
      })
      .parse(await c.req.json());
    if (d.branch_id) {
      scope(c, d.branch_id);
      assert(
        await c.env.DB.prepare(
          "SELECT id FROM el_branches WHERE id=? AND org_id=?",
        )
          .bind(d.branch_id, c.get("actor").org_id)
          .first(),
        400,
        "Branch not found",
      );
    } else
      assert(
        !c.get("actor").branch_id,
        403,
        "Organization-wide permission required",
      );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_holidays(id,org_id,branch_id,date,name) VALUES(?,?,?,?,?)",
      ).bind(id, c.get("actor").org_id, d.branch_id, d.date, d.name),
      audit(c, "holiday", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  for (const kind of ["availability", "holidays"])
    app.delete(`/api/scheduling/${kind}/:id`, async (c: AppContext) => {
      permit(c, "sessions", "manage");
      const table =
        kind === "availability" ? "el_teacher_availability" : "el_holidays";
      const a = c.get("actor");
      const before = await c.env.DB.prepare(
        `SELECT * FROM ${table} WHERE id=? AND org_id=?`,
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
      assert(before, 404, "Rule not found");
      if (kind === "availability")
        await record(c, "teachers", before.teacher_id);
      else if (before.branch_id) scope(c, before.branch_id);
      else assert(!a.branch_id, 403, "Organization-wide permission required");
      await c.env.DB.batch([
        c.env.DB.prepare(`DELETE FROM ${table} WHERE id=? AND org_id=?`).bind(
          before.id,
          a.org_id,
        ),
        audit(c, kind, before.id, "delete", before, null),
      ]);
      return c.json({ ok: true });
    });
  app.get("/api/sessions/:id/attendance", readAttendance);
  app.post("/api/sessions/:id/attendance", writeAttendance);
  app.get("/api/academic/performance", async (c: AppContext) => {
    permit(c, "reports");
    const a = c.get("actor");
    const rows = await c.env.DB.prepare(
      "SELECT s.id,s.name,s.code,s.branch_id,count(DISTINCT at.id) attendance_count,COALESCE(round(100.0*count(DISTINCT CASE WHEN at.status IN ('present','late','left_early') THEN at.id END)/NULLIF(count(DISTINCT CASE WHEN at.status<>'excused' THEN at.id END),0),1),0) attendance_percent,(SELECT round(100.0*sum(r.score)/NULLIF(sum(ex.max_score),0),1) FROM el_exam_results r JOIN el_exams ex ON ex.id=r.exam_id WHERE r.student_id=s.id AND r.status='final') exam_percent FROM el_students s LEFT JOIN el_attendance at ON at.student_id=s.id WHERE s.org_id=? AND (? IS NULL OR s.branch_id=?) GROUP BY s.id ORDER BY s.name LIMIT 1000",
    )
      .bind(a.org_id, a.branch_id, a.branch_id)
      .all();
    return c.json({ data: rows.results });
  });
}

export async function readAttendance(c: AppContext) {
  permit(c, "attendance");
  const s = await session(c, c.req.param("id")!);
  const rows = await c.env.DB.prepare(
    "SELECT st.id student_id,st.name,st.code,a.id attendance_id,a.status,a.arrival,a.departure,a.notes FROM el_enrollments e JOIN el_students st ON st.id=e.student_id LEFT JOIN el_attendance a ON a.session_id=? AND a.student_id=st.id WHERE e.group_id=? AND e.org_id=? AND e.status<>'waiting' AND unixepoch(e.created_at)<=? AND (e.status IN ('active','completed') OR unixepoch(e.updated_at)>=?) ORDER BY st.name",
  )
    .bind(s.id, s.group_id, s.org_id, s.starts_at, s.starts_at)
    .all();
  return c.json({ session: s, data: rows.results });
}

export async function writeAttendance(c: AppContext) {
  permit(c, "attendance", "edit");
  const s = await session(c, c.req.param("id")!);
  assert(
    s.status !== "cancelled",
    409,
    "Cannot record attendance for a cancelled session",
  );
  assert(s.starts_at <= now(), 409, "Cannot pre-record future attendance");
  const d = z
    .object({
      rows: z
        .array(
          z
            .object({
              student_id: z.uuid(),
              status: z.enum([
                "present",
                "absent",
                "late",
                "excused",
                "left_early",
              ]),
              arrival: timestamp.nullable().default(null),
              departure: timestamp.nullable().default(null),
              notes: text,
            })
            .refine(
              (x) =>
                x.arrival === null ||
                x.departure === null ||
                x.departure >= x.arrival,
              { message: "Departure must follow arrival" },
            ),
        )
        .min(1)
        .max(500),
    })
    .parse(await c.req.json());
  const eligible = (
    await c.env.DB.prepare(
      "SELECT st.id,st.is_demo FROM el_enrollments e JOIN el_students st ON st.id=e.student_id WHERE e.group_id=? AND e.org_id=? AND e.status<>'waiting' AND unixepoch(e.created_at)<=? AND (e.status IN ('active','completed') OR unixepoch(e.updated_at)>=?)",
    )
      .bind(s.group_id, s.org_id, s.starts_at, s.starts_at)
      .all<{ id: string; is_demo: number }>()
  ).results;
  assert(
    new Set(d.rows.map((x) => x.student_id)).size === d.rows.length,
    400,
    "Duplicate student",
  );
  assert(
    d.rows.every((r) => eligible.some((e) => e.id === r.student_id)),
    403,
    "One or more students are not eligible for this session",
  );
  assert(
    d.rows.every(
      (r) =>
        (r.arrival === null || Math.abs(r.arrival - s.starts_at) <= 86400) &&
        (r.departure === null || Math.abs(r.departure - s.ends_at) <= 86400),
    ),
    400,
    "Arrival and departure must be within one day of the session",
  );
  const a = c.get("actor"),
    statements = [];
  for (const r of d.rows) {
    const demo =
      s.is_demo && eligible.find((x) => x.id === r.student_id)!.is_demo ? 1 : 0;
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,arrival,departure,notes,recorded_by,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,student_id) DO UPDATE SET status=excluded.status,arrival=excluded.arrival,departure=excluded.departure,notes=excluded.notes,recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP",
      ).bind(
        uid(),
        a.org_id,
        s.id,
        r.student_id,
        r.status,
        r.arrival,
        r.departure,
        r.notes,
        a.user_id,
        demo,
      ),
    );
    if (r.status === "absent")
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_academic_alerts(id,org_id,branch_id,student_id,session_id,kind,message,is_demo) VALUES(?,?,?,?,?,'absence',?,?) ON CONFLICT(session_id,student_id,kind) DO UPDATE SET message=excluded.message",
        ).bind(
          uid(),
          a.org_id,
          s.branch_id,
          r.student_id,
          s.id,
          "Student recorded absent. In-app guardian alert.",
          demo,
        ),
      );
    else
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM el_academic_alerts WHERE session_id=? AND student_id=? AND kind='absence'",
        ).bind(s.id, r.student_id),
      );
  }
  await c.env.DB.batch([
    ...statements,
    audit(c, "attendance", s.id, "bulk_update", null, {
      count: d.rows.length,
    }),
  ]);
  return c.json({ ok: true });
}
