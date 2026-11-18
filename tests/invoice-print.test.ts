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
test("invoice print settings are scoped and issue-time snapshots cannot rewrite historical invoices", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "print-snapshot@example.invalid",
    password: "Testing-password-2026",
    organization: "Registered Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  await call("/finance/initialize", "POST", { year: 2026 });
  const student = (
    await call("/students", "POST", {
      name: "Fictional Learner",
      code: "PRINT-S",
      branch_id: branch,
    })
  ).j.id;
  const settings = {
    issuer_name: "Fictional Learning Center",
    contact_text: "Fictional campus\n01000000000",
    invoice_footer: "Please keep this invoice. <script>alert(1)</script>",
    receipt_footer: "Recorded receipt, not a payment gateway.",
    accent: "teal",
  };
  async function invoice(number: string) {
    const r = await call("/invoices", "POST", {
      student_id: student,
      number,
      date: "2026-11-01",
      due_date: "2026-11-30",
      discount: 0,
      items: [
        { description: "Fictional tuition", quantity: 1, unit_price: 100 },
      ],
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    return r.j.id;
  }
  let first = "";
  await t.test(
    "plain settings validate, audit and do not touch draft totals",
    async () => {
      assert.equal(
        (await call("/finance/print-settings")).j.data.accent,
        "blue",
      );
      for (const data of [
        { ...settings, accent: "red" },
        { ...settings, issuer_name: "x".repeat(161) },
        { ...settings, invoice_footer: "x".repeat(1001) },
        { ...settings, unexpected: true },
      ])
        assert.equal(
          (await call("/finance/print-settings", "PUT", data)).r.status,
          400,
        );
      assert.equal(
        (await call("/finance/print-settings", "PUT", settings)).r.status,
        200,
      );
      assert.deepEqual(
        (await call("/finance/print-settings")).j.data,
        settings,
      );
      first = await invoice("PRINT-1");
      assert.equal((await call("/invoices/" + first)).j.print_snapshot, null);
      assert.equal((await call("/invoices/" + first)).j.data.total, 100);
    },
  );
  await t.test(
    "issue captures current settings atomically and edits only affect later issues",
    async () => {
      assert.equal(
        (await call("/invoices/" + first + "/issue", "POST", {})).r.status,
        200,
      );
      const snap = (await call("/invoices/" + first)).j.print_snapshot;
      for (const k of Object.keys(settings))
        assert.equal(snap[k], settings[k as keyof typeof settings]);
      await call("/finance/print-settings", "PUT", {
        ...settings,
        issuer_name: "Updated identity",
        invoice_footer: "Updated note",
      });
      assert.deepEqual(
        (await call("/invoices/" + first)).j.print_snapshot,
        snap,
      );
      const next = await invoice("PRINT-2");
      await call("/invoices/" + next + "/issue", "POST", {});
      assert.equal(
        (await call("/invoices/" + next)).j.print_snapshot.issuer_name,
        "Updated identity",
      );
      assert.equal((await call("/invoices/" + next)).j.data.total, 100);
    },
  );
  await t.test(
    "database rejects snapshot replacement/deletion and out-of-sequence capture",
    async () => {
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_invoice_print_snapshots SET issuer_name=? WHERE invoice_id=?",
            )
            .run("Changed", first),
        /immutable/,
      );
      assert.throws(
        () =>
          raw
            .prepare(
              "DELETE FROM el_invoice_print_snapshots WHERE invoice_id=?",
            )
            .run(first),
        /immutable/,
      );
      assert.throws(() =>
        raw
          .prepare(
            "INSERT INTO el_invoice_print_snapshots SELECT ?,org_id,issuer_name,contact_text,invoice_footer,receipt_footer,accent,captured_at FROM el_invoice_print_snapshots WHERE invoice_id=?",
          )
          .run(randomUUID(), first),
      );
      const draft = await invoice("DIRECT-ISSUE");
      assert.throws(
        () =>
          raw
            .prepare("UPDATE el_invoices SET status='issued' WHERE id=?")
            .run(draft),
        /snapshot/,
      );
    },
  );
  await t.test(
    "family endpoint receives only the same saved snapshot and cannot inspect another student invoice",
    async () => {
      const role = (await call("/roles")).j.data.find(
          (r: any) => r.system_key === "student",
        ).id,
        email = "print-student@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Fictional Learner",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      const id = (await call("/me", "GET", undefined, other)).j.user.user_id;
      await call("/portal-links", "POST", {
        user_id: id,
        kind: "student",
        profile_id: student,
      });
      assert.deepEqual(
        (await call("/portal/invoices/" + first, "GET", undefined, other)).j
          .print_snapshot,
        (await call("/invoices/" + first)).j.print_snapshot,
      );
      assert.equal(
        (await call("/finance/print-settings", "PUT", settings, other)).r
          .status,
        403,
      );
      assert.equal(
        (await call("/finance/print-settings", "GET", undefined, other)).r
          .status,
        403,
      );
    },
  );
  await t.test(
    "blank issuer captures registered name, and legacy records have no invented historical branding",
    async () => {
      await call("/finance/print-settings", "PUT", {
        ...settings,
        issuer_name: "",
      });
      const blank = await invoice("PRINT-DEFAULT");
      await call("/invoices/" + blank + "/issue", "POST", {});
      assert.equal(
        (await call("/invoices/" + blank)).j.print_snapshot.issuer_name,
        "Registered Academy",
      );
      const legacy = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,total,status,created_by) VALUES(?,?,?,?,?,'2026-01-01','2026-01-31',100,'issued',?)",
        )
        .run(legacy, org, branch, student, "LEGACY", me.user.user_id);
      assert.equal((await call("/invoices/" + legacy)).j.print_snapshot, null);
    },
  );
  await t.test(
    "organization isolation, branch manager write denial and audit provenance",
    async () => {
      const role = (
          await call("/roles", "POST", {
            name: "Branch Print Manager",
            permissions: ["finance:view", "finance:manage"],
          })
        ).j.id,
        email = "branch-print@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Branch manager",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/finance/print-settings", "PUT", settings, other)).r
          .status,
        403,
      );
      assert.equal(
        (await call("/finance/print-settings", "GET", undefined, other)).r
          .status,
        200,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other Owner",
          email: "other-print@example.invalid",
          password,
          organization: "Other Organization",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/invoices/" + first, "GET", undefined, other)).r.status,
        404,
      );
      assert.equal(
        (await call("/finance/print-settings", "GET", undefined, other)).j.data
          .issuer_name,
        "",
      );
      const audit = raw
        .prepare(
          "SELECT count(*) n FROM el_audit WHERE org_id=? AND entity='finance_print_settings' AND user_id=?",
        )
        .get(org, me.user.user_id) as any;
      assert(audit.n >= 3);
    },
  );
  await t.test(
    "void preserves its issue snapshot and closed periods leave no partial snapshot",
    async () => {
      const id = await invoice("PRINT-VOID");
      await call("/invoices/" + id + "/issue", "POST", {});
      const snapshot = (await call("/invoices/" + id)).j.print_snapshot;
      assert.equal(
        (
          await call("/invoices/" + id + "/void", "POST", {
            date: "2026-11-02",
            reason: "Fictional cancellation",
          })
        ).r.status,
        200,
      );
      assert.deepEqual(
        (await call("/invoices/" + id)).j.print_snapshot,
        snapshot,
      );
      assert.throws(
        () =>
          raw
            .prepare(
              "DELETE FROM el_invoice_print_snapshots WHERE invoice_id=?",
            )
            .run(id),
        /immutable/,
      );
      const draft = await invoice("PRINT-CLOSED");
      raw
        .prepare(
          "UPDATE el_financial_periods SET status='closed' WHERE org_id=?",
        )
        .run(org);
      assert.equal(
        (await call("/invoices/" + draft + "/issue", "POST", {})).r.status,
        409,
      );
      assert.equal((await call("/invoices/" + draft)).j.print_snapshot, null);
    },
  );
});
