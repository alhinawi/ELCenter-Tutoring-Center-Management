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
test("identity-bound learning and family portals", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    students = (await call("/students")).j.data,
    roster = (await call("/groups/" + g.id + "/enrollments")).j.data;
  const own = roster[0].student_id,
    other = students.find((x: any) => x.id !== own).id;
  const roles = (await call("/roles")).j.data;
  const org = me.organization.id,
    branch = g.branch_id;
  let lesson = "",
    assignment = "",
    submission = "",
    exam = "",
    question = "",
    request = "";
  async function account(key: string, c: Client, profile?: string) {
    const email = key + randomUUID() + "@example.invalid",
      role = roles.find((x: any) => x.system_key === key);
    assert(role, key);
    const u = await call("/users", "POST", {
      name: key,
      email,
      password: "Testing-password-2026",
      role_id: role.id,
      branch_id: null,
    });
    assert.equal(u.r.status, 201, JSON.stringify(u.j));
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    const actual = (await call("/me", "GET", undefined, c)).j.user.user_id;
    if (profile) {
      const l = await call("/portal-links", "POST", {
        user_id: actual,
        kind: key === "parent_guardian" ? "guardian" : key,
        profile_id: profile,
      });
      assert.equal(l.r.status, 201, JSON.stringify(l.j));
    }
    return u.j.id;
  }
  await account("student", student, own);
  await account("teacher", teacher, g.teacher_id);
  await account("student", unlinked);
  const guardianId = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
    )
    .run(guardianId, org, branch, "Guardian fixture", "01000000111");
  await call("/students/" + own + "/guardians", "POST", {
    guardian_id: guardianId,
    relationship: "parent",
  });
  await account("parent_guardian", guardian, guardianId);
  await call("/auth/demo", "POST", {}, foreign);
  await call("/me", "GET", undefined, foreign);
  await t.test("no profile inference or generic API escape", async () => {
    for (const c of [student, guardian, teacher])
      for (const p of [
        "/students",
        "/groups",
        "/exams",
        "/users",
        "/portal-links",
        "/finance/invoices",
      ])
        assert.equal((await call(p, "GET", undefined, c)).r.status, 403, p);
    assert.equal(
      (await call("/portal", "GET", undefined, unlinked)).r.status,
      403,
    );
    assert.equal(
      (
        await call(
          "/portal-links",
          "POST",
          { user_id: me.user.user_id, kind: "student", profile_id: own },
          student,
        )
      ).r.status,
      403,
    );
  });
  await t.test("own student and related child only", async () => {
    assert.equal(
      (await call("/portal", "GET", undefined, student)).j.children[0].id,
      own,
    );
    assert.equal(
      (await call("/portal", "GET", undefined, guardian)).j.children.length,
      1,
    );
    for (const c of [student, guardian]) {
      assert.equal(
        (await call("/portal/students/" + own, "GET", undefined, c)).r.status,
        200,
      );
      assert.equal(
        (await call("/portal/students/" + other, "GET", undefined, c)).r.status,
        404,
      );
    }
    assert.equal(
      (await call("/portal/students/" + own, "GET", undefined, foreign)).r
        .status,
      404,
    );
  });
  await t.test("teachers only see their assigned classes", async () => {
    assert.equal(
      (await call("/portal/teacher", "GET", undefined, teacher)).r.status,
      200,
    );
    assert.equal(
      (await call("/lms/groups/" + g.id + "/roster", "GET", undefined, teacher))
        .r.status,
      200,
    );
    const secondTeacher = (await call("/teachers")).j.data.find(
      (x: any) => x.id !== g.teacher_id,
    );
    if (secondTeacher) {
      const stranger = { cookie: "", csrf: "" };
      await account("teacher", stranger, secondTeacher.id);
      assert.equal(
        (await call("/lms/groups/" + g.id, "GET", undefined, stranger)).r
          .status,
        403,
      );
      assert.equal(
        (
          await call(
            "/lms/lessons",
            "POST",
            { group_id: g.id, title: "No", kind: "article", content: "no" },
            stranger,
          )
        ).r.status,
        403,
      );
    }
    assert.equal(
      (await call("/lms/groups/" + g.id, "GET", undefined, foreign)).r.status,
      404,
    );
  });
  await t.test(
    "draft lessons hidden, https only and published progress persists",
    async () => {
      const b = {
        group_id: g.id,
        title: "Vectors in practice",
        description: "Guided lesson",
        kind: "article",
        content: "A vector has magnitude and direction.",
        status: "draft",
      };
      let r = await call("/lms/lessons", "POST", b, teacher);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      lesson = r.j.id;
      assert.equal(
        (await call("/lms/lessons/" + lesson, "GET", undefined, student)).r
          .status,
        404,
      );
      assert.equal(
        (
          await call(
            "/lms/lessons",
            "POST",
            { ...b, kind: "video", url: "javascript:alert(1)" },
            teacher,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            "/lms/lessons/" + lesson,
            "PUT",
            { ...b, status: "published" },
            teacher,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/lms/lessons/" + lesson + "/complete",
            "POST",
            {},
            guardian,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            "/lms/lessons/" + lesson + "/complete",
            "POST",
            {},
            student,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/lms/groups/" + g.id, "GET", undefined, student)).j
          .progress.length,
        1,
      );
    },
  );
  await t.test(
    "assignments submit once, preserve work and grade within bounds",
    async () => {
      const r = await call(
        "/lms/assignments",
        "POST",
        {
          group_id: g.id,
          title: "Vector exercise",
          instructions: "Explain addition.",
          due_at: Math.floor(Date.now() / 1000) + 86400,
          max_score: 20,
          status: "published",
        },
        teacher,
      );
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      assignment = r.j.id;
      assert.equal(
        (
          await call(
            "/lms/assignments/" + assignment + "/submit",
            "POST",
            { body: "Guardian cannot submit", url: "" },
            guardian,
          )
        ).r.status,
        403,
      );
      const s = await call(
        "/lms/assignments/" + assignment + "/submit",
        "POST",
        { body: "Use the parallelogram rule.", url: "" },
        student,
      );
      assert.equal(s.r.status, 201, JSON.stringify(s.j));
      submission = s.j.id;
      assert.equal(
        (
          await call(
            "/lms/assignments/" + assignment + "/submit",
            "POST",
            { body: "Second attempt", url: "" },
            student,
          )
        ).r.status,
        409,
      );
      assert.throws(() =>
        raw
          .prepare("UPDATE el_submissions SET body=? WHERE id=?")
          .run("Changed", submission),
      );
      assert.equal(
        (
          await call(
            "/lms/submissions/" + submission + "/grade",
            "POST",
            { score: 21 },
            teacher,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            "/lms/submissions/" + submission + "/grade",
            "POST",
            { score: 18, feedback: "Clear explanation" },
            teacher,
          )
        ).r.status,
        200,
      );
      const detail = (
        await call("/lms/assignments/" + assignment, "GET", undefined, student)
      ).j;
      assert.equal(detail.submissions[0].score, 18);
      assert.equal(
        (
          await call(
            "/lms/assignments/" + assignment + "?student_id=" + other,
            "GET",
            undefined,
            guardian,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "class discussions respect ownership and moderation",
    async () => {
      const d = await call(
        "/lms/groups/" + g.id + "/discussions",
        "POST",
        { body: "Can we see another example?" },
        student,
      );
      assert.equal(d.r.status, 201);
      assert.equal(
        (
          await call(
            "/lms/discussions/" + d.j.id + "/moderate",
            "POST",
            { status: "hidden" },
            student,
          )
        ).r.status,
        403,
      );
      await call(
        "/lms/discussions/" + d.j.id + "/moderate",
        "POST",
        { status: "hidden" },
        teacher,
      );
      assert.equal(
        (await call("/lms/groups/" + g.id, "GET", undefined, student)).j
          .discussions.length,
        0,
      );
    },
  );
  await t.test(
    "teacher authors quiz, correct answers never reach learners",
    async () => {
      const b = {
        group_id: g.id,
        name: "Vector checkpoint",
        scheduled_at: Math.floor(Date.now() / 1000) - 1,
        max_score: 10,
        pass_score: 5,
        status: "draft",
      };
      const r = await call("/lms/exams", "POST", b, teacher);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      exam = r.j.id;
      const q = await call(
        "/lms/exams/" + exam + "/questions",
        "POST",
        {
          type: "short_answer",
          prompt: "2 + 2",
          correct_answer: "4",
          points: 10,
        },
        teacher,
      );
      assert.equal(q.r.status, 201, JSON.stringify(q.j));
      question = q.j.id;
      assert.equal(
        (
          await call(
            "/lms/exams/" + exam,
            "PUT",
            { ...b, status: "published" },
            teacher,
          )
        ).r.status,
        200,
      );
      const e = (await call("/lms/exams/" + exam, "GET", undefined, student)).j;
      assert.equal(e.questions.length, 1);
      assert(!JSON.stringify(e).includes("correct_answer"));
      assert.equal(
        (
          await call(
            "/lms/exams/" + exam + "/submit",
            "POST",
            { answers: [{ question_id: question, answer: "4" }] },
            student,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/lms/exams/" + exam + "/submit",
            "POST",
            { answers: [] },
            student,
          )
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/lms/exams/" + exam, "GET", undefined, student)).j.result
          .score,
        10,
      );
      assert.equal(
        (
          await call(
            "/lms/exams/" + exam + "/submit",
            "POST",
            { answers: [] },
            guardian,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "family requests and stored notification are connected",
    async () => {
      const r = await call(
        "/portal/requests",
        "POST",
        {
          student_id: own,
          kind: "meeting",
          subject: "Progress review",
          body: "Please arrange a discussion.",
        },
        guardian,
      );
      assert.equal(r.r.status, 201);
      request = r.j.id;
      assert.equal(
        (
          await call(
            "/portal/requests",
            "POST",
            { student_id: other, kind: "contact", subject: "No", body: "No" },
            guardian,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call("/portal-requests/" + request + "/decision", "POST", {
            status: "accepted",
            response: "Please visit reception.",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/portal/students/" + own, "GET", undefined, guardian)).j
          .requests[0].status,
        "accepted",
      );
      assert.equal(
        (await call("/notifications", "GET", undefined, guardian)).j.data
          .length,
        1,
      );
      assert.equal(
        (
          await call("/portal-requests/" + request + "/decision", "POST", {
            status: "closed",
            response: "Again",
          })
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "quiz essay review preserves submitted answers and publishes only final results",
    async () => {
      const b = {
        group_id: g.id,
        name: "Essay review",
        scheduled_at: Math.floor(Date.now() / 1000) - 1,
        max_score: 10,
        pass_score: 5,
        status: "draft",
      };
      const e = await call("/lms/exams", "POST", b, teacher),
        q = await call(
          "/lms/exams/" + e.j.id + "/questions",
          "POST",
          { type: "essay", prompt: "Explain a vector", points: 10 },
          teacher,
        );
      assert.equal(q.r.status, 201);
      await call(
        "/lms/exams/" + e.j.id,
        "PUT",
        { ...b, status: "published" },
        teacher,
      );
      const r = await call(
        "/lms/exams/" + e.j.id + "/submit",
        "POST",
        {
          answers: [
            {
              question_id: q.j.id,
              answer: "A vector has direction and magnitude.",
            },
          ],
        },
        student,
      );
      assert.equal(r.j.status, "pending_review");
      assert.deepEqual(
        (await call("/lms/exams/" + e.j.id, "GET", undefined, student)).j
          .result,
        { status: "pending_review" },
      );
      assert.throws(() =>
        raw
          .prepare(
            "UPDATE el_exam_answers SET answer='changed' WHERE exam_id=?",
          )
          .run(e.j.id),
      );
      await call(
        "/lms/exams/" + e.j.id + "/results",
        "POST",
        { student_id: own, score: 9, feedback: "Well explained" },
        teacher,
      );
      assert.equal(
        (await call("/lms/exams/" + e.j.id, "GET", undefined, student)).j.result
          .score,
        9,
      );
      const result = raw
        .prepare(
          "SELECT grading_source,submitted_by FROM el_exam_results WHERE exam_id=?",
        )
        .get(e.j.id) as any;
      assert.equal(result.grading_source, "manual");
      assert(result.submitted_by);
    },
  );
  await t.test(
    "guardian sees the selected child's lesson progress without changing it",
    async () => {
      const r = await call(
        "/lms/groups/" + g.id + "?student_id=" + own,
        "GET",
        undefined,
        guardian,
      );
      assert.equal(r.r.status, 200);
      assert.equal(r.j.progress.length, 1);
      assert.equal(
        (
          await call(
            "/lms/groups/" + g.id + "?student_id=" + other,
            "GET",
            undefined,
            guardian,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "a different teacher and sibling login cannot read this class work",
    async () => {
      const t2 = await call("/teachers", "POST", {
        branch_id: branch,
        name: "Other teacher",
        code: "T-OTHER",
      });
      assert.equal(t2.r.status, 201);
      const stranger = { cookie: "", csrf: "" };
      await account("teacher", stranger, t2.j.id);
      for (const p of [
        "/lms/groups/" + g.id,
        "/lms/groups/" + g.id + "/roster",
        "/lms/assignments/" + assignment,
        "/lms/exams/" + exam,
      ])
        assert.equal(
          (await call(p, "GET", undefined, stranger)).r.status,
          403,
          p,
        );
      assert.equal(
        (
          await call(
            "/lms/submissions/" + submission + "/grade",
            "POST",
            { score: 1 },
            stranger,
          )
        ).r.status,
        403,
      );
      const s2 = await call("/students", "POST", {
          branch_id: branch,
          name: "Unrelated learner",
          code: "UNRELATED",
        }),
        outsider = { cookie: "", csrf: "" };
      assert.equal(s2.r.status, 201);
      await account("student", outsider, s2.j.id);
      assert.equal(
        (
          await call(
            "/lms/assignments/" + assignment,
            "GET",
            undefined,
            outsider,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (await call("/portal/students/" + own, "GET", undefined, outsider)).r
          .status,
        404,
      );
    },
  );
  await t.test(
    "private invoice reads reject unrelated IDs and omit internal accounting",
    async () => {
      for (const [sid, num] of [
        [own, "OWN"],
        [other, "OTHER"],
      ])
        raw
          .prepare(
            "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,total,status,created_by) VALUES(?,?,?,?,?,'2026-11-18','2026-12-18',100,'issued',?)",
          )
          .run(randomUUID(), org, branch, sid, num, me.user.user_id);
      const invoices = raw
        .prepare("SELECT id,number FROM el_invoices WHERE org_id=?")
        .all(org) as any[];
      const ownInvoice = invoices.find((x) => x.number === "OWN"),
        otherInvoice = invoices.find((x) => x.number === "OTHER");
      const r = await call(
        "/portal/invoices/" + ownInvoice.id,
        "GET",
        undefined,
        student,
      );
      assert.equal(r.r.status, 200);
      assert.equal(r.j.data.total, 100);
      assert(!("journal_id" in r.j.data));
      assert.equal(
        (
          await call(
            "/portal/invoices/" + otherInvoice.id,
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
            "/portal/invoices/" + ownInvoice.id,
            "GET",
            undefined,
            foreign,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "class announcements reach only linked class accounts and honor preferences",
    async () => {
      await call(
        "/notifications/preferences",
        "PUT",
        { in_app: false },
        student,
      );
      const r = await call(
        "/lms/groups/" + g.id + "/announcements",
        "POST",
        { title: "Class update", body: "Practice before class." },
        teacher,
      );
      assert.equal(r.r.status, 201);
      assert.equal(r.j.stored, 1);
      assert(
        !(await call("/notifications", "GET", undefined, student)).j.data.some(
          (x: any) => x.title === "Class update",
        ),
      );
      assert(
        (await call("/notifications", "GET", undefined, guardian)).j.data.some(
          (x: any) => x.title === "Class update",
        ),
      );
      assert.equal(
        (await call("/lms/groups/" + g.id, "GET", undefined, guardian)).j
          .announcements.length,
        1,
      );
      assert.equal(
        (
          await call(
            "/lms/groups/" + g.id + "/announcements",
            "POST",
            { title: "No", body: "No" },
            student,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "teacher leave uses the bound active employee and independent HR review",
    async () => {
      const a = (await call("/me", "GET", undefined, teacher)).j.user;
      assert.equal(
        (
          await call(
            "/portal/teacher/leave",
            "POST",
            {
              type: "sick",
              starts_on: "2026-12-10",
              ends_on: "2026-12-11",
              reason: "Rest",
            },
            teacher,
          )
        ).r.status,
        403,
      );
      const id = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_employees(id,org_id,branch_id,teacher_id,user_id,code,name,job_title,hired_on) VALUES(?,?,?,?,?,'TEACHER-HR','Teacher','Teacher','2026-01-01')",
        )
        .run(id, org, branch, g.teacher_id, a.user_id);
      const r = await call(
        "/portal/teacher/leave",
        "POST",
        {
          employee_id: randomUUID(),
          type: "sick",
          starts_on: "2026-12-10",
          ends_on: "2026-12-11",
          reason: "Rest",
        },
        teacher,
      );
      assert.equal(r.r.status, 201);
      assert.equal(
        (
          raw
            .prepare("SELECT employee_id FROM el_leave_requests WHERE id=?")
            .get(r.j.id) as any
        ).employee_id,
        id,
      );
      assert.equal(
        (await call("/portal/teacher", "GET", undefined, teacher)).j.leaves
          .length,
        1,
      );
      assert.equal(
        (await call("/portal/teacher/leave", "POST", {}, student)).r.status,
        403,
      );
    },
  );
  await t.test(
    "multiple explicitly related children are supported",
    async () => {
      await call("/students/" + other + "/guardians", "POST", {
        guardian_id: guardianId,
        relationship: "parent",
      });
      assert.equal(
        (await call("/portal", "GET", undefined, guardian)).j.children.length,
        2,
      );
      assert.equal(
        (await call("/portal/students/" + other, "GET", undefined, guardian)).r
          .status,
        200,
      );
    },
  );
  await t.test(
    "branch changes revoke access immediately and unlinks end active sessions",
    async () => {
      const a = (await call("/me", "GET", undefined, teacher)).j.user;
      const b = await call("/branches", "POST", {
        name: "Other branch",
        code: "OTHERBR",
        capacity: 100,
      });
      assert.equal(b.r.status, 201);
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b.j.id, a.membership_id);
      assert.equal(
        (await call("/lms/groups/" + g.id, "GET", undefined, teacher)).r.status,
        403,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=NULL WHERE id=?")
        .run(a.membership_id);
      const link = (await call("/portal-links")).j.data.find(
        (x: any) => x.user_id === a.user_id,
      );
      assert.equal(
        (await call("/portal-links/" + link.id, "DELETE")).r.status,
        200,
      );
      assert.equal(
        (await call("/me", "GET", undefined, teacher)).r.status,
        401,
      );
    },
  );
  await t.test(
    "portal demo is idempotent and real coursework blocks demo cleanup atomically",
    async () => {
      const r = await call("/settings/demo/portals", "POST", {});
      assert.equal(r.r.status, 200);
      await call("/settings/demo/portals", "POST", {});
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_lessons WHERE org_id=? AND is_demo=1",
            )
            .get(org) as any
        ).n,
        2,
      );
      const before = (
        raw
          .prepare("SELECT count(*) n FROM el_lessons WHERE org_id=?")
          .get(org) as any
      ).n;
      const off = await call("/settings/demo", "PUT", { enabled: false });
      assert.equal(off.r.status, 409);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_lessons WHERE org_id=?")
            .get(org) as any
        ).n,
        before,
      );
      assert.equal(
        (await call("/lms/lessons/" + lesson, "GET", undefined, student)).r
          .status,
        200,
      );
    },
  );
});
