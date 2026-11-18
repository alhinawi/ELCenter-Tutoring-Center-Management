import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const file of [
  "0001_foundation.sql",
  "0002_academic_core.sql",
  "0003_demo_mode.sql",
])
  raw.exec(readFileSync("migrations/" + file, "utf8"));
let cookie = "",
  csrf = "";
async function call(p: string, method = "GET", body?: unknown) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me") csrf = j.user.csrf;
  return { r, j };
}
test("demo toggle never removes real records", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "real-owner@example.invalid",
    password: "Test-only-password-123",
    organization: "Real Organization",
  });
  await call("/me");
  const headquarters = (await call("/branches")).j.data[0];
  let student = "";
  await t.test(
    "flagged demo dataset can be enabled alongside real records",
    async () => {
      const x = await call("/students", "POST", {
        name: "User-created Real Record",
        code: "REAL1",
        branch_id: headquarters.id,
      });
      student = x.j.id;
      assert.equal(
        (await call("/settings/demo", "PUT", { enabled: true })).r.status,
        200,
      );
      assert.equal((await call("/students")).j.total, 7);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_students WHERE is_demo=1")
            .get() as any
        ).n,
        6,
      );
      assert.equal((await call("/me")).j.organization.demo_enabled, 1);
    },
  );
  await t.test("repeat enable is idempotent", async () => {
    await call("/settings/demo", "PUT", { enabled: true });
    assert.equal((await call("/students")).j.total, 7);
  });
  await t.test(
    "disable removes only flagged demo rows and retains real data and audit",
    async () => {
      assert.equal(
        (await call("/settings/demo", "PUT", { enabled: false })).r.status,
        200,
      );
      const list = (await call("/students")).j;
      assert.equal(list.total, 1);
      assert.equal(list.data[0].id, student);
      assert.equal((await call("/branches")).j.total, 1);
      assert.equal((await call("/me")).j.organization.demo_enabled, 0);
      assert.ok(
        (await call("/audit")).j.data.some(
          (x: any) => x.action === "disable_demo",
        ),
      );
    },
  );
  await t.test("real references block cleanup atomically", async () => {
    await call("/settings/demo", "PUT", { enabled: true });
    const branch = (await call("/branches")).j.data.find((b: any) => b.is_demo);
    const x = await call("/students", "POST", {
      name: "Do not delete me",
      code: "SAFE",
      branch_id: branch.id,
      is_demo: 1,
    });
    assert.equal(x.r.status, 201);
    assert.equal(
      (
        raw
          .prepare("SELECT is_demo FROM el_students WHERE id=?")
          .get(x.j.id) as any
      ).is_demo,
      0,
    );
    const before = (await call("/students")).j.total;
    const off = await call("/settings/demo", "PUT", { enabled: false });
    assert.equal(off.r.status, 409);
    assert.equal((await call("/students")).j.total, before);
    assert.equal((await call("/students/" + student)).r.status, 200);
    assert.equal((await call("/me")).j.organization.demo_enabled, 1);
  });
});
