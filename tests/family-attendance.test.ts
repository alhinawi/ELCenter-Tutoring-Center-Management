import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner = { cookie: "", csrf: "" },
  student = { cookie: "", csrf: "" },
  guardian = { cookie: "", csrf: "" },
  teacher = { cookie: "", csrf: "" },
  unlinked = { cookie: "", csrf: "" },
  foreign = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c: Client = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
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
test("family attendance pages complete recorded history with current identity and status filters", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    group = (await call("/groups")).j.data[0],
    branch = group.branch_id,
    students = (await call("/students")).j.data,
    own = students[0].id,
    other = students[1].id,
    roles = (await call("/roles")).j.data;
  async function account(key: string, c: Client, profile?: string) {
    const email = crypto.randomUUID() + "@example.invalid",
      role = roles.find((r: any) => r.system_key === key),
      r = await call("/users", "POST", {
        name: "Fictional " + key,
        email,
        password: "Testing-password-2026",
        role_id: role.id,
        branch_id: branch,
      });
    assert.equal(r.r.status, 201);
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    const user = (await call("/me", "GET", undefined, c)).j.user.user_id;
    if (profile) {
      const l = await call("/portal-links", "POST", {
        user_id: user,
        kind: key === "parent_guardian" ? "guardian" : key,
        profile_id: profile,
      });
      assert.equal(l.r.status, 201, JSON.stringify(l.j));
    }
    return { user, membership: r.j.id };
  }
  const studentAccount = await account("student", student, own);
  await account("teacher", teacher, group.teacher_id);
  await account("student", unlinked);
  const guardianId = crypto.randomUUID();
  raw
    .prepare(
      "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
    )
    .run(guardianId, org, branch, "Fictional Guardian", "01000000000");
  await call("/students/" + own + "/guardians", "POST", {
    guardian_id: guardianId,
    relationship: "parent",
  });
  await account("parent_guardian", guardian, guardianId);
  raw.prepare("DELETE FROM el_attendance WHERE org_id=?").run(org);
  const sessionInsert = raw.prepare(
      "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'cancelled')",
    ),
    attendanceInsert = raw.prepare(
      "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,arrival,departure,notes,recorded_by) VALUES(?,?,?,?,?,?,?,?,?)",
    ),
    ids = new Set<string>(),
    statuses = ["present", "absent", "late", "excused", "left_early"];
  for (let i = 0; i < 221; i++) {
    const session = crypto.randomUUID(),
      attendance = crypto.randomUUID();
    sessionInsert.run(
      session,
      org,
      branch,
      group.id,
      group.teacher_id,
      group.classroom_id,
      1800000000,
      1800003600,
      "Fictional Attendance " + i,
    );
    attendanceInsert.run(
      attendance,
      org,
      session,
      own,
      statuses[i % 5],
      i === 0 ? 1800000000 : null,
      i === 0 ? 1800003600 : null,
      "EXCLUDED INTERNAL NOTES",
      me.user.user_id,
    );
    ids.add(attendance);
  }
  await t.test(
    "221 tied-time rows enumerate without duplicate pages or internal details",
    async () => {
      const actual = new Set<string>();
      for (let page = 1; page <= 12; page++) {
        const r = await call(
          `/portal/students/${own}/attendance?page=${page}`,
          "GET",
          undefined,
          student,
        );
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 221);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!actual.has(row.id));
          actual.add(row.id);
          assert.equal(row.session_status, "cancelled");
          for (const field of [
            "notes",
            "recorded_by",
            "revision",
            "student_id",
          ])
            assert(!(field in row));
        }
      }
      assert.equal(actual.size, 221);
      assert.deepEqual(
        (
          await call(
            `/portal/students/${own}/attendance?page=13`,
            "GET",
            undefined,
            student,
          )
        ).j.data,
        [],
      );
      const a = (
          await call(
            `/portal/students/${own}/attendance?page=2`,
            "GET",
            undefined,
            student,
          )
        ).j.data,
        b = (
          await call(
            `/portal/students/${own}/attendance?page=2`,
            "GET",
            undefined,
            guardian,
          )
        ).j.data;
      assert.deepEqual(a, b);
      const snapshot = (
        await call(`/portal/students/${own}`, "GET", undefined, student)
      ).j;
      assert.equal(snapshot.attendance.length, 200);
    },
  );
  await t.test(
    "all supported statuses filter and total correctly, malformed inputs reject",
    async () => {
      for (const [i, status] of statuses.entries()) {
        const r = await call(
          `/portal/students/${own}/attendance?status=${status}`,
          "GET",
          undefined,
          student,
        );
        assert.equal(r.j.total, i === 0 ? 45 : 44);
        assert(r.j.data.every((r: any) => r.status === status));
      }
      for (const value of ["", "0", "-1", "1.5", "Infinity", "10001"])
        assert.equal(
          (
            await call(
              `/portal/students/${own}/attendance?page=${value}`,
              "GET",
              undefined,
              student,
            )
          ).r.status,
          400,
          value,
        );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance?status=unknown`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "current ownership, relationship, role and profile binding gate every page",
    async () => {
      assert.equal(
        (
          await call(
            `/portal/students/${other}/attendance`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            teacher,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            unlinked,
          )
        ).r.status,
        403,
      );
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE student_id=? AND guardian_id=?",
        )
        .run(own, guardianId);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance?page=2`,
            "GET",
            undefined,
            guardian,
          )
        ).r.status,
        404,
      );
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(own);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      raw.prepare("UPDATE el_students SET status='active' WHERE id=?").run(own);
    },
  );
  await t.test(
    "membership branch and link changes revoke the existing session; foreign and unsigned access isolated",
    async () => {
      const b = (
        await call("/branches", "POST", {
          name: "Fictional Other",
          code: "FA-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b, studentAccount.membership);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, studentAccount.membership);
      raw
        .prepare("DELETE FROM el_portal_links WHERE user_id=?")
        .run(studentAccount.user);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      await call("/auth/demo", "POST", {}, foreign);
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/attendance`,
            "GET",
            undefined,
            foreign,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(`/portal/students/${own}/attendance`, "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
    },
  );
});
