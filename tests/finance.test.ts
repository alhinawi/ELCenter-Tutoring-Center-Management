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
test("finance and payroll workflows are traceable and bounded", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  const student = (await call("/students")).j.data[0],
    branch = student.branch_id,
    teacher = (await call("/teachers")).j.data[0];
  const roles = (await call("/roles")).j.data,
    ownerRole = roles.find((r: any) => r.name === "Business Owner").id;
  for (const [email, client] of [
    ["review@example.invalid", reviewer],
    ["pay@example.invalid", payer],
  ] as const) {
    await call("/users", "POST", {
      name: email,
      email,
      password: "Test-only-password-123",
      role_id: ownerRole,
      branch_id: null,
    });
    await call(
      "/auth/login",
      "POST",
      { email, password: "Test-only-password-123" },
      client,
    );
    await call("/me", "GET", undefined, client);
  }
  let invoice = "",
    payment = "",
    expense = "",
    payroll = "",
    manual = "";
  const d = {
    student_id: student.id,
    number: "INV-001",
    date: "2026-11-18",
    due_date: "2026-12-18",
    discount: 100,
    items: [{ description: "English tuition", quantity: 2, unit_price: 500 }],
  };
  await t.test(
    "initialize creates normalized chart and period idempotently",
    async () => {
      assert.equal(
        (await call("/finance/initialize", "POST", { year: 2026 })).r.status,
        200,
      );
      await call("/finance/initialize", "POST", { year: 2026 });
      assert.equal((await call("/finance/settings")).j.accounts.length, 9);
      assert.equal((await call("/finance/settings")).j.periods.length, 1);
    },
  );
  await t.test(
    "invoice computes total server-side and saves line items",
    async () => {
      const { r, j } = await call("/invoices", "POST", { ...d, total: 1 });
      assert.equal(r.status, 201);
      invoice = j.id;
      const detail = (await call("/invoices/" + invoice)).j;
      assert.equal(detail.data.total, 900);
      assert.equal(detail.items.length, 1);
    },
  );
  await t.test("fractional money and bad due dates are rejected", async () => {
    assert.equal(
      (
        await call("/invoices", "POST", {
          ...d,
          number: "BAD",
          items: [{ description: "Bad", quantity: 1, unit_price: 1.5 }],
        })
      ).r.status,
      400,
    );
    assert.equal(
      (
        await call("/invoices", "POST", {
          ...d,
          number: "BAD2",
          due_date: "2026-01-01",
        })
      ).r.status,
      400,
    );
  });
  await t.test("teacher allocations are explicit and bounded", async () => {
    assert.equal(
      (
        await call(`/invoices/${invoice}/teacher-shares`, "POST", {
          shares: [{ teacher_id: teacher.id, amount: 1000 }],
        })
      ).r.status,
      400,
    );
    assert.equal(
      (
        await call(`/invoices/${invoice}/teacher-shares`, "POST", {
          shares: [{ teacher_id: teacher.id, amount: 900 }],
        })
      ).r.status,
      200,
    );
  });
  await t.test(
    "issue posts balanced AR and revenue journal atomically",
    async () => {
      assert.equal(
        (await call(`/invoices/${invoice}/issue`, "POST", {})).r.status,
        200,
      );
      const reports = (await call("/finance/reports")).j;
      assert.equal(reports.revenue, 900);
      assert.equal(reports.outstanding, 900);
      assert.equal(reports.balanced, true);
    },
  );
  await t.test("double issue rejected and posted lines immutable", async () => {
    assert.equal(
      (await call(`/invoices/${invoice}/issue`, "POST", {})).r.status,
      409,
    );
    const j = (await call("/invoices/" + invoice)).j.data.journal_id;
    assert.throws(
      () =>
        raw
          .prepare("UPDATE el_journal_lines SET debit=1 WHERE journal_id=?")
          .run(j),
      /immutable/,
    );
    assert.throws(
      () => raw.prepare("DELETE FROM el_journals WHERE id=?").run(j),
      /cannot be deleted/,
    );
  });
  await t.test(
    "recorded receipt updates outstanding and idempotency prevents duplicates",
    async () => {
      const key = crypto.randomUUID(),
        body = {
          date: "2026-11-18",
          amount: 400,
          method: "cash",
          reference: "Desk receipt",
          idempotency_key: key,
        };
      const { r, j } = await call(
        `/invoices/${invoice}/payments`,
        "POST",
        body,
      );
      assert.equal(r.status, 201);
      payment = j.id;
      assert.equal(
        (await call(`/invoices/${invoice}/payments`, "POST", body)).j.replayed,
        true,
      );
      assert.equal((await call("/invoices/" + invoice)).j.paid, 400);
      assert.equal((await call("/finance/reports")).j.outstanding, 500);
    },
  );
  await t.test("overpayment rejected and journal rolled back", async () => {
    const before = (
      raw.prepare("SELECT count(*) n FROM el_journals").get() as any
    ).n;
    assert.equal(
      (
        await call(`/invoices/${invoice}/payments`, "POST", {
          date: "2026-11-18",
          amount: 501,
          method: "bank",
          idempotency_key: crypto.randomUUID(),
        })
      ).r.status,
      409,
    );
    assert.equal(
      (raw.prepare("SELECT count(*) n FROM el_journals").get() as any).n,
      before,
    );
  });
  await t.test(
    "refund cannot exceed original payment and preserves receipt",
    async () => {
      assert.equal(
        (
          await call(`/payments/${payment}/refund`, "POST", {
            date: "2026-11-18",
            amount: 401,
            reason: "Test refund",
            idempotency_key: crypto.randomUUID(),
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call(`/payments/${payment}/refund`, "POST", {
            date: "2026-11-18",
            amount: 100,
            reason: "Partial refund",
            idempotency_key: crypto.randomUUID(),
          })
        ).r.status,
        201,
      );
      assert.equal((await call("/invoices/" + invoice)).j.paid, 300);
      assert.equal((await call("/invoices/" + invoice)).j.payments.length, 2);
    },
  );
  await t.test(
    "invoice cannot be voided with unrefunded receipts",
    async () => {
      assert.equal(
        (
          await call(`/invoices/${invoice}/void`, "POST", {
            date: "2026-11-18",
            reason: "Cancel",
          })
        ).r.status,
        409,
      );
    },
  );
  await t.test("expenses need independent approval", async () => {
    const { r, j } = await call("/expenses", "POST", {
      branch_id: branch,
      date: "2026-11-18",
      category: "Supplies",
      description: "Fictional workbooks",
      amount: 120,
      method: "cash",
    });
    assert.equal(r.status, 201);
    expense = j.id;
    assert.equal(
      (
        await call(`/expenses/${expense}/decision`, "POST", {
          decision: "approved",
        })
      ).r.status,
      403,
    );
    assert.equal(
      (
        await call(
          `/expenses/${expense}/decision`,
          "POST",
          { decision: "approved" },
          reviewer,
        )
      ).r.status,
      200,
    );
    assert.equal((await call("/finance/reports")).j.expenses, 120);
    assert.equal(
      (
        await call(
          `/expenses/${expense}/decision`,
          "POST",
          { decision: "approved" },
          reviewer,
        )
      ).r.status,
      409,
    );
  });
  await t.test(
    "manual journals reject imbalance and reverse without deletion",
    async () => {
      const a = (await call("/finance/settings")).j.accounts,
        by = (key: string) => a.find((x: any) => x.system_key === key).id;
      const body = {
        branch_id: branch,
        date: "2026-11-18",
        reference: "OPEN-001",
        memo: "Opening balance",
        lines: [
          { account: by("cash"), debit: 1000, credit: 0 },
          { account: by("equity"), debit: 0, credit: 999 },
        ],
      };
      assert.equal(
        (await call("/finance/journals", "POST", body)).r.status,
        400,
      );
      body.lines[1].credit = 1000;
      const { r, j } = await call("/finance/journals", "POST", body);
      assert.equal(r.status, 201);
      manual = j.id;
      assert.equal(
        (
          await call(`/finance/journals/${manual}/reverse`, "POST", {
            date: "2026-11-18",
            reason: "Reverse opening",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call(`/finance/journals/${manual}/reverse`, "POST", {
            date: "2026-11-18",
            reason: "Again",
          })
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "compensation calculation snapshot and independent payroll approval",
    async () => {
      assert.equal(
        (
          await call("/payroll/compensation", "POST", {
            teacher_id: teacher.id,
            type: "fixed",
            base: 5000,
            rate: 0,
            percent: 0,
          })
        ).r.status,
        201,
      );
      const { r, j } = await call("/payroll", "POST", {
        teacher_id: teacher.id,
        month: "2026-11",
        bonus: 200,
        deduction: 100,
        adjustment_reason: "Fictional adjustment",
      });
      assert.equal(r.status, 201);
      assert.equal(j.total, 5100);
      payroll = j.id;
      assert.equal(
        (await call(`/payroll/${payroll}/approve`, "POST", {})).r.status,
        403,
      );
      assert.equal(
        (await call(`/payroll/${payroll}/approve`, "POST", {}, reviewer)).r
          .status,
        200,
      );
    },
  );
  await t.test(
    "payroll payment separated from preparer and approver",
    async () => {
      assert.equal(
        (
          await call(
            `/payroll/${payroll}/pay`,
            "POST",
            { date: "2026-11-18", method: "bank" },
            reviewer,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/payroll/${payroll}/pay`,
            "POST",
            { date: "2026-11-18", method: "bank" },
            payer,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            `/payroll/${payroll}/pay`,
            "POST",
            { date: "2026-11-18", method: "bank" },
            payer,
          )
        ).r.status,
        409,
      );
      assert.equal((await call("/finance/reports")).j.balanced, true);
    },
  );
  await t.test("all six compensation formulas use whole currency units", () => {
    const s = { minutes: 90, sessions: 2, students: 10, revenue: 1000 },
      d = { base: 100, rate: 20, percent: 10 };
    assert.equal(calculatePay({ ...d, type: "fixed" }, s), 100);
    assert.equal(calculatePay({ ...d, type: "hourly" }, s), 30);
    assert.equal(calculatePay({ ...d, type: "per_session" }, s), 40);
    assert.equal(calculatePay({ ...d, type: "per_student" }, s), 200);
    assert.equal(calculatePay({ ...d, type: "revenue_percent" }, s), 100);
    assert.equal(calculatePay({ ...d, type: "hybrid" }, s), 240);
  });
  await t.test(
    "closed periods reject new posting without partial writes",
    async () => {
      const p = (await call("/finance/settings")).j.periods[0];
      assert.equal(
        (await call("/finance/periods/" + p.id + "/close", "POST", {})).r
          .status,
        200,
      );
      const before = (
        raw.prepare("SELECT count(*) n FROM el_journals").get() as any
      ).n;
      assert.equal(
        (
          await call(`/invoices/${invoice}/payments`, "POST", {
            date: "2026-11-18",
            amount: 1,
            method: "cash",
            idempotency_key: crypto.randomUUID(),
          })
        ).r.status,
        409,
      );
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_journals").get() as any).n,
        before,
      );
    },
  );
});
