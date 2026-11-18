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
test("dashboard active record counts are current, permission-filtered and assigned-branch scoped", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "count-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Count Academy",
  });
  const org = (await call("/me")).j.organization.id,
    b1 = (await call("/branches")).j.data[0].id,
    b2 = (
      await call("/branches", "POST", {
        name: "Other",
        code: "CT2",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  for (const [i, status] of ["active", "new", "suspended", "active"].entries())
    await call("/students", "POST", {
      name: "Fictional Student " + i,
      code: "COUNT" + i,
      branch_id: i === 3 ? b2 : b1,
      status,
    });
  const teacher = (
    await call("/teachers", "POST", {
      name: "Fictional Teacher",
      code: "CT",
      branch_id: b1,
      status: "active",
    })
  ).j.id;
  const course = (
    await call("/courses", "POST", {
      name: "Fictional Course",
      code: "CC",
      branch_id: b1,
      status: "active",
    })
  ).j.id;
  const room = (
    await call("/classrooms", "POST", {
      name: "Fictional Room",
      code: "CR",
      branch_id: b1,
      capacity: 30,
    })
  ).j.id;
  await call("/groups", "POST", {
    name: "Fictional Group",
    code: "CG",
    branch_id: b1,
    teacher_id: teacher,
    course_id: course,
    classroom_id: room,
    capacity: 30,
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "active",
  });
  for (const [i, status] of [
    "active",
    "onboarding",
    "on_leave",
    "terminated",
  ].entries())
    await call("/operations/employees", "POST", {
      name: "Fictional Employee " + i,
      code: "CE" + i,
      branch_id: b1,
      job_title: "Coordinator",
      hired_on: "2026-01-01",
      status,
    });
  const role = (
      await call("/roles", "POST", {
        name: "Scoped student count reader",
        permissions: ["branches:view", "students:view"],
      })
    ).j.id,
    m = (
      await call("/users", "POST", {
        name: "Fictional Count Reader",
        email: "count-reader@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b1,
      })
    ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "count-reader@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  await t.test(
    "HQ has exact current active counts and explicit basis metadata",
    async () => {
      const r = (await call("/dashboard")).j;
      assert.deepEqual(r.record_counts.counts, {
        students: 2,
        teachers: 1,
        courses: 1,
        groups: 1,
        employees: 1,
      });
      assert.equal(r.record_counts.branch_id, null);
      assert.equal(r.record_counts.includes_saved_demo, true);
      assert.equal(r.record_counts.basis, "current_active_assigned_branch");
      assert(r.widgets.includes("active_records"));
      assert(r.record_counts.generated_at);
    },
  );
  await t.test(
    "custom role gets only permitted count and current branch moves take effect",
    async () => {
      let r = (await call("/dashboard", "GET", undefined, viewer)).j;
      assert.deepEqual(r.record_counts.counts, { students: 1 });
      assert.equal(r.record_counts.branch_id, b1);
      assert(!("employees" in r.record_counts.counts));
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b2, m);
      r = (await call("/dashboard", "GET", undefined, viewer)).j;
      assert.deepEqual(r.record_counts.counts, { students: 1 });
      raw
        .prepare(
          "UPDATE el_students SET status='inactive' WHERE org_id=? AND branch_id=? AND status='active'",
        )
        .run(org, b2);
      assert.equal(
        (await call("/dashboard", "GET", undefined, viewer)).j.record_counts
          .counts.students,
        0,
      );
    },
  );
  await t.test(
    "permission revoke removes widget and metrics, not misleading zeroes",
    async () => {
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='students'",
        )
        .run(role);
      const r = (await call("/dashboard", "GET", undefined, viewer)).j;
      assert(!("record_counts" in r));
      assert(!r.allowed_widgets.includes("active_records"));
      assert(!r.widgets.includes("active_records"));
      assert.equal(
        (
          await call(
            "/dashboard/preferences",
            "PUT",
            { widgets: ["active_records"] },
            viewer,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "saved layout remains unchanged when new widget is available; no implicit opt-in",
    async () => {
      await call("/dashboard/preferences", "PUT", { widgets: ["welcome"] });
      let r = (await call("/dashboard")).j;
      assert.deepEqual(r.widgets, ["welcome"]);
      assert(r.allowed_widgets.includes("active_records"));
      assert(r.record_counts);
      await call("/dashboard/preferences", "DELETE");
      assert((await call("/dashboard")).j.widgets.includes("active_records"));
    },
  );
  await t.test(
    "saved demo rows included, foreign organization does not inherit counts",
    async () => {
      raw
        .prepare(
          "UPDATE el_students SET is_demo=1 WHERE org_id=? AND branch_id=?",
        )
        .run(org, b1);
      assert.equal(
        (await call("/dashboard")).j.record_counts.counts.students,
        1,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "count-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Count Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.deepEqual(
        (await call("/dashboard", "GET", undefined, foreign)).j.record_counts
          .counts,
        { students: 0, teachers: 0, courses: 0, groups: 0, employees: 0 },
      );
    },
  );
});
