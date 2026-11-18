import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  other: Client = { cookie: "", csrf: "" },
  student: Client = { cookie: "", csrf: "" },
  guardian: Client = { cookie: "", csrf: "" },
  teacher: Client = { cookie: "", csrf: "" },
  unlinked: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c === owner ? "system-owner" : "system-other",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    {
      DB: db,
      ENVIRONMENT: "test",
      DOCUMENT_ENCRYPTION_KEY: "test-only-system-document-encryption-key",
    },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("family and assigned teacher corrections preserve school data and independent review", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  await call("/settings/demo/learning", "POST", {});
  const att = raw
    .prepare(
      "SELECT at.*,s.branch_id,s.teacher_id,s.group_id FROM el_attendance at JOIN el_class_sessions s ON s.id=at.session_id LIMIT 1",
    )
    .get() as any;
  assert(att);
  const roles = (await call("/roles")).j.data;
  async function account(key: string, c: Client, profile?: string) {
    const email = key + randomUUID() + "@example.invalid";
    const u = await call("/users", "POST", {
      name: key,
      email,
      password: "Testing-password-2026",
      role_id: roles.find((r: any) => r.system_key === key).id,
      branch_id: null,
    });
    assert.equal(u.r.status, 201, JSON.stringify(u.j));
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
    return user;
  }
  const studentUser = await account("student", student, att.student_id);
  const teacherUser = await account("teacher", teacher, att.teacher_id);
  await account("student", unlinked);
  const guardianId = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
    )
    .run(guardianId, org, att.branch_id, "Fictional Guardian", "01000000111");
  await call("/students/" + att.student_id + "/guardians", "POST", {
    guardian_id: guardianId,
    relationship: "parent",
  });
  await account("parent_guardian", guardian, guardianId);
  const row = () =>
    raw.prepare("SELECT * FROM el_attendance WHERE id=?").get(att.id) as any;
  const path = "/portal/attendance/" + att.id + "/corrections";
  let request = "";
  await t.test(
    "linked student requests status only and cannot decide or edit times/notes",
    async () => {
      assert.equal((await call(path, "GET", undefined, student)).r.status, 200);
      for (const extra of [
        { notes: "overwrite internal" },
        { arrival: 1700000000 },
        { departure: null },
      ])
        assert.equal(
          (
            await call(
              path,
              "POST",
              {
                status: att.status === "present" ? "absent" : "present",
                reason: "Checked my classroom register",
                ...extra,
              },
              student,
            )
          ).r.status,
          400,
        );
      const result = await call(
        path,
        "POST",
        {
          status: att.status === "present" ? "absent" : "present",
          reason: "Checked my classroom register",
        },
        student,
      );
      assert.equal(result.r.status, 201, JSON.stringify(result.j));
      request = result.j.id;
      assert.equal(row().status, att.status);
      const saved = raw
        .prepare("SELECT * FROM el_attendance_corrections WHERE id=?")
        .get(request) as any;
      assert.equal(saved.arrival, att.arrival);
      assert.equal(saved.departure, att.departure);
      assert.equal(saved.notes, att.notes);
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + request + "/decision",
            "POST",
            { decision: "approved", note: "Self approval" },
            student,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            "/attendance/" + att.id + "/corrections",
            "POST",
            { status: "excused", reason: "Generic endpoint escape" },
            teacher,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "shared pending state reveals no other requester history",
    async () => {
      const g = (await call(path, "GET", undefined, guardian)).j;
      assert.equal(g.pending, true);
      assert.deepEqual(g.data, []);
      const r = await call(
        path,
        "POST",
        { status: "excused", reason: "Family checked the register" },
        guardian,
      );
      assert.equal(r.r.status, 409);
      const own = (await call(path, "GET", undefined, student)).j.data;
      assert.equal(own.length, 1);
      assert(!("notes" in own[0]));
      assert(!("requested_by" in own[0]));
    },
  );
  await t.test(
    "school approval updates source; family sees own response only",
    async () => {
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + request + "/decision",
            "POST",
            {
              decision: "approved",
              note: "Verified against the signed register",
            },
          )
        ).r.status,
        200,
      );
      assert.notEqual(row().status, att.status);
      assert.equal(row().notes, att.notes);
      assert.equal(
        (await call(path, "GET", undefined, student)).j.data[0].status,
        "approved",
      );
      assert.equal(
        (await call(path, "GET", undefined, guardian)).j.data.length,
        0,
      );
    },
  );
  await t.test(
    "assigned teacher requests enter same queue without changing attendance",
    async () => {
      const before = row();
      const r = await call(
        "/lms/attendance/" + att.id + "/corrections",
        "POST",
        {
          status: before.status === "late" ? "excused" : "late",
          reason: "Class teacher verified signed sheet",
        },
        teacher,
      );
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      assert.equal(row().status, before.status);
      assert.equal(
        (await call(path, "GET", undefined, teacher)).j.data.length,
        1,
      );
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + r.j.id + "/decision",
            "POST",
            { decision: "approved", note: "Teacher cannot decide" },
            teacher,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + r.j.id + "/decision",
            "POST",
            { decision: "rejected", note: "Please provide a dated source" },
          )
        ).r.status,
        200,
      );
    },
  );
  await t.test(
    "unlinked, unrelated, moved branch and unavailable profile cannot access",
    async () => {
      assert.equal(
        (await call(path, "GET", undefined, unlinked)).r.status,
        403,
      );
      const unrelated = raw
        .prepare(
          "SELECT at.id FROM el_attendance at WHERE at.student_id<>? LIMIT 1",
        )
        .get(att.student_id) as any;
      assert(unrelated);
      assert.equal(
        (
          await call(
            "/portal/attendance/" + unrelated.id + "/corrections",
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
      raw
        .prepare(
          "INSERT INTO el_teachers(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
        )
        .run(randomUUID(), org, att.branch_id, "Unrelated teacher", "OTHER-T");
      const otherTeacher = raw
        .prepare("SELECT id FROM el_teachers WHERE id<>? LIMIT 1")
        .get(att.teacher_id) as any;
      assert(otherTeacher);
      raw
        .prepare(
          "UPDATE el_portal_links SET teacher_id=? WHERE org_id=? AND user_id=?",
        )
        .run(otherTeacher.id, org, teacherUser);
      assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(randomUUID(), org, "Unrelated branch", "OTHER-B");
      const otherBranch = raw
        .prepare("SELECT id FROM el_branches WHERE id<>? LIMIT 1")
        .get(att.branch_id) as any;
      assert(otherBranch);
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(otherBranch.id, org, studentUser);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE org_id=? AND user_id=?",
        )
        .run(org, studentUser);
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(att.student_id);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw
        .prepare("UPDATE el_students SET status='active' WHERE id=?")
        .run(att.student_id);
    },
  );
  await t.test(
    "cancelled sessions and unchanged status do not create requests",
    async () => {
      assert.equal(
        (
          await call(
            path,
            "POST",
            { status: row().status, reason: "Unchanged test status" },
            student,
          )
        ).r.status,
        400,
      );
      raw
        .prepare("UPDATE el_class_sessions SET status='cancelled' WHERE id=?")
        .run(att.session_id);
      assert.equal(
        (
          await call(
            path,
            "POST",
            {
              status: row().status === "present" ? "excused" : "present",
              reason: "Cancelled session must not change",
            },
            student,
          )
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "daily account limit is backed by the database and new snapshots cannot race cancellation",
    async () => {
      raw
        .prepare("UPDATE el_class_sessions SET status='completed' WHERE id=?")
        .run(att.session_id);
      const baseline = raw
        .prepare("SELECT * FROM el_attendance_corrections WHERE id=?")
        .get(request) as any;
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO el_attendance_corrections(id,org_id,branch_id,attendance_id,base_revision,old_status,new_status,notes,reason,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              randomUUID(),
              org,
              att.branch_id,
              att.id,
              baseline.base_revision,
              baseline.old_status,
              "present",
              "",
              "Stale base revision",
              studentUser,
              Math.floor(Date.now() / 1000),
            ),
        /snapshot is stale/,
      );
      const current = row();
      for (let i = 0; i < 99; i++)
        raw
          .prepare(
            "INSERT INTO el_attendance_corrections(id,org_id,branch_id,attendance_id,base_revision,old_status,new_status,notes,reason,requested_by,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'rejected')",
          )
          .run(
            randomUUID(),
            org,
            att.branch_id,
            att.id,
            current.revision,
            current.status,
            current.status === "absent" ? "present" : "absent",
            current.notes,
            "Rate limit test fixture",
            studentUser,
            Math.floor(Date.now() / 1000),
          );
      assert.equal(
        (
          await call(
            path,
            "POST",
            {
              status: current.status === "present" ? "excused" : "present",
              reason: "Must not exceed account request limit",
            },
            student,
          )
        ).r.status,
        429,
      );
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO el_attendance_corrections(id,org_id,branch_id,attendance_id,base_revision,old_status,new_status,notes,reason,requested_by,created_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'rejected')",
            )
            .run(
              randomUUID(),
              org,
              att.branch_id,
              att.id,
              current.revision,
              current.status,
              "excused",
              current.notes,
              "Rate limit trigger fixture",
              studentUser,
              Math.floor(Date.now() / 1000),
            ),
        /Daily correction request limit/,
      );
    },
  );
});
