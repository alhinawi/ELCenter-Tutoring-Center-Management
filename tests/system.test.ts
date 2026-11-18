import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { runAutomation } from "../src/server/system";
import worker from "../workers/automation";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  other: Client = { cookie: "", csrf: "" };
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
test("security, scoped search and idempotent in-app automation", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "system-owner@example.invalid",
    password: "Test-only-password-2026",
    organization: "System Center",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "system-owner@example.invalid",
      password: "Test-only-password-2026",
    },
    other,
  );
  await call("/me", "GET", undefined, other);
  await t.test(
    "sessions are private and revocable without exposing cookies",
    async () => {
      const sessions = (await call("/security/sessions")).j.data;
      assert.equal(sessions.length, 2);
      assert(sessions.every((r: any) => !r.csrf && !r.cookie));
      const tr = sessions.find((r: any) => !r.current);
      assert.equal(
        (await call("/security/sessions/revoke", "POST", { id: tr.id })).r
          .status,
        200,
      );
      assert.equal((await call("/me", "GET", undefined, other)).r.status, 401);
      assert.equal((await call("/security/sessions")).j.data.length, 1);
    },
  );
  await t.test(
    "changing a password needs the old password and revokes other sessions",
    async () => {
      await call(
        "/auth/login",
        "POST",
        {
          email: "system-owner@example.invalid",
          password: "Test-only-password-2026",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (
          await call("/security/password", "POST", {
            current_password: "wrong",
            new_password: "New-test-only-password-2026",
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call("/security/password", "POST", {
            current_password: "Test-only-password-2026",
            new_password: "New-test-only-password-2026",
          })
        ).r.status,
        200,
      );
      assert.equal((await call("/me", "GET", undefined, other)).r.status, 401);
      assert.equal((await call("/me")).r.status, 200);
    },
  );
  const student = (
    await call("/students", "POST", {
      branch_id: branch,
      name: "Private Learner",
      code: "SYS-STU",
    })
  ).j.id;
  const doc = (
    await call("/documents", "POST", {
      branch_id: branch,
      target_kind: "student",
      target_id: student,
      title: "Expiring enrollment document",
      category: "Enrollment",
      expires_on: "2026-01-01",
      filename: "enroll.pdf",
      mime: "application/pdf",
      data: Buffer.from("%PDF-1.4\nSystem test\n%%EOF").toString("base64"),
    })
  ).j.id;
  await t.test(
    "search returns only organization and role-permitted prefix matches",
    async () => {
      const result = await call("/search?q=Private");
      assert.equal(result.r.status, 200, JSON.stringify(result.j));
      assert.equal(result.j.data.students[0].id, student);
      assert.equal((await call("/search?q=P")).r.status, 400);
      const f: Client = { cookie: "", csrf: "" };
      await call("/auth/demo", "POST", {}, f);
      await call("/me", "GET", undefined, f);
      assert.equal(
        (await call("/search?q=Private", "GET", undefined, f)).j.data.students
          .length,
        0,
      );
    },
  );
  const schedule = await call("/reports/schedules", "POST", {
    name: "Weekly operations",
    frequency: "weekly",
  });
  assert.equal(schedule.r.status, 201, JSON.stringify(schedule.j));
  await t.test(
    "manual automation makes private digests and reminders once and respects preferences",
    async () => {
      const run = await call("/system/automation/run", "POST", {});
      assert.equal(run.r.status, 200, JSON.stringify(run.j));
      assert.equal(run.j.created, 2);
      const snap = (await call("/reports/snapshots")).j.data;
      assert.equal(snap.length, 1);
      assert.equal(snap[0].name, "Weekly operations");
      assert.equal(snap[0].payload.academic.groups, 0);
      assert.equal(snap[0].payload.finance.net_collections, 0);
      assert.equal(
        (await call("/system/automation/run", "POST", {})).r.status,
        429,
      );
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      await call("/reports/schedules", "POST", {
        name: "Daily private digest",
        frequency: "daily",
      });
      await call("/notifications/preferences", "PUT", { in_app: false });
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      assert.equal((await call("/reports/snapshots")).j.data.length, 2);
      await call("/notifications/preferences", "PUT", { in_app: true });
      assert.equal((await runAutomation(db, org, "test")).created, 0);
    },
  );
  await t.test(
    "scheduled worker is opt-in and a disabled org is skipped",
    async () => {
      const before = raw
        .prepare("SELECT count(*) n FROM el_automation_runs WHERE org_id=?")
        .get(org) as any;
      await worker.scheduled({}, { DB: db });
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_automation_runs WHERE org_id=?")
            .get(org) as any
        ).n,
        before.n,
      );
      await call("/system/automation", "PUT", { enabled: true });
      await worker.scheduled({}, { DB: db });
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_automation_runs WHERE org_id=?")
            .get(org) as any
        ).n,
        before.n + 1,
      );
    },
  );
  await t.test(
    "report snapshots remain private and drop financial fields after permissions change",
    async () => {
      const roles = (await call("/roles")).j.data,
        client: Client = { cookie: "", csrf: "" };
      const role = (
        await call("/roles", "POST", {
          name: "Reports only",
          permissions: ["reports:view", "reports:create", "reports:edit"],
        })
      ).j.id;
      const user = (
        await call("/users", "POST", {
          name: "Reporter",
          email: "reporter@example.invalid",
          password: "Test-only-password-2026",
          role_id: role,
          branch_id: null,
        })
      ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "reporter@example.invalid",
          password: "Test-only-password-2026",
        },
        client,
      );
      await call("/me", "GET", undefined, client);
      const rows = (await call("/reports/snapshots", "GET", undefined, client))
        .j.data;
      assert.equal(rows.length, 0);
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(role, org, me.user.user_id);
      const ownSnapshots = (await call("/reports/snapshots")).j.data;
      assert(ownSnapshots.length > 0);
      assert(ownSnapshots.every((r: any) => r.payload.finance === undefined));
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(me.user.role_id, org, me.user.user_id);
      assert.equal(
        (await call("/system/automation", "GET", undefined, client)).r.status,
        403,
      );
      assert.equal(
        (await call("/search?q=Private", "GET", undefined, client)).j.data
          .students,
        undefined,
      );
    },
  );
});
