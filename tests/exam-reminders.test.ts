import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { runAutomation } from "../src/server/system";
import { upcomingExamReminders } from "../src/server/exam-reminders";
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
test("upcoming exam reminders use current family scope and transaction rechecks", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    roster = (await call("/groups/" + g.id + "/enrollments")).j.data,
    own = roster[0].student_id,
    sibling = roster[1].student_id;
  const roles = (await call("/roles")).j.data;
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
  const studentUser = await account("student", student, own),
    teacherUser = await account("teacher", teacher, g.teacher_id);
  await account("student", unlinked);
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
  const guardianUser = await account("parent_guardian", guardian, guardianId);
  raw.prepare("UPDATE el_groups SET is_demo=0 WHERE id=?").run(g.id);
  raw
    .prepare("UPDATE el_students SET is_demo=0 WHERE id IN (?,?)")
    .run(own, sibling);
  const time = Math.floor(Date.now() / 1000),
    when = time + 86400;
  function exam(id: string, scheduled = when, status = "published", demo = 0) {
    raw
      .prepare(
        "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status,is_demo) VALUES(?,?,?,?,?,?,100,50,?,?)",
      )
      .run(
        id,
        org,
        g.branch_id,
        g.id,
        "Fictional " + id,
        scheduled,
        status,
        demo,
      );
  }
  function events() {
    return raw
      .prepare(
        "SELECT user_id,entity_id,period FROM el_automation_events WHERE org_id=? AND kind='upcoming_exam' ORDER BY user_id,entity_id",
      )
      .all(org) as any[];
  }
  exam("exam");
  exam("past", time - 1);
  exam("far", time + 16 * 86400);
  exam("draft", when, "draft");
  exam("closed", when, "closed");
  exam("demo", when, "published", 1);
  await t.test(
    "new source defaults off and excluded exam states create no events",
    async () => {
      await runAutomation(db, org, "test");
      assert.equal(events().length, 0);
      raw
        .prepare(
          "INSERT INTO el_automation_settings(org_id,enabled,upcoming_exams) VALUES(?,0,1)",
        )
        .run(org);
      await runAutomation(db, org, "test");
      assert.equal(events().length, 3);
      assert.equal(events().filter((e) => e.user_id === studentUser).length, 1);
      assert.equal(
        events().filter((e) => e.user_id === guardianUser).length,
        2,
      );
      assert(events().every((e) => e.entity_id.startsWith("exam:")));
      assert(!events().some((e) => e.user_id === teacherUser));
      assert.equal((await runAutomation(db, org, "test")).created, 0);
    },
  );
  await t.test(
    "rescheduled exam gets a fresh per-student notice with organization-local time",
    async () => {
      raw
        .prepare("UPDATE el_exams SET scheduled_at=? WHERE id='exam'")
        .run(when + 3600);
      const data = await upcomingExamReminders(db, org, time, "Africa/Cairo");
      assert.equal(data.length, 3);
      assert(data.every((e) => e.body.includes("Africa/Cairo")));
      assert(data.every((e) => e.period === String(when + 3600)));
      await runAutomation(db, org, "test");
      assert.equal(events().length, 6);
    },
  );
  await t.test(
    "preferences, suspended/changed-role members and withdrawn enrollments block new deliveries",
    async () => {
      raw
        .prepare(
          "INSERT INTO el_notification_preferences(org_id,user_id,in_app) VALUES(?,?,0)",
        )
        .run(org, guardianUser);
      raw
        .prepare(
          "UPDATE el_memberships SET status='suspended' WHERE org_id=? AND user_id=?",
        )
        .run(org, studentUser);
      exam("suspended");
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare(
          "UPDATE el_memberships SET status='active',role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(me.user.role_id, org, studentUser);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(
          roles.find((r: any) => r.system_key === "student").id,
          org,
          studentUser,
        );
      raw
        .prepare(
          "UPDATE el_enrollments SET status='withdrawn' WHERE student_id=?",
        )
        .run(own);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare("UPDATE el_enrollments SET status='active' WHERE student_id=?")
        .run(own);
      await runAutomation(db, org, "test");
    },
  );
  await t.test(
    "current family link/profile and branch scopes are required",
    async () => {
      raw
        .prepare(
          "UPDATE el_notification_preferences SET in_app=1 WHERE org_id=? AND user_id=?",
        )
        .run(org, guardianUser);
      await runAutomation(db, org, "test");
      exam("scope");
      raw
        .prepare("UPDATE el_guardians SET status='inactive' WHERE id=?")
        .run(guardianId);
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(own);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare("UPDATE el_guardians SET status='active' WHERE id=?")
        .run(guardianId);
      raw.prepare("UPDATE el_students SET status='active' WHERE id=?").run(own);
      const otherBranch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(otherBranch, org, "Other branch", "REM-OTHER");
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id IN (?,?)",
        )
        .run(otherBranch, org, studentUser, guardianUser);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE org_id=? AND user_id IN (?,?)",
        )
        .run(org, studentUser, guardianUser);
      await runAutomation(db, org, "test");
    },
  );
  await t.test(
    "changed exam or removed family relationship between selection and write fails closed",
    async () => {
      exam("race");
      let hooked = false;
      const guarded = {
        ...db,
        batch: async (statements: Parameters<typeof db.batch>[0]) => {
          if (!hooked) {
            hooked = true;
            raw
              .prepare("UPDATE el_exams SET status='closed' WHERE id='race'")
              .run();
          }
          return db.batch(statements);
        },
      };
      assert.equal((await runAutomation(guarded, org, "test")).created, 0);
      assert(hooked);
      exam("race-family");
      let removed = false;
      const linkGuard = {
        ...db,
        batch: async (statements: Parameters<typeof db.batch>[0]) => {
          if (!removed) {
            removed = true;
            raw
              .prepare("DELETE FROM el_student_guardians WHERE guardian_id=?")
              .run(guardianId);
          }
          return db.batch(statements);
        },
      };
      assert.equal((await runAutomation(linkGuard, org, "test")).created, 1);
      assert(
        events()
          .filter((e) => e.entity_id.startsWith("race-family:"))
          .every((e) => e.user_id === studentUser),
      );
    },
  );
  await t.test(
    "source cap excludes already sent keys before limiting and window is configurable",
    async () => {
      for (let i = 0; i < 105; i++) exam("bulk-" + String(i).padStart(3, "0"));
      assert.equal((await runAutomation(db, org, "test")).created, 100);
      assert.equal((await runAutomation(db, org, "test")).created, 5);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      exam("window", time + 3 * 86400);
      raw
        .prepare("UPDATE el_automation_settings SET exam_days=1 WHERE org_id=?")
        .run(org);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare("UPDATE el_automation_settings SET exam_days=4 WHERE org_id=?")
        .run(org);
      assert.equal((await runAutomation(db, org, "test")).created, 1);
    },
  );
  await t.test(
    "notice windows use organization-local calendar days across DST, not fixed 24-hour math",
    async () => {
      const spring = Date.parse("2026-03-07T17:00:00Z") / 1000;
      raw
        .prepare("UPDATE el_automation_settings SET exam_days=1 WHERE org_id=?")
        .run(org);
      exam("dst-edge", spring + 23 * 3600);
      exam("dst-outside", spring + 23 * 3600 + 1);
      const data = await upcomingExamReminders(
        db,
        org,
        spring,
        "America/New_York",
      );
      assert(data.some((e) => e.entity.startsWith("dst-edge:")));
      assert(!data.some((e) => e.entity.startsWith("dst-outside:")));
      assert(
        data
          .find((e) => e.entity.startsWith("dst-edge:"))!
          .body.includes("2026-03-08T12:00"),
      );
    },
  );
});
