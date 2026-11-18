import type { Hono } from "hono";
import { seedAcademicDemo, seedLearningDemo } from "./demo";
import { z } from "zod";
import { assert } from "./security";
import { uid, searchPattern } from "./db";
import { permit, scope, audit, type AppContext } from "./app";
const text = z.string().trim().max(500).default(""),
  name = z.string().trim().min(1).max(160),
  code = z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_-]+$/),
  count = z.number().int().min(1).max(100000),
  money = z.number().int().min(0).max(100000000),
  date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((x) => !isNaN(Date.parse(x))),
  email = z.union([z.email(), z.literal("")]).default("");
const base = { branch_id: z.uuid(), name };
const schema = {
  students: z.object({
    ...base,
    code,
    photo: z
      .string()
      .regex(/^$|^\/images\/[a-zA-Z0-9._-]+$/)
      .default(""),
    birth_date: z.union([date, z.literal("")]).default(""),
    gender: z.enum(["", "male", "female", "other"]).default(""),
    national_id: z.string().trim().max(30).default(""),
    phone: text,
    email,
    address: text,
    school: text,
    grade: text,
    stage: text,
    emergency_contact: text,
    status: z
      .enum([
        "new",
        "active",
        "inactive",
        "suspended",
        "graduated",
        "withdrawn",
        "pending",
      ])
      .default("active"),
    notes: text,
  }),
  guardians: z.object({
    ...base,
    phone: text,
    email,
    address: text,
    status: z.enum(["active", "inactive"]).default("active"),
    notes: text,
  }),
  teachers: z.object({
    ...base,
    code,
    phone: text,
    email,
    qualification: text,
    specialization: text,
    experience: z.number().int().min(0).max(80).default(0),
    status: z.enum(["active", "inactive"]).default("active"),
    notes: text,
  }),
  courses: z
    .object({
      ...base,
      code,
      description: text,
      subject: text,
      stage: text,
      grade: text,
      curriculum: text,
      duration: count.default(12),
      sessions: count.default(12),
      price: money.default(0),
      capacity: count.default(30),
      registration_start: z.union([date, z.literal("")]).default(""),
      registration_end: z.union([date, z.literal("")]).default(""),
      status: z.enum(["active", "inactive", "archived"]).default("active"),
    })
    .refine(
      (x) =>
        !x.registration_start ||
        !x.registration_end ||
        x.registration_start <= x.registration_end,
      { message: "Registration end must follow start" },
    ),
  classrooms: z.object({
    ...base,
    code,
    floor: text,
    capacity: count.default(30),
    equipment: text,
    status: z.enum(["active", "inactive", "maintenance"]).default("active"),
  }),
  groups: z
    .object({
      ...base,
      code,
      course_id: z.uuid(),
      teacher_id: z.uuid(),
      classroom_id: z.uuid(),
      capacity: count.default(20),
      start_date: date,
      end_date: date,
      session_minutes: z.number().int().min(15).max(480).default(90),
      price: money.default(0),
      status: z.enum(["active", "inactive", "completed"]).default("active"),
    })
    .refine((x) => x.start_date <= x.end_date, {
      message: "End date must follow start date",
    }),
};
export type AcademicEntity = keyof typeof schema;
const entities = Object.keys(schema) as AcademicEntity[];
export async function record(
  c: AppContext,
  entity: AcademicEntity,
  id: string,
) {
  const a = c.get("actor");
  const row = await c.env.DB.prepare(
    `SELECT * FROM el_${entity} WHERE id=? AND org_id=?`,
  )
    .bind(id, a.org_id)
    .first<Record<string, any>>();
  assert(row, 404, "Record not found");
  scope(c, row.branch_id);
  return row;
}
async function branch(c: AppContext, id: string) {
  const a = c.get("actor");
  scope(c, id);
  assert(
    await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
    )
      .bind(id, a.org_id)
      .first(),
    400,
    "Choose an active branch",
  );
}
async function validateGroup(
  c: AppContext,
  d: Record<string, any>,
  existing?: string,
) {
  const a = c.get("actor");
  const room = await c.env.DB.prepare(
    "SELECT capacity FROM el_classrooms WHERE id=? AND org_id=? AND branch_id=? AND status='active'",
  )
    .bind(d.classroom_id, a.org_id, d.branch_id)
    .first<{ capacity: number }>();
  assert(
    room && room.capacity >= d.capacity,
    409,
    "Room unavailable or capacity exceeded",
  );
  assert(
    await c.env.DB.prepare(
      "SELECT t.id FROM el_teachers t JOIN el_teacher_branches b ON b.teacher_id=t.id WHERE t.id=? AND t.org_id=? AND b.branch_id=? AND t.status='active'",
    )
      .bind(d.teacher_id, a.org_id, d.branch_id)
      .first(),
    409,
    "Teacher not assigned to this branch",
  );
  assert(
    await c.env.DB.prepare(
      "SELECT c.id FROM el_courses c JOIN el_course_branches b ON b.course_id=c.id WHERE c.id=? AND c.org_id=? AND b.branch_id=? AND c.status='active'",
    )
      .bind(d.course_id, a.org_id, d.branch_id)
      .first(),
    409,
    "Course not assigned to this branch",
  );
  if (existing) {
    const n = await c.env.DB.prepare(
      "SELECT count(*) total FROM el_enrollments WHERE group_id=? AND status='active'",
    )
      .bind(existing)
      .first<{ total: number }>();
    assert(
      (n?.total ?? 0) <= d.capacity,
      409,
      "Capacity cannot be below active enrollment",
    );
  }
}
function csvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function registerAcademic(app: Hono<any>) {
  app.post("/api/demo/academic-seed", async (c: AppContext) => {
    const a = c.get("actor");
    assert(
      a.system_key === "business_owner" &&
        a.email.startsWith("demo-") &&
        a.email.endsWith("@example.invalid"),
      403,
      "Private demo only",
    );
    await seedAcademicDemo(c);
    return c.json({ ok: true });
  });
  app.post("/api/settings/demo/learning", async (c: AppContext) => {
    permit(c, "organization", "manage");
    assert(
      !c.get("actor").branch_id,
      403,
      "Organization-wide permission required",
    );
    await seedLearningDemo(c);
    return c.json({ ok: true });
  });
  app.put("/api/settings/demo", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide permission required");
    const d = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    if (d.enabled) {
      await seedAcademicDemo(c);
      return c.json({ enabled: true });
    }
    const tables = [
      "document_versions",
      "documents",
      "ticket_messages",
      "support_tickets",
      "library_reservations",
      "borrow_records",
      "library_copies",
      "library_books",
      "asset_transfers",
      "asset_events",
      "assets",
      "stock_sale_lines",
      "stock_sales",
      "purchase_lines",
      "purchase_orders",
      "stock_transfers",
      "stock_movements",
      "suppliers",
      "inventory_items",
      "lesson_progress",
      "submissions",
      "lessons",
      "assignments",
      "discussions",
      "portal_requests",
      "portal_links",
      "quiz_attempts",
      "delivery_logs",
      "notifications",
      "announcements",
      "lead_interactions",
      "leads",
      "visits",
      "campaigns",
      "employee_shifts",
      "notification_templates",
      "employee_reviews",
      "leave_requests",
      "employee_attendance",
      "staff_payroll",
      "contracts",
      "applications",
      "employees",
      "departments",
      "expense_payments",
      "reconciliation_lines",
      "reconciliations",
      "installments",
      "invoice_teacher_shares",
      "payments",
      "invoice_items",
      "invoices",
      "coupons",
      "expenses",
      "payroll",
      "compensation",
      "journal_lines",
      "journals",
      "financial_periods",
      "accounts",
      "exam_answers",
      "exam_results",
      "questions",
      "exams",
      "academic_alerts",
      "attendance",
      "class_sessions",
      "teacher_availability",
      "holidays",
      "transfers",
      "enrollments",
      "student_guardians",
      "teacher_branches",
      "course_branches",
      "groups",
      "classrooms",
      "courses",
      "teachers",
      "guardians",
      "students",
      "branches",
    ];
    const existing = (
      await c.env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'el_%'",
      ).all<{ name: string }>()
    ).results.map((x) => x.name);
    const stockCleanup = existing.includes("el_stock_balances")
      ? [
          c.env.DB.prepare(
            "DELETE FROM el_stock_balances WHERE org_id=? AND item_id IN (SELECT id FROM el_inventory_items WHERE org_id=? AND is_demo=1) AND NOT EXISTS(SELECT 1 FROM el_stock_movements m WHERE m.item_id=el_stock_balances.item_id AND m.org_id=? AND m.is_demo=0)",
          ).bind(a.org_id, a.org_id, a.org_id),
        ]
      : [];
    const statements = tables
      .filter((table) => existing.includes("el_" + table))
      .map((table) =>
        c.env.DB.prepare(
          `DELETE FROM el_${table} WHERE org_id=? AND is_demo=1`,
        ).bind(a.org_id),
      );
    try {
      await c.env.DB.batch([
        ...stockCleanup,
        ...statements,
        c.env.DB.prepare(
          "UPDATE el_organizations SET demo_enabled=0 WHERE id=?",
        ).bind(a.org_id),
        audit(c, "organization", a.org_id, "disable_demo", null, {
          enabled: false,
        }),
      ]);
    } catch (e) {
      if (/FOREIGN KEY/.test(String(e)))
        return c.json(
          {
            error:
              "Real records refer to demo data. Reassign those links before switching demo mode off. Nothing was removed.",
          },
          409,
        );
      throw e;
    }
    return c.json({ enabled: false });
  });
  app.get("/api/academic/options", async (c: AppContext) => {
    const a = c.get("actor");
    assert(
      a.permissions.some((p) => entities.some((e) => p.startsWith(e + ":"))),
      403,
      "Academic access required",
    );
    const out: Record<string, unknown> = {};
    for (const entity of ["branches", ...entities]) {
      const can =
        a.permissions.includes(entity + ":view") ||
        (["teachers", "classrooms", "courses"].includes(entity) &&
          a.permissions.includes("groups:create"));
      if (!can) continue;
      const sql =
        entity === "branches"
          ? "SELECT id,name FROM el_branches WHERE org_id=? AND (? IS NULL OR id=?) AND status='active' ORDER BY name"
          : "SELECT id,name,branch_id,status" +
            (entity === "groups"
              ? ",teacher_id,classroom_id,course_id,capacity"
              : "") +
            " FROM el_" +
            entity +
            " WHERE org_id=? AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 1000";
      out[entity] = (
        await c.env.DB.prepare(sql)
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    }
    return c.json(out);
  });
  for (const entity of entities) {
    app.get(`/api/${entity}`, async (c: AppContext) => {
      permit(c, entity);
      const a = c.get("actor"),
        q = (c.req.query("q") ?? "").slice(0, 100),
        requested = c.req.query("branch");
      if (requested) scope(c, requested);
      const branchId = a.branch_id || requested || null;
      const page = Math.max(
        1,
        Math.min(100000, Number(c.req.query("page")) || 1),
      );
      const sort = ["name", "created_at", "status"].includes(
        c.req.query("sort") ?? "",
      )
        ? c.req.query("sort")!
        : "name";
      const dir = c.req.query("direction") === "desc" ? "DESC" : "ASC";
      const where = "org_id=? AND (? IS NULL OR branch_id=?) AND name LIKE ?";
      const vals = [a.org_id, branchId, branchId, searchPattern(q)];
      const total = await c.env.DB.prepare(
        `SELECT count(*) total FROM el_${entity} WHERE ${where}`,
      )
        .bind(...vals)
        .first<{ total: number }>();
      const data = await c.env.DB.prepare(
        `SELECT *,${entity === "groups" ? "(SELECT count(*) FROM el_enrollments e WHERE e.group_id=el_groups.id AND e.status='active')" : "0"} enrolled FROM el_${entity} WHERE ${where} ORDER BY ${sort} ${dir},id LIMIT 20 OFFSET ?`,
      )
        .bind(...vals, (page - 1) * 20)
        .all();
      return c.json({ data: data.results, total: total?.total ?? 0, page });
    });
    app.get(`/api/${entity}/export`, async (c: AppContext) => {
      permit(c, entity, "export");
      const a = c.get("actor");
      const rows = (
        await c.env.DB.prepare(
          `SELECT * FROM el_${entity} WHERE org_id=? AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 10000`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results as Record<string, unknown>[];
      const keys = rows.length
        ? Object.keys(rows[0]).filter(
            (x) => !["org_id", "national_id", "user_id"].includes(x),
          )
        : ["name"];
      return new Response(
        "\ufeff" +
          [
            keys.map(csvCell).join(","),
            ...rows.map((r) => keys.map((k) => csvCell(r[k])).join(",")),
          ].join("\r\n"),
        {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${entity}.csv"`,
            "Cache-Control": "no-store",
          },
        },
      );
    });
    app.get(`/api/${entity}/:id`, async (c: AppContext) => {
      permit(c, entity);
      const row = await record(c, entity, c.req.param("id")!);
      if (entity === "students") {
        const guardians = await c.env.DB.prepare(
          "SELECT g.id,g.name,g.phone,g.email,l.relationship FROM el_student_guardians l JOIN el_guardians g ON g.id=l.guardian_id WHERE l.student_id=? AND l.org_id=?",
        )
          .bind(row.id, row.org_id)
          .all();
        const enrollment = await c.env.DB.prepare(
          "SELECT e.*,g.name group_name,c.name course_name,t.name teacher_name FROM el_enrollments e JOIN el_groups g ON g.id=e.group_id JOIN el_courses c ON c.id=g.course_id JOIN el_teachers t ON t.id=g.teacher_id WHERE e.student_id=? AND e.org_id=? ORDER BY e.created_at DESC",
        )
          .bind(row.id, row.org_id)
          .all();
        return c.json({
          data: row,
          guardians: guardians.results,
          enrollments: enrollment.results,
        });
      }
      return c.json({ data: row });
    });
    app.post(`/api/${entity}`, async (c: AppContext) => {
      permit(c, entity, "create");
      const d = schema[entity].parse(await c.req.json()) as Record<string, any>;
      await branch(c, d.branch_id);
      if (entity === "groups") await validateGroup(c, d);
      const id = uid(),
        a = c.get("actor"),
        keys = Object.keys(d);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO el_${entity}(id,org_id,${keys.join(",")}) VALUES(${Array(
            keys.length + 2,
          )
            .fill("?")
            .join(",")})`,
        ).bind(id, a.org_id, ...keys.map((k) => d[k])),
        audit(c, entity, id, "create", null, d),
      ]);
      return c.json({ id }, 201);
    });
    app.put(`/api/${entity}/:id`, async (c: AppContext) => {
      permit(c, entity, "edit");
      const id = c.req.param("id")!,
        before = await record(c, entity, id),
        d = schema[entity].parse(await c.req.json()) as Record<string, any>;
      assert(
        d.branch_id === before.branch_id,
        409,
        "Use the transfer or branch-assignment workflow instead of changing the home branch",
      );
      await branch(c, d.branch_id);
      if (entity === "groups") await validateGroup(c, d, id);
      if (entity === "classrooms") {
        const max = await c.env.DB.prepare(
          "SELECT max(capacity) capacity FROM el_groups WHERE classroom_id=? AND status='active'",
        )
          .bind(id)
          .first<{ capacity: number | null }>();
        assert(
          !max?.capacity || max.capacity <= d.capacity,
          409,
          "Room capacity is below an active group capacity",
        );
      }
      if (entity === "teachers" && d.status === "inactive")
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_groups WHERE teacher_id=? AND status='active' LIMIT 1",
          )
            .bind(id)
            .first()),
          409,
          "Reassign active groups before deactivating this teacher",
        );
      if (entity === "classrooms" && d.status !== "active")
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_groups WHERE classroom_id=? AND status='active' LIMIT 1",
          )
            .bind(id)
            .first()),
          409,
          "Reassign active groups before closing this room",
        );
      if (entity === "courses" && d.status !== "active")
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_groups WHERE course_id=? AND status='active' LIMIT 1",
          )
            .bind(id)
            .first()),
          409,
          "Close active groups before archiving this course",
        );
      const keys = Object.keys(d);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE el_${entity} SET ${keys.map((k) => `${k}=?`).join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?`,
        ).bind(...keys.map((k) => d[k]), id, c.get("actor").org_id),
        audit(c, entity, id, "update", before, d),
      ]);
      return c.json({ ok: true });
    });
    app.delete(`/api/${entity}/:id`, async (c: AppContext) => {
      permit(c, entity, "delete");
      const id = c.req.param("id")!,
        before = await record(c, entity, id);
      if (["teachers", "classrooms", "courses"].includes(entity)) {
        const fk =
          entity === "teachers"
            ? "teacher_id"
            : entity === "classrooms"
              ? "classroom_id"
              : "course_id";
        assert(
          !(await c.env.DB.prepare(
            `SELECT id FROM el_groups WHERE ${fk}=? AND status='active' LIMIT 1`,
          )
            .bind(id)
            .first()),
          409,
          "Reassign or close active groups first",
        );
      }
      const status = entity === "courses" ? "archived" : "inactive";
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE el_${entity} SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?`,
        ).bind(status, id, c.get("actor").org_id),
        audit(c, entity, id, "archive", before, { status }),
      ]);
      return c.json({ ok: true });
    });
  }
  app.post("/api/students/import", async (c: AppContext) => {
    permit(c, "students", "create");
    const input = z
      .object({ rows: z.array(schema.students).min(1).max(160) })
      .parse(await c.req.json());
    const a = c.get("actor");
    const allowed = (
      await c.env.DB.prepare(
        "SELECT id FROM el_branches WHERE org_id=? AND status='active' AND (? IS NULL OR id=?)",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all<{ id: string }>()
    ).results.map((x) => x.id);
    assert(
      input.rows.every((r) => allowed.includes(r.branch_id)),
      403,
      "One or more branches are outside your workspace",
    );
    const statements = [];
    const keys = Object.keys(
      input.rows[0],
    ) as (keyof (typeof input.rows)[number])[];
    for (let i = 0; i < input.rows.length; i += 4) {
      const rows = input.rows.slice(i, i + 4);
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO el_students(id,org_id,${keys.join(",")}) VALUES ` +
            rows
              .map(
                () =>
                  `(${Array(keys.length + 2)
                    .fill("?")
                    .join(",")})`,
              )
              .join(","),
        ).bind(
          ...rows.flatMap((d) => [uid(), a.org_id, ...keys.map((k) => d[k])]),
        ),
      );
    }
    await c.env.DB.batch([
      ...statements,
      audit(c, "students", "bulk", "import", null, {
        count: input.rows.length,
      }),
    ]);
    return c.json({ count: input.rows.length }, 201);
  });
  app.post("/api/students/:id/guardians", async (c: AppContext) => {
    permit(c, "students", "edit");
    const s = await record(c, "students", c.req.param("id")!);
    const d = z
      .object({ guardian_id: z.uuid(), relationship: name })
      .parse(await c.req.json());
    await record(c, "guardians", d.guardian_id);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_student_guardians(org_id,student_id,guardian_id,relationship) VALUES(?,?,?,?) ON CONFLICT(student_id,guardian_id) DO UPDATE SET relationship=excluded.relationship",
      ).bind(s.org_id, s.id, d.guardian_id, d.relationship),
      audit(c, "student", s.id, "link_guardian", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/groups/:id/enrollments", async (c: AppContext) => {
    permit(c, "groups", "edit");
    const g = await record(c, "groups", c.req.param("id")!);
    const d = z
      .object({
        student_id: z.uuid(),
        status: z.enum(["active", "waiting"]).default("active"),
      })
      .parse(await c.req.json());
    const s = await record(c, "students", d.student_id);
    assert(
      s.branch_id === g.branch_id,
      409,
      "Student and group must share a branch",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,?)",
      ).bind(id, g.org_id, d.student_id, g.id, d.status),
      audit(c, "enrollment", id, "create", null, { ...d, group_id: g.id }),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/groups/:id/enrollments", async (c: AppContext) => {
    permit(c, "groups");
    const g = await record(c, "groups", c.req.param("id")!);
    const rows = await c.env.DB.prepare(
      "SELECT e.id,e.student_id,s.name,s.code,e.status,e.created_at FROM el_enrollments e JOIN el_students s ON s.id=e.student_id WHERE e.group_id=? AND e.org_id=? ORDER BY s.name",
    )
      .bind(g.id, g.org_id)
      .all();
    return c.json({ data: rows.results });
  });
  app.post("/api/enrollments/:id/transfer", async (c: AppContext) => {
    permit(c, "groups", "edit");
    const a = c.get("actor"),
      d = z.object({ group_id: z.uuid() }).parse(await c.req.json());
    const old = await c.env.DB.prepare(
      "SELECT e.*,g.branch_id FROM el_enrollments e JOIN el_groups g ON g.id=e.group_id WHERE e.id=? AND e.org_id=? AND e.status='active'",
    )
      .bind(c.req.param("id")!, a.org_id)
      .first<Record<string, any>>();
    assert(old, 409, "Active enrollment not found");
    scope(c, old.branch_id);
    const target = await record(c, "groups", d.group_id);
    assert(old.group_id !== target.id, 400, "Choose a different group");
    assert(
      old.branch_id === target.branch_id,
      409,
      "Use the branch transfer approval workflow",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_enrollments(id,org_id,student_id,group_id,is_demo) VALUES(?,?,?,?,?)",
      ).bind(id, a.org_id, old.student_id, target.id, old.is_demo),
      c.env.DB.prepare(
        "UPDATE el_enrollments SET status='transferred',updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(old.id),
      audit(c, "enrollment", id, "transfer", old, { group_id: target.id }),
    ]);
    return c.json({ id }, 201);
  });
  app.patch("/api/enrollments/:id", async (c: AppContext) => {
    permit(c, "groups", "edit");
    const a = c.get("actor"),
      id = c.req.param("id")!;
    const before = await c.env.DB.prepare(
      "SELECT e.*,g.branch_id FROM el_enrollments e JOIN el_groups g ON g.id=e.group_id WHERE e.id=? AND e.org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
    assert(before, 404, "Enrollment not found");
    scope(c, before.branch_id);
    const d = z
      .object({
        status: z.enum(["active", "waiting", "withdrawn", "completed"]),
      })
      .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_enrollments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?",
      ).bind(d.status, id, a.org_id),
      audit(c, "enrollment", id, "status", before, d),
    ]);
    return c.json({ ok: true });
  });
  for (const entity of ["teachers", "courses"] as const)
    app.post(`/api/${entity}/:id/branches`, async (c: AppContext) => {
      permit(c, entity, "edit");
      const row = await record(c, entity, c.req.param("id")!);
      const d = z
        .object({ branch_id: z.uuid(), price: money.default(0) })
        .parse(await c.req.json());
      await branch(c, d.branch_id);
      const sql =
        entity === "teachers"
          ? "INSERT INTO el_teacher_branches(org_id,teacher_id,branch_id) VALUES(?,?,?) ON CONFLICT DO NOTHING"
          : "INSERT INTO el_course_branches(org_id,course_id,branch_id,price) VALUES(?,?,?,?) ON CONFLICT(course_id,branch_id) DO UPDATE SET price=excluded.price";
      await c.env.DB.batch([
        c.env.DB.prepare(sql).bind(
          row.org_id,
          row.id,
          d.branch_id,
          ...(entity === "courses" ? [d.price] : []),
        ),
        audit(c, entity, row.id, "assign_branch", null, d),
      ]);
      return c.json({ ok: true });
    });
  app.post("/api/courses/:id/duplicate", async (c: AppContext) => {
    permit(c, "courses", "create");
    const row = await record(c, "courses", c.req.param("id")!);
    const d = z.object({ name, code }).parse(await c.req.json());
    const { id: old, org_id, created_at, updated_at, ...copy } = row;
    const recordData: Record<string, any> = { ...copy, ...d },
      keys = Object.keys(recordData),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO el_courses(id,org_id,${keys.join(",")}) VALUES(${Array(
          keys.length + 2,
        )
          .fill("?")
          .join(",")})`,
      ).bind(id, org_id, ...keys.map((k) => recordData[k])),
      audit(c, "course", id, "duplicate", { source: old }, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/transfers", async (c: AppContext) => {
    permit(c, "students");
    const a = c.get("actor");
    const rows = await c.env.DB.prepare(
      "SELECT t.*,s.name student_name,b.name destination FROM el_transfers t JOIN el_students s ON s.id=t.student_id JOIN el_branches b ON b.id=t.to_branch WHERE t.org_id=? AND (? IS NULL OR t.from_branch=? OR t.to_branch=?) ORDER BY t.created_at DESC LIMIT 100",
    )
      .bind(a.org_id, a.branch_id, a.branch_id, a.branch_id)
      .all();
    return c.json({ data: rows.results });
  });
  app.post("/api/transfers", async (c: AppContext) => {
    permit(c, "students", "edit");
    const d = z
      .object({ student_id: z.uuid(), to_branch: z.uuid(), reason: name })
      .parse(await c.req.json());
    const s = await record(c, "students", d.student_id);
    const dest = await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
    )
      .bind(d.to_branch, s.org_id)
      .first();
    assert(dest, 400, "Destination branch not found");
    assert(s.branch_id !== d.to_branch, 400, "Choose a different branch");
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_transfers(id,org_id,student_id,from_branch,to_branch,requested_by,reason) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        id,
        s.org_id,
        s.id,
        s.branch_id,
        d.to_branch,
        c.get("actor").user_id,
        d.reason,
      ),
      audit(c, "transfer", id, "request", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/transfers/:id/decision", async (c: AppContext) => {
    permit(c, "students", "approve");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide approval required");
    const id = c.req.param("id")!,
      d = z
        .object({ decision: z.enum(["approved", "rejected"]) })
        .parse(await c.req.json());
    const row = await c.env.DB.prepare(
      "SELECT t.* FROM el_transfers t JOIN el_students s ON s.id=t.student_id WHERE t.id=? AND t.org_id=? AND t.status='pending' AND t.from_branch=s.branch_id",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
    assert(row, 409, "Transfer is no longer pending or student branch changed");
    const statements = [
      c.env.DB.prepare(
        "UPDATE el_transfers SET status=?,approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
      ).bind(d.decision, a.user_id, id),
    ];
    if (d.decision === "approved") {
      statements.push(
        c.env.DB.prepare(
          "UPDATE el_enrollments SET status='transferred',updated_at=CURRENT_TIMESTAMP WHERE student_id=? AND status IN ('active','waiting')",
        ).bind(row.student_id),
        c.env.DB.prepare(
          "UPDATE el_students SET branch_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?",
        ).bind(row.to_branch, row.student_id, a.org_id),
      );
    }
    await c.env.DB.batch([
      ...statements,
      audit(c, "transfer", id, d.decision, row, d),
    ]);
    return c.json({ ok: true });
  });
}
