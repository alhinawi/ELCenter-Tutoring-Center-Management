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
test("teacher group pages list every assigned group once with scope isolation", async (t) => {
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
  const mine = new Set<string>();
  for (let i = 0; i < 45; i++) {
    const g = copyGroup(i);
    mine.add(g);
    if (i % 3 === 0)
      raw.prepare("UPDATE el_groups SET status='completed' WHERE id=?").run(g);
  }
  const otherTeacher = { id: randomUUID() };
  raw
    .prepare(
      "INSERT INTO el_teachers(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
    )
    .run(otherTeacher.id, org, branch, "Fictional Other Teacher", "OT-1");
  let foreignGroup = "";
  if (otherTeacher) {
    foreignGroup = copyGroup(99);
    raw
      .prepare("UPDATE el_groups SET teacher_id=? WHERE id=?")
      .run(otherTeacher.id, foreignGroup);
  }
  const mineCount = (
    raw
      .prepare(
        "SELECT count(*) n FROM el_groups WHERE org_id=? AND teacher_id=?",
      )
      .get(org, group.teacher_id) as any
  ).n;
  assert(mineCount > 45);
  await t.test("pages exactly once, sorted, no foreign groups", async () => {
    const seen = new Set<string>();
    const pages = Math.ceil(mineCount / 20);
    for (let page = 1; page <= pages + 1; page++) {
      const r = await call(
        "/portal/teacher/groups?page=" + page,
        "GET",
        undefined,
        teacher,
      );
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.total, mineCount);
      for (const row of r.j.data) {
        assert(!seen.has(row.id));
        assert.notEqual(row.id, foreignGroup);
        seen.add(row.id);
      }
      if (page > pages) assert.equal(r.j.data.length, 0);
    }
    assert.equal(seen.size, mineCount);
    for (const id of mine) assert(seen.has(id));
  });
  await t.test("status filter, bad input and role denial", async () => {
    const done = (
      raw
        .prepare(
          "SELECT count(*) n FROM el_groups WHERE teacher_id=? AND status='completed'",
        )
        .get(group.teacher_id) as any
    ).n;
    assert.equal(
      (
        await call(
          "/portal/teacher/groups?status=completed",
          "GET",
          undefined,
          teacher,
        )
      ).j.total,
      done,
    );
    for (const q of ["?status=x", "?page=0", "?page=10001", "?page=x"])
      assert.equal(
        (await call("/portal/teacher/groups" + q, "GET", undefined, teacher)).r
          .status,
        400,
      );
    assert.equal(
      (await call("/portal/teacher/groups", "GET", undefined, student)).r
        .status,
      403,
    );
    assert.equal(
      (await call("/portal/teacher/groups", "GET", undefined, unlinked)).r
        .status,
      403,
    );
  });
  await t.test(
    "home totals count everything, not a capped preview",
    async () => {
      for (let i = 0; i < 70; i++) copyGroup(1000 + i);
      const total = (
        raw
          .prepare(
            "SELECT count(*) n FROM el_groups WHERE org_id=? AND teacher_id=?",
          )
          .get(org, group.teacher_id) as any
      ).n;
      assert(total > 100);
      const home = (await call("/portal/teacher", "GET", undefined, teacher)).j;
      assert.equal(home.totals.groups, total);
      assert.equal(typeof home.totals.sessions, "number");
      assert.equal(typeof home.totals.exams, "number");
      assert.equal(home.groups, undefined);
    },
  );
  void guardianAccount;
  void studentAccount;
});
