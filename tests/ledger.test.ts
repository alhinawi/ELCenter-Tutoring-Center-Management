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
test("ledger pagination returns complete journals beyond former 2000-line cap", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "ledger-cursor@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Ledger Center",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  assert.equal(
    (await call("/finance/initialize", "POST", { year: 2026 })).r.status,
    200,
  );
  const settings = (await call("/finance/settings")).j;
  const accounts = settings.accounts,
    period = settings.periods[0].id;
  const debit = accounts.find((x: any) => x.system_key === "cash").id,
    credit = accounts.find((x: any) => x.system_key === "equity").id;
  function journal(i: number, scope = branch, date = "2026-11-01", lines = 80) {
    const id = randomUUID();
    raw
      .prepare(
        "INSERT INTO el_journals(id,org_id,branch_id,period_id,date,reference,memo,source_type,created_by,created_at) VALUES(?,?,?,?,?,?,?,'manual',?,'2026-11-01 12:00:00')",
      )
      .run(
        id,
        org,
        scope,
        period,
        date,
        "PAGE-" + i,
        "=Fictional formula-looking memo",
        me.user.user_id,
      );
    for (let j = 0; j < lines; j++)
      raw
        .prepare(
          "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,?,?)",
        )
        .run(
          randomUUID(),
          org,
          id,
          j % 2 ? credit : debit,
          j % 2 ? 0 : 1,
          j % 2 ? 1 : 0,
        );
    raw.prepare("UPDATE el_journals SET status='posted' WHERE id=?").run(id);
    return id;
  }
  for (let i = 0; i < 27; i++) journal(i);
  const path = "/finance/ledger?from=2026-01-01&to=2026-12-31";
  let cursor = "";
  const seen: string[] = [];
  await t.test(
    "default 25-journal page includes all 80 lines per journal and reaches all 2160 lines",
    async () => {
      const first = await call(path);
      assert.equal(first.r.status, 200, JSON.stringify(first.j));
      assert.equal(first.j.journal_count, 25);
      assert.equal(first.j.data.length, 2000);
      assert(first.j.has_more);
      cursor = first.j.next_cursor;
      seen.push(...first.j.data.map((r: any) => r.line_id));
      const second = await call(path + "&cursor=" + encodeURIComponent(cursor));
      assert.equal(second.r.status, 200, JSON.stringify(second.j));
      assert.equal(second.j.journal_count, 2);
      assert.equal(second.j.data.length, 160);
      assert.equal(second.j.next_cursor, null);
      seen.push(...second.j.data.map((r: any) => r.line_id));
      assert.equal(new Set(seen).size, 2160);
      for (const result of [first.j, second.j])
        for (const id of new Set(result.data.map((r: any) => r.id))) {
          const rows = result.data.filter((r: any) => r.id === id);
          assert.equal(rows.length, 80);
          assert.equal(
            rows.reduce((n: number, r: any) => n + r.debit - r.credit, 0),
            0,
          );
        }
    },
  );
  await t.test(
    "tie order is stable; small pages have no repeats and an empty range returns no cursor",
    async () => {
      const a = (await call(path + "&limit=1")).j,
        b = (await call(path + "&limit=1")).j;
      assert.equal(a.data[0].id, b.data[0].id);
      assert.equal(a.data.length, 80);
      const next = (
        await call(
          path + "&limit=1&cursor=" + encodeURIComponent(a.next_cursor),
        )
      ).j;
      assert.notEqual(a.data[0].id, next.data[0].id);
      assert.equal(
        (await call("/finance/ledger?from=2025-01-01&to=2025-12-31")).j
          .next_cursor,
        null,
      );
    },
  );
  await t.test(
    "malformed cursors, oversized page requests and changed filters fail instead of resetting silently",
    async () => {
      for (const suffix of [
        "&cursor=not-json",
        "&limit=0",
        "&limit=26",
        "&limit=51",
        "&limit=1.5",
        "&cursor=" + encodeURIComponent(btoa("{}")),
      ])
        assert.equal((await call(path + suffix)).r.status, 400);
      assert.equal(
        (
          await call(
            "/finance/ledger?from=2026-02-01&to=2026-12-31&cursor=" +
              encodeURIComponent(cursor),
          )
        ).r.status,
        400,
      );
      assert.equal(
        (await call("/finance/ledger?from=2026-12-31&to=2026-01-01")).r.status,
        400,
      );
    },
  );
  await t.test(
    "scope is checked on every page, including old cursor after a membership branch change",
    async () => {
      const otherBranch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(otherBranch, org, "Other branch", "LED-OTHER");
      const another = journal(99, otherBranch, "2026-11-02", 2);
      const role = (
          await call("/roles", "POST", {
            name: "Scoped ledger viewer",
            permissions: ["finance:view"],
          })
        ).j.id,
        email = "ledger-reader@example.invalid";
      await call("/users", "POST", {
        name: "Reader",
        email,
        password: "Testing-password-2026",
        role_id: role,
        branch_id: branch,
      });
      await call(
        "/auth/login",
        "POST",
        { email, password: "Testing-password-2026" },
        other,
      );
      const reader = (await call("/me", "GET", undefined, other)).j.user
        .user_id;
      const scoped = (await call(path + "&limit=1", "GET", undefined, other)).j;
      assert(scoped.next_cursor);
      assert(scoped.data.every((r: any) => r.branch_id === branch));
      assert.equal(
        (
          await call(
            path + "&cursor=" + encodeURIComponent(cursor),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        400,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(otherBranch, org, reader);
      assert.equal(
        (
          await call(
            path + "&cursor=" + encodeURIComponent(scoped.next_cursor),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        400,
      );
      const changed = (await call(path, "GET", undefined, other)).j;
      assert(changed.data.every((r: any) => r.id === another));
      raw.prepare("DELETE FROM el_role_permissions WHERE role_id=?").run(role);
      assert.equal((await call(path, "GET", undefined, other)).r.status, 403);
    },
  );
});
