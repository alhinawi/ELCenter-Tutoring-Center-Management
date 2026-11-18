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
  cashier: Client = { cookie: "", csrf: "" },
  outsider: Client = { cookie: "", csrf: "" };
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
test("finance account isolation and immutable finalized records", async () => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  await call("/finance/initialize", "POST", { year: 2026 });
  const student = (await call("/students")).j.data[0],
    branch = student.branch_id;
  const other = await call("/branches", "POST", {
    name: "Other branch",
    code: "OTHER",
    address: "",
    capacity: 50,
  });
  const role = (await call("/roles")).j.data.find(
    (r: any) => r.name === "Cashier",
  ).id;
  await call("/users", "POST", {
    name: "Scoped cashier",
    email: "cashier@example.invalid",
    password: "Testing-password-2026",
    role_id: role,
    branch_id: other.j.id,
  });
  await call(
    "/auth/login",
    "POST",
    { email: "cashier@example.invalid", password: "Testing-password-2026" },
    cashier,
  );
  await call("/me", "GET", undefined, cashier);
  const created = await call("/invoices", "POST", {
    student_id: student.id,
    number: "ACCESS",
    date: "2026-11-18",
    due_date: "2026-12-18",
    items: [{ description: "Tuition", quantity: 1, unit_price: 500 }],
  });
  assert.equal(created.r.status, 201);
  const id = created.j.id;
  assert.equal(
    (await call("/invoices/" + id, "GET", undefined, cashier)).r.status,
    403,
  );
  assert.equal(
    (await call("/invoices", "GET", undefined, cashier)).j.data.length,
    0,
  );
  const choices = await call("/finance/options", "GET", undefined, cashier);
  assert.equal(choices.r.status, 200);
  assert.equal(choices.j.students.length, 0);
  assert(choices.j.branches.every((b: any) => b.id === other.j.id));
  assert.equal(
    (await call("/finance/initialize", "POST", { year: 2027 }, cashier)).r
      .status,
    403,
  );
  assert.equal(
    (await call("/finance/reports", "GET", undefined, cashier)).j.balance_sheet
      .assets,
    0,
  );
  await call("/auth/demo", "POST", {}, outsider);
  await call("/me", "GET", undefined, outsider);
  assert.equal(
    (await call("/invoices/" + id, "GET", undefined, outsider)).r.status,
    404,
  );
  assert.equal((await call(`/invoices/${id}/issue`, "POST", {})).r.status, 200);
  assert.throws(
    () => raw.prepare("DELETE FROM el_invoices WHERE id=?").run(id),
    /Finalized invoices/,
  );
  const journal = raw
    .prepare("SELECT journal_id FROM el_invoices WHERE id=?")
    .get(id) as any;
  assert.throws(
    () =>
      raw
        .prepare("DELETE FROM el_journal_lines WHERE journal_id=?")
        .run(journal.journal_id),
    /immutable/,
  );
  assert.throws(
    () => raw.prepare("UPDATE el_invoices SET total=1 WHERE id=?").run(id),
    /immutable/,
  );
  assert.equal(branch, student.branch_id);
});
