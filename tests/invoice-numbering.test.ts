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
test("automatic invoice numbering reserves atomically and never rewrites existing invoices", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "invoice-numbering@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Number Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    student = (
      await call("/students", "POST", {
        name: "Learner",
        code: "SEQ-S",
        branch_id: branch,
      })
    ).j.id;
  const payload = {
    student_id: student,
    date: "2026-11-01",
    due_date: "2026-11-30",
    items: [{ description: "Fictional tuition", quantity: 1, unit_price: 100 }],
  };
  const settings = {
    enabled: true,
    prefix: "CLASS-",
    next_number: 1,
    expected_next: 1,
  };
  await t.test(
    "disabled default preserves manual entry and rejects blank; settings validate",
    async () => {
      assert.equal((await call("/finance/numbering")).j.data.enabled, 0);
      assert.equal((await call("/invoices", "POST", payload)).r.status, 409);
      for (const change of [
        { prefix: "bad prefix" },
        { prefix: "X".repeat(17) },
        { next_number: 0 },
        { next_number: 1.5 },
        { next_number: 1000000000 },
        { expected_next: 2 },
      ])
        assert(
          [400, 409].includes(
            (
              await call("/finance/numbering", "PUT", {
                ...settings,
                ...change,
              })
            ).r.status,
          ),
        );
      assert.equal(
        (await call("/invoices", "POST", { ...payload, number: "MANUAL-1" })).r
          .status,
        201,
      );
      assert.equal(
        (await call("/finance/numbering", "PUT", settings)).r.status,
        200,
      );
    },
  );
  await t.test(
    "concurrent creates get unique increasing numbers; manual number does not consume one",
    async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () => call("/invoices", "POST", payload)),
      );
      assert(
        results.every((r) => r.r.status === 201),
        JSON.stringify(results.map((r) => r.j)),
      );
      assert.deepEqual(
        results.map((r) => r.j.number).sort(),
        Array.from(
          { length: 10 },
          (_, i) => "CLASS-" + String(i + 1).padStart(6, "0"),
        ),
      );
      assert.equal((await call("/finance/numbering")).j.data.next_number, 11);
      const id = results[0].j.id;
      assert.equal(
        (await call("/invoices/" + id)).j.data.number,
        results[0].j.number,
      );
      await call("/invoices", "POST", { ...payload, number: "OTHER-MANUAL" });
      assert.equal((await call("/finance/numbering")).j.data.next_number, 11);
    },
  );
  await t.test(
    "collision and invalid creates roll back the reservation and entire invoice",
    async () => {
      await call("/invoices", "POST", { ...payload, number: "CLASS-000011" });
      const before = (
        raw
          .prepare("SELECT count(*) n FROM el_invoices WHERE org_id=?")
          .get(org) as any
      ).n;
      assert.equal((await call("/invoices", "POST", payload)).r.status, 409);
      assert.equal((await call("/finance/numbering")).j.data.next_number, 11);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_invoices WHERE org_id=?")
            .get(org) as any
        ).n,
        before,
      );
      assert.equal(
        (await call("/invoices", "POST", { ...payload, items: [] })).r.status,
        400,
      );
      assert.equal((await call("/finance/numbering")).j.data.next_number, 11);
    },
  );
  await t.test(
    "explicit forward change resolves collision, stale settings and backwards counters fail",
    async () => {
      assert.equal(
        (
          await call("/finance/numbering", "PUT", {
            ...settings,
            next_number: 12,
            expected_next: 11,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/invoices", "POST", payload)).j.number,
        "CLASS-000012",
      );
      assert.equal(
        (
          await call("/finance/numbering", "PUT", {
            ...settings,
            next_number: 15,
            expected_next: 12,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call("/finance/numbering", "PUT", {
            ...settings,
            next_number: 1,
            expected_next: 13,
          })
        ).r.status,
        409,
      );
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_invoice_number_sequences SET next_number=1 WHERE org_id=?",
            )
            .run(org),
        /backwards/,
      );
      assert.throws(
        () =>
          raw
            .prepare("DELETE FROM el_invoice_number_sequences WHERE org_id=?")
            .run(org),
        /deleted/,
      );
    },
  );
  await t.test(
    "headquarters only, branch read and other-organization isolation",
    async () => {
      const role = (
          await call("/roles", "POST", {
            name: "Branch numbering",
            permissions: ["finance:view", "finance:manage"],
          })
        ).j.id,
        email = "numbering-branch@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Branch User",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/finance/numbering", "GET", undefined, other)).j.data
          .next_number,
        13,
      );
      assert.equal(
        (
          await call(
            "/finance/numbering",
            "PUT",
            { ...settings, next_number: 13, expected_next: 13 },
            other,
          )
        ).r.status,
        403,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other",
          email: "numbering-other@example.invalid",
          password,
          organization: "Other academy",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/finance/numbering", "GET", undefined, other)).j.data
          .next_number,
        1,
      );
      assert.equal(
        (await call("/invoices", "POST", payload, other)).r.status,
        404,
      );
    },
  );
  await t.test(
    "disabling stops blank creates but preserves manual and the counter; exhaustion fails safely",
    async () => {
      assert.equal(
        (
          await call("/finance/numbering", "PUT", {
            ...settings,
            enabled: false,
            next_number: 13,
            expected_next: 13,
          })
        ).r.status,
        200,
      );
      assert.equal((await call("/invoices", "POST", payload)).r.status, 409);
      assert.equal(
        (
          await call("/invoices", "POST", {
            ...payload,
            number: "MANUAL-DISABLED",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call("/finance/numbering", "PUT", {
            ...settings,
            next_number: 999999999,
            expected_next: 13,
          })
        ).r.status,
        200,
      );
      assert.equal((await call("/invoices", "POST", payload)).r.status, 409);
    },
  );
});
