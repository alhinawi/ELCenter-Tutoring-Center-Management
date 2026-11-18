import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import {
  identity,
  ownedStudent,
  groupAccess,
  portalRoles,
} from "./portal-access";
const schema = z
  .object({
    status: z.enum(["present", "absent", "late", "excused", "left_early"]),
    arrival: z
      .number()
      .int()
      .min(1577836800)
      .max(4102444800)
      .nullable()
      .default(null),
    departure: z
      .number()
      .int()
      .min(1577836800)
      .max(4102444800)
      .nullable()
      .default(null),
    notes: z.string().trim().max(1000).default(""),
    reason: z.string().trim().min(5).max(1000),
  })
  .refine(
    (d) =>
      d.arrival === null || d.departure === null || d.departure >= d.arrival,
    "Departure must follow arrival",
  );
export function registerAttendanceCorrections(app: Hono<any>) {
  app.get("/api/attendance-corrections", async (c: AppContext) => {
    permit(c, "attendance");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT r.*,st.name student_name,g.name group_name,s.starts_at,u.name requester FROM el_attendance_corrections r JOIN el_attendance at ON at.id=r.attendance_id JOIN el_students st ON st.id=at.student_id JOIN el_class_sessions s ON s.id=at.session_id JOIN el_groups g ON g.id=s.group_id JOIN el_users u ON u.id=r.requested_by WHERE r.org_id=? AND (? IS NULL OR r.branch_id=?) ORDER BY r.created_at DESC,r.id LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/attendance/:id/corrections", async (c: AppContext) => {
    permit(c, "attendance", "edit");
    const a = c.get("actor"),
      d = schema.parse(await c.req.json()),
      row = await c.env.DB.prepare(
        "SELECT at.*,s.branch_id,s.starts_at,s.ends_at,s.status session_status FROM el_attendance at JOIN el_class_sessions s ON s.id=at.session_id WHERE at.id=? AND at.org_id=?",
      )
        .bind(c.req.param("id"), a.org_id)
        .first<Record<string, any>>();
    assert(row, 404, "Attendance record not found");
    scope(c, row.branch_id);
    return submitCorrection(c, row, d);
  });
  for (const prefix of ["/api/portal/attendance", "/api/lms/attendance"]) {
    app.get(prefix + "/:id/corrections", async (c: AppContext) => {
      const row = await portalAttendance(c);
      const data = (
        await c.env.DB.prepare(
          "SELECT id,new_status,reason,status,decision_note,created_at,reviewed_at FROM el_attendance_corrections WHERE org_id=? AND attendance_id=? AND requested_by=? ORDER BY created_at DESC,id DESC LIMIT 30",
        )
          .bind(row.org_id, row.id, c.get("actor").user_id)
          .all()
      ).results;
      const pending = !!(await c.env.DB.prepare(
        "SELECT id FROM el_attendance_corrections WHERE attendance_id=? AND status='pending'",
      )
        .bind(row.id)
        .first());
      return c.json({ data, pending });
    });
    app.post(prefix + "/:id/corrections", async (c: AppContext) => {
      const row = await portalAttendance(c),
        d = z
          .object({
            status: z.enum([
              "present",
              "absent",
              "late",
              "excused",
              "left_early",
            ]),
            reason: z.string().trim().min(5).max(1000),
          })
          .strict()
          .parse(await c.req.json());
      // Portal requests change status only. Preserve internal notes and recorded times.
      assert(
        d.status !== row.status,
        400,
        "Choose a different attendance status",
      );
      return submitCorrection(c, row, {
        ...d,
        arrival: row.arrival,
        departure: row.departure,
        notes: row.notes,
      });
    });
  }

  app.post(
    "/api/attendance-corrections/:id/decision",
    async (c: AppContext) => {
      permit(c, "attendance", "approve");
      const a = c.get("actor"),
        d = z
          .object({
            decision: z.enum(["approved", "rejected"]),
            note: z.string().trim().min(3).max(1000),
          })
          .parse(await c.req.json()),
        before = await c.env.DB.prepare(
          "SELECT * FROM el_attendance_corrections WHERE id=? AND org_id=?",
        )
          .bind(c.req.param("id"), a.org_id)
          .first<Record<string, any>>();
      assert(before, 404, "Correction not found");
      scope(c, before.branch_id);
      assert(before.status === "pending", 409, "Correction already finalized");
      assert(
        before.requested_by !== a.user_id,
        403,
        "Independent reviewer required",
      );
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE el_attendance_corrections SET status=?,reviewed_by=?,decision_note=?,reviewed_at=? WHERE id=? AND org_id=?",
        ).bind(d.decision, a.user_id, d.note, now(), before.id, a.org_id),
        audit(c, "attendance_correction", before.id, d.decision, before, d),
      ]);
      return c.json({ ok: true });
    },
  );
}

async function portalAttendance(c: AppContext) {
  const a = c.get("actor");
  assert(
    portalRoles.includes(a.system_key),
    403,
    "Use the backoffice correction workflow",
  );
  const row = await c.env.DB.prepare(
    "SELECT at.*,s.branch_id,s.starts_at,s.ends_at,s.group_id,s.teacher_id,s.status session_status FROM el_attendance at JOIN el_class_sessions s ON s.id=at.session_id WHERE at.id=? AND at.org_id=?",
  )
    .bind(c.req.param("id"), a.org_id)
    .first<Record<string, any>>();
  assert(row, 404, "Attendance record not found");
  scope(c, row.branch_id);
  if (a.system_key === "teacher") {
    permit(c, "attendance", "edit");
    const link = await identity(c);
    if (link.teacher_id !== row.teacher_id)
      await groupAccess(c, row.group_id, true);
  } else await ownedStudent(c, row.student_id);
  return row;
}
async function submitCorrection(
  c: AppContext,
  row: Record<string, any>,
  d: z.infer<typeof schema>,
) {
  const a = c.get("actor");
  assert(row.session_status !== "cancelled", 409, "Cancelled session");
  assert(
    (d.arrival === null || Math.abs(d.arrival - row.starts_at) <= 86400) &&
      (d.departure === null || Math.abs(d.departure - row.ends_at) <= 86400),
    400,
    "Times must be within one day of the session",
  );
  assert(
    d.status !== row.status ||
      d.arrival !== row.arrival ||
      d.departure !== row.departure ||
      d.notes !== row.notes,
    400,
    "No attendance change",
  );
  const requests = await c.env.DB.prepare(
    "SELECT count(*) n FROM el_attendance_corrections WHERE org_id=? AND requested_by=? AND created_at>=?",
  )
    .bind(a.org_id, a.user_id, now() - 86400)
    .first<{ n: number }>();
  assert(
    (requests?.n ?? 0) < 100,
    429,
    "Daily correction request limit reached",
  );
  const pending = await c.env.DB.prepare(
    "SELECT id FROM el_attendance_corrections WHERE attendance_id=? AND status='pending'",
  )
    .bind(row.id)
    .first();
  assert(!pending, 409, "A correction is already pending");
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO el_attendance_corrections(id,org_id,branch_id,attendance_id,base_revision,old_status,new_status,arrival,departure,notes,reason,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      a.org_id,
      row.branch_id,
      row.id,
      row.revision,
      row.status,
      d.status,
      d.arrival,
      d.departure,
      d.notes,
      d.reason,
      a.user_id,
      now(),
    ),
    audit(c, "attendance_correction", id, "request", row, d),
  ]);
  return c.json({ id }, 201);
}
