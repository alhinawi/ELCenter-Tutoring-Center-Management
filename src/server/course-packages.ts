import { calendarDate as day } from "./dates";
import { Temporal } from "@js-temporal/polyfill";
import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { record } from "./academic";
import { uid, now } from "./db";
import { assert } from "./security";
export function packageEnrollmentDay(timezone: string, epochMs = Date.now()) {
  return Temporal.Instant.fromEpochMilliseconds(epochMs)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function registerCoursePackages(app: Hono<any>) {
  app.get("/api/course-packages", async (c: AppContext) => {
    permit(c, "courses");
    const a = c.get("actor");
    const rows = (
      await c.env.DB.prepare(
        "SELECT * FROM el_course_packages WHERE org_id=? AND (? IS NULL OR branch_id=?) ORDER BY created_at DESC,id LIMIT 100",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all<Record<string, any>>()
    ).results;
    const items = (
      await c.env.DB.prepare(
        "SELECT i.package_id,i.course_id,c.name,c.branch_id FROM el_course_package_items i JOIN el_course_packages p ON p.id=i.package_id AND p.org_id=i.org_id JOIN el_courses c ON c.id=i.course_id AND c.org_id=i.org_id WHERE p.org_id=? AND (? IS NULL OR p.branch_id=?) ORDER BY c.name LIMIT 1000",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all<Record<string, any>>()
    ).results;
    for (const item of items) scope(c, item.branch_id);
    const zone = (await c.env.DB.prepare(
      "SELECT timezone FROM el_organizations WHERE id=?",
    )
      .bind(a.org_id)
      .first<{ timezone: string }>())!.timezone;
    const localDay = packageEnrollmentDay(zone);
    return c.json({
      enrollment_day: localDay,
      enrollment_timezone: zone,
      data: rows.map((r) => ({
        ...r,
        enrollment_window_open:
          (!r.enrollment_opens_on || localDay >= r.enrollment_opens_on) &&
          (!r.enrollment_closes_on || localDay <= r.enrollment_closes_on),
        courses: items.filter((i) => i.package_id === r.id),
      })),
    });
  });
  app.post("/api/course-packages", async (c: AppContext) => {
    permit(c, "courses", "create");
    const a = c.get("actor"),
      d = z
        .object({
          branch_id: z.uuid(),
          name: z.string().trim().min(1).max(160),
          price: z.number().int().min(1).max(1000000000),
          course_ids: z.array(z.uuid()).min(2).max(10),
          enrollment_opens_on: day.nullable().optional().default(null),
          enrollment_closes_on: day.nullable().optional().default(null),
        })
        .refine(
          (d) =>
            !d.enrollment_opens_on ||
            !d.enrollment_closes_on ||
            d.enrollment_closes_on >= d.enrollment_opens_on,
          "Invalid package enrollment window",
        )
        .parse(await c.req.json());
    scope(c, d.branch_id);
    assert(
      new Set(d.course_ids).size === d.course_ids.length,
      400,
      "Duplicate course",
    );
    const branch = await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
    )
      .bind(d.branch_id, a.org_id)
      .first();
    assert(branch, 404, "Active branch not found");
    for (const id of d.course_ids) {
      const course = await record(c, "courses", id);
      assert(course.status === "active", 409, "Choose active courses");
    }
    const count = await c.env.DB.prepare(
      "SELECT count(*) n FROM el_course_packages WHERE org_id=?",
    )
      .bind(a.org_id)
      .first<{ n: number }>();
    assert((count?.n ?? 0) < 100, 409, "At most 100 package definitions");
    const currency = (await c.env.DB.prepare(
        "SELECT currency FROM el_organizations WHERE id=?",
      )
        .bind(a.org_id)
        .first<{ currency: string }>())!.currency,
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_course_packages(id,org_id,branch_id,name,price,currency,created_by,created_at,enrollment_opens_on,enrollment_closes_on) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.branch_id,
        d.name,
        d.price,
        currency,
        a.user_id,
        now(),
        d.enrollment_opens_on,
        d.enrollment_closes_on,
      ),
      ...d.course_ids.map((course) =>
        c.env.DB.prepare(
          "INSERT INTO el_course_package_items(org_id,package_id,course_id) VALUES(?,?,?)",
        ).bind(a.org_id, id, course),
      ),
      audit(c, "course_package", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/course-packages/:id", async (c: AppContext) => {
    permit(c, "courses", "edit");
    const a = c.get("actor"),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_course_packages WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id"), a.org_id)
        .first<Record<string, any>>();
    assert(before, 404, "Package not found");
    scope(c, before.branch_id);
    const d = z
      .object({ status: z.enum(["active", "archived"]) })
      .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_course_packages SET status=? WHERE id=? AND org_id=?",
      ).bind(d.status, before.id, a.org_id),
      audit(c, "course_package", before.id, "status", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/course-packages/:id/enroll", async (c: AppContext) => {
    permit(c, "courses");
    permit(c, "groups", "edit");
    permit(c, "finance", "create");
    const a = c.get("actor"),
      d = z
        .object({
          student_id: z.uuid(),
          group_ids: z.array(z.uuid()).min(2).max(10),
          invoice_number: z.string().trim().min(1).max(60),
          date: day,
          due_date: day,
        })
        .refine((d) => d.due_date >= d.date, "Due date precedes invoice date")
        .parse(await c.req.json()),
      p = await c.env.DB.prepare(
        "SELECT * FROM el_course_packages WHERE id=? AND org_id=? AND status='active'",
      )
        .bind(c.req.param("id"), a.org_id)
        .first<Record<string, any>>();
    assert(p, 404, "Active package not found");
    scope(c, p.branch_id);
    const zone = (await c.env.DB.prepare(
        "SELECT timezone FROM el_organizations WHERE id=?",
      )
        .bind(a.org_id)
        .first<{ timezone: string }>())!.timezone,
      localDay = packageEnrollmentDay(zone);
    assert(
      (!p.enrollment_opens_on || localDay >= p.enrollment_opens_on) &&
        (!p.enrollment_closes_on || localDay <= p.enrollment_closes_on),
      409,
      "Package enrollment window is not open on the organization-local day",
    );
    const student = await record(c, "students", d.student_id);
    assert(
      student.branch_id === p.branch_id &&
        ["new", "active"].includes(student.status),
      409,
      "Active student must share package branch",
    );
    const items = (
      await c.env.DB.prepare(
        "SELECT course_id FROM el_course_package_items WHERE package_id=? AND org_id=?",
      )
        .bind(p.id, a.org_id)
        .all<{ course_id: string }>()
    ).results;
    assert(
      items.length === d.group_ids.length &&
        new Set(d.group_ids).size === d.group_ids.length,
      400,
      "Choose exactly one group for each package course",
    );
    const groups: Record<string, any>[] = [];
    for (const id of d.group_ids) {
      const g = await record(c, "groups", id);
      assert(
        g.branch_id === p.branch_id &&
          g.status === "active" &&
          items.some((i) => i.course_id === g.course_id),
        409,
        "Group does not match package",
      );
      groups.push(g);
    }
    assert(
      new Set(groups.map((g) => g.course_id)).size === items.length,
      400,
      "Choose one group per course",
    );
    const existing = await c.env.DB.prepare(
      "SELECT id FROM el_course_package_orders WHERE package_id=? AND student_id=?",
    )
      .bind(p.id, student.id)
      .first();
    assert(!existing, 409, "Student already has this package");
    const invoice = uid(),
      order = uid(),
      summary = {
        package_id: p.id,
        enrolled_on: localDay,
        enrollment_timezone: zone,
        enrollment_opens_on: p.enrollment_opens_on,
        enrollment_closes_on: p.enrollment_closes_on,
        name: p.name,
        price: p.price,
        currency: p.currency,
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          course_id: g.course_id,
        })),
      };
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,currency,total,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        invoice,
        a.org_id,
        p.branch_id,
        student.id,
        d.invoice_number,
        d.date,
        d.due_date,
        p.currency,
        p.price,
        a.user_id,
      ),
      c.env.DB.prepare(
        "INSERT INTO el_invoice_items(id,org_id,invoice_id,description,quantity,unit_price) VALUES(?,?,?,?,1,?)",
      ).bind(
        uid(),
        a.org_id,
        invoice,
        p.name + " · " + groups.map((g) => g.name).join(" / "),
        p.price,
      ),
      ...groups.map((g) =>
        c.env.DB.prepare(
          "INSERT INTO el_enrollments(id,org_id,student_id,group_id) VALUES(?,?,?,?)",
        ).bind(uid(), a.org_id, student.id, g.id),
      ),
      c.env.DB.prepare(
        "INSERT INTO el_course_package_orders(id,org_id,package_id,student_id,invoice_id,summary_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        order,
        a.org_id,
        p.id,
        student.id,
        invoice,
        JSON.stringify(summary),
        a.user_id,
        now(),
      ),
      audit(c, "course_package", p.id, "enroll", null, {
        ...summary,
        student_id: student.id,
        invoice_id: invoice,
      }),
    ]);
    return c.json(
      { id: order, invoice_id: invoice, invoice_status: "draft" },
      201,
    );
  });
}
