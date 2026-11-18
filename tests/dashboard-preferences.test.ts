import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  viewer: Client = { cookie: "", csrf: "" },
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
        "cf-connecting-ip":
          c === owner
            ? "team-owner"
            : c === viewer
              ? "team-viewer"
              : "team-foreign",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("dashboard preferences are membership-private, validated, audited and filtered by current permission", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "dashboard-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Widget Academy",
  });
  const org = (await call("/me")).j.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const limited = (
    await call("/roles", "POST", {
      name: "Widget branch reader",
      permissions: ["branches:view"],
    })
  ).j.id;
  const membership = (
    await call("/users", "POST", {
      name: "Fictional Widget Viewer",
      email: "dashboard-viewer@example.invalid",
      password: "Testing-password-2026",
      role_id: limited,
      branch_id: branch,
    })
  ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "dashboard-viewer@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  const path = "/dashboard/preferences",
    sql = (q: string, ...v: any[]) => raw.prepare(q).get(...v) as any;
  await t.test(
    "defaults show only authorized widgets and omit unpermitted statistics",
    async () => {
      const full = (await call("/dashboard")).j;
      assert.equal(full.widgets.length, 8);
      assert.equal(full.customized, false);
      assert.equal(typeof full.members, "number");
      assert.equal(typeof full.roles, "number");
      const scoped = (await call("/dashboard", "GET", undefined, viewer)).j;
      assert.deepEqual(scoped.widgets, [
        "welcome",
        "branch_stats",
        "capacity_stats",
        "branch_network",
      ]);
      assert(!("roles" in scoped));
      assert(!("members" in scoped));
      assert.deepEqual(scoped.activity, []);
      assert.equal(scoped.branches.length, 1);
    },
  );
  await t.test(
    "visibility/order survive next request and are personal, empty selection allowed",
    async () => {
      assert.equal(
        (
          await call(path, "PUT", {
            widgets: ["activity", "welcome", "branch_stats"],
          })
        ).r.status,
        200,
      );
      const r = (await call("/dashboard")).j;
      assert.deepEqual(r.widgets, ["activity", "welcome", "branch_stats"]);
      assert.equal(r.customized, true);
      assert.equal(
        (await call(path, "GET", undefined, viewer)).j.customized,
        false,
      );
      assert.equal((await call(path, "PUT", { widgets: [] })).r.status, 200);
      assert.deepEqual((await call("/dashboard")).j.widgets, []);
    },
  );
  await t.test(
    "invalid fields, duplicates, unknown and forbidden widgets reject without writes",
    async () => {
      const count = () =>
          sql(
            "SELECT count(*) n FROM el_audit WHERE entity='dashboard_preferences'",
          ).n,
        n = count();
      for (const d of [
        { widgets: ["unknown"] },
        { widgets: ["welcome", "welcome"] },
        { widgets: ["welcome"], user_id: "other" },
        { widgets: "welcome" },
      ])
        assert.equal((await call(path, "PUT", d)).r.status, 400);
      assert.equal(
        (await call(path, "PUT", { widgets: ["activity"] }, viewer)).r.status,
        403,
      );
      assert.equal(count(), n);
      const r = await app.request(
        "http://localhost/api" + path,
        {
          method: "PUT",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: JSON.stringify({ widgets: ["welcome"] }),
        },
        { DB: db, ENVIRONMENT: "test" },
      );
      assert.equal(r.status, 403);
    },
  );
  await t.test(
    "current permission revoke hides stored widgets and forbids re-saving them",
    async () => {
      const role = sql(
        "SELECT role_id FROM el_memberships WHERE id=?",
        membership,
      ).role_id;
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,'audit','view')",
        )
        .run(role);
      assert.equal(
        (await call(path, "PUT", { widgets: ["activity", "welcome"] }, viewer))
          .r.status,
        200,
      );
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='audit'",
        )
        .run(role);
      const r = (await call("/dashboard", "GET", undefined, viewer)).j;
      assert.deepEqual(r.widgets, ["welcome"]);
      assert(!r.allowed_widgets.includes("activity"));
      assert.deepEqual(r.activity, []);
      assert.equal(
        (await call(path, "PUT", { widgets: ["activity", "welcome"] }, viewer))
          .r.status,
        403,
      );
    },
  );
  await t.test(
    "failed audit rolls back preference save/reset; reset restores defaults",
    async () => {
      const before = (await call(path)).j;
      raw.exec(
        "CREATE TRIGGER fail_widget_audit BEFORE INSERT ON el_audit WHEN NEW.entity='dashboard_preferences' BEGIN SELECT RAISE(ABORT,'forced widget audit failure'); END;",
      );
      assert.equal(
        (await call(path, "PUT", { widgets: ["welcome"] })).r.status,
        500,
      );
      assert.deepEqual((await call(path)).j.widgets, before.widgets);
      assert.equal((await call(path, "DELETE")).r.status, 500);
      assert.equal((await call(path)).j.customized, true);
      raw.exec("DROP TRIGGER fail_widget_audit");
      assert.equal((await call(path, "DELETE")).r.status, 200);
      const reset = (await call(path)).j;
      assert.equal(reset.customized, false);
      assert.equal(reset.widgets.length, 8);
      const log = sql(
        "SELECT after_json FROM el_audit WHERE org_id=? AND entity='dashboard_preferences' AND action='update' ORDER BY created_at LIMIT 1",
        org,
      );
      assert(log);
    },
  );
  await t.test(
    "same-named account in another organization starts with its own defaults",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "dashboard-other@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Other Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call(path, "GET", undefined, foreign)).j.customized,
        false,
      );
      await call(path, "PUT", { widgets: ["branch_network"] }, foreign);
      assert.equal((await call(path)).j.widgets.length, 8);
      raw
        .prepare("UPDATE el_memberships SET status='suspended' WHERE id=?")
        .run(membership);
      assert.equal((await call(path, "GET", undefined, viewer)).r.status, 401);
    },
  );
});
