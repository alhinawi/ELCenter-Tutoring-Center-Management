import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  review: Client = { cookie: "", csrf: "" },
  other: Client = { cookie: "", csrf: "" };
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  client = owner,
) {
  const r = await app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: client.cookie,
        "x-csrf-token": client.csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    client.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (path === "/me") client.csrf = j.user.csrf;
  return { r, j };
}
test("people and admissions are connected workflows", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  let branch = (await call("/branches")).j.data[0].id;
  const role = (await call("/roles")).j.data.find(
    (r: any) => r.name === "Business Owner",
  ).id;
  await call("/users", "POST", {
    name: "Reviewer",
    email: "review@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: null,
  });
  await call(
    "/auth/login",
    "POST",
    { email: "review@example.invalid", password: "Testing-password-2026" },
    review,
  );
  await call("/me", "GET", undefined, review);
  await call("/auth/demo", "POST", {}, other);
  await call("/me", "GET", undefined, other);
  let employee = "",
    lead = "",
    campaign = "",
    application = "";
  await t.test(
    "fictional operations seed and full flag cleanup are safe",
    async () => {
      const r = await call("/settings/demo/operations", "POST", {});
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(
        (await call("/operations/employees")).j.data[0].name,
        "Nour Hassan",
      );
      assert.equal((await call("/notifications")).j.data.length, 1);
      assert.equal(
        (await call("/settings/demo/operations", "POST", {})).r.status,
        200,
      );
      assert.equal((await call("/operations/employees")).j.data.length, 1);
      assert.equal(
        (await call("/settings/demo", "PUT", { enabled: false })).r.status,
        200,
      );
      assert.equal((await call("/operations/employees")).j.data.length, 0);
      assert.equal((await call("/notifications")).j.data.length, 0);
      await call("/settings/demo", "PUT", { enabled: true });
      branch = (await call("/branches")).j.data[0].id;
    },
  );
  await t.test(
    "employee relations, contract and persisted attendance",
    async () => {
      const department = await call("/operations/departments", "POST", {
        branch_id: branch,
        name: "Admissions",
      });
      assert.equal(department.r.status, 201);
      const r = await call("/operations/employees", "POST", {
        branch_id: branch,
        department_id: department.j.id,
        code: "STAFF-1",
        name: "Test Employee",
        job_title: "Advisor",
        hired_on: "2026-01-01",
        status: "active",
      });
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      employee = r.j.id;
      assert.equal(
        (
          await call(
            "/operations/employees/" + employee,
            "GET",
            undefined,
            other,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call("/operations/contracts", "POST", {
            employee_id: employee,
            title: "Annual contract",
            starts_on: "2026-01-01",
            ends_on: "2026-12-31",
            salary: 6000,
            hours_per_day: 8,
            workweek: "7,1,2,3,4",
            overtime_rate: 60,
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call("/operations/employee_attendance", "POST", {
            employee_id: employee,
            date: "2026-11-18",
            arrival: "09:00",
            departure: "17:30",
            status: "present",
          })
        ).r.status,
        201,
      );
      const attendance = await call("/operations/employee_attendance");
      assert.equal(attendance.r.status, 200);
      assert.equal(attendance.j.data[0].minutes, 510);
      assert.equal(
        (
          await call("/operations/employee_attendance", "POST", {
            employee_id: employee,
            date: "2026-11-19",
            arrival: "24:00",
            departure: "25:00",
            status: "present",
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "leave requires independent decision and blocks overlapping approvals",
    async () => {
      const d = {
        employee_id: employee,
        type: "vacation",
        starts_on: "2026-12-01",
        ends_on: "2026-12-03",
        reason: "Annual leave",
      };
      const first = await call("/operations/leave_requests", "POST", d);
      assert.equal(first.r.status, 201);
      assert.equal(
        (
          await call(
            `/operations/leave_requests/${first.j.id}/decision`,
            "POST",
            { decision: "approved" },
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/operations/leave_requests/${first.j.id}/decision`,
            "POST",
            { decision: "approved" },
            review,
          )
        ).r.status,
        200,
      );
      const second = await call("/operations/leave_requests", "POST", d);
      assert.equal(
        (
          await call(
            `/operations/leave_requests/${second.j.id}/decision`,
            "POST",
            { decision: "approved" },
            review,
          )
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "recruitment offer converts once into onboarding employee",
    async () => {
      const candidate = await call("/operations/applications", "POST", {
        branch_id: branch,
        name: "Candidate Example",
        job_title: "Teacher",
      });
      assert.equal(candidate.r.status, 201);
      application = candidate.j.id;
      assert.equal(
        (
          await call(`/operations/applications/${application}/hire`, "POST", {
            code: "STAFF-2",
            hired_on: "2026-11-18",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call(`/operations/applications/${application}/stage`, "PUT", {
            stage: "offer",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(`/operations/applications/${application}/hire`, "POST", {
            code: "STAFF-2",
            hired_on: "2026-11-18",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call(`/operations/applications/${application}/hire`, "POST", {
            code: "STAFF-3",
            hired_on: "2026-11-18",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/operations/employees")).j.data.find(
          (e: any) => e.code === "STAFF-2",
        ).status,
        "onboarding",
      );
    },
  );
  await t.test(
    "campaign and lead timeline lead to one registered student",
    async () => {
      const c = await call("/operations/campaigns", "POST", {
        branch_id: branch,
        name: "Referral week",
        channel: "referral",
        starts_on: "2026-01-01",
        ends_on: "2026-12-31",
        budget: 1000,
        status: "active",
      });
      assert.equal(c.r.status, 201);
      campaign = c.j.id;
      const r = await call("/operations/leads", "POST", {
        branch_id: branch,
        name: "Future Learner",
        phone: "01000000000",
        source: "referral",
        campaign_id: campaign,
        follow_up_on: "2026-11-20",
      });
      assert.equal(r.r.status, 201);
      lead = r.j.id;
      assert.equal(
        (
          await call(`/operations/leads/${lead}/interactions`, "POST", {
            type: "call",
            notes: "Discussed course choices",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (await call(`/operations/leads/${lead}/interactions`)).j.data.length,
        1,
      );
      assert.equal(
        (
          await call(`/operations/leads/${lead}/stage`, "PUT", {
            stage: "interested",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(`/operations/leads/${lead}/convert`, "POST", {
            code: "NEW-LEARNER",
            grade: "Grade 8",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call(`/operations/leads/${lead}/convert`, "POST", {
            code: "NEW-LEARNER-2",
          })
        ).r.status,
        409,
      );
      const analytics = (await call("/operations/summary")).j;
      assert.equal(
        analytics.campaigns.find((x: any) => x.id === campaign).conversions,
        1,
      );
      assert.equal(
        (await call("/students?q=Future")).j.data[0].name,
        "Future Learner",
      );
    },
  );
  await t.test(
    "reception check-in and check-out have valid order",
    async () => {
      const r = await call("/operations/visits", "POST", {
        branch_id: branch,
        name: "Visitor Example",
        purpose: "Course inquiry",
        scheduled_at: 1795000000,
      });
      assert.equal(r.r.status, 201);
      assert.equal(
        (
          await call(`/operations/visits/${r.j.id}/check`, "POST", {
            action: "out",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call(`/operations/visits/${r.j.id}/check`, "POST", {
            action: "in",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(`/operations/visits/${r.j.id}/check`, "POST", {
            action: "out",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(`/operations/visits/${r.j.id}/check`, "POST", {
            action: "in",
          })
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "announcements use in-app preferences and never claim external delivery",
    async () => {
      await call(
        "/notifications/preferences",
        "PUT",
        { in_app: false },
        review,
      );
      const n = await call("/announcements", "POST", {
        branch_id: "",
        title: "Test announcement",
        body: "Stored privately in account inboxes",
        channel: "in_app",
      });
      assert.equal(n.r.status, 201);
      assert.equal(n.j.stored, 1);
      assert.equal(n.j.blocked, 1);
      assert.equal((await call("/notifications")).j.data.length, 1);
      assert.equal(
        (await call("/notifications", "GET", undefined, review)).j.data.length,
        0,
      );
      const item = (await call("/notifications")).j.data[0];
      assert.equal(
        (await call(`/notifications/${item.id}/read`, "POST", {}, other)).r
          .status,
        404,
      );
      assert.equal(
        (await call(`/notifications/${item.id}/read`, "POST", {})).r.status,
        200,
      );
      assert.equal((await call("/announcements")).j.data[0].read, 1);
      const ext = await call("/announcements", "POST", {
        branch_id: "",
        title: "External not configured",
        body: "No external delivery",
        channel: "whatsapp",
      });
      assert.equal(ext.j.stored, 0);
      assert.equal(ext.j.external_sent, 0);
      assert.equal(ext.j.blocked, 2);
    },
  );
  await t.test("staff shifts reject overlaps and approved leave", async () => {
    const start = Math.floor(
        new Date("2026-11-25T09:00:00+02:00").getTime() / 1000,
      ),
      body = {
        employee_id: employee,
        starts_at: start,
        ends_at: start + 8 * 3600,
      };
    const first = await call("/operations/employee_shifts", "POST", body);
    assert.equal(first.r.status, 201);
    assert.equal(
      (await call("/operations/employee_shifts", "POST", body)).r.status,
      409,
    );
    assert.equal(
      (
        await call(`/operations/employee_shifts/${first.j.id}/status`, "POST", {
          status: "cancelled",
        })
      ).r.status,
      200,
    );
    assert.equal(
      (await call("/operations/employee_shifts", "POST", body)).r.status,
      201,
    );
    const leaveStart = Math.floor(
      new Date("2026-12-02T09:00:00+02:00").getTime() / 1000,
    );
    assert.equal(
      (
        await call("/operations/employee_shifts", "POST", {
          ...body,
          starts_at: leaveStart,
          ends_at: leaveStart + 3600,
        })
      ).r.status,
      409,
    );
  });
  await t.test(
    "saved message template publishes its stored text with correct channel",
    async () => {
      const template = await call(
        "/operations/notification_templates",
        "POST",
        {
          branch_id: branch,
          name: "Course reminder",
          title: "Upcoming course",
          body: "Your course starts soon",
          channel: "in_app",
        },
      );
      assert.equal(template.r.status, 201);
      const n = await call("/announcements", "POST", {
        branch_id: branch,
        template_id: template.j.id,
        title: "",
        body: "",
      });
      assert.equal(n.r.status, 201, JSON.stringify(n.j));
      assert.equal(
        (await call("/notifications")).j.data.some(
          (x: any) =>
            x.title === "Upcoming course" &&
            x.body === "Your course starts soon",
        ),
        true,
      );
    },
  );
  await t.test(
    "branch HR and CRM do not expose another branch or finance",
    async () => {
      const b = await call("/branches", "POST", {
        name: "Private branch",
        code: "PRIVATE",
        capacity: 50,
      });
      const hrRole = (await call("/roles")).j.data.find(
        (x: any) => x.name === "HR Employee",
      ).id;
      const scoped: Client = { cookie: "", csrf: "" };
      await call("/users", "POST", {
        name: "Scoped HR",
        email: "hr@example.invalid",
        password: "Testing-password-2026",
        role_id: hrRole,
        branch_id: b.j.id,
      });
      await call(
        "/auth/login",
        "POST",
        { email: "hr@example.invalid", password: "Testing-password-2026" },
        scoped,
      );
      await call("/me", "GET", undefined, scoped);
      assert.equal(
        (await call("/operations/employees", "GET", undefined, scoped)).j.data
          .length,
        0,
      );
      assert.equal(
        (
          await call(
            "/operations/employees/" + employee,
            "GET",
            undefined,
            scoped,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (await call("/staff-payroll", "GET", undefined, scoped)).r.status,
        403,
      );
      assert.equal(
        (await call("/finance/reports", "GET", undefined, scoped)).r.status,
        403,
      );
      assert.equal(
        (await call("/operations/leads/" + lead, "GET", undefined, scoped)).r
          .status,
        403,
      );
    },
  );
  await t.test(
    "employee payroll uses contract weekdays, actual attendance and approved leave, then accrues and pays independently",
    async () => {
      await call("/finance/initialize", "POST", { year: 2026 });
      assert.equal(
        (
          await call("/staff-payroll", "POST", {
            employee_id: employee,
            month: "2026-11",
          })
        ).r.status,
        409,
      );
      const scheduled: string[] = [];
      for (let day = 1; day <= 30; day++) {
        const date = "2026-11-" + String(day).padStart(2, "0");
        const weekday = new Date(date + "T12:00:00Z").getUTCDay();
        if ([0, 1, 2, 3, 4].includes(weekday)) {
          scheduled.push(date);
          if (day !== 18 && day !== 4)
            assert.equal(
              (
                await call("/operations/employee_attendance", "POST", {
                  employee_id: employee,
                  date,
                  status: day === 2 ? "absent" : "present",
                  arrival: day === 2 ? "" : "09:00",
                  departure: day === 2 ? "" : "17:00",
                })
              ).r.status,
              201,
            );
        }
      }
      const leave = await call("/operations/leave_requests", "POST", {
        employee_id: employee,
        type: "unpaid",
        starts_on: "2026-11-04",
        ends_on: "2026-11-04",
        reason: "Personal day",
      });
      assert.equal(
        (
          await call(
            `/operations/leave_requests/${leave.j.id}/decision`,
            "POST",
            { decision: "approved" },
            review,
          )
        ).r.status,
        200,
      );
      const p = await call("/staff-payroll", "POST", {
        employee_id: employee,
        month: "2026-11",
        bonus: 200,
        deduction: 100,
        reason: "Test adjustments",
      });
      assert.equal(p.r.status, 201, JSON.stringify(p.j));
      assert.equal(
        p.j.total,
        6000 - Math.round(12000 / scheduled.length) + 30 + 100,
      );
      const id = p.j.id;
      assert.equal(
        (
          await call(`/staff-payroll/${id}/approve`, "POST", {
            date: "2026-11-30",
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/staff-payroll/${id}/approve`,
            "POST",
            { date: "2026-11-29" },
            review,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            `/staff-payroll/${id}/approve`,
            "POST",
            { date: "2026-11-30" },
            review,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/finance/reports")).j.balance_sheet.liabilities,
        p.j.total,
      );
      const payer: Client = { cookie: "", csrf: "" };
      await call("/users", "POST", {
        name: "Payroll payer",
        email: "payer@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: null,
      });
      await call(
        "/auth/login",
        "POST",
        { email: "payer@example.invalid", password: "Testing-password-2026" },
        payer,
      );
      await call("/me", "GET", undefined, payer);
      assert.equal(
        (
          await call(
            `/staff-payroll/${id}/pay`,
            "POST",
            { date: "2026-11-30", method: "bank" },
            review,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/staff-payroll/${id}/pay`,
            "POST",
            { date: "2026-11-29", method: "bank" },
            payer,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            `/staff-payroll/${id}/pay`,
            "POST",
            { date: "2026-11-30", method: "bank" },
            payer,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/finance/reports")).j.balance_sheet.liabilities,
        0,
      );
      assert.equal((await call("/staff-payroll")).j.data[0].status, "paid");
    },
  );
  await t.test(
    "coupon validity and issuance caps are enforced atomically",
    async () => {
      await call("/finance/initialize", "POST", { year: 2026 });
      const coupon = await call("/operations/coupons", "POST", {
        branch_id: branch,
        name: "Referral discount",
        code: "REF10",
        type: "percent",
        value: 10,
        starts_on: "2026-01-01",
        ends_on: "2026-12-31",
        max_uses: 1,
      });
      assert.equal(coupon.r.status, 201);
      const student = (await call("/students")).j.data[0];
      const create = async (number: string) =>
        call("/invoices", "POST", {
          student_id: student.id,
          number,
          date: "2026-11-18",
          due_date: "2026-12-18",
          items: [{ description: "Tuition", quantity: 1, unit_price: 1000 }],
        });
      const first = await create("PROMO1");
      const apply = await call(`/invoices/${first.j.id}/coupon`, "POST", {
        code: "REF10",
      });
      assert.equal(apply.r.status, 200);
      assert.equal(apply.j.total, 900);
      assert.equal(
        (await call(`/invoices/${first.j.id}/issue`, "POST", {})).r.status,
        200,
      );
      const second = await create("PROMO2");
      await call(`/invoices/${second.j.id}/coupon`, "POST", { code: "REF10" });
      assert.equal(
        (await call(`/invoices/${second.j.id}/issue`, "POST", {})).r.status,
        409,
      );
      assert.equal(
        (await call("/invoices/" + second.j.id)).j.data.status,
        "draft",
      );
    },
  );
});
