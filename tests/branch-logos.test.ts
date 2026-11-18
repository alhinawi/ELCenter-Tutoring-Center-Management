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
test("branch logos enforce current branch permissions, isolation, encryption and removal", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "branch-logo-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Branch Logo Center",
  });
  const org = (await call("/me")).j.organization.id;
  const b1 = (await call("/branches")).j.data[0].id;
  const b2 = (
    await call("/branches", "POST", {
      name: "Second fictional branch",
      code: "BL2",
      capacity: 100,
      status: "active",
    })
  ).j.id;
  const path = (id: string) => "/branches/" + id + "/logo";
  async function member(
    permissions: string[],
    branch_id: string | null,
    email: string,
  ) {
    const role = (await call("/roles", "POST", { name: email, permissions })).j
      .id;
    await call("/users", "POST", {
      name: "Fictional staff",
      email,
      password: "Testing-password-2026",
      branch_id,
      role_id: role,
    });
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      other,
    );
    return (await call("/me", "GET", undefined, other)).j.user.user_id;
  }
  await t.test(
    "no anonymous/foreign/missing branch access; signatures/dimensions/size validated",
    async () => {
      assert.equal(
        (await call(path(b1), "GET", undefined, { cookie: "", csrf: "" })).r
          .status,
        401,
      );
      assert.equal((await call(path("missing"))).r.status, 404);
      assert.equal((await call(path(b1))).j.data, null);
      for (const d of [
        { mime: "image/svg+xml", data: png },
        { mime: "image/png", data: "broken" },
        { mime: "image/png", data: "A".repeat(43693) },
      ])
        assert.equal((await call(path(b1), "PUT", d)).r.status, 400);
      const large = Buffer.from(png, "base64");
      large.writeUInt32BE(10000, 16);
      assert.equal(
        (
          await call(path(b1), "PUT", {
            mime: "image/png",
            data: large.toString("base64"),
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "one current encrypted version; no-store; image-free audits; wrong key fails",
    async () => {
      assert.equal(
        (await call(path(b1), "PUT", { mime: "image/png", data: png })).r
          .status,
        200,
      );
      const before = (await call(path(b1))).j.data.version;
      await call(path(b1), "PUT", { mime: "image/png", data: png });
      const r = await call(path(b1));
      assert.notEqual(before, r.j.data.version);
      assert.equal(r.j.data.data, png);
      assert.equal(r.r.headers.get("cache-control"), "private, no-store");
      const rows = raw
        .prepare("SELECT * FROM el_branch_logos WHERE org_id=? AND branch_id=?")
        .all(org, b1);
      assert.equal(rows.length, 1);
      assert(!JSON.stringify(rows).includes(png));
      const logs = raw
        .prepare(
          "SELECT * FROM el_audit WHERE org_id=? AND entity='branch_logo'",
        )
        .all(org);
      assert(logs.length >= 4);
      assert(!JSON.stringify(logs).includes(png));
      const denied = await app.request(
        "http://localhost/api" + path(b1),
        { headers: { cookie: owner.cookie } },
        {
          DB: db,
          ENVIRONMENT: "test",
          DOCUMENT_ENCRYPTION_KEY: "wrong-branch-logo-key-2026",
        },
      );
      assert.equal(denied.status, 503);
    },
  );
  await t.test(
    "branch-bound editor can change only own branch; view does not imply edit; revocation takes effect",
    async () => {
      await member(
        ["branches:view", "branches:edit"],
        b1,
        "bl-editor@example.invalid",
      );
      assert.equal(
        (await call(path(b1), "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        200,
      );
      assert.equal(
        (await call(path(b2), "GET", undefined, other)).r.status,
        403,
      );
      assert.equal(
        (await call(path(b2), "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        403,
      );
      assert.equal((await call(path(b2), "DELETE", {}, other)).r.status, 403);
      const user = await member(
        ["branches:view"],
        b1,
        "bl-viewer@example.invalid",
      );
      assert.equal(
        (await call(path(b1), "GET", undefined, other)).j.data.data,
        png,
      );
      assert.equal(
        (await call(path(b1), "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        403,
      );
      assert.equal((await call(path(b1), "DELETE", {}, other)).r.status, 403);
      raw
        .prepare(
          "UPDATE el_memberships SET status='suspended' WHERE org_id=? AND user_id=?",
        )
        .run(org, user);
      assert.equal(
        (await call(path(b1), "GET", undefined, other)).r.status,
        401,
      );
      await member(["students:view"], null, "bl-nobranches@example.invalid");
      assert.equal(
        (await call(path(b1), "GET", undefined, other)).r.status,
        403,
      );
    },
  );
  await t.test(
    "AAD binds branch, organization and image kind; immutable identity; explicit remove is isolated",
    async () => {
      await call(path(b2), "PUT", { mime: "image/png", data: png });
      const original = raw
        .prepare("SELECT * FROM el_branch_logos WHERE org_id=? AND branch_id=?")
        .get(org, b1) as any;
      raw
        .prepare(
          "UPDATE el_branch_logos SET version=?,iv=?,ciphertext=? WHERE org_id=? AND branch_id=?",
        )
        .run(original.version, original.iv, original.ciphertext, org, b2);
      assert.equal((await call(path(b2))).r.status, 503);
      assert.throws(() =>
        raw
          .prepare(
            "UPDATE el_branch_logos SET branch_id=? WHERE org_id=? AND branch_id=?",
          )
          .run("missing", org, b1),
      );
      await call("/organization/logo", "PUT", { mime: "image/png", data: png });
      const logo = raw
        .prepare("SELECT * FROM el_organization_logos WHERE org_id=?")
        .get(org) as any;
      raw
        .prepare(
          "UPDATE el_branch_logos SET version=?,iv=?,ciphertext=? WHERE org_id=? AND branch_id=?",
        )
        .run(logo.version, logo.iv, logo.ciphertext, org, b2);
      assert.equal((await call(path(b2))).r.status, 503);
      await call(path(b2), "PUT", { mime: "image/png", data: png });
      assert.equal((await call(path(b1), "DELETE", {})).r.status, 200);
      assert.equal((await call(path(b1))).j.data, null);
      assert.equal((await call(path(b2))).j.data.data, png);
      assert.equal((await call("/portal/organization-logo")).j.data.data, png);
    },
  );
  await t.test(
    "foreign owner and dedicated portal roles cannot access another branch branding",
    async () => {
      const roles = (await call("/roles")).j.data;
      const role = roles.find((r: any) => r.system_key === "student").id;
      await call("/users", "POST", {
        name: "Fictional portal",
        email: "bl-portal@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b1,
      });
      await call(
        "/auth/login",
        "POST",
        {
          email: "bl-portal@example.invalid",
          password: "Testing-password-2026",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call(path(b2), "GET", undefined, other)).r.status,
        403,
      );
      await call(
        "/auth/register",
        "POST",
        {
          name: "Foreign",
          email: "bl-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Other Logo Center",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call(path(b2), "GET", undefined, other)).r.status,
        404,
      );
      assert.equal(
        (await call(path(b2), "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        404,
      );
      assert.equal((await call(path(b2), "DELETE", {}, other)).r.status, 404);
    },
  );
});
