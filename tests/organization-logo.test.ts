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
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF5kAAAAASUVORK5CYII=";
test("organization logo is private encrypted current-only branding with headquarters edit and member read", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "logo-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Logo Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    read = "/portal/organization-logo",
    write = "/organization/logo";
  let version = "";
  await t.test(
    "unauthenticated requests fail and invalid bytes/dimensions/size do not persist",
    async () => {
      const anon: Client = { cookie: "", csrf: "" };
      assert.equal((await call(read, "GET", undefined, anon)).r.status, 401);
      assert.equal((await call(read)).j.data, null);
      for (const body of [
        { mime: "image/svg+xml", data: png },
        { mime: "image/jpeg", data: "/9j/" },
        { mime: "image/png", data: "A".repeat(43693) },
        { mime: "image/png", data: btoa("invalid") },
      ])
        assert.equal((await call(write, "PUT", body)).r.status, 400);
      const large = Buffer.from(png, "base64");
      large.writeUInt32BE(10000, 16);
      assert.equal(
        (
          await call(write, "PUT", {
            mime: "image/png",
            data: large.toString("base64"),
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_organization_logos")
            .get() as any
        ).n,
        0,
      );
    },
  );
  await t.test(
    "encrypted current version uses no-store, separate AAD and audited replacement without byte logs",
    async () => {
      assert.equal(
        (await call(write, "PUT", { mime: "image/png", data: png })).r.status,
        200,
      );
      const r = await call(read);
      assert.equal(r.j.data.data, png);
      assert.equal(r.r.headers.get("cache-control"), "private, no-store");
      version = r.j.data.version;
      const row = raw
        .prepare("SELECT * FROM el_organization_logos WHERE org_id=?")
        .get(org) as any;
      assert.notEqual(row.ciphertext, png);
      assert(!JSON.stringify(row).includes(png));
      const audits = raw
        .prepare(
          "SELECT after_json FROM el_audit WHERE org_id=? AND entity='organization_logo'",
        )
        .all(org);
      assert(audits.length >= 2);
      assert(!JSON.stringify(audits).includes(png));
      await call(write, "PUT", { mime: "image/png", data: png });
      assert.notEqual((await call(read)).j.data.version, version);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_organization_logos WHERE org_id=?",
            )
            .get(org) as any
        ).n,
        1,
      );
      const r2 = await app.request(
        "http://localhost/api" + read,
        { headers: { cookie: owner.cookie } },
        {
          DB: db,
          ENVIRONMENT: "test",
          DOCUMENT_ENCRYPTION_KEY: "wrong-logo-key-2026-long",
        },
      );
      assert.equal(r2.status, 503);
    },
  );
  await t.test(
    "ordinary current member can read but not edit; branch editor cannot change organization-wide logo",
    async () => {
      async function account(
        permissions: string[],
        email: string,
        branch_id: string | null,
      ) {
        const role = (
            await call("/roles", "POST", { name: email, permissions })
          ).j.id,
          password = "Testing-password-2026";
        await call("/users", "POST", {
          name: "Fictional staff",
          email,
          password,
          role_id: role,
          branch_id,
        });
        await call("/auth/login", "POST", { email, password }, other);
        return (await call("/me", "GET", undefined, other)).j.user.user_id;
      }
      await account(["students:view"], "logo-viewer@example.invalid", branch);
      assert.equal(
        (await call(read, "GET", undefined, other)).j.data.data,
        png,
      );
      assert.equal(
        (await call(write, "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        403,
      );
      assert.equal((await call(write, "DELETE", {}, other)).r.status, 403);
      const user = await account(
        ["organization:view", "organization:edit"],
        "logo-branch@example.invalid",
        branch,
      );
      assert.equal(
        (await call(write, "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        403,
      );
      raw
        .prepare(
          "UPDATE el_memberships SET status='suspended' WHERE org_id=? AND user_id=?",
        )
        .run(org, user);
      assert.equal((await call(read, "GET", undefined, other)).r.status, 401);
    },
  );
  await t.test(
    "authenticated portal roles read only their organization branding even before profile linking, never profile data",
    async () => {
      const roles = (await call("/roles")).j.data;
      for (const key of ["student", "parent_guardian", "teacher"]) {
        const email = "logo-" + key + "@example.invalid",
          password = "Testing-password-2026";
        await call("/users", "POST", {
          name: "Fictional portal",
          email,
          password,
          role_id: roles.find((r: any) => r.system_key === key).id,
          branch_id: branch,
        });
        await call("/auth/login", "POST", { email, password }, other);
        await call("/me", "GET", undefined, other);
        assert.equal(
          (await call(read, "GET", undefined, other)).j.data.data,
          png,
        );
        assert.equal(
          (await call(write, "PUT", { mime: "image/png", data: png }, other)).r
            .status,
          403,
        );
      }
    },
  );
  await t.test(
    "foreign org gets its own empty store and logo removal never affects another org",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "logo-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other logo center",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal((await call(read, "GET", undefined, other)).j.data, null);
      await call(write, "PUT", { mime: "image/png", data: png }, other);
      const ownerRow = raw
        .prepare("SELECT * FROM el_organization_logos WHERE org_id=?")
        .get(org) as any;
      const foreignOrg = (await call("/me", "GET", undefined, other)).j
        .organization.id;
      raw
        .prepare(
          "UPDATE el_organization_logos SET version=?,iv=?,ciphertext=? WHERE org_id=?",
        )
        .run(ownerRow.version, ownerRow.iv, ownerRow.ciphertext, foreignOrg);
      assert.equal((await call(read, "GET", undefined, other)).r.status, 503);
      assert.equal(
        (await call(write, "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        200,
      );
      assert.equal((await call(write, "DELETE", {})).r.status, 200);
      assert.equal((await call(read)).j.data, null);
      assert.equal(
        (await call(read, "GET", undefined, other)).j.data.data,
        png,
      );
    },
  );
});
