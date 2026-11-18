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
test("organization profiles persist, validate and honor isolation", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "profile-owner@example.invalid",
    password: "Test-only-password-2026",
    organization: "Legal Center Name",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  const profile = {
    display_name: "Display Academy",
    tagline: "Learn together",
    contact_email: "contact@example.invalid",
    contact_phone: "01000000000",
    address: "Fictional campus",
    website: "https://example.invalid",
    default_language: "ar",
    financial_year_start_month: 9,
  };
  await t.test(
    "profile is saved with an audit and display identity reaches authenticated UI",
    async () => {
      assert.equal(
        (await call("/organization/profile")).j.data.financial_year_start_month,
        1,
      );
      assert.equal(
        (await call("/organization/profile", "PUT", profile)).r.status,
        200,
      );
      const actual = (await call("/organization/profile")).j.data;
      for (const k of Object.keys(profile))
        assert.equal(actual[k], profile[k as keyof typeof profile]);
      assert.equal(
        (await call("/me")).j.organization.name,
        "Legal Center Name",
      );
      assert.equal(
        (await call("/me")).j.organization.display_name,
        "Display Academy",
      );
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_audit WHERE org_id=? AND action='profile_settings'",
            )
            .get(org) as any
        ).n,
        1,
      );
    },
  );
  await t.test(
    "unsafe websites, invalid month and language fail without partial changes",
    async () => {
      for (const bad of [
        { website: "javascript:alert(1)" },
        { website: "http://example.invalid" },
        { website: "https://user:pass@example.invalid" },
        { financial_year_start_month: 0 },
        { financial_year_start_month: 13 },
        { financial_year_start_month: 2.5 },
        { default_language: "de" },
        { contact_email: "bad" },
      ])
        assert.equal(
          (await call("/organization/profile", "PUT", { ...profile, ...bad })).r
            .status,
          400,
        );
      assert.equal(
        (await call("/organization/profile")).j.data.website,
        profile.website,
      );
    },
  );
  await t.test(
    "other organizations and branch users cannot change this profile",
    async () => {
      await call("/auth/demo", "POST", {}, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/organization/profile", "GET", undefined, other)).j.data
          .display_name,
        "",
      );
      assert.equal(
        (
          await call(
            "/organization/profile",
            "PUT",
            { ...profile, display_name: "Other org" },
            other,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (await call("/organization/profile")).j.data.display_name,
        profile.display_name,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
        )
        .run(branch, org, me.user.user_id);
      assert.equal(
        (await call("/organization/profile", "PUT", profile)).r.status,
        403,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE org_id=? AND user_id=?",
        )
        .run(org, me.user.user_id);
      const role = (
        await call("/roles", "POST", {
          name: "Profile reader",
          permissions: ["organization:view"],
        })
      ).j.id;
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(role, org, me.user.user_id);
      assert.equal((await call("/organization/profile")).r.status, 200);
      assert.equal(
        (await call("/organization/profile", "PUT", profile)).r.status,
        403,
      );
    },
  );
});
