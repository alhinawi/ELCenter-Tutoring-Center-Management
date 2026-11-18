import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { assert } from "./security";
import { uid, searchPattern } from "./db";
import { permit, scope, audit, type AppContext } from "./app";
import { date } from "./finance";
const text = z.string().trim().max(2000).default(""),
  name = z.string().trim().min(1).max(160),
  email = z.union([z.email(), z.literal("")]).default(""),
  link = z
    .union([z.uuid(), z.literal("")])
    .transform((x) => x || null)
    .nullable()
    .default(null),
  money = z.number().int().min(0).max(1000000000),
  base = { branch_id: z.uuid() },
  range = { starts_on: date, ends_on: date };
const schemas = {
  notification_templates: z.object({
    ...base,
    name,
    title: name,
    body: z.string().trim().min(1).max(4000),
    channel: z.enum(["in_app", "email", "sms", "whatsapp"]).default("in_app"),
  }),
  employee_shifts: z
    .object({
      employee_id: z.uuid(),
      starts_at: z.number().int().positive(),
      ends_at: z.number().int().positive(),
      notes: text,
    })
    .refine((x) => x.ends_at > x.starts_at && x.ends_at - x.starts_at <= 86400),
  coupons: z
    .object({
      ...base,
      name,
      code: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[A-Z0-9_-]+$/),
      type: z.enum(["fixed", "percent"]),
      value: z.number().int().positive().max(1000000000),
      ...range,
      max_uses: z.number().int().positive().max(1000000).default(100),
      status: z.enum(["active", "inactive"]).default("active"),
    })
    .refine(
      (x) =>
        x.ends_on >= x.starts_on && (x.type !== "percent" || x.value <= 100),
    ),
  departments: z.object({
    ...base,
    name,
    manager: text,
    status: z.enum(["active", "inactive"]).default("active"),
  }),
  employees: z.object({
    ...base,
    department_id: link,
    teacher_id: link,
    user_id: link,
    code: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/),
    name,
    email,
    phone: text,
    job_title: name,
    emergency_contact: text,
    hired_on: date,
    status: z
      .enum(["active", "onboarding", "on_leave", "resigned", "terminated"])
      .default("onboarding"),
    notes: text,
  }),
  contracts: z
    .object({
      employee_id: z.uuid(),
      title: name,
      ...range,
      salary: money,
      workweek: z
        .string()
        .trim()
        .regex(/^$|^[1-7](,[1-7])*$/)
        .default(""),
      overtime_rate: money.default(0),
      hours_per_day: z.number().int().min(1).max(24).default(8),
      notes: text,
    })
    .refine((x) => x.ends_on >= x.starts_on),
  employee_attendance: z.object({
    employee_id: z.uuid(),
    date,
    arrival: z
      .string()
      .regex(/^$|^\d{2}:\d{2}$/)
      .default(""),
    departure: z
      .string()
      .regex(/^$|^\d{2}:\d{2}$/)
      .default(""),
    status: z.enum(["present", "absent", "late", "excused"]),
    notes: text,
  }),
  leave_requests: z
    .object({
      employee_id: z.uuid(),
      type: z.enum(["vacation", "sick", "unpaid", "other"]),
      ...range,
      reason: name,
    })
    .refine((x) => x.ends_on >= x.starts_on),
  employee_reviews: z.object({
    employee_id: z.uuid(),
    date,
    type: z.enum([
      "performance",
      "disciplinary",
      "onboarding",
      "resignation",
      "termination",
    ]),
    rating: z.number().int().min(0).max(5).default(0),
    notes: name,
  }),
  applications: z.object({
    ...base,
    name,
    email,
    phone: text,
    job_title: name,
    interview_at: z.number().int().positive().nullable().default(null),
    notes: text,
  }),
  campaigns: z
    .object({
      ...base,
      name,
      channel: z.enum([
        "website",
        "facebook",
        "instagram",
        "whatsapp",
        "phone",
        "walk_in",
        "referral",
        "other",
      ]),
      ...range,
      budget: money.default(0),
      status: z
        .enum(["draft", "active", "completed", "paused"])
        .default("draft"),
      notes: text,
    })
    .refine((x) => x.ends_on >= x.starts_on),
  leads: z.object({
    ...base,
    name,
    phone: text,
    email,
    source: z.enum([
      "website",
      "facebook",
      "instagram",
      "whatsapp",
      "phone",
      "walk_in",
      "referral",
      "other",
    ]),
    campaign_id: link,
    assigned_to: link,
    follow_up_on: z.union([date, z.literal("")]).default(""),
    notes: text,
  }),
  visits: z.object({
    ...base,
    name,
    phone: text,
    purpose: name,
    host: text,
    scheduled_at: z.number().int().positive(),
    notes: text,
  }),
};
export const operations = Object.keys(schemas) as (keyof typeof schemas)[];
export const resource = (table: string) =>
  table === "notification_templates"
    ? "notifications"
    : ["campaigns", "coupons"].includes(table)
      ? "marketing"
      : ["leads", "visits"].includes(table)
        ? "crm"
        : "hr";
