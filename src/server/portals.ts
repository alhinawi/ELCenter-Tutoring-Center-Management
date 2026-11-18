import type { Hono } from "hono";
import { z } from "zod";
import { uid, now } from "./db";
import { assert } from "./security";
import { permit, scope, audit, type AppContext } from "./app";
import {
  identity,
  ownedStudent,
  portalRoles,
  groupAccess,
} from "./portal-access";
import { date } from "./finance";
export function registerPortals(app: Hono<any>) {
  app.get("/api/portal-links", async (c: AppContext) => {
    permit(c, "users", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT l.*,u.name user_name,COALESCE(s.name,g.name,t.name) profile_name FROM el_portal_links l JOIN el_users u ON u.id=l.user_id LEFT JOIN el_students s ON s.id=l.student_id LEFT JOIN el_guardians g ON g.id=l.guardian_id LEFT JOIN el_teachers t ON t.id=l.teacher_id WHERE l.org_id=? ORDER BY u.name LIMIT 500",
        )
          .bind(a.org_id)
          .all()
      ).results,
    });
  });
  app.get("/api/portal-links/options", async (c: AppContext) => {
    permit(c, "users", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const a = c.get("actor"),
      out: Record<string, unknown> = {
        users: (
          await c.env.DB.prepare(
            "SELECT u.id,u.name,r.system_key,m.branch_id FROM el_users u JOIN el_memberships m ON m.user_id=u.id JOIN el_roles r ON r.id=m.role_id WHERE m.org_id=? AND m.status='active' AND r.system_key IN ('student','parent_guardian','teacher') AND (? IS NULL OR m.branch_id=?) ORDER BY u.name LIMIT 500",
          )
            .bind(a.org_id, a.branch_id, a.branch_id)
            .all()
        ).results,
      };
    for (const table of ["students", "guardians", "teachers"])
      out[table] = (
        await c.env.DB.prepare(
          `SELECT id,name,branch_id FROM el_${table} WHERE org_id=? AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    return c.json(out);
  });
  app.post("/api/portal-links", async (c: AppContext) => {
    permit(c, "users", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const a = c.get("actor"),
      d = z
        .object({
          user_id: z.uuid(),
          kind: z.enum(["student", "guardian", "teacher"]),
          profile_id: z.uuid(),
        })
        .parse(await c.req.json()),
      table =
        d.kind === "guardian"
          ? "guardians"
          : d.kind === "student"
            ? "students"
            : "teachers",
      profile = await c.env.DB.prepare(
        `SELECT id,branch_id FROM el_${table} WHERE id=? AND org_id=?`,
      )
        .bind(d.profile_id, a.org_id)
        .first<{ id: string; branch_id: string }>();
    assert(profile, 404, "Profile not found");
    scope(c, profile.branch_id);
    const member = await c.env.DB.prepare(
      "SELECT m.branch_id,r.system_key FROM el_memberships m JOIN el_roles r ON r.id=m.role_id WHERE m.org_id=? AND m.user_id=? AND m.status='active'",
    )
      .bind(a.org_id, d.user_id)
      .first<{ branch_id: string | null; system_key: string }>();
    assert(
      member &&
        member.system_key ===
          (d.kind === "guardian" ? "parent_guardian" : d.kind) &&
        (!member.branch_id || member.branch_id === profile.branch_id),
      400,
      "Login role and branch must match the chosen profile",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_portal_links(id,org_id,user_id,kind,student_id,guardian_id,teacher_id,created_by) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.user_id,
        d.kind,
        d.kind === "student" ? profile.id : null,
        d.kind === "guardian" ? profile.id : null,
        d.kind === "teacher" ? profile.id : null,
        a.user_id,
      ),
      audit(c, "portal_link", id, "link_identity", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.delete("/api/portal-links/:id", async (c: AppContext) => {
    permit(c, "users", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    const a = c.get("actor"),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_portal_links WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(before, 404, "Link not found");
    const table =
        before.kind === "guardian"
          ? "guardians"
          : before.kind === "student"
            ? "students"
            : "teachers",
      p = await c.env.DB.prepare(
        `SELECT branch_id FROM el_${table} WHERE id=? AND org_id=?`,
      )
        .bind(before[before.kind + "_id"], a.org_id)
        .first<{ branch_id: string }>();
    scope(c, p?.branch_id);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_portal_links WHERE id=? AND org_id=?",
      ).bind(before.id, a.org_id),
      c.env.DB.prepare("DELETE FROM el_sessions WHERE user_id=?").bind(
        before.user_id,
      ),
      audit(c, "portal_link", before.id, "unlink_identity", before, null),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/portal", async (c: AppContext) => {
    const a = c.get("actor"),
      link = await identity(c);
    let children: unknown[] = [];
    if (link.kind !== "teacher")
      children = (
        await c.env.DB.prepare(
          `SELECT s.id,s.name,s.code,s.grade,s.school,s.branch_id,s.status FROM el_students s WHERE s.org_id=? AND ${link.kind === "student" ? "s.id=?" : "EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.student_id=s.id AND sg.org_id=s.org_id AND sg.guardian_id=?)"} AND (? IS NULL OR s.branch_id=?) ORDER BY s.name`,
        )
          .bind(
            a.org_id,
            link.kind === "student" ? link.student_id : link.guardian_id,
            a.branch_id,
            a.branch_id,
          )
          .all()
      ).results;
    return c.json({ kind: link.kind, profile: link.profile, children });
  });
  app.get("/api/portal/students/:id", async (c: AppContext) => {
    const student = await ownedStudent(c, c.req.param("id")!),
      a = c.get("actor"),
      id = student.id;
    const groups = (
      await c.env.DB.prepare(
        "SELECT g.id,g.name,g.code,g.status,g.teacher_id,g.course_id,t.name teacher_name,co.name course_name,en.status enrollment_status FROM el_enrollments en JOIN el_groups g ON g.id=en.group_id JOIN el_teachers t ON t.id=g.teacher_id JOIN el_courses co ON co.id=g.course_id WHERE en.org_id=? AND en.student_id=? AND en.status IN ('active','completed') ORDER BY g.name LIMIT 100",
      )
        .bind(a.org_id, id)
        .all()
    ).results;
    const sessions = (
      await c.env.DB.prepare(
        "SELECT s.id,s.starts_at,s.ends_at,s.topic,s.status,g.name group_name,t.name teacher_name,cl.name classroom_name FROM el_class_sessions s JOIN el_groups g ON g.id=s.group_id JOIN el_teachers t ON t.id=s.teacher_id JOIN el_classrooms cl ON cl.id=s.classroom_id WHERE s.org_id=? AND s.starts_at>=? AND s.starts_at<=? AND EXISTS(SELECT 1 FROM el_enrollments en WHERE en.student_id=? AND en.group_id=s.group_id AND en.org_id=s.org_id AND en.status='active') ORDER BY s.starts_at LIMIT 100",
      )
        .bind(a.org_id, now() - 86400, now() + 120 * 86400, id)
        .all()
    ).results;
    const attendance = (
      await c.env.DB.prepare(
        "SELECT a.status,a.arrival,a.departure,s.starts_at,s.topic,g.name group_name FROM el_attendance a JOIN el_class_sessions s ON s.id=a.session_id JOIN el_groups g ON g.id=s.group_id WHERE a.org_id=? AND a.student_id=? ORDER BY s.starts_at DESC LIMIT 200",
      )
        .bind(a.org_id, id)
        .all()
    ).results;
    const results = (
      await c.env.DB.prepare(
        "SELECT r.id,r.exam_id,r.score,r.feedback,e.max_score,e.pass_score,e.name,e.scheduled_at,g.name group_name FROM el_exam_results r JOIN el_exams e ON e.id=r.exam_id JOIN el_groups g ON g.id=e.group_id WHERE r.org_id=? AND r.student_id=? AND r.status='final' AND e.status<>'draft' ORDER BY e.scheduled_at DESC LIMIT 100",
      )
        .bind(a.org_id, id)
        .all()
    ).results;
    const invoices = (
      await c.env.DB.prepare(
        "SELECT i.id,i.number,i.date,i.due_date,i.total,i.currency,i.status,COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.invoice_id=i.id),0) paid FROM el_invoices i WHERE i.org_id=? AND i.student_id=? AND i.status<>'draft' ORDER BY i.date DESC LIMIT 100",
      )
        .bind(a.org_id, id)
        .all()
    ).results;
    const requests = (
      await c.env.DB.prepare(
        "SELECT id,kind,subject,body,requested_on,status,response,created_at FROM el_portal_requests WHERE org_id=? AND student_id=? AND user_id=? ORDER BY created_at DESC LIMIT 50",
      )
        .bind(a.org_id, id, a.user_id)
        .all()
    ).results;
    return c.json({
      student,
      groups,
      sessions,
      attendance,
      results,
      invoices,
      requests,
    });
  });
  app.get("/api/portal/invoices/:id", async (c: AppContext) => {
    const a = c.get("actor"),
      i = await c.env.DB.prepare(
        "SELECT * FROM el_invoices WHERE id=? AND org_id=? AND status<>'draft'",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(i, 404, "Invoice not found");
    const student = await ownedStudent(c, i.student_id);
    return c.json({
      data: {
        id: i.id,
        number: i.number,
        date: i.date,
        due_date: i.due_date,
        total: i.total,
        currency: i.currency,
        discount: i.discount,
        status: i.status,
      },
      student,
      items: (
        await c.env.DB.prepare(
          "SELECT description,quantity,unit_price FROM el_invoice_items WHERE invoice_id=? AND org_id=?",
        )
          .bind(i.id, a.org_id)
          .all()
      ).results,
      payments: (
        await c.env.DB.prepare(
          "SELECT id,date,amount,kind,method,reference FROM el_payments WHERE invoice_id=? AND org_id=? ORDER BY date",
        )
          .bind(i.id, a.org_id)
          .all()
      ).results,
      installments: (
        await c.env.DB.prepare(
          "SELECT due_date,amount FROM el_installments WHERE invoice_id=? AND org_id=? ORDER BY due_date",
        )
          .bind(i.id, a.org_id)
          .all()
      ).results,
    });
  });
  app.get("/api/portal/teacher", async (c: AppContext) => {
    const a = c.get("actor"),
      link = await identity(c);
    assert(link.kind === "teacher", 403, "Teacher profile required");
    const groups = (
      await c.env.DB.prepare(
        "SELECT g.id,g.name,g.code,g.status,co.name course_name,b.name branch_name,(SELECT count(*) FROM el_enrollments en WHERE en.group_id=g.id AND en.status='active') students FROM el_groups g JOIN el_courses co ON co.id=g.course_id JOIN el_branches b ON b.id=g.branch_id WHERE g.org_id=? AND g.teacher_id=? AND (? IS NULL OR g.branch_id=?) ORDER BY g.name LIMIT 100",
      )
        .bind(a.org_id, link.teacher_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    const sessions = (
      await c.env.DB.prepare(
        "SELECT s.id,s.starts_at,s.ends_at,s.topic,s.status,g.name group_name,cl.name classroom_name FROM el_class_sessions s JOIN el_groups g ON g.id=s.group_id JOIN el_classrooms cl ON cl.id=s.classroom_id WHERE s.org_id=? AND s.teacher_id=? AND s.starts_at>=? AND s.starts_at<=? AND (? IS NULL OR s.branch_id=?) ORDER BY s.starts_at LIMIT 100",
      )
        .bind(
          a.org_id,
          link.teacher_id,
          now() - 7 * 86400,
          now() + 90 * 86400,
          a.branch_id,
          a.branch_id,
        )
        .all()
    ).results;
    const exams = (
      await c.env.DB.prepare(
        "SELECT e.*,g.name group_name FROM el_exams e JOIN el_groups g ON g.id=e.group_id WHERE e.org_id=? AND g.teacher_id=? AND (? IS NULL OR g.branch_id=?) ORDER BY e.scheduled_at DESC LIMIT 100",
      )
        .bind(a.org_id, link.teacher_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    const payroll = (
      await c.env.DB.prepare(
        "SELECT month,base_amount,bonus,deduction,total,status,calculation_json FROM el_payroll WHERE org_id=? AND teacher_id=? AND status<>'draft' AND (? IS NULL OR branch_id=?) ORDER BY month DESC LIMIT 24",
      )
        .bind(a.org_id, link.teacher_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    const employee = await c.env.DB.prepare(
      "SELECT id,branch_id FROM el_employees WHERE org_id=? AND user_id=? AND teacher_id=? AND status='active'",
    )
      .bind(a.org_id, a.user_id, link.teacher_id)
      .first<{ id: string; branch_id: string }>();
    const leaves = employee
      ? (
          await c.env.DB.prepare(
            "SELECT id,type,starts_on,ends_on,reason,status,decision_note FROM el_leave_requests WHERE org_id=? AND employee_id=? ORDER BY starts_on DESC LIMIT 50",
          )
            .bind(a.org_id, employee.id)
            .all()
        ).results
      : [];
    return c.json({
      profile: link.profile,
      groups,
      sessions,
      exams,
      payroll,
      leaves,
      can_request_leave: !!employee,
    });
  });
  app.post("/api/portal/teacher/leave", async (c: AppContext) => {
    const a = c.get("actor"),
      link = await identity(c);
    assert(link.kind === "teacher", 403, "Teacher account required");
    const employee = await c.env.DB.prepare(
      "SELECT id,branch_id FROM el_employees WHERE org_id=? AND user_id=? AND teacher_id=? AND status='active'",
    )
      .bind(a.org_id, a.user_id, link.teacher_id)
      .first<{ id: string; branch_id: string }>();
    assert(
      employee,
      403,
      "HR must link your active employee and teacher records",
    );
    scope(c, employee.branch_id);
    const d = z
        .object({
          type: z.enum(["vacation", "sick", "unpaid", "other"]),
          starts_on: date,
          ends_on: date,
          reason: z.string().trim().min(1).max(160),
        })
        .refine((d) => d.ends_on >= d.starts_on)
        .parse(await c.req.json()),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_leave_requests(id,org_id,branch_id,employee_id,type,starts_on,ends_on,reason,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        employee.branch_id,
        employee.id,
        d.type,
        d.starts_on,
        d.ends_on,
        d.reason,
        a.user_id,
      ),
      audit(c, "leave", id, "request", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/portal/requests", async (c: AppContext) => {
    const a = c.get("actor"),
      link = await identity(c);
    assert(link.kind !== "teacher", 403, "Family account required");
    const d = z
        .object({
          student_id: z.uuid(),
          kind: z.enum(["absence_excuse", "meeting", "contact"]),
          subject: z.string().trim().min(1).max(160),
          body: z.string().trim().min(1).max(3000),
          requested_on: z.union([date, z.literal("")]).default(""),
        })
        .parse(await c.req.json()),
      student = await ownedStudent(c, d.student_id),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_portal_requests(id,org_id,branch_id,student_id,user_id,kind,subject,body,requested_on) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        student.branch_id,
        student.id,
        a.user_id,
        d.kind,
        d.subject,
        d.body,
        d.requested_on,
      ),
      audit(c, "portal_request", id, "submit", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/portal-requests", async (c: AppContext) => {
    permit(c, "students");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT r.*,s.name student_name FROM el_portal_requests r JOIN el_students s ON s.id=r.student_id WHERE r.org_id=? AND (? IS NULL OR r.branch_id=?) ORDER BY r.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/portal-requests/:id/decision", async (c: AppContext) => {
    permit(c, "students", "approve");
    const a = c.get("actor"),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_portal_requests WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(before, 404, "Request not found");
    scope(c, before.branch_id);
    const d = z
      .object({
        status: z.enum(["accepted", "rejected", "closed"]),
        response: z.string().trim().min(1).max(3000),
      })
      .parse(await c.req.json());
    assert(before.status === "pending", 409, "Request already decided");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_portal_requests SET status=?,response=?,decided_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(d.status, d.response, a.user_id, before.id),
      c.env.DB.prepare(
        "INSERT INTO el_notifications(id,org_id,user_id,title,body) VALUES(?,?,?,?,?)",
      ).bind(
        uid(),
        a.org_id,
        before.user_id,
        "Request update: " + before.subject,
        d.response,
      ),
      audit(c, "portal_request", before.id, "decision", before, d),
    ]);
    return c.json({ ok: true });
  });
}
