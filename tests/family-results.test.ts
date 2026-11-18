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
test("complete family result pages preserve current linked identity and summary totals", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    group = (await call("/groups")).j.data[0],
    students = (await call("/students")).j.data,
    own = students[0].id,
    other = students[1].id,
    roles = (await call("/roles")).j.data;
  async function account(key: string, c: Client, profile?: string) {
    const email = "family-results-" + key + randomUUID() + "@example.invalid",
      role = roles.find((r: any) => r.system_key === key);
    const r = await call("/users", "POST", {
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
    let link = "";
    if (profile) {
      const l = await call("/portal-links", "POST", {
        user_id: user,
        kind: key === "parent_guardian" ? "guardian" : key,
        profile_id: profile,
      });
      assert.equal(l.r.status, 201, JSON.stringify(l.j));
      link = l.j.id;
    }
    return { user, link, membership: r.j.id };
  }
  const studentAccount = await account("student", student, own),
    teacherAccount = await account("teacher", teacher, group.teacher_id);
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
  await call("/students/" + other + "/guardians", "POST", {
    guardian_id: guardianId,
    relationship: "parent",
  });
  await account("parent_guardian", guardian, guardianId);
  // Remove only fixture results before constructing a deterministic full history.
  raw.prepare("DELETE FROM el_exam_results WHERE org_id=?").run(org);
  const examInsert = raw.prepare(
      "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status) VALUES(?,?,?,?,?,?,100,50,'published')",
    ),
    resultInsert = raw.prepare(
      "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,feedback,graded_by) VALUES(?,?,?,?,?,?,?,?)",
    ),
    ids = new Set<string>();
  for (let i = 0; i < 121; i++) {
    const exam = crypto.randomUUID(),
      result = crypto.randomUUID();
    examInsert.run(
      exam,
      org,
      branch,
      group.id,
      "Fictional History Exam " + i,
      1800000000,
    );
    ids.add(result);
    resultInsert.run(
      result,
      org,
      exam,
      own,
      i % 101,
      "final",
      "Fictional feedback " + i,
      me.user.user_id,
    );
  }
  const pendingExam = crypto.randomUUID();
  examInsert.run(
    pendingExam,
    org,
    branch,
    group.id,
    "Excluded pending",
    1800000001,
  );
  resultInsert.run(
    crypto.randomUUID(),
    org,
    pendingExam,
    own,
    99,
    "pending_review",
    "Excluded pending feedback",
    me.user.user_id,
  );
  // A legacy final row attached to a draft must still remain hidden.
  const draftExam = crypto.randomUUID();
  examInsert.run(
    draftExam,
    org,
    branch,
    group.id,
    "Excluded draft",
    1800000002,
  );
  resultInsert.run(
    crypto.randomUUID(),
    org,
    draftExam,
    own,
    99,
    "final",
    "Excluded draft feedback",
    me.user.user_id,
  );
  raw.prepare("UPDATE el_exams SET status='draft' WHERE id=?").run(draftExam);
  await t.test(
    "121 finalized published/closed results enumerate across tied pages without leaks",
    async () => {
      const actual = new Set<string>();
      for (let page = 1; page <= 7; page++) {
        const r = await call(
          `/portal/students/${own}/results?page=${page}`,
          "GET",
          undefined,
          student,
        );
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 121);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!actual.has(row.id));
          actual.add(row.id);
          assert(!("answers_json" in row));
          assert(!("graded_by" in row));
          assert(!("correct_answer" in row));
        }
      }
      assert.equal(actual.size, 121);
      assert.deepEqual(
        (
          await call(
            `/portal/students/${own}/results?page=8`,
            "GET",
            undefined,
            student,
          )
        ).j.data,
        [],
      );
      const repeat = (
        await call(
          `/portal/students/${own}/results?page=2`,
          "GET",
          undefined,
          student,
        )
      ).j.data.map((r: any) => r.id);
      assert.deepEqual(
        repeat,
        (
          await call(
            `/portal/students/${own}/results?page=2`,
            "GET",
            undefined,
            guardian,
          )
        ).j.data.map((r: any) => r.id),
      );
      assert.equal(
        (
          await call(
            `/portal/students/${other}/results`,
            "GET",
            undefined,
            guardian,
          )
        ).j.total,
        0,
      );
      const snapshot = (
        await call(`/portal/students/${own}`, "GET", undefined, student)
      ).j;
      assert.equal(snapshot.summary.results, 121);
      assert.equal(snapshot.results.length, 100);
      assert(!JSON.stringify(snapshot.results).includes("Excluded"));
      assert.deepEqual(
        Object.keys(
          (
            await call(
              `/portal/students/${own}/results`,
              "GET",
              undefined,
              student,
            )
          ).j.student,
        ).sort(),
        ["code", "id", "name"],
      );
    },
  );
  await t.test(
    "summary outstanding total uses all issued invoices not the100-row preview",
    async () => {
      await call("/finance/initialize", "POST", { year: 2026 });
      const before = (
        await call(`/portal/students/${own}`, "GET", undefined, student)
      ).j.summary.outstanding;
      const issued: string[] = [];
      // Use the real invoice issue workflow, preserving accounting guards.
      for (let i = 0; i < 101; i++) {
        const r = await call("/invoices", "POST", {
          branch_id: branch,
          student_id: own,
          number: "HISTORY-" + i,
          date: "2026-11-01",
          due_date: "2026-11-30",
          items: [
            { description: "Fictional tuition", quantity: 1, unit_price: 10 },
          ],
          discount: 0,
        });
        assert.equal(r.r.status, 201, JSON.stringify(r.j));
        issued.push(r.j.id);
        const issue = await call("/invoices/" + r.j.id + "/issue", "POST", {});
        assert.equal(issue.r.status, 200, JSON.stringify(issue.j));
      }
      const snapshot = (
        await call(`/portal/students/${own}`, "GET", undefined, student)
      ).j;
      assert.equal(snapshot.invoices.length, 100);
      assert.equal(snapshot.summary.outstanding, before + 1010);
      const payment = await call(
        "/invoices/" + issued[0] + "/payments",
        "POST",
        {
          date: "2026-11-18",
          amount: 6,
          method: "cash",
          reference: "Fictional partial",
          idempotency_key: crypto.randomUUID(),
        },
      );
      assert.equal(payment.r.status, 201, JSON.stringify(payment.j));
      assert.equal(
        (await call(`/portal/students/${own}`, "GET", undefined, student)).j
          .summary.outstanding,
        before + 1004,
      );
      const voided = await call("/invoices/" + issued[1] + "/void", "POST", {
        date: "2026-11-18",
        reason: "Fictional canceled tuition",
      });
      assert.equal(voided.r.status, 200, JSON.stringify(voided.j));
      assert.equal(
        (await call(`/portal/students/${own}`, "GET", undefined, student)).j
          .summary.outstanding,
        before + 994,
      );
    },
  );
  await t.test(
    "strict page, family relationship, linked identity and role gates",
    async () => {
      for (const value of ["", "0", "-1", "1.5", "Infinity", "10001"])
        assert.equal(
          (
            await call(
              `/portal/students/${own}/results?page=${value}`,
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
            `/portal/students/${other}/results`,
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
            `/portal/students/${own}/results`,
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
            `/portal/students/${own}/results`,
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
            `/portal/students/${own}/results`,
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
            `/portal/students/${own}/results`,
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
    "current branch transfer and identity unlink revoke history on existing login",
    async () => {
      const otherBranch = (
        await call("/branches", "POST", {
          name: "Fictional Other Branch",
          code: "FR-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(otherBranch, studentAccount.membership);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/results`,
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
            `/portal/students/${own}/results`,
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
            `/portal/students/${own}/results`,
            "GET",
            undefined,
            foreign,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(`/portal/students/${own}/results`, "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
    },
  );
});
