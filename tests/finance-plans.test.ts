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
  review: Client = { cookie: "", csrf: "" };
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
test("plans, cutoff statements, payables and reconciliation", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  await call("/finance/initialize", "POST", { year: 2026 });
  const student = (await call("/students")).j.data[0],
    branch = student.branch_id,
    role = (await call("/roles")).j.data.find(
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
  const draft = await call("/invoices", "POST", {
    student_id: student.id,
    number: "PLAN",
    date: "2026-02-01",
    due_date: "2026-03-01",
    items: [{ description: "Tuition", quantity: 1, unit_price: 1000 }],
  });
  const id = draft.j.id;
  assert.equal(draft.r.status, 201);
  await t.test(
    "installment sums and dates are enforced; plan locks after issue",
    async () => {
      assert.equal(
        (
          await call(`/invoices/${id}/installments`, "PUT", {
            installments: [{ due_date: "2026-02-15", amount: 600 }],
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(`/invoices/${id}/installments`, "PUT", {
            installments: [
              { due_date: "2026-02-01", amount: 400 },
              { due_date: "2026-03-01", amount: 600 },
            ],
          })
        ).r.status,
        200,
      );
      assert.equal((await call("/invoices/" + id)).j.installments.length, 2);
      assert.equal(
        (await call(`/invoices/${id}/issue`, "POST", {})).r.status,
        200,
      );
      assert.equal(
        (
          await call(`/invoices/${id}/installments`, "PUT", {
            installments: [{ due_date: "2026-03-01", amount: 1000 }],
          })
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "as-of statements exclude later receipts from receivables",
    async () => {
      assert.equal(
        (
          await call(`/invoices/${id}/payments`, "POST", {
            date: "2026-03-01",
            amount: 1000,
            method: "cash",
            idempotency_key: crypto.randomUUID(),
          })
        ).r.status,
        201,
      );
      const feb = (await call("/finance/reports?from=2026-02-01&to=2026-02-28"))
        .j;
      assert.equal(feb.outstanding, 1000);
      assert.equal(feb.cash_flow.closing, 0);
      assert.equal(feb.balance_sheet.assets, 1000);
      assert.equal(feb.balance_sheet.retained_earnings, 1000);
      assert.equal(feb.balance_sheet.balanced, true);
      const march = (
        await call("/finance/reports?from=2026-03-01&to=2026-03-31")
      ).j;
      assert.equal(march.outstanding, 0);
      assert.equal(march.cash_flow.movement, 1000);
      assert.equal(march.revenue, 0);
    },
  );
  await t.test(
    "approved payable settles partially and cannot be overpaid",
    async () => {
      const exp = await call("/expenses", "POST", {
        branch_id: branch,
        date: "2026-03-02",
        category: "Rent",
        description: "March rent payable",
        amount: 600,
        method: "payable",
      });
      assert.equal(exp.r.status, 201);
      assert.equal(
        (
          await call(
            `/expenses/${exp.j.id}/decision`,
            "POST",
            { decision: "approved" },
            review,
          )
        ).r.status,
        200,
      );
      const payment = {
        date: "2026-03-03",
        amount: 200,
        method: "cash",
        reference: "Bill settlement",
        idempotency_key: crypto.randomUUID(),
      };
      assert.equal(
        (await call(`/expenses/${exp.j.id}/settle`, "POST", payment)).r.status,
        201,
      );
      assert.equal(
        (await call(`/expenses/${exp.j.id}/settle`, "POST", payment)).j
          .replayed,
        true,
      );
      const journals = raw
        .prepare("SELECT count(*) n FROM el_journals")
        .get() as any;
      assert.equal(
        (
          await call(`/expenses/${exp.j.id}/settle`, "POST", {
            ...payment,
            amount: 500,
            idempotency_key: crypto.randomUUID(),
          })
        ).r.status,
        409,
      );
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_journals").get() as any).n,
        journals.n,
      );
      const e = (await call("/expenses")).j.data.find(
        (x: any) => x.id === exp.j.id,
      );
      assert.equal(e.outstanding, 400);
      const r = (await call("/finance/reports?from=2026-03-01&to=2026-03-31"))
        .j;
      assert.equal(r.balance_sheet.liabilities, 400);
      assert.equal(r.expenses, 600);
      assert.equal(r.cash_flow.closing, 800);
      assert.equal(r.balance_sheet.balanced, true);
    },
  );
  await t.test(
    "statement matching balances and prevents reusing cleared lines",
    async () => {
      const ac = (await call("/finance/settings")).j.accounts.find(
        (x: any) => x.system_key === "cash",
      ).id;
      const lines = (
        await call(
          `/finance/reconciliation?branch_id=${branch}&account_id=${ac}`,
        )
      ).j.data;
      assert.equal(lines.length, 2);
      const d = {
        branch_id: branch,
        account_id: ac,
        statement_date: "2026-03-31",
        opening_balance: 0,
        closing_balance: 800,
        reference: "March cash statement",
        line_ids: lines.map((x: any) => x.id),
      };
      assert.equal(
        (
          await call("/finance/reconciliation", "POST", {
            ...d,
            closing_balance: 801,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/finance/reconciliation", "POST", d)).r.status,
        201,
      );
      assert.equal(
        (await call("/finance/reconciliation", "POST", d)).r.status,
        409,
      );
      const after = (
        await call(
          `/finance/reconciliation?branch_id=${branch}&account_id=${ac}`,
        )
      ).j;
      assert.equal(after.data.length, 0);
      assert.equal(after.history.length, 1);
    },
  );
});
