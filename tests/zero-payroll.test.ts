import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  other: Client = { cookie: "", csrf: "" },
  closer: Client = { cookie: "", csrf: "" },
  foreign: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c === owner ? "system-owner" : "system-other",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    {
      DB: db,
      ENVIRONMENT: "test",
      DOCUMENT_ENCRYPTION_KEY: "test-only-system-document-encryption-key",
    },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("approved zero teacher and employee payroll closes explicitly without payment", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const month = Temporal.Now.plainDateISO("Africa/Cairo")
      .subtract({ months: 1 })
      .toPlainYearMonth(),
    start = month.toPlainDate({ day: 1 }),
    end = start.add({ months: 1 }).subtract({ days: 1 }).toString();
  async function account(c: Client, label: string) {
    const email =
      label.replaceAll(" ", "-") + randomUUID() + "@example.invalid";
    const r = await call("/users", "POST", {
      name: label,
      email,
      password: "Testing-password-2026",
      role_id: me.user.role_id,
      branch_id: null,
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    return (await call("/me", "GET", undefined, c)).j.user.user_id;
  }
  const approver = await account(other, "Independent approver"),
    closeUser = await account(closer, "Independent closer");
  const teacher = (await call("/teachers")).j.data[0];
  await call("/payroll/compensation", "POST", {
    teacher_id: teacher.id,
    type: "fixed",
    base: 0,
    rate: 0,
    percent: 0,
  });
  const teacherCalc = await call("/payroll", "POST", {
    teacher_id: teacher.id,
    month: month.toString(),
  });
  assert.equal(teacherCalc.r.status, 201, JSON.stringify(teacherCalc.j));
  assert.equal(teacherCalc.j.total, 0);
  const teacherPay = teacherCalc.j.id;
  const emp = await call("/operations/employees", "POST", {
    branch_id: branch,
    name: "Fictional Zero Payroll Employee",
    code: "ZERO-EMP",
    job_title: "Tutor",
    hired_on: start.toString(),
    status: "active",
  });
  assert.equal(emp.r.status, 201, JSON.stringify(emp.j));
  const contract = await call("/operations/contracts", "POST", {
    employee_id: emp.j.id,
    title: "Zero-pay test contract",
    starts_on: start.toString(),
    ends_on: end,
    salary: 0,
    workweek: "1,2,3,4,5",
    hours_per_day: 8,
  });
  assert.equal(contract.r.status, 201, JSON.stringify(contract.j));
  for (
    let day = start;
    Temporal.PlainDate.compare(day, end) <= 0;
    day = day.add({ days: 1 })
  )
    if (day.dayOfWeek <= 5) {
      const r = await call("/operations/employee_attendance", "POST", {
        employee_id: emp.j.id,
        date: day.toString(),
        arrival: "09:00",
        departure: "17:00",
        status: "present",
      });
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
    }
  const employeeCalc = await call("/staff-payroll", "POST", {
    employee_id: emp.j.id,
    month: month.toString(),
    bonus: 0,
    deduction: 0,
    reason: "",
  });
  assert.equal(employeeCalc.r.status, 201, JSON.stringify(employeeCalc.j));
  assert.equal(employeeCalc.j.total, 0);
  const employeePay = employeeCalc.j.id;
  const closure = {
    date: end,
    reason: "Verified calculation has no amount payable.",
  };
  for (const [path, id, table, column] of [
    ["payroll", teacherPay, "el_payroll", "teacher_payroll_id"],
    ["staff-payroll", employeePay, "el_staff_payroll", "staff_payroll_id"],
  ] as const) {
    await t.test(
      path + " enforces independent approval and no-payment closure",
      async () => {
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/close-zero",
              "POST",
              closure,
              closer,
            )
          ).r.status,
          409,
        );
        const approval = await call(
          "/" + path + "/" + id + "/approve",
          "POST",
          path === "payroll" ? {} : { date: end },
          other,
        );
        assert.equal(approval.r.status, 200, JSON.stringify(approval.j));
        assert.equal(
          (await call("/" + path + "/" + id + "/close-zero", "POST", closure)).r
            .status,
          403,
        );
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/close-zero",
              "POST",
              closure,
              other,
            )
          ).r.status,
          403,
        );
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/close-zero",
              "POST",
              { ...closure, date: start.toString() },
              closer,
            )
          ).r.status,
          400,
        );
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/close-zero",
              "POST",
              {
                ...closure,
                date: Temporal.Now.plainDateISO("Africa/Cairo")
                  .add({ days: 1 })
                  .toString(),
              },
              closer,
            )
          ).r.status,
          400,
        );
        const journals = raw
          .prepare("SELECT count(*) n FROM el_journals")
          .get() as any;
        const result = await call(
          "/" + path + "/" + id + "/close-zero",
          "POST",
          closure,
          closer,
        );
        assert.equal(result.r.status, 201, JSON.stringify(result.j));
        assert.equal(result.j.closed_without_payment, true);
        assert.equal(
          (raw.prepare("SELECT count(*) n FROM el_journals").get() as any).n,
          journals.n,
        );
        const source = raw
          .prepare("SELECT * FROM " + table + " WHERE id=?")
          .get(id) as any;
        assert.equal(source.status, "approved");
        assert.equal(source.paid_by, null);
        const stored = raw
          .prepare("SELECT * FROM el_zero_payroll_closures WHERE id=?")
          .get(result.j.id) as any;
        assert.equal(stored[column], id);
        assert.equal(stored.closed_by, closeUser);
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/close-zero",
              "POST",
              closure,
              closer,
            )
          ).r.status,
          409,
        );
        assert.equal(
          (
            await call(
              "/" + path + "/" + id + "/pay",
              "POST",
              { date: end, method: "bank" },
              closer,
            )
          ).r.status,
          409,
        );
        assert.throws(
          () =>
            raw
              .prepare(
                "UPDATE el_zero_payroll_closures SET reason=? WHERE id=?",
              )
              .run("Changed reason", stored.id),
          /immutable/,
        );
        assert.throws(
          () =>
            raw
              .prepare("DELETE FROM el_zero_payroll_closures WHERE id=?")
              .run(stored.id),
          /immutable/,
        );
        assert.throws(
          () =>
            raw
              .prepare(
                "UPDATE " + table + " SET status='paid',paid_by=? WHERE id=?",
              )
              .run(closeUser, id),
          /must close without payment/,
        );
        const list = (await call("/" + path)).j.data.find(
          (p: any) => p.id === id,
        );
        assert.equal(list.zero_closed_on, end);
        assert.equal(list.zero_closure_reason, closure.reason);
      },
    );
  }
  await t.test(
    "nonzero payroll and cross-branch/cross-organization access cannot be closed",
    async () => {
      await call("/payroll/compensation", "POST", {
        teacher_id: teacher.id,
        type: "fixed",
        base: 100,
        rate: 0,
        percent: 0,
      });
      const next = await call("/payroll", "POST", {
        teacher_id: teacher.id,
        month: month.subtract({ months: 1 }).toString(),
      });
      assert.equal(next.r.status, 201, JSON.stringify(next.j));
      await call("/payroll/" + next.j.id + "/approve", "POST", {}, other);
      assert.equal(
        (
          await call(
            "/payroll/" + next.j.id + "/close-zero",
            "POST",
            closure,
            closer,
          )
        ).r.status,
        409,
      );
      await call("/auth/demo", "POST", {}, foreign);
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (
          await call(
            "/payroll/" + teacherPay + "/close-zero",
            "POST",
            closure,
            foreign,
          )
        ).r.status,
        404,
      );
      const otherBranch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(otherBranch, org, "Other branch", "OTHER-ZERO");
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(otherBranch, org, closeUser);
      assert.equal(
        (
          await call(
            "/payroll/" + teacherPay + "/close-zero",
            "POST",
            closure,
            closer,
          )
        ).r.status,
        403,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE org_id=? AND user_id=?",
        )
        .run(org, closeUser);
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO el_zero_payroll_closures(id,org_id,branch_id,teacher_payroll_id,closed_by,closed_on,reason,created_at) VALUES(?,?,?,?,?,?,?,0)",
            )
            .run(
              randomUUID(),
              org,
              teacher.branch_id,
              next.j.id,
              closeUser,
              end,
              "Nonzero cannot be closed",
            ),
        /Only independently approved zero payroll/,
      );
    },
  );
});
