import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  viewer: Client = { cookie: "", csrf: "" },
  foreign: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip":
          c === owner
            ? "team-owner"
            : c === viewer
              ? "team-viewer"
              : "team-foreign",
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
test("student profile print snapshots have private current fields without sensitive extras", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "profile-print-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Card Academy",
  });
  const org = (await call("/me")).j.organization.id,
    b1 = (await call("/branches")).j.data[0].id,
    b2 = (
      await call("/branches", "POST", {
        name: "Other Branch",
        code: "CARD2",
        capacity: 100,
        status: "active",
      })
    ).j.id;
  const student = (
      await call("/students", "POST", {
        name: "Fictional Card Learner",
        code: "CARD-ST",
        branch_id: b1,
        national_id: "PRIVATE-NATIONAL",
        phone: "PRIVATE-PHONE",
        notes: "PRIVATE-NOTE",
        status: "suspended",
      })
    ).j.id,
    path = "/students/" + student + "/print-profile";
  await t.test(
    "snapshot excludes sensitive profile fields, records current status and audit without bytes",
    async () => {
      const r = await call(path, "POST", {});
      assert.equal(r.r.status, 200);
      assert.equal(r.r.headers.get("cache-control"), "no-store");
      assert.equal(r.j.data.phone, "PRIVATE-PHONE");
      assert(!("qr_payload" in r.j.data));
      assert.equal(r.j.data.name, "Fictional Card Learner");
      assert.equal(r.j.data.organization_name, "Fictional Card Academy");
      assert.equal(r.j.data.status, "suspended");
      assert(!JSON.stringify(r.j).includes("PRIVATE-NATIONAL"));
      assert(!JSON.stringify(r.j).includes("PRIVATE-NOTE"));
      assert(!JSON.stringify(r.j).includes("national_id"));
      const log = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE org_id=? AND entity='student_profile_print' AND entity_id=?",
        )
        .get(org, student) as any;
      assert.equal(JSON.parse(log.after_json).student_id, student);
      assert.equal(JSON.parse(log.after_json).branch_id, b1);
      assert(!log.after_json.includes("PRIVATE-"));
      raw
        .prepare("UPDATE el_students SET name=? WHERE id=?")
        .run("Updated Card Learner", student);
      assert.equal(
        (await call(path, "POST", {})).j.data.name,
        "Updated Card Learner",
      );
    },
  );
  await t.test(
    "view+print required, current branch changes honored, CSRF required",
    async () => {
      const role = (
        await call("/roles", "POST", {
          name: "Card printer",
          permissions: ["students:view", "students:print"],
        })
      ).j.id;
      const membership = (
        await call("/users", "POST", {
          name: "Fictional Printer",
          email: "profile-print-printer@example.invalid",
          password: "Testing-password-2026",
          role_id: role,
          branch_id: b1,
        })
      ).j.id;
      await call(
        "/auth/login",
        "POST",
        {
          email: "profile-print-printer@example.invalid",
          password: "Testing-password-2026",
        },
        viewer,
      );
      await call("/me", "GET", undefined, viewer);
      assert.equal((await call(path, "POST", {}, viewer)).r.status, 200);
      let before = (
        raw
          .prepare(
            "SELECT count(*) n FROM el_audit WHERE entity='student_profile_print'",
          )
          .get() as any
      ).n;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b2, membership);
      assert.equal((await call(path, "POST", {}, viewer)).r.status, 403);
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b1, membership);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND action='print'",
        )
        .run(role);
      assert.equal((await call(path, "POST", {}, viewer)).r.status, 403);
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,'students','print')",
        )
        .run(role);
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND action='view'",
        )
        .run(role);
      assert.equal((await call(path, "POST", {}, viewer)).r.status, 403);
      const denied = await app.request(
        "http://localhost/api" + path,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: owner.cookie },
          body: "{}",
        },
        { DB: db, ENVIRONMENT: "test" },
      );
      assert.equal(denied.status, 403);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_audit WHERE entity='student_profile_print'",
            )
            .get() as any
        ).n,
        before,
      );
    },
  );
  await t.test(
    "foreign organization cannot generate a profile and audit failure returns no snapshot",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "profile-print-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Card Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.equal((await call(path, "POST", {}, foreign)).r.status, 404);
      raw.exec(
        "CREATE TRIGGER el_test_card_audit BEFORE INSERT ON el_audit WHEN NEW.entity='student_profile_print' BEGIN SELECT RAISE(ABORT,'test audit unavailable');END;",
      );
      try {
        const r = await call(path, "POST", {});
        assert.equal(r.r.status, 500);
        assert(!r.j.data);
      } finally {
        raw.exec("DROP TRIGGER el_test_card_audit");
      }
    },
  );
});
