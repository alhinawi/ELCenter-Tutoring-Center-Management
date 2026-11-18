import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { permit, scope, type AppContext } from "./app";
import { date } from "./finance";
import { assert } from "./security";
export function registerReports(app: Hono<any>) {
  app.get("/api/reports/options", async (c: AppContext) => {
    permit(c, "reports");
    const a = c.get("actor"),
      out: Record<string, unknown> = {};
    for (const table of ["branches", "courses", "teachers"]) {
      out[table] = (
        await c.env.DB.prepare(
          `SELECT id,name FROM el_${table} WHERE org_id=?${table === "branches" ? " AND (? IS NULL OR id=?)" : table === "teachers" ? " AND (? IS NULL OR branch_id=?)" : " AND (? IS NULL OR branch_id=?)"} ORDER BY name LIMIT 300`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    }
    return c.json(out);
  });

  app.get("/api/reports/overview", async (c: AppContext) => {
    permit(c, "reports");
    const a = c.get("actor"),
      d = z
        .object({
          from: date,
          to: date,
          branch_id: z.union([z.uuid(), z.literal("")]).default(""),
          course_id: z.union([z.uuid(), z.literal("")]).default(""),
          teacher_id: z.union([z.uuid(), z.literal("")]).default(""),
        })
        .parse(c.req.query());
    assert(d.to >= d.from, 400, "Report end must follow start");
    const days = Temporal.PlainDate.from(d.from).until(
      Temporal.PlainDate.from(d.to),
    ).days;
    assert(days <= 366, 400, "Reports are limited to 366 days");
    const branch = a.branch_id || d.branch_id || null;
    scope(c, branch);
    const timezone = (await c.env.DB.prepare(
        "SELECT timezone FROM el_organizations WHERE id=?",
      )
        .bind(a.org_id)
        .first<{ timezone: string }>())!.timezone,
      start = Math.floor(
        Temporal.PlainDate.from(d.from).toZonedDateTime(timezone)
          .epochMilliseconds / 1000,
      ),
      end = Math.floor(
        Temporal.PlainDate.from(d.to).add({ days: 1 }).toZonedDateTime(timezone)
          .epochMilliseconds / 1000,
      );
    for (const [table, id] of [
      ["courses", d.course_id],
      ["teachers", d.teacher_id],
    ])
      if (id)
        assert(
          await c.env.DB.prepare(
            `SELECT id FROM el_${table} WHERE id=? AND org_id=?`,
          )
            .bind(id, a.org_id)
            .first(),
          400,
          "Invalid report filter",
        );
    const academic = (
      await c.env.DB.prepare(
        "SELECT g.id,g.name,b.name branch_name,co.name course_name,t.name teacher_name,g.capacity,(SELECT count(*) FROM el_enrollments en WHERE en.group_id=g.id AND en.status='active') active_students,(SELECT count(*) FROM el_enrollments en WHERE en.group_id=g.id AND en.status IN ('withdrawn','transferred')) departed_students,(SELECT count(*) FROM el_class_sessions se WHERE se.group_id=g.id AND se.starts_at>=? AND se.starts_at<? AND se.status<>'cancelled') sessions,(SELECT round(avg(r.score*100.0/e.max_score),1) FROM el_exam_results r JOIN el_exams e ON e.id=r.exam_id WHERE e.group_id=g.id AND r.status='final' AND e.scheduled_at>=? AND e.scheduled_at<?) average_score,(SELECT count(*) FROM el_lessons l WHERE l.group_id=g.id AND l.status='published') published_lessons,(SELECT count(*) FROM el_lesson_progress p JOIN el_lessons l ON l.id=p.lesson_id WHERE l.group_id=g.id AND l.status='published' AND p.completed_at>=? AND p.completed_at<?) completed_checks FROM el_groups g JOIN el_branches b ON b.id=g.branch_id JOIN el_courses co ON co.id=g.course_id JOIN el_teachers t ON t.id=g.teacher_id WHERE g.org_id=? AND (? IS NULL OR g.branch_id=?) AND (?='' OR g.course_id=?) AND (?='' OR g.teacher_id=?) ORDER BY b.name,g.name LIMIT 301",
      )
        .bind(
          start,
          end,
          start,
          end,
          start,
          end,
          a.org_id,
          branch,
          branch,
          d.course_id,
          d.course_id,
          d.teacher_id,
          d.teacher_id,
        )
        .all()
    ).results;
    const attendance = (
      await c.env.DB.prepare(
        "SELECT g.name group_name,count(*) records,sum(CASE WHEN at.status IN ('present','late','left_early') THEN 1 ELSE 0 END) attended,sum(CASE WHEN at.status='absent' THEN 1 ELSE 0 END) absent,round(100.0*sum(CASE WHEN at.status IN ('present','late','left_early') THEN 1 ELSE 0 END)/nullif(count(*),0),1) attendance_percent FROM el_attendance at JOIN el_class_sessions se ON se.id=at.session_id JOIN el_groups g ON g.id=se.group_id WHERE at.org_id=? AND (? IS NULL OR se.branch_id=?) AND se.starts_at>=? AND se.starts_at<? AND se.status<>'cancelled' AND (?='' OR g.course_id=?) AND (?='' OR se.teacher_id=?) GROUP BY g.id,g.name ORDER BY g.name LIMIT 301",
      )
        .bind(
          a.org_id,
          branch,
          branch,
          start,
          end,
          d.course_id,
          d.course_id,
          d.teacher_id,
          d.teacher_id,
        )
        .all()
    ).results;
    const workload = (
      await c.env.DB.prepare(
        "SELECT t.id,t.name,count(*) sessions,sum(se.ends_at-se.starts_at)/60 minutes,round(sum(se.ends_at-se.starts_at)/3600.0,1) hours FROM el_class_sessions se JOIN el_teachers t ON t.id=se.teacher_id JOIN el_groups g ON g.id=se.group_id WHERE se.org_id=? AND (? IS NULL OR se.branch_id=?) AND se.starts_at>=? AND se.starts_at<? AND se.status<>'cancelled' AND (?='' OR g.course_id=?) AND (?='' OR se.teacher_id=?) GROUP BY t.id,t.name ORDER BY t.name LIMIT 301",
      )
        .bind(
          a.org_id,
          branch,
          branch,
          start,
          end,
          d.course_id,
          d.course_id,
          d.teacher_id,
          d.teacher_id,
        )
        .all()
    ).results;
    const rooms = (
      await c.env.DB.prepare(
        "SELECT cl.id,cl.name,b.name branch_name,cl.capacity,count(se.id) sessions,COALESCE(sum(se.ends_at-se.starts_at)/60,0) booked_minutes FROM el_classrooms cl JOIN el_branches b ON b.id=cl.branch_id LEFT JOIN el_class_sessions se ON se.classroom_id=cl.id AND se.status<>'cancelled' AND se.starts_at>=? AND se.starts_at<? WHERE cl.org_id=? AND (? IS NULL OR cl.branch_id=?) GROUP BY cl.id,cl.name,b.name,cl.capacity ORDER BY b.name,cl.name LIMIT 301",
      )
        .bind(start, end, a.org_id, branch, branch)
        .all()
    ).results;
    const branches = (
      await c.env.DB.prepare(
        "SELECT b.id,b.name,(SELECT count(*) FROM el_students s WHERE s.branch_id=b.id AND s.status='active') active_students,(SELECT count(*) FROM el_students s WHERE s.branch_id=b.id AND s.status='withdrawn') withdrawn_students,(SELECT count(*) FROM el_leads le WHERE le.branch_id=b.id AND le.created_at>=? AND le.created_at<?) new_leads,(SELECT count(*) FROM el_leads le WHERE le.branch_id=b.id AND le.stage='registered' AND le.created_at>=? AND le.created_at<?) converted_leads FROM el_branches b WHERE b.org_id=? AND (? IS NULL OR b.id=?) ORDER BY b.name LIMIT 101",
      )
        .bind(
          d.from,
          d.to + " 23:59:59",
          d.from,
          d.to + " 23:59:59",
          a.org_id,
          branch,
          branch,
        )
        .all()
    ).results;
    let finance: unknown[] = [],
      payroll: unknown[] = [];
    if (a.permissions.includes("finance:view"))
      finance = (
        await c.env.DB.prepare(
          "SELECT b.id,b.name,COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.branch_id=b.id AND p.date>=? AND p.date<=?),0) net_collections,COALESCE((SELECT sum(e.amount) FROM el_expenses e WHERE e.branch_id=b.id AND e.status IN ('approved','paid') AND e.date>=? AND e.date<=?),0) approved_expenses,COALESCE((SELECT sum(i.total-COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.invoice_id=i.id),0)) FROM el_invoices i WHERE i.branch_id=b.id AND i.status='issued' AND i.date<=?),0) current_receivables FROM el_branches b WHERE b.org_id=? AND (? IS NULL OR b.id=?) ORDER BY b.name LIMIT 101",
        )
          .bind(d.from, d.to, d.from, d.to, d.to, a.org_id, branch, branch)
          .all()
      ).results;
    if (a.permissions.includes("payroll:view"))
      payroll = (
        await c.env.DB.prepare(
          "SELECT month,status,sum(total) total,count(*) statements FROM (SELECT month,status,total FROM el_payroll WHERE org_id=? AND (? IS NULL OR branch_id=?) AND month>=? AND month<=? UNION ALL SELECT month,status,total FROM el_staff_payroll WHERE org_id=? AND (? IS NULL OR branch_id=?) AND month>=? AND month<=?) GROUP BY month,status ORDER BY month,status LIMIT 101",
        )
          .bind(
            a.org_id,
            branch,
            branch,
            d.from.slice(0, 7),
            d.to.slice(0, 7),
            a.org_id,
            branch,
            branch,
            d.from.slice(0, 7),
            d.to.slice(0, 7),
          )
          .all()
      ).results;
    const sections = {
      academic,
      attendance,
      workload,
      rooms,
      branches,
      finance,
      payroll,
    };
    for (const [section, rows] of Object.entries(sections)) {
      const cap = ["branches", "finance", "payroll"].includes(section)
        ? 100
        : 300;
      assert(
        rows.length <= cap,
        400,
        `Report section ${section} exceeds ${cap} rows. Narrow the branch, course, teacher or date filters where applicable. No partial report was generated.`,
      );
    }
    return c.json({
      limits: {
        academic: 300,
        attendance: 300,
        workload: 300,
        rooms: 300,
        branches: 100,
        finance: 100,
        payroll: 100,
      },
      filters: d,
      academic,
      attendance,
      workload,
      rooms,
      branches,
      finance,
      payroll,
      notes: {
        scope:
          "Academic filters apply to groups, attendance and teacher workload. Room and branch summaries use branch/date filters.",
        capacity:
          "Current active enrollments divided by current capacity, not historical snapshots.",
        completion:
          "Published lesson completion checks during the range, not certified course completion.",
        retention: "Current active/withdrawn counts are not cohort retention.",
        finance:
          "Collections and approved expenses are operational figures, not profit. Receivables use current payment totals for invoices issued by report end; use finance cutoff reports for historical balances.",
        rooms:
          "Booked minutes only. Utilization percent needs explicit operating-hour capacity.",
      },
    });
  });
}
