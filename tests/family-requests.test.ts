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
test("family request history pages complete account-private records", async (t) => {
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
  const guardianAccount = await account(
    "parent_guardian",
    guardian,
    guardianId,
  );
  const insert = raw.prepare(
      "INSERT INTO el_portal_requests(id,org_id,branch_id,student_id,user_id,kind,subject,body,status,response,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ),
    ids = new Set<string>(),
    statuses = ["pending", "accepted", "rejected", "closed"],
    kinds = ["absence_excuse", "meeting", "contact"];
  for (let i = 0; i < 121; i++) {
    const id = randomUUID();
    ids.add(id);
    insert.run(
      id,
      org,
      branch,
      own,
      studentAccount.user,
      kinds[i % 3],
      "Fictional Request " + i,
      "Fictional body " + i,
      statuses[i % 4],
      i % 4 ? "Fictional response" : "",
      "2026-11-18 12:00:00",
    );
  }
  insert.run(
    randomUUID(),
    org,
    branch,
    own,
    guardianAccount.user,
    "contact",
    "PRIVATE GUARDIAN",
    "Private guardian body",
    "pending",
    "",
    "2026-11-18 12:00:00",
  );
  insert.run(
    randomUUID(),
    org,
    branch,
    other,
    studentAccount.user,
    "contact",
    "OTHER CHILD",
    "Other child body",
    "pending",
    "",
    "2026-11-18 12:00:00",
  );
  const path = `/portal/students/${own}/requests`;
  await t.test(
    "121 tied-time own rows enumerate exactly; account privacy remains separate for same child",
    async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 7; page++) {
        const r = await call(path + "?page=" + page, "GET", undefined, student);
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 121);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!seen.has(row.id));
          seen.add(row.id);
          for (const key of ["user_id", "decided_by", "branch_id", "is_demo"])
            assert(!(key in row));
        }
      }
      assert.equal(seen.size, 121);
      assert.deepEqual(
        (await call(path + "?page=8", "GET", undefined, student)).j.data,
        [],
      );
      const g = await call(path, "GET", undefined, guardian);
      assert.equal(g.j.total, 1);
      assert.equal(g.j.data[0].subject, "PRIVATE GUARDIAN");
      assert.equal(
        (
          await call(
            `/portal/students/${other}/requests`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "all statuses and kinds have exact intersected counts and malformed filters reject",
    async () => {
      for (const status of statuses)
        for (const kind of kinds) {
          const r = await call(
            path + `?status=${status}&kind=${kind}`,
            "GET",
            undefined,
            student,
          );
          const expected = Array.from({ length: 121 }, (_, i) => i).filter(
            (i) => statuses[i % 4] === status && kinds[i % 3] === kind,
          ).length;
          assert.equal(r.j.total, expected);
          assert(
            r.j.data.every((r: any) => r.status === status && r.kind === kind),
          );
        }
      for (const q of [
        "page=",
        "page=0",
        "page=-1",
        "page=1.5",
        "page=Infinity",
        "page=10001",
        "status=other",
        "kind=other",
      ]) {
        assert.equal(
          (await call(path + "?" + q, "GET", undefined, student)).r.status,
          400,
          q,
        );
      }
    },
  );
  await t.test(
    "current role, relationship, profile, branch and link gate every page",
    async () => {
      for (const c of [teacher, unlinked, owner])
        assert.equal((await call(path, "GET", undefined, c)).r.status, 403);
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE student_id=? AND guardian_id=?",
        )
        .run(own, guardianId);
      assert.equal(
        (await call(path + "?page=2", "GET", undefined, guardian)).r.status,
        404,
      );
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(own);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw.prepare("UPDATE el_students SET status='active' WHERE id=?").run(own);
      const b = (
        await call("/branches", "POST", {
          name: "Fictional Other",
          code: "FR-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b, studentAccount.membership);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, studentAccount.membership);
      raw
        .prepare("DELETE FROM el_portal_links WHERE user_id=?")
        .run(studentAccount.user);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      assert.equal(
        (await call(path, "GET", undefined, { cookie: "", csrf: "" })).r.status,
        401,
      );
    },
  );
});