export async function operationRecord(
  c: AppContext,
  table: string,
  id: string,
) {
  assert(operations.includes(table as any), 404, "Module not found");
  const row = await c.env.DB.prepare(
    `SELECT * FROM el_${table} WHERE id=? AND org_id=?`,
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(row, 404, "Record not found");
  scope(c, row.branch_id);
  return row;
}
async function validateBranch(c: AppContext, id: string) {
  scope(c, id);
  assert(
    await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
    )
      .bind(id, c.get("actor").org_id)
      .first(),
    400,
    "Choose an active branch",
  );
}
export function registerOperations(app: Hono<any>) {
  app.get("/api/operations/options", async (c: AppContext) => {
    const a = c.get("actor");
    assert(
      ["hr", "crm", "marketing", "notifications"].some((r) =>
        a.permissions.includes(r + ":view"),
      ),
      403,
      "Operations access required",
    );
    const out: Record<string, unknown> = {};
    for (const table of [
      "branches",
      ...(a.permissions.includes("notifications:view")
        ? ["notification_templates"]
        : []),
      ...(a.permissions.includes("hr:view")
        ? ["departments", "employees", "teachers"]
        : []),
      ...(a.permissions.includes("marketing:view") ||
      a.permissions.includes("crm:view")
        ? ["campaigns"]
        : []),
    ])
      out[table] = (
        await c.env.DB.prepare(
          `SELECT id,name${table === "branches" ? "" : ",branch_id"} FROM el_${table} WHERE org_id=? AND (? IS NULL OR ${table === "branches" ? "id" : "branch_id"}=?) ORDER BY name LIMIT 500`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    if (a.permissions.includes("crm:view") || a.permissions.includes("hr:view"))
      out.staff = (
        await c.env.DB.prepare(
          "SELECT u.id,u.name,m.branch_id FROM el_memberships m JOIN el_users u ON u.id=m.user_id WHERE m.org_id=? AND m.status='active' AND (? IS NULL OR m.branch_id=? OR m.branch_id IS NULL) ORDER BY u.name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    return c.json(out);
  });
  for (const table of operations) {
    const r = resource(table),
      schema = schemas[table];
    app.get("/api/operations/" + table, async (c: AppContext) => {
      permit(c, r);
      const a = c.get("actor"),
        page = Math.max(1, Math.min(10000, Number(c.req.query("page")) || 1)),
        q = searchPattern((c.req.query("q") ?? "").slice(0, 100)),
        employee = c.req.query("employee_id");
      const named = [
          "departments",
          "employees",
          "applications",
          "campaigns",
          "notification_templates",
          "coupons",
          "leads",
          "visits",
        ].includes(table),
        where = `org_id=? AND (? IS NULL OR branch_id=?)${named ? " AND name LIKE ?" : ""}${employee && ["contracts", "employee_attendance", "leave_requests", "employee_reviews"].includes(table) ? " AND employee_id=?" : ""}`,
        vals: unknown[] = [
          a.org_id,
          a.branch_id,
          a.branch_id,
          ...(named ? [q] : []),
          ...(employee &&
          [
            "contracts",
            "employee_attendance",
            "leave_requests",
            "employee_reviews",
            "employee_shifts",
          ].includes(table)
            ? [employee]
            : []),
        ];
      const rows = (
        await c.env.DB.prepare(
          `SELECT * FROM el_${table} WHERE ${where} ORDER BY created_at DESC,id LIMIT 21 OFFSET ?`,
        )
          .bind(...vals, (page - 1) * 20)
          .all()
      ).results;
      return c.json({
        data: rows.slice(0, 20),
        has_more: rows.length > 20,
        page,
      });
    });
    app.post("/api/operations/" + table, async (c: AppContext) => {
      permit(c, r, "create");
      const d: any = schema.parse(await c.req.json()),
        a = c.get("actor"),
        id = uid();
      if (d.employee_id) {
        const employee = await operationRecord(c, "employees", d.employee_id);
        d.branch_id = employee.branch_id;
        if (table === "employee_attendance") {
          const minutes = (t: string) => {
            const [h, m] = t.split(":").map(Number);
            assert(h < 24 && m < 60, 400, "Invalid time");
            return h * 60 + m;
          };
          d.minutes =
            d.arrival && d.departure
              ? minutes(d.departure) - minutes(d.arrival)
              : 0;
          assert(d.minutes >= 0, 400, "Departure must follow arrival");
          d.created_by = a.user_id;
        }
        if (table === "leave_requests" || table === "employee_reviews")
          d.created_by = a.user_id;
      }
      await validateBranch(c, d.branch_id);
      if (table === "employee_shifts") {
        const org = await c.env.DB.prepare(
          "SELECT timezone FROM el_organizations WHERE id=?",
        )
          .bind(a.org_id)
          .first<{ timezone: string }>();
        const from = Temporal.Instant.fromEpochMilliseconds(d.starts_at * 1000)
            .toZonedDateTimeISO(org!.timezone)
            .toPlainDate()
            .toString(),
          to = Temporal.Instant.fromEpochMilliseconds(d.ends_at * 1000 - 1)
            .toZonedDateTimeISO(org!.timezone)
            .toPlainDate()
            .toString();
        d.local_start = from;
        d.local_end = to;
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_leave_requests WHERE employee_id=? AND status='approved' AND starts_on<=? AND ends_on>=? LIMIT 1",
          )
            .bind(d.employee_id, to, from)
            .first()),
          409,
          "Employee has approved leave during the shift",
        );
      }

      if (table === "employees") {
        for (const [k, t] of [
          ["department_id", "departments"],
          ["teacher_id", "teachers"],
          ["user_id", "users"],
        ])
          if (d[k]) {
            const found = await c.env.DB.prepare(
              t === "users"
                ? `SELECT user_id id,branch_id FROM el_memberships WHERE user_id=? AND org_id=? AND status='active'`
                : `SELECT id,branch_id FROM el_${t} WHERE id=? AND org_id=?`,
            )
              .bind(d[k], a.org_id)
              .first<{ id: string; branch_id: string | null }>();
            assert(
              found && (!found.branch_id || found.branch_id === d.branch_id),
              400,
              "Related record must belong to the employee branch",
            );
          }
      }
      if (table === "leads") {
        if (d.campaign_id) {
          const campaign = await operationRecord(c, "campaigns", d.campaign_id);
          assert(
            campaign.branch_id === d.branch_id,
            400,
            "Campaign and lead must share a branch",
          );
        }
        if (d.assigned_to) {
          const assigned = await c.env.DB.prepare(
            "SELECT user_id id,branch_id FROM el_memberships WHERE user_id=? AND org_id=? AND status='active'",
          )
            .bind(d.assigned_to, a.org_id)
            .first<{ id: string; branch_id: string | null }>();
          assert(
            assigned &&
              (!assigned.branch_id || assigned.branch_id === d.branch_id),
            400,
            "Assignee unavailable for this branch",
          );
        }
      }
      const keys = Object.keys(d);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO el_${table}(id,org_id,${keys.join(",")}) VALUES(?,?,${keys.map(() => "?").join(",")})`,
        ).bind(id, a.org_id, ...keys.map((k) => d[k])),
        audit(c, table, id, "create", null, d),
      ]);
      return c.json({ id }, 201);
    });
    app.get("/api/operations/" + table + "/:id", async (c: AppContext) => {
      permit(c, r);
      const row = await operationRecord(c, table, c.req.param("id")!);
      return c.json({ data: row });
    });
  }
  for (const table of [
    "departments",
    "campaigns",
    "coupons",
    "notification_templates",
    "visits",
  ] as const)
    app.put("/api/operations/" + table + "/:id", async (c: AppContext) => {
      permit(c, resource(table), "edit");
      const before = await operationRecord(c, table, c.req.param("id")!),
        d = schemas[table].parse(await c.req.json()) as Record<string, any>;
      assert(
        d.branch_id === before.branch_id,
        400,
        "Branch transfers require a dedicated workflow",
      );
      if (table === "visits")
        assert(!before.checked_in, 409, "Cannot edit a visitor after check-in");
      if (table === "coupons")
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_invoices WHERE coupon_id=? LIMIT 1",
          )
            .bind(before.id)
            .first()),
          409,
          "Coupon already used by an invoice; create a new offer",
        );
      const keys = Object.keys(d);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE el_${table} SET ${keys.map((k) => k + "=?").join(",")} WHERE id=? AND org_id=?`,
        ).bind(...keys.map((k) => d[k]), before.id, before.org_id),
        audit(c, table, before.id, "update", before, d),
      ]);
      return c.json({ ok: true });
    });
  app.post(
    "/api/operations/employee_shifts/:id/status",
    async (c: AppContext) => {
      permit(c, "hr", "edit");
      const before = await operationRecord(
          c,
          "employee_shifts",
          c.req.param("id")!,
        ),
        d = z
          .object({ status: z.enum(["completed", "cancelled"]) })
          .parse(await c.req.json());
      assert(before.status === "scheduled", 409, "Shift already finalized");
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE el_employee_shifts SET status=? WHERE id=?",
        ).bind(d.status, before.id),
        audit(c, "shift", before.id, d.status, before, d),
      ]);
      return c.json({ ok: true });
    },
  );
  app.put("/api/operations/employees/:id", async (c: AppContext) => {
    permit(c, "hr", "edit");
    const before = await operationRecord(c, "employees", c.req.param("id")!),
      d = schemas.employees
        .pick({
          name: true,
          email: true,
          phone: true,
          job_title: true,
          emergency_contact: true,
          status: true,
          notes: true,
        })
        .parse(await c.req.json());
    const keys = Object.keys(d) as (keyof typeof d)[];
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE el_employees SET ${keys.map((k) => k + "=?").join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?`,
      ).bind(...keys.map((k) => d[k]), before.id, before.org_id),
      audit(c, "employee", before.id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.post(
    "/api/operations/leave_requests/:id/decision",
    async (c: AppContext) => {
      permit(c, "hr", "approve");
      const before = await operationRecord(
          c,
          "leave_requests",
          c.req.param("id")!,
        ),
        d = z
          .object({ decision: z.enum(["approved", "rejected"]), note: text })
          .parse(await c.req.json()),
        a = c.get("actor");
      assert(before.status === "pending", 409, "Leave already decided");
      assert(
        before.created_by !== a.user_id,
        403,
        "A different HR user must decide leave",
      );
      if (d.decision === "approved") {
        const org = await c.env.DB.prepare(
          "SELECT timezone FROM el_organizations WHERE id=?",
        )
          .bind(a.org_id)
          .first<{ timezone: string }>();
        const from = Temporal.PlainDate.from(before.starts_on).toZonedDateTime({
            timeZone: org!.timezone,
            plainTime: "00:00",
          }),
          to = Temporal.PlainDate.from(before.ends_on)
            .add({ days: 1 })
            .toZonedDateTime({ timeZone: org!.timezone, plainTime: "00:00" });
        assert(
          !(await c.env.DB.prepare(
            "SELECT id FROM el_employee_shifts WHERE employee_id=? AND status='scheduled' AND starts_at<? AND ends_at>? LIMIT 1",
          )
            .bind(
              before.employee_id,
              Number(to.epochMilliseconds) / 1000,
              Number(from.epochMilliseconds) / 1000,
            )
            .first()),
          409,
          "Cancel overlapping scheduled shifts before approving leave",
        );
      }
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE el_leave_requests SET status=?,decision_note=?,decided_by=? WHERE id=?",
        ).bind(d.decision, d.note, a.user_id, before.id),
        audit(c, "leave", before.id, d.decision, before, d),
      ]);
      return c.json({ ok: true });
    },
  );
  app.post("/api/operations/leads/:id/interactions", async (c: AppContext) => {
    permit(c, "crm", "edit");
    const lead = await operationRecord(c, "leads", c.req.param("id")!),
      d = z
        .object({
          type: z.enum(["call", "message", "visit", "note"]),
          notes: name,
        })
        .parse(await c.req.json()),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_lead_interactions(id,org_id,lead_id,type,notes,created_by) VALUES(?,?,?,?,?,?)",
      ).bind(id, lead.org_id, lead.id, d.type, d.notes, c.get("actor").user_id),
      audit(c, "lead", lead.id, "interaction", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/operations/leads/:id/interactions", async (c: AppContext) => {
    permit(c, "crm");
    const lead = await operationRecord(c, "leads", c.req.param("id")!);
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT * FROM el_lead_interactions WHERE org_id=? AND lead_id=? ORDER BY created_at DESC LIMIT 100",
        )
          .bind(lead.org_id, lead.id)
          .all()
      ).results,
    });
  });
  app.put("/api/operations/leads/:id/stage", async (c: AppContext) => {
    permit(c, "crm", "edit");
    const lead = await operationRecord(c, "leads", c.req.param("id")!),
      d = z
        .object({
          stage: z.enum([
            "new",
            "contacted",
            "interested",
            "trial_booked",
            "trial_attended",
            "negotiation",
            "lost",
          ]),
          follow_up_on: z.union([date, z.literal("")]).default(""),
        })
        .parse(await c.req.json());
    assert(!lead.student_id, 409, "Lead already converted");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_leads SET stage=?,follow_up_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(d.stage, d.follow_up_on, lead.id),
      audit(c, "lead", lead.id, "stage", lead, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/operations/leads/:id/convert", async (c: AppContext) => {
    permit(c, "crm", "edit");
    permit(c, "students", "create");
    const lead = await operationRecord(c, "leads", c.req.param("id")!),
      d = z
        .object({
          code: z
            .string()
            .trim()
            .min(1)
            .max(30)
            .regex(/^[A-Za-z0-9_-]+$/),
          grade: text,
        })
        .parse(await c.req.json());
    assert(!lead.student_id, 409, "Lead already converted");
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_students(id,org_id,branch_id,name,code,phone,email,grade,status,notes,is_demo) VALUES(?,?,?,?,?,?,?,?,'new',?,?)",
      ).bind(
        id,
        lead.org_id,
        lead.branch_id,
        lead.name,
        d.code,
        lead.phone,
        lead.email,
        d.grade,
        lead.notes,
        lead.is_demo,
      ),
      c.env.DB.prepare(
        "UPDATE el_leads SET stage='registered',student_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(id, lead.id),
      audit(c, "lead", lead.id, "convert_to_student", lead, { student_id: id }),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/operations/applications/:id/stage", async (c: AppContext) => {
    permit(c, "hr", "edit");
    const before = await operationRecord(c, "applications", c.req.param("id")!),
      d = z
        .object({
          stage: z.enum([
            "applied",
            "screening",
            "interview",
            "offer",
            "rejected",
          ]),
          interview_at: z.number().int().positive().nullable().default(null),
        })
        .parse(await c.req.json());
    assert(before.stage !== "hired", 409, "Candidate already hired");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_applications SET stage=?,interview_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(d.stage, d.interview_at, before.id),
      audit(c, "application", before.id, "stage", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/operations/applications/:id/hire", async (c: AppContext) => {
    permit(c, "hr", "approve");
    const before = await operationRecord(c, "applications", c.req.param("id")!),
      d = z
        .object({ code: z.string().trim().min(1).max(30), hired_on: date })
        .parse(await c.req.json());
    assert(
      before.stage === "offer" && !before.employee_id,
      409,
      "Candidate must have an offer before hiring",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_employees(id,org_id,branch_id,code,name,email,phone,job_title,hired_on,status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,'onboarding',?)",
      ).bind(
        id,
        before.org_id,
        before.branch_id,
        d.code,
        before.name,
        before.email,
        before.phone,
        before.job_title,
        d.hired_on,
        before.is_demo,
      ),
      c.env.DB.prepare(
        "UPDATE el_applications SET stage='hired',employee_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(id, before.id),
      audit(c, "application", before.id, "hire", before, { employee_id: id }),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/operations/visits/:id/check", async (c: AppContext) => {
    permit(c, "crm", "edit");
    const before = await operationRecord(c, "visits", c.req.param("id")!),
      d = z.object({ action: z.enum(["in", "out"]) }).parse(await c.req.json());
    assert(
      d.action === "in"
        ? !before.checked_in
        : before.checked_in && !before.checked_out,
      409,
      "Invalid visitor check transition",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE el_visits SET ${d.action === "in" ? "checked_in" : "checked_out"}=unixepoch() WHERE id=?`,
      ).bind(before.id),
      audit(c, "visit", before.id, "check_" + d.action, before, null),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/operations/summary", async (c: AppContext) => {
    const a = c.get("actor");
    permit(c, "crm");
    const leads = (
      await c.env.DB.prepare(
        "SELECT stage,count(*) count FROM el_leads WHERE org_id=? AND (? IS NULL OR branch_id=?) GROUP BY stage",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    const campaigns = (
      await c.env.DB.prepare(
        "SELECT c.id,c.name,c.budget,count(l.id) leads,COALESCE(sum(CASE WHEN l.stage='registered' THEN 1 ELSE 0 END),0) conversions FROM el_campaigns c LEFT JOIN el_leads l ON l.campaign_id=c.id WHERE c.org_id=? AND (? IS NULL OR c.branch_id=?) GROUP BY c.id ORDER BY c.starts_on DESC LIMIT 100",
      )
        .bind(a.org_id, a.branch_id, a.branch_id)
        .all()
    ).results;
    return c.json({ leads, campaigns });
  });
}
