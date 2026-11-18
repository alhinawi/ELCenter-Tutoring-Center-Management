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
test("family invoice pages preserve identity and complete recorded payment balances", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  await call("/finance/initialize", "POST", { year: 2026 });
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
  await account("parent_guardian", guardian, guardianId);
  const ids = new Set<string>(),
    list: string[] = [];
  for (let i = 0; i < 121; i++) {
    const r = await call("/invoices", "POST", {
      student_id: own,
      number: "FAMILY-INV-" + i,
      date: "2026-11-01",
      due_date: "2026-11-30",
      items: [
        { description: "Fictional tuition", quantity: 1, unit_price: 100 },
      ],
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    const issue = await call("/invoices/" + r.j.id + "/issue", "POST", {});
    assert.equal(issue.r.status, 200, JSON.stringify(issue.j));
    ids.add(r.j.id);
    list.push(r.j.id);
  }
  await call("/invoices", "POST", {
    student_id: own,
    number: "EXCLUDED-DRAFT",
    date: "2026-11-01",
    due_date: "2026-11-30",
    items: [{ description: "Draft private", quantity: 1, unit_price: 999 }],
  });
  await t.test(
    "121 invoice rows beyond preview enumerate without duplicate ties and drafts",
    async () => {
      const actual = new Set<string>();
      for (let page = 1; page <= 7; page++) {
        const r = await call(
          `/portal/students/${own}/invoices?page=${page}`,
          "GET",
          undefined,
          student,
        );
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 121);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!actual.has(row.id));
          actual.add(row.id);
          assert.equal(row.currency, "EGP");
          assert.equal(row.total, 100);
          assert.equal(row.paid, 0);
          assert(!("journal_id" in row));
          assert(!("created_by" in row));
        }
      }
      assert.equal(actual.size, 121);
      assert.deepEqual(
        (
          await call(
            `/portal/students/${own}/invoices?page=8`,
            "GET",
            undefined,
            student,
          )
        ).j.data,
        [],
      );
      assert.deepEqual(
        (
          await call(
            `/portal/students/${own}/invoices?page=2`,
            "GET",
            undefined,
            student,
          )
        ).j.data,
        (
          await call(
            `/portal/students/${own}/invoices?page=2`,
            "GET",
            undefined,
            guardian,
          )
        ).j.data,
      );
      assert.equal(
        (await call(`/portal/students/${own}`, "GET", undefined, student)).j
          .invoices.length,
        100,
      );
    },
  );
  await t.test(
    "partial receipt, refund and void are actual recorded net paid not external settlement",
    async () => {
      const receipt = await call("/invoices/" + list[0] + "/payments", "POST", {
        date: "2026-11-18",
        amount: 60,
        method: "cash",
        reference: "Fictional recorded cash",
        idempotency_key: crypto.randomUUID(),
      });
      assert.equal(receipt.r.status, 201, JSON.stringify(receipt.j));
      const refund = await call(
        "/payments/" + receipt.j.id + "/refund",
        "POST",
        {
          date: "2026-11-18",
          amount: 20,
          reason: "Fictional partial refund",
          idempotency_key: crypto.randomUUID(),
        },
      );
      assert.equal(refund.r.status, 201, JSON.stringify(refund.j));
      const voided = await call("/invoices/" + list[1] + "/void", "POST", {
        date: "2026-11-18",
        reason: "Fictional cancellation",
      });
      assert.equal(voided.r.status, 200, JSON.stringify(voided.j));
      let paid: any;
      for (let page = 1; page <= 7; page++) {
        const r = await call(
          `/portal/students/${own}/invoices?page=${page}`,
          "GET",
          undefined,
          student,
        );
        paid ??= r.j.data.find((r: any) => r.id === list[0]);
      }
      assert.equal(paid.paid, 40);
      const v = await call(
        `/portal/students/${own}/invoices?status=void`,
        "GET",
        undefined,
        student,
      );
      assert.equal(v.j.total, 1);
      assert.equal(v.j.data[0].id, list[1]);
      assert.equal(v.j.data[0].status, "void");
      const issued = await call(
        `/portal/students/${own}/invoices?status=issued`,
        "GET",
        undefined,
        student,
      );
      assert.equal(issued.j.total, 120);
      assert(issued.j.data.every((r: any) => r.status === "issued"));
      assert.equal(
        (await call(`/portal/students/${own}`, "GET", undefined, student)).j
          .summary.outstanding,
        11960,
      );
    },
  );
  await t.test(
    "strict inputs and current family/role relationships gate all pages",
    async () => {
      for (const value of ["", "0", "-1", "1.5", "Infinity", "10001"])
        assert.equal(
          (
            await call(
              `/portal/students/${own}/invoices?page=${value}`,
              "GET",
              undefined,
              student,
            )
          ).r.status,
          400,
          value,
        );
      for (const status of ["draft", "paid", "unknown"])
        assert.equal(
          (
            await call(
              `/portal/students/${own}/invoices?status=${status}`,
              "GET",
              undefined,
              student,
            )
          ).r.status,
          400,
        );
      assert.equal(
        (
          await call(
            `/portal/students/${other}/invoices`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            teacher,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            unlinked,
          )
        ).r.status,
        403,
      );
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE student_id=? AND guardian_id=?",
        )
        .run(own, guardianId);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            guardian,
          )
        ).r.status,
        404,
      );
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(own);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      raw.prepare("UPDATE el_students SET status='active' WHERE id=?").run(own);
    },
  );
  await t.test(
    "live branch transfer/link revocation, foreign and unsigned access stay isolated",
    async () => {
      const b = (
        await call("/branches", "POST", {
          name: "Fictional Other",
          code: "FI-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b, studentAccount.membership);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, studentAccount.membership);
      raw
        .prepare("DELETE FROM el_portal_links WHERE user_id=?")
        .run(studentAccount.user);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      await call("/auth/demo", "POST", {}, foreign);
      await call("/me", "GET", undefined, foreign);
      assert.equal(
        (
          await call(
            `/portal/students/${own}/invoices`,
            "GET",
            undefined,
            foreign,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(`/portal/students/${own}/invoices`, "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
    },
  );
});
