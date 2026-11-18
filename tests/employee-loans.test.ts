import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
import { calculatePay } from "../src/server/payroll";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  reviewer: Client = { cookie: "", csrf: "" },
  payer: Client = { cookie: "", csrf: "" };
async function call(p: string, method = "GET", body?: unknown, client = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
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
  if (p === "/me") client.csrf = j.user.csrf;
  return { r, j };
}
test("employee loans separate approval, disbursement and immutable recovery with balanced journals", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "loans-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Loans Academy",
  });
  const org = (await call("/me")).j.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    other = (
      await call("/branches", "POST", {
        name: "Other Branch",
        code: "LOAN2",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  const role = (await call("/roles")).j.data.find(
    (r: any) => r.name === "Business Owner",
  ).id;
  const members: string[] = [];
  for (const [email, c] of [
    ["loans-review@example.invalid", reviewer],
    ["loans-pay@example.invalid", payer],
  ] as const) {
    members.push(
      (
        await call("/users", "POST", {
          name: email,
          email,
          password: "Testing-password-2026",
          role_id: role,
          branch_id: null,
        })
      ).j.id,
    );
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
      name: "Fictional Borrower",
      code: "EMP-LOAN",
      job_title: "Coordinator",
      hired_on: "2026-01-01",
      branch_id: branch,
      status: "active",
    })
  ).j.id;
  const today = (await call("/employee-loans/options")).j.today;
  assert.equal(
    (
      await call("/finance/initialize", "POST", {
        year: Number(today.slice(0, 4)),
      })
    ).r.status,
    200,
  );
  const account = (
    await call("/finance/accounts", "POST", {
      code: "1199",
      name: "Employee receivables",
      kind: "asset",
    })
  ).j.id;
  assert(account);
  assert(employee);
  const terms = {
    employee_id: employee,
    kind: "advance",
    principal: 1000,
    receivable_account_id: account,
    requested_on: today,
    due_on: today,
    reason: "Fictional interest-free advance",
  };
  const create = () => call("/employee-loans", "POST", terms);
  const first = await create();
  assert.equal(first.r.status, 201, JSON.stringify(first.j));
  const id = first.j.id,
    path = "/employee-loans/" + id;
  const get = (sql: string, ...v: any[]) => raw.prepare(sql).get(...v) as any;
  const journals = () => get("SELECT count(*) n FROM el_journals").n;
  await t.test("requires permissions, current scope and CSRF", async () => {
    const restricted = (
      await call("/roles", "POST", {
        name: "Loan restricted",
        permissions: ["finance:create", "payroll:view"],
      })
    ).j.id;
    raw
      .prepare("UPDATE el_memberships SET role_id=? WHERE id=?")
      .run(restricted, members[1]);
    assert.equal(
      (await call("/employee-loans", "POST", terms, payer)).r.status,
      403,
    );
    raw
      .prepare("UPDATE el_memberships SET role_id=?,branch_id=? WHERE id=?")
      .run(role, other, members[1]);
    assert.equal((await call(path, "GET", undefined, payer)).r.status, 403);
    assert.equal(
      (await call("/employee-loans", "GET", undefined, payer)).j.data.length,
      0,
    );
    assert.equal(
      (await call("/employee-loans", "POST", terms, payer)).r.status,
      403,
    );
    raw
      .prepare("UPDATE el_memberships SET branch_id=NULL WHERE id=?")
      .run(members[1]);
    const r = await app.request(
      "http://localhost/api/employee-loans",
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify(terms),
      },
      { DB: db, ENVIRONMENT: "test" },
    );
    assert.equal(r.status, 403);
  });
  await t.test(
    "strict dates, integer principal and active real employee required",
    async () => {
      for (const patch of [
        { principal: 0 },
        { principal: 1.5 },
        { requested_on: "2026-02-30" },
        { requested_on: "9999-01-01" },
        { due_on: "2020-01-01" },
      ])
        assert.equal(
          (await call("/employee-loans", "POST", { ...terms, ...patch })).r
            .status,
          400,
        );
      raw
        .prepare("UPDATE el_employees SET status='terminated' WHERE id=?")
        .run(employee);
      assert.equal((await create()).r.status, 404);
      raw
        .prepare("UPDATE el_employees SET status='active' WHERE id=?")
        .run(employee);
    },
  );
  await t.test(
    "independent reviewer and separate disbursement recorder",
    async () => {
      assert.equal(
        (
          await call(
            path + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call(path + "/decision", "POST", {
            decision: "approved",
            note: "Review",
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            path + "/decision",
            "POST",
            { decision: "approved", note: "Independent review" },
            reviewer,
          )
        ).r.status,
        200,
      );
      assert(
        get("SELECT decided_at FROM el_employee_loans WHERE id=?", id)
          .decided_at,
      );
      for (const c of [owner, reviewer])
        assert.equal(
          (
            await call(
              path + "/disburse",
              "POST",
              { date: today, method: "bank" },
              c,
            )
          ).r.status,
          403,
        );
    },
  );
  await t.test(
    "current employee branch and currency rechecked atomically",
    async () => {
      const n = journals();
      raw
        .prepare("UPDATE el_employees SET branch_id=? WHERE id=?")
        .run(other, employee);
      assert.equal(
        (
          await call(
            path + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      assert.equal(journals(), n);
      raw
        .prepare("UPDATE el_employees SET branch_id=? WHERE id=?")
        .run(branch, employee);
      raw
        .prepare("UPDATE el_organizations SET currency='USD' WHERE id=?")
        .run(org);
      assert.equal(
        (
          await call(
            path + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      raw
        .prepare("UPDATE el_organizations SET currency='EGP' WHERE id=?")
        .run(org);
    },
  );
  await t.test(
    "closed period and failed audit roll back whole recording",
    async () => {
      const n = journals();
      raw
        .prepare(
          "UPDATE el_financial_periods SET status='closed' WHERE org_id=?",
        )
        .run(org);
      assert.equal(
        (
          await call(
            path + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      assert.equal(journals(), n);
      raw
        .prepare("UPDATE el_financial_periods SET status='open' WHERE org_id=?")
        .run(org);
      raw.exec(
        "CREATE TRIGGER fail_loan_audit BEFORE INSERT ON el_audit WHEN NEW.action='record_disbursement' BEGIN SELECT RAISE(ABORT,'forced audit failure'); END;",
      );
      assert.equal(
        (
          await call(
            path + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        500,
      );
      assert.equal(journals(), n);
      assert.equal((await call(path)).j.data.status, "approved");
      raw.exec("DROP TRIGGER fail_loan_audit");
    },
  );
  await t.test("balanced posting and exact disbursement replay", async () => {
    const n = journals(),
      r = await call(
        path + "/disburse",
        "POST",
        { date: today, method: "bank" },
        payer,
      );
    assert.equal(r.r.status, 200, JSON.stringify(r.j));
    assert.equal(journals(), n + 1);
    const lines = raw
      .prepare(
        "SELECT account_id,debit,credit FROM el_journal_lines WHERE journal_id=?",
      )
      .all(r.j.journal_id) as any[];
    assert.equal(lines.length, 2);
    assert.equal(
      lines.reduce((s, l) => s + l.debit - l.credit, 0),
      0,
    );
    assert.equal(lines.find((l) => l.account_id === account)?.debit, 1000);
    assert.equal(
      (
        await call(
          path + "/disburse",
          "POST",
          { date: today, method: "bank" },
          payer,
        )
      ).j.replayed,
      true,
    );
    assert.equal(journals(), n + 1);
    assert.equal(
      (
        await call(
          path + "/disburse",
          "POST",
          { date: today, method: "cash" },
          payer,
        )
      ).r.status,
      409,
    );
    assert.throws(
      () =>
        raw
          .prepare("UPDATE el_employee_loans SET principal=2000 WHERE id=?")
          .run(id),
      /immutable/,
    );
    assert.throws(
      () => raw.prepare("DELETE FROM el_employee_loans WHERE id=?").run(id),
      /cannot be deleted/,
    );
  });
  await t.test(
    "recovery replay bound to exact request, cannot exceed principal, immutable journals",
    async () => {
      const data = {
          date: today,
          method: "cash",
          amount: 400,
          reference: "Fictional cash receipt",
          request_key: crypto.randomUUID(),
        },
        n = journals();
      const r = await call(path + "/recoveries", "POST", data);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      assert.equal(journals(), n + 1);
      assert.equal(
        (await call(path + "/recoveries", "POST", data)).j.replayed,
        true,
      );
      assert.equal(journals(), n + 1);
      assert.equal(
        (await call(path + "/recoveries", "POST", { ...data, amount: 401 })).r
          .status,
        409,
      );
      assert.equal(
        (
          await call(path + "/recoveries", "POST", {
            ...data,
            amount: 601,
            request_key: crypto.randomUUID(),
          })
        ).r.status,
        400,
      );
      const detail = (await call(path)).j;
      assert.equal(detail.data.recovered, 400);
      assert.equal(detail.recoveries.length, 1);
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_employee_loan_recoveries SET amount=1 WHERE id=?",
            )
            .run(r.j.id),
        /immutable/,
      );
      assert.throws(
        () =>
          raw
            .prepare("DELETE FROM el_employee_loan_recoveries WHERE id=?")
            .run(r.j.id),
        /cannot be deleted/,
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          call(path + "/recoveries", "POST", {
            ...data,
            amount: 600,
            request_key: crypto.randomUUID(),
          }),
        ),
      );
      assert.equal(results.filter((r) => r.r.status === 201).length, 1);
      assert.equal((await call(path)).j.data.recovered, 1000);
      assert.equal(journals(), n + 2);
    },
  );
  await t.test(
    "bad journal cannot force a disbursement and rejected/cancelled requests stop",
    async () => {
      const second = (await create()).j.id;
      await call(
        "/employee-loans/" + second + "/decision",
        "POST",
        { decision: "approved", note: "Review" },
        reviewer,
      );
      const uid = get(
        "SELECT user_id FROM el_memberships WHERE id=?",
        members[1],
      ).user_id;
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_employee_loans SET status='disbursed',disbursed_by=?,disbursed_on=?,disbursed_method='bank',journal_id=? WHERE id=?",
            )
            .run(uid, today, crypto.randomUUID(), second),
        /matching posted journal/,
      );
      assert.equal(
        (
          await call(
            "/employee-loans/" + second + "/decision",
            "POST",
            { decision: "cancelled", note: "No longer needed" },
            reviewer,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/employee-loans/" + second + "/disburse",
            "POST",
            { date: today, method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      const third = (await create()).j.id;
      assert.equal(
        (
          await call(
            "/employee-loans/" + third + "/decision",
            "POST",
            { decision: "rejected", note: "Rejected review" },
            reviewer,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/employee-loans/" + third + "/decision",
            "POST",
            { decision: "approved", note: "Retry" },
            reviewer,
          )
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "foreign organizations cannot list or retrieve private employee loans",
    async () => {
      const foreign: Client = { cookie: "", csrf: "" };
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "loans-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call("/employee-loans", "GET", undefined, foreign)).j.data
          .length,
        0,
      );
      assert.equal((await call(path, "GET", undefined, foreign)).r.status, 404);
      assert.equal(
        (
          await call(
            path + "/recoveries",
            "POST",
            {
              date: today,
              amount: 1,
              method: "bank",
              reference: "Foreign attempt",
              request_key: crypto.randomUUID(),
            },
            foreign,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "options fail whole response above 500 custom accounts instead of truncating",
    async () => {
      const ids: string[] = [];
      const insert = raw.prepare(
        "INSERT INTO el_accounts(id,org_id,code,name,kind) VALUES(?,?,?,?,'asset')",
      );
      for (let i = 0; i < 499; i++) {
        const id = crypto.randomUUID();
        ids.push(id);
        insert.run(id, org, String(20000 + i), "Fictional bounded account");
      }
      assert.equal(
        (await call("/employee-loans/options")).j.accounts.length,
        500,
      );
      const extra = crypto.randomUUID();
      ids.push(extra);
      insert.run(extra, org, "29999", "Fictional overflow account");
      const r = await call("/employee-loans/options");
      assert.equal(r.r.status, 400);
      assert(!r.j.accounts);
      for (const id of ids)
        raw.prepare("DELETE FROM el_accounts WHERE id=?").run(id);
    },
  );
  await t.test(
    "recovery audit failure rolls back both new journal and recovery",
    async () => {
      const next = (await create()).j.id,
        p = "/employee-loans/" + next;
      await call(
        p + "/decision",
        "POST",
        { decision: "approved", note: "Review" },
        reviewer,
      );
      await call(
        p + "/disburse",
        "POST",
        { date: today, method: "cash" },
        payer,
      );
      const n = journals();
      raw.exec(
        "CREATE TRIGGER fail_recovery_audit BEFORE INSERT ON el_audit WHEN NEW.action='record_recovery' BEGIN SELECT RAISE(ABORT,'forced recovery audit failure'); END;",
      );
      assert.equal(
        (
          await call(p + "/recoveries", "POST", {
            date: today,
            amount: 100,
            method: "cash",
            reference: "Fictional retry",
            request_key: crypto.randomUUID(),
          })
        ).r.status,
        500,
      );
      assert.equal(journals(), n);
      assert.equal((await call(p)).j.data.recovered, 0);
      raw.exec("DROP TRIGGER fail_recovery_audit");
    },
  );
});
