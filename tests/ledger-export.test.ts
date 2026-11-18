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
test("complete scoped ledger exports whole journals, all account balances and never partial rows", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "complete-ledger@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Whole Ledger",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    path = "/finance/ledger-export",
    filters = { from: "2026-11-01", to: "2026-11-30" };
  await t.test("empty ledger is a zero complete audited export", async () => {
    const r = await call(path, "POST", filters);
    assert.equal(r.r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.row_count, 0);
    assert.equal(r.j.account_count, 0);
    assert.deepEqual(r.j.summary, {
      opening: 0,
      debit: 0,
      credit: 0,
      closing: 0,
    });
    assert.equal(r.r.headers.get("cache-control"), "private, no-store");
  });
  await call("/finance/initialize", "POST", { year: 2026 });
  const settings = (await call("/finance/settings")).j,
    period = settings.periods[0].id,
    cash = settings.accounts.find((a: any) => a.system_key === "cash").id,
    equity = settings.accounts.find((a: any) => a.system_key === "equity").id,
    bank = settings.accounts.find((a: any) => a.system_key === "bank").id,
    expense = settings.accounts.find((a: any) => a.system_key === "expense").id;
  function journal(
    value: number,
    date: string,
    scope = branch,
    accounts = [cash, equity],
    posted = true,
  ) {
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
        "=REF-" + id,
        "@Fictional memo",
        me.user.user_id,
      );
    for (const [account, debit, credit] of [
      [accounts[0], Math.max(value, 0), Math.max(-value, 0)],
      [accounts[1], Math.max(-value, 0), Math.max(value, 0)],
    ])
      raw
        .prepare(
          "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,?,?)",
        )
        .run(randomUUID(), org, id, account, debit, credit);
    if (posted)
      raw.prepare("UPDATE el_journals SET status='posted' WHERE id=?").run(id);
    return id;
  }
  journal(100, "2026-10-31");
  journal(20, "2026-11-01", [branch][0], [bank, expense]);
  const original = journal(30, "2026-11-01");
  journal(40, "2026-11-01");
  journal(900, "2026-12-01");
  journal(777, "2026-11-10", branch, [cash, equity], false);
  await t.test(
    "all movements and historical-only balances reconcile per account and each journal stays whole",
    async () => {
      const r = await call(path, "POST", filters);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.row_count, 6);
      assert.equal(r.j.account_count, 4);
      assert.deepEqual(r.j.summary, {
        opening: 0,
        debit: 90,
        credit: 90,
        closing: 0,
      });
      const seen = new Set(r.j.data.map((v: any) => v.journal_id));
      assert.equal(seen.size, 3);
      for (const id of seen) {
        const rows = r.j.data.filter((v: any) => v.journal_id === id);
        assert.equal(rows.length, 2);
        assert.equal(
          rows.reduce((n: number, v: any) => n + v.debit - v.credit, 0),
          0,
        );
      }
      for (const ac of r.j.accounts) {
        let balance = ac.opening;
        for (const row of r.j.data.filter((v: any) => v.account_id === ac.id)) {
          balance += row.debit - row.credit;
          assert.equal(row.running_balance, balance);
        }
        assert.equal(balance, ac.closing);
      }
      assert.equal(r.j.accounts.find((v: any) => v.id === cash).closing, 170);
      const keys = r.j.data.map((v: any) =>
        [v.date, v.created_at, v.journal_id, v.code, v.line_id].join(":"),
      );
      assert.deepEqual(keys, [...keys].sort());
      const narrow = (
        await call(path, "POST", { from: "2026-11-02", to: "2026-11-30" })
      ).j;
      assert.equal(narrow.row_count, 0);
      assert.equal(narrow.account_count, 4);
      assert.equal(
        narrow.accounts.find((v: any) => v.id === cash).opening,
        170,
      );
    },
  );
  await t.test(
    "reversal stays a separate complete journal and the audit describes the returned snapshot",
    async () => {
      const reversed = await call(
        "/finance/journals/" + original + "/reverse",
        "POST",
        { date: "2026-11-18", reason: "Fictional reversal" },
      );
      assert.equal(reversed.r.status, 201, JSON.stringify(reversed.j));
      const r = (await call(path, "POST", filters)).j;
      assert.equal(r.row_count, 8);
      assert.equal(
        r.data.filter((v: any) => v.reverse_of === original).length,
        2,
      );
      assert.equal(r.accounts.find((v: any) => v.id === cash).closing, 140);
      const audit = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE org_id=? AND entity='ledger_export' ORDER BY rowid DESC LIMIT 1",
        )
        .get(org) as any;
      const saved = JSON.parse(audit.after_json);
      assert.equal(saved.row_count, r.row_count);
      assert.equal(saved.account_count, r.account_count);
      assert.equal(saved.debit, r.summary.debit);
    },
  );
  await t.test(
    "malformed dates fail; view/export and current organization/branch are checked each time",
    async () => {
      for (const change of [
        { from: "2026-02-30" },
        { to: "bad" },
        { from: "2026-12-01" },
        { account_id: cash },
      ])
        assert.equal(
          (await call(path, "POST", { ...filters, ...change })).r.status,
          400,
        );
      const branch2 = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch2, org, "Other campus", "LEDGER-OTHER");
      journal(333, "2026-11-20", branch2);
      const role = (
          await call("/roles", "POST", {
            name: "Scoped whole ledger",
            permissions: ["finance:view", "finance:export"],
          })
        ).j.id,
        email = "whole-ledger-scoped@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Scoped",
        email,
        password,
        role_id: role,
        branch_id: branch2,
      });
      await call("/auth/login", "POST", { email, password }, other);
      const user = (await call("/me", "GET", undefined, other)).j.user.user_id;
      const scoped = (await call(path, "POST", filters, other)).j;
      assert.equal(scoped.row_count, 2);
      assert.equal(scoped.accounts.find((v: any) => v.id === cash).opening, 0);
      assert(scoped.data.every((v: any) => v.branch_id === branch2));
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(branch, org, user);
      assert.equal((await call(path, "POST", filters, other)).j.row_count, 8);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='finance' AND action='export'",
        )
        .run(role);
      assert.equal((await call(path, "POST", filters, other)).r.status, 403);
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "whole-ledger-foreign@example.invalid",
          password,
          organization: "Foreign ledger",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      const foreign = (await call(path, "POST", filters, other)).j;
      assert.equal(foreign.row_count, 0);
      assert.equal(foreign.account_count, 0);
    },
  );
  await t.test(
    "exactly 5000 statement rows are complete; larger mixed requests reject before success audit",
    async () => {
      const id = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_journals(id,org_id,branch_id,period_id,date,reference,memo,source_type,created_by) VALUES(?,?,?,?,'2026-01-02','CAP','Fictional exact cap','manual',?)",
        )
        .run(id, org, branch, period, me.user.user_id);
      for (let i = 0; i < 5000; i++)
        raw
          .prepare(
            "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            org,
            id,
            i % 2 ? equity : cash,
            i % 2 ? 0 : 1,
            i % 2 ? 1 : 0,
          );
      raw.prepare("UPDATE el_journals SET status='posted' WHERE id=?").run(id);
      const exact = await call(path, "POST", {
        from: "2026-01-01",
        to: "2026-01-31",
      });
      assert.equal(exact.r.status, 200, JSON.stringify(exact.j));
      assert.equal(exact.j.row_count, 5000);
      assert.equal(new Set(exact.j.data.map((v: any) => v.line_id)).size, 5000);
      assert.equal(exact.j.summary.debit, 2500);
      assert.equal(exact.j.summary.credit, 2500);
      const before = (
        raw
          .prepare(
            "SELECT count(*) n FROM el_audit WHERE org_id=? AND entity='ledger_export'",
          )
          .get(org) as any
      ).n;
      const big = await call(path, "POST", {
        from: "2026-01-01",
        to: "2026-11-30",
      });
      assert.equal(big.r.status, 409);
      assert.equal(big.j.data, undefined);
      assert.match(big.j.error, /No partial/);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_audit WHERE org_id=? AND entity='ledger_export'",
            )
            .get(org) as any
        ).n,
        before,
      );
    },
  );
  await t.test(
    "more than one interactive ledger page exports all journals and history opening",
    async () => {
      for (let i = 0; i < 26; i++) journal(1, "2026-01-10");
      const r = await call(path, "POST", {
        from: "2026-01-10",
        to: "2026-01-10",
      });
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.row_count, 52);
      assert.equal(new Set(r.j.data.map((v: any) => v.journal_id)).size, 26);
      assert.equal(r.j.accounts.find((v: any) => v.id === cash).opening, 2500);
      assert.equal(r.j.accounts.find((v: any) => v.id === cash).closing, 2526);
    },
  );
});
