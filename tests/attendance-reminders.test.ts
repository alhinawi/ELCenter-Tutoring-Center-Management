import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { runAutomation } from "../src/server/system";
import { lowAttendanceReminders } from "../src/server/attendance-reminders";
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
test("low attendance notices exclude unrecorded sessions and recheck current family scope", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    roster = (await call("/groups/" + g.id + "/enrollments")).j.data,
    own = roster[0].student_id,
    sibling = roster[1].student_id,
    roles = (await call("/roles")).j.data;
  const time = Math.floor(Date.now() / 1000),
    user = me.user.user_id;
  raw.prepare("UPDATE el_groups SET is_demo=0 WHERE id=?").run(g.id);
  raw.prepare("UPDATE el_enrollments SET is_demo=0 WHERE group_id=?").run(g.id);
  raw
    .prepare("UPDATE el_students SET is_demo=0 WHERE id IN (?,?)")
    .run(own, sibling);
  const guardianId = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
    )
    .run(guardianId, org, g.branch_id, "Fictional Guardian", "01000000111");
  for (const id of [own, sibling])
    await call("/students/" + id + "/guardians", "POST", {
      guardian_id: guardianId,
      relationship: "parent",
    });
  async function account(key: string, c: Client, profile?: string) {
    const email = key + randomUUID() + "@example.invalid";
    await call("/users", "POST", {
      name: key,
      email,
      password: "Testing-password-2026",
      role_id: roles.find((r: any) => r.system_key === key).id,
      branch_id: null,
    });
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    const id = (await call("/me", "GET", undefined, c)).j.user.user_id;
    if (profile)
      assert.equal(
        (
          await call("/portal-links", "POST", {
            user_id: id,
            kind: key === "parent_guardian" ? "guardian" : key,
            profile_id: profile,
          })
        ).r.status,
        201,
      );
    return id;
  }
  const studentUser = await account("student", student, own),
    guardianUser = await account("parent_guardian", guardian, guardianId);
  await account("student", unlinked);
  await account("teacher", teacher, g.teacher_id);
  function session(
    i: number,
    statuses: [string | null, string | null],
    demo = 0,
    state = "completed",
    offset = -1,
  ) {
    const id = randomUUID(),
      start = time + offset * 86400 - i * 4000;
    raw
      .prepare(
        "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        org,
        g.branch_id,
        g.id,
        g.teacher_id,
        g.classroom_id,
        start,
        start + 1800,
        state,
        demo,
      );
    for (const [n, st] of statuses.entries())
      if (st)
        raw
          .prepare(
            "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,recorded_by,is_demo) VALUES(?,?,?,?,?,?,?)",
          )
          .run(randomUUID(), org, id, n === 0 ? own : sibling, st, user, demo);
    return id;
  }
  const absence = session(0, ["absent", "absent"]);
  session(1, ["present", "absent"]);
  session(2, ["late", "absent"]);
  session(3, ["left_early", "absent"]);
  session(4, ["absent", "absent"]);
  session(5, ["excused", "excused"]);
  session(6, [null, null]);
  session(7, ["absent", "absent"], 1);
  session(8, ["absent", "absent"], 0, "cancelled");
  session(9, ["absent", "absent"], 0, "completed", -100);
  session(0, ["absent", "absent"], 0, "scheduled", 1);
  const events = () =>
    raw
      .prepare(
        "SELECT user_id,entity_id FROM el_automation_events WHERE org_id=? AND kind='low_attendance'",
      )
      .all(org) as any[];
  await t.test("defaults off and configurable rule validation", async () => {
    assert.deepEqual(
      await lowAttendanceReminders(db, org, time, "Africa/Cairo"),
      [],
    );
    for (const body of [
      { attendance_days: 6 },
      { attendance_days: 91 },
      { attendance_threshold: 0 },
      { attendance_threshold: 101 },
      { attendance_minimum: 0 },
      { attendance_minimum: 51 },
    ])
      assert.equal(
        (await call("/system/automation", "PUT", { enabled: false, ...body })).r
          .status,
        400,
      );
    assert.equal(
      (
        await call("/system/automation", "PUT", {
          enabled: false,
          low_attendance: true,
          attendance_days: 30,
          attendance_threshold: 75,
          attendance_minimum: 5,
        })
      ).r.status,
      200,
    );
  });
  await t.test(
    "child-specific 3/5 and 0/5 counts; siblings separated, linked roles only, monthly dedupe",
    async () => {
      const rows = await lowAttendanceReminders(db, org, time, "Africa/Cairo");
      assert.equal(rows.length, 3);
      assert.equal(rows.filter((r) => r.user === guardianUser).length, 2);
      assert(rows.find((r) => r.user === studentUser)?.body.includes("3/5"));
      assert(rows.find((r) => r.entity === sibling)?.body.includes("0/5"));
      await runAutomation(db, org, "test");
      assert.equal(events().length, 3);
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        0,
      );
    },
  );
  await t.test(
    "exact threshold is not low; minimum excludes sparse data; unrecorded and excused never inflate denominator",
    async () => {
      raw
        .prepare("DELETE FROM el_automation_events WHERE kind='low_attendance'")
        .run();
      raw
        .prepare(
          "UPDATE el_automation_settings SET attendance_threshold=60 WHERE org_id=?",
        )
        .run(org);
      let rows = await lowAttendanceReminders(db, org, time, "Africa/Cairo");
      assert.equal(rows.length, 1);
      assert.equal(rows[0].entity, sibling);
      raw
        .prepare(
          "UPDATE el_automation_settings SET attendance_minimum=6 WHERE org_id=?",
        )
        .run(org);
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        0,
      );
      raw
        .prepare(
          "UPDATE el_automation_settings SET attendance_threshold=75,attendance_minimum=5 WHERE org_id=?",
        )
        .run(org);
    },
  );
  await t.test(
    "candidate transaction rechecks aggregate, opt out, withdrawn enrollment, inactive group and demo flag",
    async () => {
      async function recheck(change: () => void, undo: () => void) {
        const row = (
          await lowAttendanceReminders(db, org, time, "Africa/Cairo")
        ).find((r) => r.user === studentUser)!;
        assert(row);
        change();
        assert.equal(
          (
            await db
              .prepare("SELECT " + row.recheck.sql + " ok")
              .bind(...row.recheck.args)
              .first<{ ok: number }>()
          )?.ok,
          0,
        );
        undo();
      }
      await recheck(
        () =>
          raw.prepare("UPDATE el_students SET is_demo=1 WHERE id=?").run(own),
        () =>
          raw.prepare("UPDATE el_students SET is_demo=0 WHERE id=?").run(own),
      );
      await recheck(
        () =>
          raw
            .prepare("UPDATE el_groups SET status='inactive' WHERE id=?")
            .run(g.id),
        () =>
          raw
            .prepare("UPDATE el_groups SET status='active' WHERE id=?")
            .run(g.id),
      );
      await recheck(
        () =>
          raw
            .prepare(
              "UPDATE el_enrollments SET status='withdrawn' WHERE student_id=?",
            )
            .run(own),
        () =>
          raw
            .prepare(
              "UPDATE el_enrollments SET status='active' WHERE student_id=?",
            )
            .run(own),
      );
      await recheck(
        () =>
          raw
            .prepare(
              "INSERT INTO el_notification_preferences(org_id,user_id,in_app) VALUES(?,?,0)",
            )
            .run(org, studentUser),
        () =>
          raw
            .prepare(
              "DELETE FROM el_notification_preferences WHERE org_id=? AND user_id=?",
            )
            .run(org, studentUser),
      );
      const extra = randomUUID();
      await recheck(
        () => {
          raw
            .prepare(
              "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,status) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              extra,
              org,
              g.branch_id,
              g.id,
              g.teacher_id,
              g.classroom_id,
              time - 20 * 86400,
              time - 20 * 86400 + 1800,
              "completed",
            );
          raw
            .prepare(
              "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,recorded_by) VALUES(?,?,?,?,?,?)",
            )
            .run(randomUUID(), org, extra, own, "absent", user);
        },
        () => {
          raw
            .prepare("DELETE FROM el_attendance WHERE session_id=?")
            .run(extra);
          raw.prepare("DELETE FROM el_class_sessions WHERE id=?").run(extra);
        },
      );
    },
  );
  await t.test(
    "revoked link, role and membership branch never receive new notices",
    async () => {
      const branch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch, org, "Other", "OTHER");
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(branch, org, studentUser);
      assert(
        !(await lowAttendanceReminders(db, org, time, "Africa/Cairo")).some(
          (r) => r.user === studentUser,
        ),
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL,role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(me.user.role_id, org, studentUser);
      assert(
        !(await lowAttendanceReminders(db, org, time, "Africa/Cairo")).some(
          (r) => r.user === studentUser,
        ),
      );
      raw
        .prepare("DELETE FROM el_portal_links WHERE org_id=? AND user_id=?")
        .run(org, guardianUser);
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        0,
      );
    },
  );
  await t.test(
    "monthly dedupe excludes prior keys before the 100-recipient cap",
    async () => {
      assert.equal(
        (
          await call("/portal-links", "POST", {
            user_id: guardianUser,
            kind: "guardian",
            profile_id: guardianId,
          })
        ).r.status,
        201,
      );
      const sessions = raw
        .prepare(
          "SELECT s.id FROM el_class_sessions s JOIN el_attendance a ON a.session_id=s.id WHERE a.student_id=? AND a.status<>'excused' AND s.is_demo=0 AND s.status<>'cancelled' AND s.ends_at<=? AND s.starts_at>=? ORDER BY s.starts_at LIMIT 5",
        )
        .all(own, time, time - 30 * 86400) as { id: string }[];
      assert.equal(sessions.length, 5);
      raw
        .prepare("UPDATE el_classrooms SET capacity=200 WHERE id=?")
        .run(g.classroom_id);
      raw.prepare("UPDATE el_groups SET capacity=200 WHERE id=?").run(g.id);
      for (let n = 0; n < 103; n++) {
        const id = randomUUID();
        raw
          .prepare(
            "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
          )
          .run(id, org, g.branch_id, "Fictional learner " + n, "ATT-CAP-" + n);
        raw
          .prepare(
            "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,?)",
          )
          .run(randomUUID(), org, id, g.id, "active");
        raw
          .prepare(
            "INSERT INTO el_student_guardians(org_id,student_id,guardian_id,relationship) VALUES(?,?,?,?)",
          )
          .run(org, id, guardianId, "parent");
        for (const session of sessions)
          raw
            .prepare(
              "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,recorded_by) VALUES(?,?,?,?,?,?)",
            )
            .run(randomUUID(), org, session.id, id, "absent", user);
      }
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        100,
      );
      await runAutomation(db, org, "test");
      assert.equal(events().length, 100);
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        5,
      );
      await runAutomation(db, org, "test");
      assert.equal(events().length, 105);
      assert.equal(
        (await lowAttendanceReminders(db, org, time, "Africa/Cairo")).length,
        0,
      );
    },
  );
});

test("attendance calendar lookback follows the organization timezone across DST", async () => {
  const time = Math.floor(Date.parse("2026-03-10T12:00:00Z") / 1000),
    bindings: unknown[][] = [];
  const mock = {
    prepare: (_sql: string) => ({
      bind(...args: unknown[]) {
        bindings.push(args);
        return this;
      },
      async first() {
        return {
          low_attendance: 1,
          attendance_days: 7,
          attendance_threshold: 75,
          attendance_minimum: 5,
        };
      },
      async all() {
        return { results: [] };
      },
    }),
  };
  await lowAttendanceReminders(mock as any, "org", time, "America/New_York");
  assert.equal(
    bindings[1][1],
    Math.floor(Date.parse("2026-03-04T05:00:00Z") / 1000),
  );
});
