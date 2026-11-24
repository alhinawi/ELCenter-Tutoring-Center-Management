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
  approver: Client = { cookie: "", csrf: "" },
  payer: Client = { cookie: "", csrf: "" };
async function call(p: string, method = "GET", body?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me") c.csrf = j.user.csrf;
  return { r, j };
}
const get = (sql: string, ...v: any[]) => raw.prepare(sql).get(...v) as any;
test("payroll loan deductions reserve balance, accrue atomically and cap recoveries", async () => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "ld-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Deduction Academy",
  });
  await call("/me");
  const branch = (await call("/branches")).j.data[0].id;
  const role = (await call("/roles")).j.data.find(
    (r: any) => r.name === "Business Owner",
  ).id;
  for (const [email, c] of [
    ["ld-approve@example.invalid", approver],
    ["ld-pay@example.invalid", payer],
  ] as const) {
    await call("/users", "POST", {
      name: email,
      email,
      password: "Testing-password-2026",
      role_id: role,
      branch_id: null,
    });
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    await call("/me", "GET", undefined, c);
  }
  const employee = (
    await call("/operations/employees", "POST", {
      name: "Fictional Staff",
      code: "EMP-LD",
      job_title: "Coordinator",
      hired_on: "2026-01-01",
      branch_id: branch,
      status: "active",
    })
  ).j.id;
  const today = (await call("/employee-loans/options")).j.today;
  await call("/finance/initialize", "POST", {
    year: Number(today.slice(0, 4)),
  });
  const account = (
    await call("/finance/accounts", "POST", {
      code: "1199",
      name: "Employee receivables",
      kind: "asset",
    })
  ).j.id;
  const loan = (
    await call("/employee-loans", "POST", {
      employee_id: employee,
      kind: "loan",
      principal: 1000,
      receivable_account_id: account,
      requested_on: today,
      due_on: today,
      reason: "Fictional loan",
    })
  ).j.id;
  await call(
    `/employee-loans/${loan}/decision`,
    "POST",
    {
      decision: "approved",
      note: "ok",
    },
    approver,
  );
  assert.equal(
    (
      await call(
        `/employee-loans/${loan}/disburse`,
        "POST",
        {
          date: today,
          method: "bank",
        },
        payer,
      )
    ).r.status,
    200,
  );
  await call("/operations/contracts", "POST", {
    employee_id: employee,
    title: "Fixed",
    starts_on: "2020-01-01",
    ends_on: "2099-12-31",
    salary: 3100,
    hours_per_day: 8,
    workweek: "1,2,3,4,5,6,7",
    overtime_rate: 0,
  });
  const month = "2026-02";
  for (let d = 1; d <= 28; d++)
    await call("/operations/employee_attendance", "POST", {
      employee_id: employee,
      date: `${month}-${String(d).padStart(2, "0")}`,
      status: "present",
      arrival: "09:00",
      departure: "17:00",
    });
  const base = { employee_id: employee, month };
  const bad = async (loan_deductions: any[], status: number) =>
    assert.equal(
      (await call("/staff-payroll", "POST", { ...base, loan_deductions })).r
        .status,
      status,
    );
  await bad([{ loan_id: loan, amount: 1001 }], 409);
  await bad([{ loan_id: loan, amount: 0 }], 400);
  await bad(
    [
      { loan_id: loan, amount: 1 },
      { loan_id: loan, amount: 2 },
    ],
    400,
  );
  await bad([{ loan_id: crypto.randomUUID(), amount: 5 }], 404);
  assert.equal(get("SELECT count(*) n FROM el_employee_loan_deductions").n, 0);
  const p = await call("/staff-payroll", "POST", {
    ...base,
    loan_deductions: [{ loan_id: loan, amount: 400 }],
  });
  assert.equal(p.r.status, 201, JSON.stringify(p.j));
  assert.equal(p.j.total, 2700);
  const id = p.j.id;
  // reserved balance blocks over-recovery
  const rec = (amount: number) =>
    call(`/employee-loans/${loan}/recoveries`, "POST", {
      date: today,
      amount,
      method: "cash",
      reference: "manual",
      request_key: crypto.randomUUID(),
    });
  assert.equal((await rec(601)).r.status, 400);
  const detail = (await call("/employee-loans/" + loan)).j;
  assert.equal(detail.data.deducted, 400);
  assert.equal(detail.deductions.length, 1);
  assert.equal(
    (await call("/staff-payroll/options")).j.loans[0].outstanding,
    600,
  );
  // immutable and undeletable
  assert.throws(() => raw.exec("DELETE FROM el_employee_loan_deductions"));
  assert.throws(() =>
    raw.exec("UPDATE el_employee_loan_deductions SET amount=1"),
  );
  assert.throws(() =>
    raw.exec(
      "UPDATE el_employee_loan_deductions SET applied_journal_id='missing'",
    ),
  );
  const ap = await call(
    `/staff-payroll/${id}/approve`,
    "POST",
    { date: "2026-02-28" },
    approver,
  );
  assert.equal(ap.r.status, 400, "approval before loan disbursement date");
  const ok = await call(
    `/staff-payroll/${id}/approve`,
    "POST",
    { date: today > "2026-02-28" ? today : "2026-02-28" },
    approver,
  );
  assert.equal(ok.r.status, 200, JSON.stringify(ok.j));
  const row = get(
    "SELECT accrual_journal_id j FROM el_staff_payroll WHERE id=?",
    id,
  );
  const lines = raw
    .prepare(
      "SELECT account_id,debit,credit FROM el_journal_lines WHERE journal_id=?",
    )
    .all(row.j) as any[];
  assert.equal(
    lines.reduce((n, l) => n + l.debit - l.credit, 0),
    0,
  );
  assert.equal(Math.max(...lines.map((l) => l.debit)), 3100);
  assert.equal(lines.find((l) => l.account_id === account).credit, 400);
  assert.equal(
    get("SELECT applied_journal_id j FROM el_employee_loan_deductions").j,
    row.j,
  );
  assert.equal((await rec(600)).r.status, 201);
  assert.equal((await rec(1)).r.status, 400);
  assert.equal((await call("/staff-payroll/options")).j.loans.length, 0);
  const paid = await call(
    `/staff-payroll/${id}/pay`,
    "POST",
    { date: today, method: "bank" },
    payer,
  );
  assert.equal(paid.r.status, 200, JSON.stringify(paid.j));
});
