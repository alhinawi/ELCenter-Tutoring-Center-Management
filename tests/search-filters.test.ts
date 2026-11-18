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
test("global search filters have strict kind scope and precise eight-plus-one bounds", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "search-filter-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Search Academy",
  });
  const org = (await call("/me")).j.organization.id,
    b = (await call("/branches")).j.data[0].id,
    other = (
      await call("/branches", "POST", {
        name: "Fictional Other Branch",
        code: "SEARCH-OTHER",
        capacity: 20,
        status: "active",
      })
    ).j.id;
  const insert = raw.prepare(
    "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
  );
  for (let i = 0; i < 9; i++)
    insert.run(crypto.randomUUID(), org, b, "Fictional Match " + i, "SM-" + i);
  insert.run(
    crypto.randomUUID(),
    org,
    other,
    "Fictional Other Branch",
    "SM-OTHER",
  );
  await call("/teachers", "POST", {
    name: "Fictional Teacher",
    code: "ST",
    branch_id: b,
  });
  await t.test(
    "exact8 not flagged,9 flagged without returning sentinel or counts",
    async () => {
      let r = await call("/search?q=Fictional%20Match&kind=students");
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.data.students.length, 8);
      assert.equal(r.j.more.students, true);
      assert.equal(r.j.limit_per_kind, 8);
      assert.deepEqual(Object.keys(r.j.data), ["students"]);
      raw.prepare("DELETE FROM el_students WHERE code='SM-8'").run();
      r = await call("/search?q=Fictional%20Match&kind=students");
      assert.equal(r.j.data.students.length, 8);
      assert.equal(r.j.more.students, false);
      assert.deepEqual(Object.keys(r.j.data.students[0]).sort(), [
        "id",
        "label",
      ]);
      r = await call("/search?q=Fictional&kind=teachers");
      assert.equal(r.j.data.teachers.length, 1);
      assert(!r.j.data.students);
      assert.equal(r.j.more.teachers, false);
      r = await call("/search?q=Fictional&kind=");
      assert(r.j.data.students);
      assert(r.j.data.teachers);
      assert.equal(r.j.more.students, true);
      assert.equal(
        (await call("/search?q=Fictional&kind=unknown")).r.status,
        400,
      );
      assert.equal(
        (await call("/search?q=Fictional&kind=Students")).r.status,
        400,
      );
    },
  );
  const role = (
      await call("/roles", "POST", {
        name: "Student search only",
        permissions: ["students:view"],
      })
    ).j.id,
    membership = (
      await call("/users", "POST", {
        name: "Fictional Reader",
        email: "search-filter-viewer@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b,
      })
    ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "search-filter-viewer@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  await t.test(
    "module selection never widens permission, branch or more-match evidence",
    async () => {
      let r = await call(
        "/search?q=Fictional&kind=teachers",
        "GET",
        undefined,
        viewer,
      );
      assert.deepEqual(r.j.data, {});
      assert.deepEqual(r.j.more, {});
      r = await call(
        "/search?q=Fictional&kind=students",
        "GET",
        undefined,
        viewer,
      );
      assert.equal(r.j.data.students.length, 8);
      assert.equal(r.j.more.students, false);
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(other, membership);
      r = await call(
        "/search?q=Fictional&kind=students",
        "GET",
        undefined,
        viewer,
      );
      assert.equal(r.j.data.students.length, 1);
      assert.equal(r.j.more.students, false);
      assert.equal(r.j.data.students[0].label, "Fictional Other Branch");
      raw.prepare("DELETE FROM el_role_permissions WHERE role_id=?").run(role);
      r = await call(
        "/search?q=Fictional&kind=students",
        "GET",
        undefined,
        viewer,
      );
      assert.deepEqual(r.j.data, {});
      assert.deepEqual(r.j.more, {});
    },
  );
  await t.test(
    "foreign and unsigned sources cannot reveal matches or existence flags",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Fictional Foreign",
          email: "search-filter-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Foreign Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      const r = await call(
        "/search?q=Fictional&kind=students",
        "GET",
        undefined,
        foreign,
      );
      assert.deepEqual(r.j.data.students, []);
      assert.equal(r.j.more.students, false);
      assert.equal(
        (
          await call("/search?q=Fictional&kind=students", "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
    },
  );
});
