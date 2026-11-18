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
test("employee custom fields use HR permission and employee branch without leaking to academics", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "employee-fields@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Staff Fields",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const employee = (
    await call("/operations/employees", "POST", {
      branch_id: branch,
      name: "Fictional Employee",
      code: "CUSTOM-EMP",
      job_title: "Tutor",
      hired_on: "2026-01-01",
    })
  ).j.id;
  const field = (
    await call("/custom-fields", "POST", {
      entity: "employees",
      field_key: "staff_badge",
      label: "Staff badge classification",
      type: "select",
      options: ["Visitor", "Permanent"],
      required: true,
    })
  ).j.id;
  assert(field);
  const path = "/record-fields/employees/" + employee;
  await t.test(
    "typed persisted values are independent from core employee registration",
    async () => {
      assert.equal((await call(path)).j.data[0].value, null);
      assert.equal((await call(path, "PUT", { values: {} })).r.status, 400);
      assert.equal(
        (await call(path, "PUT", { values: { [field]: "Invalid" } })).r.status,
        400,
      );
      assert.equal(
        (await call(path, "PUT", { values: { [field]: "Permanent" } })).r
          .status,
        200,
      );
      assert.equal((await call(path)).j.data[0].value, "Permanent");
    },
  );
  await t.test(
    "HR reader can read but not edit; academic permission grants no employee value access",
    async () => {
      const role = (
        await call("/roles", "POST", {
          name: "HR reader",
          permissions: ["hr:view"],
        })
      ).j.id;
      const email = "hr-fields-" + randomUUID() + "@example.invalid";
      const membership = (
        await call("/users", "POST", {
          name: "HR Reader",
          email,
          password: "Testing-password-2026",
          role_id: role,
          branch_id: branch,
        })
      ).j.id;
      await call(
        "/auth/login",
        "POST",
        { email, password: "Testing-password-2026" },
        other,
      );
      const user = (await call("/me", "GET", undefined, other)).j.user.user_id;
      assert.equal(
        (await call(path, "GET", undefined, other)).j.data[0].value,
        "Permanent",
      );
      assert.equal(
        (await call(path, "PUT", { values: { [field]: "Visitor" } }, other)).r
          .status,
        403,
      );
      const academic = (
        await call("/roles", "POST", {
          name: "Academic editor",
          permissions: ["students:view", "students:edit", "teachers:view"],
        })
      ).j.id;
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(academic, org, user);
      assert.equal((await call(path, "GET", undefined, other)).r.status, 403);
      const otherBranch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(otherBranch, org, "Other branch", "EMP-OTHER");
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=?,branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(role, otherBranch, org, user);
      assert.equal((await call(path, "GET", undefined, other)).r.status, 403);
    },
  );
  await t.test(
    "archiving retains read-only values and employee deletion clears only its values",
    async () => {
      assert.equal(
        (
          await call("/custom-fields/" + field, "PUT", {
            label: "Staff badge classification",
            required: true,
            status: "archived",
          })
        ).r.status,
        200,
      );
      assert.equal((await call(path)).j.data[0].value, "Permanent");
      assert.equal(
        (await call(path, "PUT", { values: { [field]: "Visitor" } })).r.status,
        400,
      );
      raw.prepare("DELETE FROM el_employees WHERE id=?").run(employee);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_custom_values WHERE field_id=?")
            .get(field) as any
        ).n,
        0,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_custom_fields WHERE id=?")
            .get(field) as any
        ).n,
        1,
      );
    },
  );
});
test("0023 rebuild preserves earlier definitions, archived values, foreign keys and guards", () => {
  const before = sqliteDatabase();
  for (const f of readdirSync("migrations")
    .filter((f) => f.endsWith(".sql") && f < "0023")
    .sort())
    before.raw.exec(readFileSync("migrations/" + f, "utf8"));
  before.raw
    .prepare(
      "INSERT INTO el_organizations(id,name) VALUES('migration-org','Fictional Migration')",
    )
    .run();
  before.raw
    .prepare(
      "INSERT INTO el_branches(id,org_id,name,code) VALUES('migration-branch','migration-org','Branch','B')",
    )
    .run();
  before.raw
    .prepare(
      "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES('migration-student','migration-org','migration-branch','Student','S')",
    )
    .run();
  before.raw
    .prepare(
      "INSERT INTO el_custom_fields(id,org_id,entity,field_key,label,type,created_at) VALUES('migration-field','migration-org','students','old_field','Original field','text',1)",
    )
    .run();
  before.raw
    .prepare(
      "INSERT INTO el_custom_values(org_id,field_id,record_id,value_json,updated_at) VALUES('migration-org','migration-field','migration-student','\"original retained value\"',123)",
    )
    .run();
  before.raw
    .prepare(
      "UPDATE el_custom_fields SET status='archived' WHERE id='migration-field'",
    )
    .run();
  const definitions = before.raw
      .prepare("SELECT * FROM el_custom_fields ORDER BY id")
      .all(),
    values = before.raw
      .prepare("SELECT * FROM el_custom_values ORDER BY field_id")
      .all();
  before.raw.exec(
    readFileSync("migrations/0023_employee_custom_fields.sql", "utf8"),
  );
  assert.deepEqual(
    before.raw.prepare("SELECT * FROM el_custom_fields ORDER BY id").all(),
    definitions,
  );
  assert.deepEqual(
    before.raw
      .prepare("SELECT * FROM el_custom_values ORDER BY field_id")
      .all(),
    values,
  );
  assert.deepEqual(before.raw.prepare("PRAGMA foreign_key_check").all(), []);
  assert.throws(
    () =>
      before.raw
        .prepare("UPDATE el_custom_values SET value_json='\"changed\"'")
        .run(),
    /archived/,
  );
  assert.throws(
    () => before.raw.prepare("UPDATE el_custom_fields SET type='number'").run(),
    /immutable/,
  );
  before.raw
    .prepare("DELETE FROM el_students WHERE id='migration-student'")
    .run();
  assert.equal(
    (before.raw.prepare("SELECT count(*) n FROM el_custom_values").get() as any)
      .n,
    0,
  );
  before.raw
    .prepare(
      "INSERT INTO el_custom_fields(id,org_id,entity,field_key,label,type,created_at) VALUES('employee-field','migration-org','employees','staff','Staff','text',2)",
    )
    .run();
  assert.equal(
    (before.raw.prepare("SELECT count(*) n FROM el_custom_fields").get() as any)
      .n,
    2,
  );
});
