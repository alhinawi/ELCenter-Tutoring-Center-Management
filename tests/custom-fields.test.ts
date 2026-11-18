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
test("custom definitions and record values enforce types, privacy, archive and audit", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "fields-owner@example.invalid",
    password: "Test-only-password-2026",
    organization: "Fields Center",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const student = (
    await call("/students", "POST", {
      branch_id: branch,
      name: "Fields learner",
      code: "FIELD-1",
    })
  ).j.id;
  const ids: Record<string, string> = {};
  for (const [key, type, options, required] of [
    ["contact", "text", [], true],
    ["score", "number", [], false],
    ["renewal", "date", [], false],
    ["level", "select", ["A", "B"], false],
    ["consent", "boolean", [], false],
  ] as const) {
    const r = await call("/custom-fields", "POST", {
      entity: "students",
      field_key: key,
      label: key,
      type,
      options,
      required,
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    ids[key] = r.j.id;
  }
  const save = (values: Record<string, unknown>) =>
    call("/record-fields/students/" + student, "PUT", { values });
  const values = {
    [ids.contact]: "Phone preferred",
    [ids.score]: 12.5,
    [ids.renewal]: "2028-02-29",
    [ids.level]: "A",
    [ids.consent]: false,
  };
  await t.test(
    "validated typed values persist and have audited updates",
    async () => {
      assert.equal((await save(values)).r.status, 200);
      const data = (await call("/record-fields/students/" + student)).j.data;
      assert.equal(data.length, 5);
      assert.equal(data.find((r: any) => r.id === ids.consent).value, false);
      assert.equal(data.find((r: any) => r.id === ids.score).value, 12.5);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_audit WHERE org_id=? AND action='custom_fields'",
            )
            .get(org) as any
        ).n,
        1,
      );
    },
  );
  await t.test(
    "invalid date, option, number and unknown fields fail atomically",
    async () => {
      for (const bad of [
        { [ids.renewal]: "2027-02-29" },
        { [ids.score]: "12" },
        { [ids.level]: "C" },
        { [ids.consent]: "false" },
        { [randomUUID()]: "unknown" },
        { [ids.contact]: null },
      ])
        assert.equal((await save({ ...values, ...bad })).r.status, 400);
      assert.equal((await save({})).r.status, 400);
      assert.equal(
        (
          await call("/custom-fields", "POST", {
            entity: "students",
            field_key: "bad",
            label: "Bad",
            type: "select",
            options: ["A", "A"],
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call("/custom-fields", "POST", {
            entity: "students",
            field_key: "bad-key",
            label: "Bad",
            type: "text",
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "archiving retains historical values but rejects edits",
    async () => {
      assert.equal(
        (
          await call("/custom-fields/" + ids.score, "PUT", {
            label: "Score at registration",
            required: false,
            status: "archived",
          })
        ).r.status,
        200,
      );
      assert.equal((await save(values)).r.status, 400);
      const active = { ...values };
      delete active[ids.score];
      assert.equal((await save(active)).r.status, 200);
      const historic = (
        await call("/record-fields/students/" + student)
      ).j.data.find((f: any) => f.id === ids.score);
      assert.equal(historic.value, 12.5);
      assert.equal(historic.status, "archived");
    },
  );
  await t.test(
    "database guards retain identity and clean deleted demo records",
    async () => {
      assert.throws(() =>
        raw
          .prepare("UPDATE el_custom_fields SET type='text' WHERE id=?")
          .run(ids.score),
      );
      assert.throws(() =>
        raw
          .prepare(
            "UPDATE el_custom_values SET value_json='99' WHERE field_id=?",
          )
          .run(ids.score),
      );
      const temp = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_students(id,org_id,branch_id,name,code,is_demo) VALUES(?,?,?,?,?,1)",
        )
        .run(temp, org, branch, "Temporary demo", "CUSTOM-DEMO");
      raw
        .prepare(
          "INSERT INTO el_custom_values(org_id,field_id,record_id,value_json,updated_at) VALUES(?,?,?,'true',0)",
        )
        .run(org, ids.consent, temp);
      raw.prepare("DELETE FROM el_students WHERE id=?").run(temp);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_custom_values WHERE record_id=?",
            )
            .get(temp) as any
        ).n,
        0,
      );
    },
  );
  await t.test(
    "organization, branch and permission boundaries apply",
    async () => {
      await call("/auth/demo", "POST", {}, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (
          await call(
            "/record-fields/students/" + student,
            "GET",
            undefined,
            other,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (await call("/custom-fields", "GET", undefined, other)).j.data.length,
        0,
      );
      assert.equal(
        (
          await call(
            "/custom-fields/" + ids.contact,
            "PUT",
            { label: "Foreign", required: false, status: "active" },
            other,
          )
        ).r.status,
        404,
      );
      const branch2 = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch2, org, "Other branch", "FIELD-2");
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE user_id=? AND org_id=?",
        )
        .run(branch2, me.user.user_id, org);
      assert.equal(
        (await call("/record-fields/students/" + student)).r.status,
        403,
      );
      assert.equal((await save(values)).r.status, 403);
      assert.equal(
        (
          await call("/custom-fields", "POST", {
            entity: "students",
            field_key: "blocked",
            label: "Blocked",
            type: "text",
          })
        ).r.status,
        403,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE user_id=? AND org_id=?",
        )
        .run(me.user.user_id, org);
      const role = (
        await call("/roles", "POST", {
          name: "Student reader",
          permissions: ["students:view"],
        })
      ).j.id;
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE user_id=? AND org_id=?",
        )
        .run(role, me.user.user_id, org);
      assert.equal(
        (await call("/record-fields/students/" + student)).r.status,
        200,
      );
      assert.equal((await save(values)).r.status, 403);
      assert.equal((await call("/custom-fields")).r.status, 403);
    },
  );
});
