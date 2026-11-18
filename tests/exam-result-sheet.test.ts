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
test("exam result sheets expose final grades only with private audited scope", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "results-owner@example.invalid",
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
  const exam = (
    await call("/exams", "POST", {
      name: "Fictional Exam",
      group_id: group,
      scheduled_at: Math.floor(Date.now() / 1000) - 600,
      max_score: 100,
      pass_score: 50,
      status: "draft",
    })
  ).j.id;
  assert(exam);
  const path = "/exams/" + exam + "/result-sheet";
  assert.equal((await call(path, "POST", { action: "print" })).r.status, 409);
  raw.prepare("UPDATE el_exams SET status='published' WHERE id=?").run(exam);
  const empty = (await call(path, "POST", { action: "print" })).j;
  assert.deepEqual(empty.results, []);
  assert.equal(empty.summary.average_score, null);
  assert.equal(empty.summary.final, 0);
  const ownerId = (await call("/me")).j.user.user_id;
  const createStudent = (i: number) =>
    call("/students", "POST", {
      name: i === 0 ? "=Fictional top learner" : "Fictional learner " + i,
      code: "ER" + i,
      branch_id: branch,
      national_id: "EXCLUDED-PRIVATE",
      phone: "EXCLUDED-PRIVATE",
      notes: "EXCLUDED-PRIVATE",
    });
  for (const [i, score] of [90, 90, 40, 99].entries()) {
    const id = (await createStudent(i)).j.id;
    raw
      .prepare(
        "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,feedback,graded_by) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        crypto.randomUUID(),
        org,
        exam,
        id,
        score,
        i === 3 ? "pending_review" : "final",
        "EXCLUDED-PRIVATE",
        ownerId,
      );
  }
  await t.test(
    "draft rejects; final-only sheet uses competition rank and excludes pending scores",
    async () => {
      const r = await call(path, "POST", { action: "print" });
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.deepEqual(
        r.j.results.map((r: any) => r.rank),
        [1, 1, 3],
      );
      assert.deepEqual(
        r.j.results.map((r: any) => r.score),
        [90, 90, 40],
      );
      assert.equal(r.j.results[0].percent, 90);
      assert.deepEqual(r.j.summary, {
        final: 3,
        pending_review: 1,
        passed: 2,
        needs_support: 1,
        average_score: 220 / 3,
      });
      assert(!JSON.stringify(r.j).includes("EXCLUDED-PRIVATE"));
      assert(!JSON.stringify(r.j).includes("Fictional learner 3"));
      assert(!("student_id" in r.j.results[0]));
    },
  );
  await t.test(
    "current permission/branch and CSRF checks; audit failure returns no grades",
    async () => {
      const role = (
          await call("/roles", "POST", {
            name: "Sheet reader",
            permissions: ["exams:view", "exams:print"],
          })
        ).j.id,
        m = (
          await call("/users", "POST", {
            name: "Fictional Reader",
            email: "sheet-reader@example.invalid",
            password: "Testing-password-2026",
            role_id: role,
            branch_id: branch,
          })
        ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "sheet-reader@example.invalid",
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
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='exams' AND action='view'",
        )
        .run(role);
      assert.equal(
        (await call(path, "POST", { action: "print" }, viewer)).r.status,
        403,
      );
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,'exams','view')",
        )
        .run(role);
      const other = (
        await call("/branches", "POST", {
          name: "Other",
          code: "ER2",
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
      for (const data of [
        { action: "invalid" },
        { action: "print", student_id: crypto.randomUUID() },
      ])
        assert.equal((await call(path, "POST", data)).r.status, 400);
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
      raw.exec(
        "CREATE TRIGGER fail_sheet_audit BEFORE INSERT ON el_audit WHEN NEW.entity='exam_result_sheet' BEGIN SELECT RAISE(ABORT,'forced sheet audit failure'); END;",
      );
      const failure = await call(path, "POST", { action: "export" });
      assert.equal(failure.r.status, 500);
      assert(!failure.j.results);
      raw.exec("DROP TRIGGER fail_sheet_audit");
    },
  );
  await t.test(
    "foreign organization is denied; current finalized grade changes refresh output",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "sheet-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Sheet Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (await call(path, "POST", { action: "print" }, foreign)).r.status,
        404,
      );
      raw
        .prepare(
          "UPDATE el_exam_results SET status='final' WHERE exam_id=? AND status='pending_review'",
        )
        .run(exam);
      const r = (await call(path, "POST", { action: "export" })).j;
      assert.equal(r.summary.final, 4);
      assert.equal(r.summary.pending_review, 0);
      assert.deepEqual(
        r.results.map((r: any) => r.rank),
        [1, 2, 2, 4],
      );
    },
  );
  await t.test(
    "exact 5000 recorded results complete and 5001 rejects including pending rows",
    async () => {
      const si = raw.prepare(
          "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
        ),
        ri = raw.prepare(
          "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,graded_by) VALUES(?,?,?,?,0,'pending_review',?)",
        );
      for (let i = 4; i < 5000; i++) {
        const id = crypto.randomUUID();
        si.run(id, org, branch, "Fictional boundary " + i, "ES" + i);
        ri.run(crypto.randomUUID(), org, exam, id, ownerId);
      }
      let r = await call(path, "POST", { action: "export" });
      assert.equal(r.r.status, 200);
      assert.equal(r.j.summary.pending_review, 4996);
      assert.equal(r.j.results.length, 4);
      const id = crypto.randomUUID();
      si.run(id, org, branch, "Fictional overflow", "ESOVER");
      ri.run(crypto.randomUUID(), org, exam, id, ownerId);
      r = await call(path, "POST", { action: "print" });
      assert.equal(r.r.status, 409);
      assert(!r.j.results);
    },
  );
});
