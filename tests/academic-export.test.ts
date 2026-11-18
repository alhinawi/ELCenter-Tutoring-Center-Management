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
  other: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c === owner ? "export-owner" : "export-other",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
function audits() {
  return (
    raw
      .prepare("SELECT count(*) n FROM el_audit WHERE action='export'")
      .get() as any
  ).n;
}
test("academic exports apply filters and authorization, audit complete output and reject cap overflow", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "academic-export-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Export Center",
  });
  const org = (await call("/me")).j.organization.id,
    b1 = (await call("/branches")).j.data[0].id,
    b2 = (
      await call("/branches", "POST", {
        name: "Other Branch",
        code: "EXPORT2",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  async function student(name: string, code: string, branch_id = b1) {
    const r = await call("/students", "POST", {
      name,
      code,
      branch_id,
      national_id: "PRIVATE-NATIONAL-ID",
    });
    assert.equal(r.r.status, 201);
    return r.j.id;
  }
  await student("Fictional Match A", "MATCH-A");
  await student("Fictional Match B", "MATCH-B", b2);
  await student("Unmatched learner", "NO-MATCH");
  await t.test(
    "complete filtered single-query rows exclude protected IDs and create one scoped audit",
    async () => {
      const before = audits(),
        r = await call("/students/export?q=Fictional&branch=" + b1);
      assert.equal(r.r.status, 200);
      assert.equal(r.r.headers.get("x-elc-export-rows"), "1");
      assert.equal(r.r.headers.get("cache-control"), "no-store");
      assert(r.j.includes("Fictional Match A"));
      assert(!r.j.includes("Match B"));
      assert(!r.j.includes("PRIVATE-NATIONAL-ID"));
      assert(!r.j.includes("national_id"));
      assert.equal(audits(), before + 1);
      const log = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE action='export' ORDER BY rowid DESC LIMIT 1",
        )
        .get() as any;
      const data = JSON.parse(log.after_json);
      assert.equal(data.branch_id, b1);
      assert.equal(data.query, "Fictional");
      assert.equal(data.rows, 1);
      assert(data.generated_at > 0);
      const empty = await call("/students/export?q=No-match-prefix");
      assert.equal(empty.r.status, 200);
      assert.equal(empty.r.headers.get("x-elc-export-rows"), "0");
      assert.equal(empty.j.trim(), '"name"');
    },
  );
  await t.test(
    "CSV protects formula-like whitespace/control prefixes, quotes, commas and newlines",
    async () => {
      const id = await student("Placeholder", "FORMULA");
      const name = '  =HYPERLINK("https://example.invalid","text")\nnext';
      raw.prepare("UPDATE el_students SET name=? WHERE id=?").run(name, id);
      const r = await call("/students/export?q=" + encodeURIComponent("  ="));
      assert(
        r.j.includes(
          '"\'  =HYPERLINK(""https://example.invalid"",""text"")\nnext"',
        ),
      );
    },
  );
  await t.test(
    "current branch and both read/export grants apply; no failed export success audit",
    async () => {
      const role = (
        await call("/roles", "POST", {
          name: "Scoped export reader",
          permissions: ["students:view", "students:export"],
        })
      ).j.id;
      await call("/users", "POST", {
        name: "Fictional exporter",
        email: "academic-exporter@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b1,
      });
      await call(
        "/auth/login",
        "POST",
        {
          email: "academic-exporter@example.invalid",
          password: "Testing-password-2026",
        },
        other,
      );
      const user = (await call("/me", "GET", undefined, other)).j.user;
      const r = await call(
        "/students/export?q=Fictional",
        "GET",
        undefined,
        other,
      );
      assert(r.j.includes("Match A"));
      assert(!r.j.includes("Match B"));
      let before = audits();
      assert.equal(
        (await call("/students/export?branch=" + b2, "GET", undefined, other)).r
          .status,
        403,
      );
      assert.equal(audits(), before);
      raw
        .prepare("DELETE FROM el_role_permissions WHERE role_id=? AND action=?")
        .run(role, "view");
      assert.equal(
        (await call("/students/export", "GET", undefined, other)).r.status,
        403,
      );
      assert.equal(audits(), before);
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,'students','view')",
        )
        .run(role);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND action='export'",
        )
        .run(role);
      assert.equal(
        (await call("/students/export", "GET", undefined, other)).r.status,
        403,
      );
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,'students','export')",
        )
        .run(role);
      raw
        .prepare(
          "UPDATE el_memberships SET status='suspended' WHERE org_id=? AND user_id=?",
        )
        .run(org, user.user_id);
      assert.equal(
        (await call("/students/export", "GET", undefined, other)).r.status,
        401,
      );
      assert.equal(audits(), before);
    },
  );
  await t.test(
    "invalid/missing branch selectors do not masquerade as empty successful exports",
    async () => {
      const before = audits();
      assert.equal(
        (await call("/students/export?branch=not-a-uuid")).r.status,
        400,
      );
      assert.equal(
        (await call("/students/export?branch=" + randomUUID())).r.status,
        404,
      );
      assert.equal(audits(), before);
    },
  );
  await t.test(
    "all other academic exports preserve their permission-scoped endpoints and empty CSV",
    async () => {
      for (const entity of [
        "guardians",
        "teachers",
        "courses",
        "groups",
        "classrooms",
      ]) {
        const r = await call("/" + entity + "/export");
        assert.equal(r.r.status, 200, entity);
        assert.equal(r.r.headers.get("x-elc-export-rows"), "0");
        assert.equal(r.j.trim(), '"name"');
      }
    },
  );
  await t.test(
    "failed audit does not return an apparently successful download",
    async () => {
      const before = audits();
      raw.exec(
        "CREATE TRIGGER el_test_export_audit_failure BEFORE INSERT ON el_audit WHEN NEW.action='export' BEGIN SELECT RAISE(ABORT,'test export audit unavailable');END;",
      );
      try {
        const r = await call("/students/export?q=Fictional");
        assert.equal(r.r.status, 500);
        assert(!r.r.headers.get("content-disposition"));
        assert.equal(audits(), before);
      } finally {
        raw.exec("DROP TRIGGER el_test_export_audit_failure");
      }
    },
  );
  await t.test(
    "exactly 10000 rows export; 10001 rejects the entire output and narrowing succeeds",
    async () => {
      const insert = raw.prepare(
        "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
      );
      raw.exec("BEGIN");
      try {
        for (let i = 0; i < 10000; i++)
          insert.run(
            randomUUID(),
            org,
            b1,
            "Cap Fixture " + String(i).padStart(5, "0"),
            "CAP-" + i,
          );
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
      let before = audits();
      const exact = await call("/students/export?q=Cap%20Fixture");
      assert.equal(exact.r.status, 200);
      assert.equal(exact.r.headers.get("x-elc-export-rows"), "10000");
      assert.equal(exact.j.trim().split("\r\n").length, 10001);
      assert.equal(audits(), before + 1);
      insert.run(randomUUID(), org, b1, "Cap Fixture Overflow", "CAP-OVERFLOW");
      before = audits();
      const over = await call("/students/export?q=Cap%20Fixture");
      assert.equal(over.r.status, 400);
      assert(over.j.error.includes("10000"));
      assert(!over.r.headers.get("content-disposition"));
      assert.equal(audits(), before);
      const narrowed = await call("/students/export?q=Cap%20Fixture%2000000");
      assert.equal(narrowed.r.status, 200);
      assert.equal(narrowed.r.headers.get("x-elc-export-rows"), "1");
    },
  );
});
