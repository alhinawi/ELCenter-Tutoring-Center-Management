import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
test("user managers cannot assign existing higher-privilege roles", async () => {
  const { raw, db } = sqliteDatabase();
  for (const f of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    raw.exec(readFileSync("migrations/" + f, "utf8"));
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
  await call("/auth/demo", "POST", {});
  await call("/me");
  const roles = (await call("/roles")).j.data;
  const manager = roles.find((r: any) => r.name === "General Manager");
  const custom = await call("/roles", "POST", {
    name: "Limited User Manager",
    permissions: ["users:create", "users:view"],
  });
  await call("/users", "POST", {
    name: "Limited Manager",
    email: "limited@example.invalid",
    password: "Test-only-password-123",
    role_id: custom.j.id,
    branch_id: null,
  });
  await call("/auth/logout", "POST", {});
  await call("/auth/login", "POST", {
    email: "limited@example.invalid",
    password: "Test-only-password-123",
  });
  await call("/me");
  const result = await call("/users", "POST", {
    name: "Escalated User",
    email: "escalated@example.invalid",
    password: "Test-only-password-123",
    role_id: manager.id,
    branch_id: null,
  });
  assert.equal(result.r.status, 403);
  assert.equal(
    (
      raw
        .prepare(
          "SELECT count(*) n FROM el_users WHERE email='escalated@example.invalid'",
        )
        .get() as any
    ).n,
    0,
  );
});
