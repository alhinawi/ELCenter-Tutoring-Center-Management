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
test("team directory branch isolation and complete permission-change audits", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "team-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Team Center",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    b1 = (await call("/branches")).j.data[0].id,
    b2 = (
      await call("/branches", "POST", {
        name: "Other Branch",
        code: "TEAM2",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  const role = (
    await call("/roles", "POST", {
      name: "Branch team observer",
      permissions: [
        "users:view",
        "users:create",
        "users:edit",
        "branches:view",
      ],
    })
  ).j.id;
  async function user(name: string, email: string, branch_id: string | null) {
    const r = await call("/users", "POST", {
      name,
      email,
      password: "Testing-password-2026",
      role_id: role,
      branch_id,
    });
    assert.equal(r.r.status, 201);
    return r.j.id;
  }
  const observer = await user(
    "Branch A Observer",
    "team-observer@example.invalid",
    b1,
  );
  await user("Branch A Colleague", "team-colleague@example.invalid", b1);
  await user("Branch B Private", "team-private@example.invalid", b2);
  await user("Headquarters Private", "team-hq@example.invalid", null);
  await call(
    "/auth/login",
    "POST",
    {
      email: "team-observer@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  await t.test(
    "branch custom role sees only same-branch memberships, never headquarters or foreign branch contacts",
    async () => {
      const list = await call("/users", "GET", undefined, viewer);
      assert.equal(list.r.status, 200);
      assert.deepEqual(
        list.j.data.map((r: any) => r.name),
        ["Branch A Colleague", "Branch A Observer"],
      );
      assert(list.j.data.every((r: any) => r.branch_id === b1));
      assert(!JSON.stringify(list.j).includes("team-private@example.invalid"));
      assert(!JSON.stringify(list.j).includes("team-owner@example.invalid"));
      const all = (await call("/users")).j.data;
      assert.equal(all.length, 5);
      assert(all.some((r: any) => r.name === "Branch B Private"));
      assert.equal(
        (
          await call(
            "/users",
            "POST",
            {
              name: "No branch creation",
              email: "team-no@example.invalid",
              password: "Testing-password-2026",
              role_id: role,
              branch_id: b1,
            },
            viewer,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            "/users/" + observer + "/status",
            "PATCH",
            { status: "suspended" },
            viewer,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "current branch move and suspended membership take effect without a fresh login",
    async () => {
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b2, observer);
      const moved = (await call("/users", "GET", undefined, viewer)).j.data;
      assert.deepEqual(
        moved.map((r: any) => r.name),
        ["Branch A Observer", "Branch B Private"],
      );
      assert(moved.every((r: any) => r.branch_id === b2));
      raw
        .prepare("UPDATE el_memberships SET status='suspended' WHERE id=?")
        .run(observer);
      assert.equal(
        (await call("/users", "GET", undefined, viewer)).r.status,
        401,
      );
    },
  );
  await t.test(
    "headquarters custom viewer stays in its own organization",
    async () => {
      await call(
        "/auth/login",
        "POST",
        { email: "team-hq@example.invalid", password: "Testing-password-2026" },
        viewer,
      );
      await call("/me", "GET", undefined, viewer);
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign private owner",
          email: "team-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Foreign Team Center",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      const list = (await call("/users", "GET", undefined, viewer)).j.data;
      assert.equal(list.length, 5);
      assert(!JSON.stringify(list).includes("team-foreign@example.invalid"));
      assert.equal(
        (await call("/users", "GET", undefined, foreign)).j.data.length,
        1,
      );
    },
  );
  await t.test(
    "malformed permission tokens do not silently map onto valid grants",
    async () => {
      const before = (
        raw.prepare("SELECT count(*) n FROM el_roles").get() as any
      ).n;
      for (const permission of [
        "students:view:delete",
        "students:view:",
        "students",
        ":view",
        "students:VIEW",
        "students:view\n",
      ])
        assert.equal(
          (
            await call("/roles", "POST", {
              name: "Invalid role",
              permissions: [permission],
            })
          ).r.status,
          400,
          permission,
        );
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_roles").get() as any).n,
        before,
      );
    },
  );
  await t.test(
    "role changes preserve explicit previous and new permission sets, not secrets",
    async () => {
      const target = (
        await call("/roles", "POST", {
          name: "Audited target",
          permissions: ["students:view", "students:edit"],
        })
      ).j.id;
      const edited = await call("/roles/" + target, "PUT", {
        name: "Audited target revised",
        permissions: ["students:view", "courses:view"],
      });
      assert.equal(edited.r.status, 200);
      const log = raw
        .prepare(
          "SELECT before_json,after_json FROM el_audit WHERE org_id=? AND entity='role' AND entity_id=? AND action='update'",
        )
        .get(org, target) as any;
      assert.deepEqual(JSON.parse(log.before_json).permissions, [
        "students:edit",
        "students:view",
      ]);
      assert.deepEqual(JSON.parse(log.after_json).permissions, [
        "students:view",
        "courses:view",
      ]);
      assert.equal(JSON.parse(log.before_json).name, "Audited target");
      assert(!JSON.stringify(log).includes("Testing-password"));
    },
  );
});
