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
test("student performance pages all students with branch-scoped recorded denominators", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "performance-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Performance Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    user = me.user.user_id,
    b = (await call("/branches")).j.data[0].id,
    other = (
      await call("/branches", "POST", {
        name: "Fictional History Branch",
        code: "HISTORY",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  async function make(
    entity: string,
    code: string,
    branch = b,
    extra: any = {},
  ) {
    const r = await call("/" + entity, "POST", {
      name: "Fictional " + code,
      code,
      branch_id: branch,
      ...extra,
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    return r.j.id;
  }
  const target = await make("students", "TARGET", b, {
      name: "A Metric Student",
      status: "active",
    }),
    empty = await make("students", "EMPTY", b, {
      name: "A No Records",
      status: "inactive",
    }),
    excused = await make("students", "EXCUSED", b, { name: "A Excused Only" });
  const ins = raw.prepare(
    "INSERT INTO el_students(id,org_id,branch_id,name,code,status) VALUES(?,?,?,?,?,?)",
  );
  for (let i = 3; i < 1001; i++)
    ins.run(
      crypto.randomUUID(),
      org,
      b,
      "Fictional Tied Name",
      "PAGE-" + i,
      i % 2 ? "active" : "inactive",
    );
  const foreignStudent = await make("students", "OTHER-BRANCH", other);
  const scopes: any[] = [];
  for (const [branch, index] of [
    [b, 0],
    [other, 1],
  ] as [string, number][]) {
    const teacher = await make("teachers", "PT" + index, branch),
      room = await make("classrooms", "PR" + index, branch, { capacity: 20 }),
      course = await make("courses", "PC" + index, branch),
      group = await make("groups", "PG" + index, branch, {
        teacher_id: teacher,
        classroom_id: room,
        course_id: course,
        capacity: 20,
        start_date: "2026-01-01",
        end_date: "2026-12-31",
      });
    const sessionInsert = raw.prepare(
      "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,status) VALUES(?,?,?,?,?,?,?,?,'cancelled')",
    );
    const attendanceInsert = raw.prepare(
      "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,recorded_by) VALUES(?,?,?,?,?,?)",
    );
    for (const [i, status] of (index
      ? ["absent"]
      : ["present", "late", "left_early", "absent", "excused"]
    ).entries()) {
      const id = crypto.randomUUID();
      sessionInsert.run(
        id,
        org,
        branch,
        group,
        teacher,
        room,
        1800000000 + i * 3600,
        1800000300 + i * 3600,
      );
      attendanceInsert.run(crypto.randomUUID(), org, id, target, status, user);
      if (status === "excused")
        attendanceInsert.run(
          crypto.randomUUID(),
          org,
          id,
          excused,
          status,
          user,
        );
    }
    // One unrecorded session must not increase the attendance denominator.
    sessionInsert.run(
      crypto.randomUUID(),
      org,
      branch,
      group,
      teacher,
      room,
      1800080000,
      1800080300,
    );
    const examInsert = raw.prepare(
        "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status) VALUES(?,?,?,?,?,1800000000,?,0,'published')",
      ),
      resultInsert = raw.prepare(
        "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,graded_by) VALUES(?,?,?,?,?,?,?)",
      );
    for (const [max, score, status] of (index
      ? [[100, 0, "final"]]
      : [
          [50, 50, "final"],
          [150, 0, "final"],
          [100, 100, "pending_review"],
        ]) as [number, number, string][]) {
      const id = crypto.randomUUID();
      examInsert.run(id, org, branch, group, "Fictional Metric Exam", max);
      resultInsert.run(
        crypto.randomUUID(),
        org,
        id,
        target,
        score,
        status,
        user,
      );
    }
    scopes.push({ group });
  }
  await t.test(
    "all 1002 students enumerate without duplicate ties beyond prior1000 cap",
    async () => {
      const ids = new Set<string>();
      let total = 0;
      for (let page = 1; page <= 51; page++) {
        const r = await call("/academic/performance?page=" + page);
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        total = r.j.total;
        assert.equal(r.j.page_size, 20);
        assert.equal(r.j.page, page);
        for (const row of r.j.data) {
          assert(!ids.has(row.id));
          ids.add(row.id);
        }
      }
      assert.equal(total, 1002);
      assert.equal(ids.size, 1002);
      assert(ids.has(target));
      assert(ids.has(foreignStudent));
      assert.deepEqual(
        (await call("/academic/performance?page=52")).j.data,
        [],
      );
      const a = (await call("/academic/performance?page=2")).j.data.map(
          (r: any) => r.id,
        ),
        b = (await call("/academic/performance?page=2")).j.data.map(
          (r: any) => r.id,
        );
      assert.deepEqual(a, b);
    },
  );
  await t.test(
    "all-organization weighted final score and recorded attendance; absent data is null not zero",
    async () => {
      const rows = (await call("/academic/performance?q=A%20")).j.data,
        row = rows.find((r: any) => r.id === target),
        none = rows.find((r: any) => r.id === empty),
        onlyExcused = rows.find((r: any) => r.id === excused);
      assert.equal(row.attendance_count, 6);
      assert.equal(row.attendance_eligible, 5);
      assert.equal(row.attended_count, 3);
      assert.equal(row.attendance_percent, 60);
      assert.equal(row.exam_count, 3);
      assert.equal(row.exam_percent, 16.7);
      assert.equal(none.attendance_count, 0);
      assert.equal(none.attendance_percent, null);
      assert.equal(none.exam_percent, null);
      assert.equal(none.exam_count, 0);
      assert.equal(onlyExcused.attendance_count, 1);
      assert.equal(onlyExcused.attendance_eligible, 0);
      assert.equal(onlyExcused.attendance_percent, null);
      assert(!("email" in row));
      assert(!("phone" in row));
      assert(!("notes" in row));
    },
  );
  await t.test(
    "name and current student status filters, strict pagination and no silent coercion",
    async () => {
      const r = await call("/academic/performance?q=A%20No&status=inactive");
      assert.equal(r.j.total, 1);
      assert.equal(r.j.data[0].id, empty);
      assert.equal(
        (await call("/academic/performance?q=A%20No&status=active")).j.total,
        0,
      );
      for (const page of ["", "0", "-1", "1.5", "Infinity", "NaN", "10001"])
        assert.equal(
          (await call("/academic/performance?page=" + page)).r.status,
          400,
          page,
        );
      assert.equal(
        (await call("/academic/performance?status=unknown")).r.status,
        400,
      );
      assert.equal(
        (await call("/academic/performance?q=" + "a".repeat(101))).r.status,
        400,
      );
    },
  );
  const role = (
      await call("/roles", "POST", {
        name: "Performance reader",
        permissions: ["reports:view"],
      })
    ).j.id,
    membership = (
      await call("/users", "POST", {
        name: "Fictional Branch Reader",
        email: "performance-reader@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b,
      })
    ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "performance-reader@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  await t.test(
    "branch reader uses session/exam branch not transferred student's all-branch history",
    async () => {
      const r = await call(
          "/academic/performance?q=A%20Metric",
          "GET",
          undefined,
          viewer,
        ),
        row = r.j.data[0];
      assert.equal(r.r.status, 200);
      assert.equal(r.j.total, 1);
      assert.equal(row.attendance_count, 5);
      assert.equal(row.attendance_eligible, 4);
      assert.equal(row.attendance_percent, 75);
      assert.equal(row.exam_count, 2);
      assert.equal(row.exam_percent, 25);
      assert.equal(
        (
          await call(
            "/academic/performance?q=OTHER-BRANCH",
            "GET",
            undefined,
            viewer,
          )
        ).j.total,
        0,
      );
      assert.equal(
        (await call("/academic/performance?page=51", "GET", undefined, viewer))
          .j.total,
        1001,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(other, membership);
      assert.equal(
        (
          await call(
            "/academic/performance?q=A%20Metric",
            "GET",
            undefined,
            viewer,
          )
        ).j.total,
        0,
      );
      // Student transfer changes current roster scope; it must not bring old-branch activity along.
      raw
        .prepare("UPDATE el_students SET branch_id=? WHERE id=?")
        .run(other, target);
      const after = (
        await call(
          "/academic/performance?q=A%20Metric",
          "GET",
          undefined,
          viewer,
        )
      ).j.data[0];
      assert.equal(after.attendance_percent, 0);
      assert.equal(after.attendance_count, 1);
      assert.equal(after.exam_percent, 0);
      assert.equal(after.exam_count, 1);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='reports'",
        )
        .run(role);
      assert.equal(
        (await call("/academic/performance", "GET", undefined, viewer)).r
          .status,
        403,
      );
    },
  );
  await t.test(
    "foreign organizations, suspended memberships and unauthenticated viewers remain isolated",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Fictional Foreign",
          email: "performance-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Foreign Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      const r = await call("/academic/performance", "GET", undefined, foreign);
      assert.equal(r.j.total, 0);
      assert.deepEqual(r.j.data, []);
      assert.equal(
        (
          await call("/academic/performance", "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
      raw
        .prepare("UPDATE el_memberships SET status='suspended' WHERE id=?")
        .run(membership);
      assert.equal(
        (await call("/academic/performance", "GET", undefined, viewer)).r
          .status,
        401,
      );
    },
  );
});
