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
test("group rosters are minimal, current scoped complete-or-reject audited snapshots", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "roster-owner@example.invalid",
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
  const path = "/groups/" + group + "/roster";
  const students: string[] = [];
  for (const [i, status] of [
    "active",
    "waiting",
    "completed",
    "withdrawn",
  ].entries()) {
    const id = (
      await call("/students", "POST", {
        name: i === 0 ? "=Fictional formula name" : "Fictional Student " + i,
        code: "RS" + i,
        branch_id: branch,
        national_id: "EXCLUDED-PRIVATE",
        phone: "EXCLUDED-PRIVATE",
        notes: "EXCLUDED-PRIVATE",
      })
    ).j.id;
    students.push(id);
    const e = crypto.randomUUID();
    raw
      .prepare(
        "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,?)",
      )
      .run(e, org, id, group, status);
  }
  await t.test(
    "default active, explicit waiting/all, no sensitive fields or raw identities",
    async () => {
      const active = await call(path, "POST", { action: "print" });
      assert.equal(active.r.status, 200, JSON.stringify(active.j));
      assert.equal(active.j.students.length, 1);
      assert.equal(active.j.students[0].enrollment_status, "active");
      assert.equal(active.j.group.name, "Fictional Group");
      assert(!JSON.stringify(active.j).includes("EXCLUDED-PRIVATE"));
      assert(!("student_id" in active.j.students[0]));
      assert.equal(
        (await call(path, "POST", { action: "export", status: "waiting" })).j
          .students.length,
        1,
      );
      assert.equal(
        (await call(path, "POST", { action: "export", status: "all" })).j
          .students.length,
        4,
      );
      const log = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE entity='group_roster' AND entity_id=? AND json_extract(after_json,'$.status')='all' LIMIT 1",
        )
        .get(group) as any;
      assert.equal(JSON.parse(log.after_json).count, 4);
      assert(!log.after_json.includes("Fictional Student"));
    },
  );
  await t.test(
    "current grants, scope and CSRF required, invalid actions reject",
    async () => {
      const role = (
          await call("/roles", "POST", {
            name: "Roster reader",
            permissions: ["groups:view", "groups:print"],
          })
        ).j.id,
        m = (
          await call("/users", "POST", {
            name: "Fictional Roster Reader",
            email: "roster-reader@example.invalid",
            password: "Testing-password-2026",
            role_id: role,
            branch_id: branch,
          })
        ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "roster-reader@example.invalid",
          password: "Testing-password-2026",
        },
        viewer,
      );
      await call("/me", "GET", undefined, viewer);
      assert.equal(
        (await call(path, "POST", { action: "print" }, viewer)).r.status,
        200,
      );
      assert.equal(
        (await call(path, "POST", { action: "export" }, viewer)).r.status,
        403,
      );
      const other = (
        await call("/branches", "POST", {
          name: "Other",
          code: "R2",
          capacity: 10,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(other, m);
      assert.equal(
        (await call(path, "POST", { action: "print" }, viewer)).r.status,
        403,
      );
      for (const b of [
        { action: "delete" },
        { action: "print", status: "invalid" },
        { action: "print", user_id: "other" },
      ])
        assert.equal((await call(path, "POST", b)).r.status, 400);
      const r = await app.request(
        "http://localhost/api" + path,
        {
          method: "POST",
          headers: { cookie: owner.cookie, "content-type": "application/json" },
          body: '{"action":"print"}',
        },
        { DB: db, ENVIRONMENT: "test" },
      );
      assert.equal(r.status, 403);
    },
  );
  await t.test(
    "foreign organization and failed audit cannot return roster",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "roster-other@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Roster Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call(path, "POST", { action: "print" }, foreign)).r.status,
        404,
      );
      raw.exec(
        "CREATE TRIGGER fail_roster_audit BEFORE INSERT ON el_audit WHEN NEW.entity='group_roster' BEGIN SELECT RAISE(ABORT,'forced roster audit failure'); END;",
      );
      const r = await call(path, "POST", { action: "export" });
      assert.equal(r.r.status, 500);
      assert(!r.j.students);
      raw.exec("DROP TRIGGER fail_roster_audit");
    },
  );
  await t.test(
    "exact 5000 is complete and 5001 rejects rather than truncates",
    async () => {
      const si = raw.prepare(
          "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
        ),
        ei = raw.prepare(
          "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,'withdrawn')",
        );
      for (let i = 4; i < 5000; i++) {
        const id = crypto.randomUUID();
        si.run(id, org, branch, "Fictional boundary " + i, "BOUND" + i);
        ei.run(crypto.randomUUID(), org, id, group);
      }
      assert.equal(
        (await call(path, "POST", { action: "export", status: "all" })).j
          .students.length,
        5000,
      );
      const id = crypto.randomUUID();
      si.run(id, org, branch, "Fictional overflow", "OVER");
      ei.run(crypto.randomUUID(), org, id, group);
      const r = await call(path, "POST", { action: "export", status: "all" });
      assert.equal(r.r.status, 409);
      assert(!r.j.students);
      assert.equal(
        (await call(path, "POST", { action: "print", status: "active" })).j
          .students.length,
        1,
      );
    },
  );
});
