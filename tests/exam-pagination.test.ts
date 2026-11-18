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
test("exam directory pagination reaches old exams with exact filters and current scope", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "exam-page-owner@example.invalid",
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
  const time = 1800000000,
    insert = raw.prepare(
      "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status) VALUES(?,?,?,?,?,?,100,50,?)",
    ),
    ids: string[] = [];
  for (let i = 0; i < 321; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    insert.run(
      id,
      org,
      branch,
      group,
      i === 0 ? "Oldest distinctive exam" : "Fictional exam " + i,
      time + Math.floor(i / 2),
      i % 2 ? "published" : "draft",
    );
  }
  await t.test(
    "all 321 reachable, stable scheduled/id ties, 20-row pages",
    async () => {
      const seen = new Set<string>();
      let previous: any = null;
      for (let page = 1; page <= 17; page++) {
        const r = await call("/exams?page=" + page);
        assert.equal(r.r.status, 200);
        assert.equal(r.j.total, 321);
        assert.equal(r.j.page_size, 20);
        assert.equal(r.j.data.length, page === 17 ? 1 : 20);
        for (const e of r.j.data) {
          assert(!seen.has(e.id));
          seen.add(e.id);
          if (previous)
            assert(
              previous.scheduled_at > e.scheduled_at ||
                (previous.scheduled_at === e.scheduled_at &&
                  previous.id > e.id),
            );
          previous = e;
        }
      }
      assert.equal(seen.size, 321);
      assert.equal((await call("/exams?page=18")).j.data.length, 0);
    },
  );
  await t.test(
    "name status group filters narrow full directory, malformed pagination rejected",
    async () => {
      assert.equal((await call("/exams?q=Oldest")).j.data[0].id, ids[0]);
      assert.equal((await call("/exams?status=published")).j.total, 160);
      assert.equal(
        (await call("/exams?status=draft&q=Oldest&group=" + group)).j.total,
        1,
      );
      for (const p of [
        "page=0",
        "page=1.5",
        "page=NaN",
        "page=10001",
        "status=bad",
        "group=bad",
      ])
        assert.equal((await call("/exams?" + p)).r.status, 400, p);
      assert.equal(
        (await call("/exams?group=" + crypto.randomUUID())).r.status,
        404,
      );
    },
  );
  await t.test(
    "current assigned scope applies to list count and group filter",
    async () => {
      const other = (
          await call("/branches", "POST", {
            name: "Other",
            code: "EXP2",
            capacity: 30,
            status: "active",
          })
        ).j.id,
        role = (
          await call("/roles", "POST", {
            name: "Exam directory reader",
            permissions: ["exams:view"],
          })
        ).j.id,
        m = (
          await call("/users", "POST", {
            name: "Fictional Reader",
            email: "exam-page-reader@example.invalid",
            password: "Testing-password-2026",
            role_id: role,
            branch_id: other,
          })
        ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "exam-page-reader@example.invalid",
          password: "Testing-password-2026",
        },
        viewer,
      );
      await call("/me", "GET", undefined, viewer);
      assert.equal((await call("/exams", "GET", undefined, viewer)).j.total, 0);
      assert.equal(
        (await call("/exams?group=" + group, "GET", undefined, viewer)).r
          .status,
        403,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, m);
      assert.equal(
        (await call("/exams", "GET", undefined, viewer)).j.total,
        321,
      );
      raw
        .prepare("UPDATE el_memberships SET status='suspended' WHERE id=?")
        .run(m);
      assert.equal(
        (await call("/exams", "GET", undefined, viewer)).r.status,
        401,
      );
    },
  );
  await t.test(
    "foreign organization sees neither exams nor totals and cannot use group",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "exam-page-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Exam Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call("/exams", "GET", undefined, foreign)).j.total,
        0,
      );
      assert.equal(
        (await call("/exams?group=" + group, "GET", undefined, foreign)).r
          .status,
        404,
      );
    },
  );
});
