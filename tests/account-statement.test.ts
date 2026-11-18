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
test("account statements have complete signed balances, stable ordering, current scope and audited exports", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "account-statement@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Statement Center",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  await call("/finance/initialize", "POST", { year: 2026 });
  const settings = (await call("/finance/settings")).j,
    period = settings.periods[0].id,
    cash = settings.accounts.find((a: any) => a.system_key === "cash").id,
    equity = settings.accounts.find((a: any) => a.system_key === "equity").id,
    empty = settings.accounts.find((a: any) => a.system_key === "bank").id;
  function journal(value: number, date: string, scope = branch, posted = true) {
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
        "=Untrusted reference-" + id,
        "@Memo, with a comma",
        me.user.user_id,
      );
    for (const [account, debit, credit] of [
      [cash, Math.max(value, 0), Math.max(-value, 0)],
      [equity, Math.max(-value, 0), Math.max(value, 0)],
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
  const old = journal(100, "2026-10-31");
  journal(-30, "2026-11-01");
  journal(10, "2026-11-01");
  journal(20, "2026-11-15");
  journal(777, "2026-12-01");
  journal(999, "2026-11-16", branch, false);
  const payload = { account_id: cash, from: "2026-11-01", to: "2026-11-30" };
  let prior: any;
  await t.test(
    "opening excludes period; draft/future excluded; tie ordering and running balance reconcile",
    async () => {
      const r = await call("/finance/account-statement", "POST", payload);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      prior = r.j;
      assert.equal(r.r.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(r.j.summary, {
        opening: 100,
        debit: 30,
        credit: 30,
        closing: 100,
      });
      assert.equal(r.j.row_count, 3);
      let balance = 100;
      for (const row of r.j.data) {
        balance += row.debit - row.credit;
        assert.equal(row.running_balance, balance);
        assert.notEqual(row.journal_id, old);
      }
      assert.equal(r.j.balance_basis, "debit_minus_credit");
      const keys = r.j.data.map((r: any) =>
        [r.date, r.created_at, r.journal_id, r.line_id].join(":"),
      );
      assert.deepEqual(keys, [...keys].sort());
      const opposite = (
        await call("/finance/account-statement", "POST", {
          ...payload,
          account_id: equity,
        })
      ).j;
      assert.deepEqual(opposite.summary, {
        opening: -100,
        debit: 30,
        credit: 30,
        closing: -100,
      });
      const audit = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE org_id=? AND entity='account_statement' ORDER BY created_at DESC LIMIT 1",
        )
        .get(org) as any;
      assert(audit);
      const saved = JSON.parse(audit.after_json);
      assert.equal(saved.account_id, equity);
      assert.equal(saved.row_count, 3);
      assert.equal(saved.closing, -100);
      assert.equal(saved.from, payload.from);
    },
  );
  await t.test(
    "empty period retains opening, empty account zero and later backdated entries need new export",
    async () => {
      const none = (
        await call("/finance/account-statement", "POST", {
          ...payload,
          from: "2026-11-29",
        })
      ).j;
      assert.equal(none.row_count, 0);
      assert.equal(none.summary.opening, 100);
      assert.equal(none.summary.closing, 100);
      const zero = (
        await call("/finance/account-statement", "POST", {
          ...payload,
          account_id: empty,
        })
      ).j;
      assert.equal(zero.row_count, 0);
      assert.deepEqual(zero.summary, {
        opening: 0,
        debit: 0,
        credit: 0,
        closing: 0,
      });
      journal(7, "2026-10-30");
      const updated = (
        await call("/finance/account-statement", "POST", payload)
      ).j;
      assert.equal(updated.summary.opening, 107);
      assert.equal(updated.summary.closing, 107);
      assert.equal(prior.summary.opening, 100);
    },
  );
  await t.test(
    "invalid filters and foreign accounts fail without returning a partial statement",
    async () => {
      for (const change of [
        { from: "2026-02-30" },
        { to: "2026-13-01" },
        { from: "2026-12-01" },
        { account_id: "not-uuid" },
        { unexpected: true },
      ])
        assert.equal(
          (
            await call("/finance/account-statement", "POST", {
              ...payload,
              ...change,
            })
          ).r.status,
          400,
        );
      assert.equal(
        (
          await call("/finance/account-statement", "POST", {
            ...payload,
            account_id: randomUUID(),
          })
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "view alone is insufficient; current branch and revoked export permission are enforced",
    async () => {
      const branch2 = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch2, org, "Other campus", "STAT-B2");
      journal(300, "2026-11-10", branch2);
      const role = (
          await call("/roles", "POST", {
            name: "Statement exporter",
            permissions: ["finance:view", "finance:export"],
          })
        ).j.id,
        email = "statement-exporter@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Scoped exporter",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      const user = (await call("/me", "GET", undefined, other)).j.user.user_id;
      const scoped = (
        await call("/finance/account-statement", "POST", payload, other)
      ).j;
      assert.equal(scoped.summary.closing, 107);
      assert.equal(scoped.branch_id, branch);
      assert(scoped.data.every((r: any) => r.branch_id === branch));
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(branch2, org, user);
      const changed = (
        await call("/finance/account-statement", "POST", payload, other)
      ).j;
      assert.equal(changed.summary.opening, 0);
      assert.equal(changed.summary.closing, 300);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='finance' AND action='export'",
        )
        .run(role);
      assert.equal(
        (await call("/finance/account-statement", "POST", payload, other)).r
          .status,
        403,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "statement-foreign@example.invalid",
          password,
          organization: "Other Academy",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/finance/account-statement", "POST", payload, other)).r
          .status,
        404,
      );
    },
  );
  await t.test(
    "5001 matching movements reject without an audit claiming a partial export; opening-only history is not capped",
    async () => {
      const id = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_journals(id,org_id,branch_id,period_id,date,reference,memo,source_type,created_by) VALUES(?,?,?,?,'2026-11-20','BIG','Large fictional fixture','manual',?)",
        )
        .run(id, org, branch, period, me.user.user_id);
      for (let i = 0; i < 5001; i++)
        raw
          .prepare(
            "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,1,0)",
          )
          .run(randomUUID(), org, id, cash);
      raw
        .prepare(
          "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,0,5001)",
        )
        .run(randomUUID(), org, id, equity);
      raw.prepare("UPDATE el_journals SET status='posted' WHERE id=?").run(id);
      const before = (
        raw
          .prepare(
            "SELECT count(*) n FROM el_audit WHERE org_id=? AND entity='account_statement'",
          )
          .get(org) as any
      ).n;
      const rejected = await call(
        "/finance/account-statement",
        "POST",
        payload,
      );
      assert.equal(rejected.r.status, 409);
      assert.equal(rejected.j.data, undefined);
      assert.match(rejected.j.error, /5000/);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_audit WHERE org_id=? AND entity='account_statement'",
            )
            .get(org) as any
        ).n,
        before,
      );
      const narrow = (
        await call("/finance/account-statement", "POST", {
          ...payload,
          from: "2026-11-21",
        })
      ).j;
      assert.equal(narrow.row_count, 0);
      assert.equal(narrow.summary.opening, 5408);
      assert.equal(narrow.summary.closing, 5408);
    },
  );
  await t.test(
    "exactly 5000 period movements are returned whole without truncation",
    async () => {
      const id = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_journals(id,org_id,branch_id,period_id,date,reference,memo,source_type,created_by) VALUES(?,?,?,?,'2026-11-22','EXACT-CAP','Fictional exact cap','manual',?)",
        )
        .run(id, org, branch, period, me.user.user_id);
      for (let i = 0; i < 5000; i++)
        raw
          .prepare(
            "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,1,0)",
          )
          .run(randomUUID(), org, id, cash);
      raw
        .prepare(
          "INSERT INTO el_journal_lines(id,org_id,journal_id,account_id,debit,credit) VALUES(?,?,?,?,0,5000)",
        )
        .run(randomUUID(), org, id, equity);
      raw.prepare("UPDATE el_journals SET status='posted' WHERE id=?").run(id);
      const r = await call("/finance/account-statement", "POST", {
        ...payload,
        from: "2026-11-22",
        to: "2026-11-22",
      });
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.data.length, 5000);
      assert.equal(new Set(r.j.data.map((v: any) => v.line_id)).size, 5000);
      assert.equal(r.j.summary.closing - r.j.summary.opening, 5000);
    },
  );
});
