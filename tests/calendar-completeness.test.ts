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
test("calendar session windows are complete, strict and currently scoped", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "calendar-bound-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Roster Academy",
  });
  const org = (await call("/me")).j.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const teacher = (
      await call("/teachers", "POST", {
        name: "Fictional Teacher",
        code: "TR",
        branch_id: branch,
      })
    ).j.id,
    course = (
      await call("/courses", "POST", {
        name: "Fictional Course",
        code: "CR",
        branch_id: branch,
      })
    ).j.id,
    room = (
      await call("/classrooms", "POST", {
        name: "Fictional Room",
        code: "RR",
        branch_id: branch,
        capacity: 10000,
      })
    ).j.id;
  const group = (
    await call("/groups", "POST", {
      name: "Fictional Group",
      code: "GR",
      branch_id: branch,
      teacher_id: teacher,
      course_id: course,
      classroom_id: room,
      capacity: 10000,
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    })
  ).j.id;
  assert(group);
  const start = 1800000000,
    insert = raw.prepare(
      "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'cancelled')",
    );
  for (let i = 0; i < 1000; i++)
    insert.run(
      crypto.randomUUID(),
      org,
      branch,
      group,
      teacher,
      room,
      start + i * 60,
      start + i * 60 + 60,
      "Fictional calendar " + i,
    );
  const path = "/sessions?from=" + start + "&to=" + (start + 1001 * 60);
  await t.test(
    "exactly 1000 returned in stable complete window; 1001 rejects and narrower range works",
    async () => {
      let r = await call(path);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.data.length, 1000);
      assert.equal(r.j.data[0].starts_at, start);
      insert.run(
        crypto.randomUUID(),
        org,
        branch,
        group,
        teacher,
        room,
        start + 1000 * 60,
        start + 1001 * 60,
        "Fictional overflow",
      );
      r = await call(path);
      assert.equal(r.r.status, 409);
      assert(!r.j.data);
      r = await call("/sessions?from=" + start + "&to=" + (start + 30 * 60));
      assert.equal(r.j.data.length, 30);
      r = await call(
        "/sessions?from=" + (start + 30 * 60) + "&to=" + (start + 31 * 60),
      );
      assert.equal(r.j.data.length, 1);
      assert.equal(r.j.data[0].starts_at, start + 30 * 60);
    },
  );
  await t.test(
    "nonfinite, fractional, empty and invalid epoch/range inputs reject not default",
    async () => {
      for (const value of [
        "Infinity",
        "NaN",
        "abc",
        "0",
        "-1",
        "1.5",
        "",
        "253402300800",
      ]) {
        assert.equal(
          (await call("/sessions?from=" + value + "&to=" + (start + 60))).r
            .status,
          400,
          value,
        );
        assert.equal(
          (await call("/sessions?from=" + start + "&to=" + value)).r.status,
          400,
          value,
        );
      }
      assert.equal(
        (await call("/sessions?from=" + start + "&to=" + start)).r.status,
        400,
      );
      assert.equal(
        (await call("/sessions?from=" + start + "&to=" + (start + 371 * 86400)))
          .r.status,
        400,
      );
      for (const param of ["group=bad", "branch=bad"])
        assert.equal((await call(path + "&" + param)).r.status, 400);
      assert.equal(
        (await call(path + "&branch=" + crypto.randomUUID())).r.status,
        404,
      );
      assert.equal(
        (await call(path + "&group=" + crypto.randomUUID())).r.status,
        404,
      );
    },
  );
  await t.test(
    "current group/branch scope checked even when the requested window is empty",
    async () => {
      const other = (
        await call("/branches", "POST", {
          name: "Other",
          code: "CAL2",
          capacity: 30,
          status: "active",
        })
      ).j.id;
      const role = (
          await call("/roles", "POST", {
            name: "Calendar branch reader",
            permissions: ["sessions:view"],
          })
        ).j.id,
        m = (
          await call("/users", "POST", {
            name: "Fictional Reader",
            email: "calendar-bound-reader@example.invalid",
            password: "Testing-password-2026",
            role_id: role,
            branch_id: other,
          })
        ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "calendar-bound-reader@example.invalid",
          password: "Testing-password-2026",
        },
        viewer,
      );
      await call("/me", "GET", undefined, viewer);
      const empty = "/sessions?from=100&to=200";
      assert.equal(
        (await call(empty + "&group=" + group, "GET", undefined, viewer)).r
          .status,
        403,
      );
      assert.equal(
        (await call(empty + "&branch=" + branch, "GET", undefined, viewer)).r
          .status,
        403,
      );
      assert.equal(
        (await call(empty + "&group=" + group + "&branch=" + other)).r.status,
        400,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, m);
      assert.equal(
        (await call(empty + "&group=" + group, "GET", undefined, viewer)).r
          .status,
        200,
      );
    },
  );
  await t.test(
    "foreign organization cannot use group or branch filter identifiers",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "calendar-bound-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Calendar Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call(path + "&group=" + group, "GET", undefined, foreign)).r
          .status,
        404,
      );
      assert.equal(
        (await call(path + "&branch=" + branch, "GET", undefined, foreign)).r
          .status,
        404,
      );
      assert.deepEqual(
        (await call(path, "GET", undefined, foreign)).j.data,
        [],
      );
    },
  );
});
