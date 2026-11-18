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
test("receipt numbering is atomic, immutable, scoped and independent of invoice numbering", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "receipt-numbering@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Receipt Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const student = (
    await call("/students", "POST", {
      name: "Fictional receipt learner",
      code: "RCPT-S",
      branch_id: branch,
    })
  ).j.id;
  await call("/finance/initialize", "POST", { year: 2026 });
  const invoice = (
    await call("/invoices", "POST", {
      student_id: student,
      number: "RECEIPT-INVOICE",
      date: "2026-11-01",
      due_date: "2026-11-30",
      items: [
        { description: "Fictional tuition", quantity: 1, unit_price: 10000 },
      ],
    })
  ).j.id;
  assert.equal(
    (await call("/invoices/" + invoice + "/issue", "POST", {})).r.status,
    200,
  );
  const path = "/invoices/" + invoice + "/payments";
  const body = () => ({
    date: "2026-11-18",
    amount: 10,
    method: "cash",
    reference: "Fictional desk",
    idempotency_key: randomUUID(),
  });
  const settings = {
    enabled: true,
    prefix: "DESK-",
    next_number: 1,
    expected_next: 1,
  };
  let first: any;
  await t.test(
    "default off preserves receipt ID and invalid settings fail",
    async () => {
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.enabled,
        0,
      );
      const old = await call(path, "POST", body());
      assert.equal(old.r.status, 201);
      assert.equal(old.j.receipt_number, null);
      for (const change of [
        { prefix: "invalid prefix" },
        { prefix: "A".repeat(17) },
        { next_number: 0 },
        { next_number: 1.1 },
        { next_number: 1000000000 },
        { expected_next: 2 },
      ])
        assert(
          [400, 409].includes(
            (
              await call("/finance/receipt-numbering", "PUT", {
                ...settings,
                ...change,
              })
            ).r.status,
          ),
        );
      assert.equal(
        (await call("/finance/receipt-numbering", "PUT", settings)).r.status,
        200,
      );
    },
  );
  await t.test(
    "concurrent new receipts reserve distinct numbers; exact replay does not consume",
    async () => {
      const payload = body();
      first = await call(path, "POST", payload);
      assert.equal(first.r.status, 201, JSON.stringify(first.j));
      assert.equal(first.j.receipt_number, "DESK-000001");
      const replay = await call(path, "POST", payload);
      assert.equal(replay.j.id, first.j.id);
      assert.equal(replay.j.receipt_number, "DESK-000001");
      assert.equal(replay.j.replayed, true);
      for (const change of [
        { amount: 11 },
        { date: "2026-11-19" },
        { method: "bank" },
        { reference: "different" },
      ])
        assert.equal(
          (await call(path, "POST", { ...payload, ...change })).r.status,
          409,
        );
      const created = await Promise.all(
        Array.from({ length: 10 }, () => call(path, "POST", body())),
      );
      assert(
        created.every((r) => r.r.status === 201),
        JSON.stringify(created.map((r) => r.j)),
      );
      assert.deepEqual(
        created.map((r) => r.j.receipt_number).sort(),
        Array.from(
          { length: 10 },
          (_, i) => "DESK-" + String(i + 2).padStart(6, "0"),
        ),
      );
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        12,
      );
      assert.equal((await call("/finance/numbering")).j.data.next_number, 1);
      const detail = (await call("/invoices/" + invoice)).j;
      assert.equal(
        detail.payments.find((p: any) => p.id === first.j.id).receipt_number,
        "DESK-000001",
      );
    },
  );
  await t.test(
    "invalid payment and duplicate request roll back journals and counter; refund does not consume",
    async () => {
      const before = (
        raw
          .prepare("SELECT count(*) n FROM el_journals WHERE org_id=?")
          .get(org) as any
      ).n;
      assert.equal(
        (await call(path, "POST", { ...body(), amount: 999999 })).r.status,
        409,
      );
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        12,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_journals WHERE org_id=?")
            .get(org) as any
        ).n,
        before,
      );
      const refund = await call("/payments/" + first.j.id + "/refund", "POST", {
        date: "2026-11-18",
        amount: 5,
        method: "cash",
        reference: "Fictional refund",
        reason: "Fictional change",
        idempotency_key: randomUUID(),
      });
      assert.equal(refund.r.status, 201, JSON.stringify(refund.j));
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        12,
      );
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_receipt_numbers WHERE payment_id=?",
            )
            .get(refund.j.id) as any
        ).n,
        0,
      );
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_receipt_numbers SET number=? WHERE payment_id=?",
            )
            .run("CHANGED", first.j.id),
        /immutable/,
      );
      assert.throws(
        () =>
          raw
            .prepare("DELETE FROM el_receipt_numbers WHERE payment_id=?")
            .run(first.j.id),
        /deleted/,
      );
    },
  );
  await t.test(
    "prefix collisions and exhausted settings fail whole receipt; explicit forward recovery and disable preserve history",
    async () => {
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            enabled: true,
            prefix: "DESK-1",
            next_number: 12,
            expected_next: 12,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (await call(path, "POST", body())).j.receipt_number,
        "DESK-1000012",
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            prefix: "DESK-",
            next_number: 1000012,
            expected_next: 13,
          })
        ).r.status,
        200,
      );
      const journals = (
        raw
          .prepare("SELECT count(*) n FROM el_journals WHERE org_id=?")
          .get(org) as any
      ).n;
      assert.equal((await call(path, "POST", body())).r.status, 409);
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        1000012,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_journals WHERE org_id=?")
            .get(org) as any
        ).n,
        journals,
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            prefix: "NEW-",
            next_number: 1000013,
            expected_next: 1000012,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (await call(path, "POST", body())).j.receipt_number,
        "NEW-1000013",
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            next_number: 1000012,
            expected_next: 1000014,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            next_number: 1000014,
            expected_next: 1000013,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            enabled: false,
            next_number: 1000014,
            expected_next: 1000014,
          })
        ).r.status,
        200,
      );
      assert.equal((await call(path, "POST", body())).j.receipt_number, null);
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        1000014,
      );
      assert.equal(
        (
          await call("/finance/receipt-numbering", "PUT", {
            ...settings,
            next_number: 999999999,
            expected_next: 1000014,
          })
        ).r.status,
        200,
      );
      assert.equal((await call(path, "POST", body())).r.status, 409);
      assert.equal(
        (await call("/finance/receipt-numbering")).j.data.next_number,
        999999999,
      );
      assert.equal(
        (await call("/invoices/" + invoice)).j.payments.find(
          (p: any) => p.id === first.j.id,
        ).receipt_number,
        "DESK-000001",
      );
    },
  );
  await t.test(
    "finance manager and headquarters checks, organization isolation and linked family reads",
    async () => {
      const roles = (await call("/roles")).j.data;
      async function login(
        role: string,
        email: string,
        branch_id: string | null,
        custom = false,
      ) {
        const password = "Testing-password-2026";
        const created = await call("/users", "POST", {
          name: "Fictional scoped user",
          email,
          password,
          role_id: custom
            ? role
            : roles.find((r: any) => r.system_key === role).id,
          branch_id,
        });
        assert.equal(created.r.status, 201, JSON.stringify(created.j));
        await call("/auth/login", "POST", { email, password }, other);
        return (await call("/me", "GET", undefined, other)).j.user.user_id;
      }
      const role = (
        await call("/roles", "POST", {
          name: "Receipt viewer",
          permissions: ["finance:view"],
        })
      ).j.id;
      await login(role, "receipt-viewer@example.invalid", branch, true);
      assert.equal(
        (await call("/finance/receipt-numbering", "GET", undefined, other)).r
          .status,
        200,
      );
      assert.equal(
        (await call("/finance/receipt-numbering", "PUT", settings, other)).r
          .status,
        403,
      );
      const manager = (
        await call("/roles", "POST", {
          name: "Branch receipt manager",
          permissions: ["finance:view", "finance:manage"],
        })
      ).j.id;
      await login(manager, "receipt-branch@example.invalid", branch, true);
      assert.equal(
        (await call("/finance/receipt-numbering", "PUT", settings, other)).r
          .status,
        403,
      );
      const user = await login(
        "student",
        "receipt-family@example.invalid",
        branch,
      );
      await call("/portal-links", "POST", {
        user_id: user,
        kind: "student",
        profile_id: student,
      });
      const result = await call(
        "/portal/invoices/" + invoice,
        "GET",
        undefined,
        other,
      );
      assert.equal(result.r.status, 200, JSON.stringify(result.j));
      assert.equal(
        result.j.payments.find((p: any) => p.id === first.j.id).receipt_number,
        "DESK-000001",
      );
      assert.equal(
        (await call("/finance/receipt-numbering", "GET", undefined, other)).r
          .status,
        403,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "receipt-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Academy",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/finance/receipt-numbering", "GET", undefined, other)).j
          .data.next_number,
        1,
      );
      assert.equal(
        (await call("/invoices/" + invoice, "GET", undefined, other)).r.status,
        404,
      );
    },
  );
  await t.test(
    "demo receipts are excluded and normal demo removal works after enabling",
    async () => {
      await call("/auth/demo", "POST", {}, other);
      await call("/me", "GET", undefined, other);
      await call("/demo/academic-seed", "POST", {}, other);
      assert.equal(
        (await call("/finance/receipt-numbering", "PUT", settings, other)).r
          .status,
        200,
      );
      const seed = await call("/settings/demo/finance", "POST", {}, other);
      assert.equal(seed.r.status, 200, JSON.stringify(seed.j));
      assert.equal(
        (await call("/finance/receipt-numbering", "GET", undefined, other)).j
          .data.next_number,
        1,
      );
      const cleaned = await call(
        "/settings/demo",
        "PUT",
        { enabled: false },
        other,
      );
      assert.equal(cleaned.r.status, 200, JSON.stringify(cleaned.j));
    },
  );
});
