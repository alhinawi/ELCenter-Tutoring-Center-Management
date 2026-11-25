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
test("roster pages every enrolled student once, scoped", async (t) => {
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
  const scols = (
    raw.prepare("PRAGMA table_info(el_students)").all() as any[]
  ).map((c) => c.name);
  const seed = raw
    .prepare("SELECT * FROM el_students WHERE org_id=? LIMIT 1")
    .get(org) as any;
  const ids: string[] = [];
  for (let i = 0; i < 160; i++) {
    const id = randomUUID();
    const row = {
      ...seed,
      id,
      name: "Roster Learner " + String(i).padStart(3, "0"),
      code: "RL" + i,
      user_id: null,
      email: "",
    };
    const use = scols.filter((c) => c in row);
    raw
      .prepare(
        `INSERT INTO el_students(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`,
      )
      .run(...use.map((c) => row[c]));
    raw
      .prepare(
        "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        org,
        id,
        group.id,
        i % 4 === 3 ? "withdrawn" : "completed",
      );
    ids.push(id);
  }
  const expected = (
    raw
      .prepare(
        "SELECT count(*) n FROM el_enrollments WHERE group_id=? AND status IN ('active','completed')",
      )
      .get(group.id) as any
  ).n;
  assert(expected > 100);
  const path = `/lms/groups/${group.id}/roster`;
  await t.test("pages once, sorted, withdrawn excluded", async () => {
    const seen = new Set<string>();
    let names: string[] = [];
    const pages = Math.ceil(expected / 50);
    for (let p = 1; p <= pages + 1; p++) {
      const r = await call(path + "?page=" + p, "GET", undefined, teacher);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.total, expected);
      assert.equal(
        r.j.data.length,
        p <= pages ? Math.min(50, expected - (p - 1) * 50) : 0,
      );
      for (const x of r.j.data) {
        assert(!seen.has(x.id));
        seen.add(x.id);
        names.push(x.name);
      }
    }
    assert.equal(seen.size, expected);
    assert.deepEqual(names, [...names].sort());
    const withdrawn = ids.filter((_, i) => i % 4 === 3);
    for (const id of withdrawn) assert(!seen.has(id));
  });
  await t.test("bad page and wrong role rejected", async () => {
    for (const q of ["?page=0", "?page=10001", "?page=x"])
      assert.equal(
        (await call(path + q, "GET", undefined, teacher)).r.status,
        400,
      );
    assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
  });
  void guardianAccount;
  void studentAccount;
});
