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
test("family group pages enumerate current-owned enrollments completely", async (t) => {
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
  const cols = (raw.prepare("PRAGMA table_info(el_groups)").all() as any[]).map(
    (c) => c.name,
  );
  const copyGroup = (n: number) => {
    const id = randomUUID(),
      list = cols.join(","),
      sel = cols
        .map((c) =>
          c === "id"
            ? "?"
            : c === "name"
              ? "'Pager Group ' || printf('%03d',?)"
              : c === "code"
                ? "'PG-' || ?"
                : c,
        )
        .join(",");
    raw
      .prepare(
        `INSERT INTO el_groups(${list}) SELECT ${sel} FROM el_groups WHERE id=?`,
      )
      .run(id, n, n, group.id);
    return id;
  };
  const ids = new Set<string>(),
    enrollCols = (
      raw.prepare("PRAGMA table_info(el_enrollments)").all() as any[]
    ).map((c) => c.name);
  raw.prepare("DELETE FROM el_enrollments WHERE student_id=?").run(own);
  for (let i = 0; i < 45; i++) {
    const g = copyGroup(i);
    ids.add(g);
    raw
      .prepare(
        "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        org,
        own,
        g,
        i % 3 === 0 ? "completed" : i % 3 === 1 ? "active" : "waiting",
      );
  }
  void enrollCols;
  const path = `/portal/groups/${own}`;
  await t.test(
    "all active and completed groups page exactly once",
    async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 3; page++) {
        const r = await call(path + "?page=" + page, "GET", undefined, student);
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 30);
        assert.equal(r.j.data.length, page < 2 ? 20 : page === 2 ? 10 : 0);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!seen.has(row.id));
          assert(["active", "completed"].includes(row.enrollment_status));
          seen.add(row.id);
        }
      }
      assert.equal(seen.size, 30);
      const names = (await call(path, "GET", undefined, student)).j.data.map(
        (x: any) => x.name,
      );
      assert.deepEqual(names, [...names].sort());
    },
  );
  await t.test("status filter counts, bad input and ownership", async () => {
    assert.equal(
      (await call(path + "?status=completed", "GET", undefined, student)).j
        .total,
      15,
    );
    assert.equal(
      (await call(path + "?status=active", "GET", undefined, guardian)).j.total,
      15,
    );
    for (const q of ["?status=waiting", "?page=0", "?page=10001", "?page=x"])
      assert.equal(
        (await call(path + q, "GET", undefined, student)).r.status,
        400,
      );
    assert.equal(
      (await call(`/portal/groups/${other}`, "GET", undefined, student)).r
        .status,
      404,
    );
    assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
    assert.equal((await call(path, "GET", undefined, unlinked)).r.status, 403);
  });
  void studentAccount;
  void guardianAccount;
});
