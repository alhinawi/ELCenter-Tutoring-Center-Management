import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
raw.exec(readFileSync("migrations/0001_foundation.sql", "utf8"));
const env = { DB: db, ENVIRONMENT: "test" };
type Client = { cookie: string; csrf: string; ip: string };
let ip = 0;
const client = (): Client => ({ cookie: "", csrf: "", ip: `127.0.0.${++ip}` });
async function req(
  c: Client,
  path: string,
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await app.request(
    "http://localhost/api" + path,
    {
      method,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c.ip,
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (path === "/me" && r.ok) c.csrf = j.user.csrf;
  return { r, j };
}
const owner = client(),
  other = client();
let branch = "",
  role = "",
  membership = "";
test("foundation end-to-end", async (t) => {
  await t.test("unauthenticated requests denied", async () => {
    assert.equal((await req(owner, "/branches")).r.status, 401);
  });
  await t.test(
    "real registration hashes password and sets HttpOnly session",
    async () => {
      const { r } = await req(owner, "/auth/register", "POST", {
        name: "Demo Owner",
        email: "owner@example.invalid",
        password: "Test-only-password-123",
        organization: "Fictional Academy",
      });
      assert.equal(r.status, 201);
      assert.match(r.headers.get("set-cookie") ?? "", /HttpOnly/i);
      const row = raw
        .prepare("SELECT password_hash FROM el_users")
        .get() as any;
      assert.ok(!row.password_hash.includes("Test-only-password"));
      assert.equal(
        (await req(owner, "/me")).j.organization.name,
        "Fictional Academy",
      );
    },
  );
  await t.test("all 18 roles seeded with normalized permissions", async () => {
    const { j } = await req(owner, "/roles");
    assert.equal(j.data.length, 18);
    role = j.data.find((x: any) => x.name === "Branch Manager").id;
    assert.ok(j.permissions.length > 500);
  });
  await t.test("cross origin mutation denied", async () => {
    assert.equal(
      (
        await req(
          owner,
          "/branches",
          "POST",
          {},
          { origin: "https://evil.example" },
        )
      ).r.status,
      403,
    );
  });
  await t.test("csrf required", async () => {
    assert.equal(
      (await req(owner, "/branches", "POST", {}, { "x-csrf-token": "" })).r
        .status,
      403,
    );
  });
  await t.test(
    "schema validation rejects fractional and negative capacities",
    async () => {
      for (const capacity of [-1, 0, 2.5])
        assert.equal(
          (
            await req(owner, "/branches", "POST", {
              name: "Test",
              code: "T",
              capacity,
            })
          ).r.status,
          400,
        );
    },
  );
  await t.test("create and persist branch", async () => {
    const { r, j } = await req(owner, "/branches", "POST", {
      name: "Cairo Campus",
      code: "CAI",
      capacity: 150,
      address: "Fictional address",
    });
    assert.equal(r.status, 201);
    branch = j.id;
    assert.equal((await req(owner, "/branches?q=Cairo")).j.total, 1);
  });
  await t.test("duplicate branch codes rejected", async () => {
    assert.equal(
      (
        await req(owner, "/branches", "POST", {
          name: "Duplicate",
          code: "CAI",
          capacity: 100,
        })
      ).r.status,
      409,
    );
  });
  await t.test(
    "edit persists, audit stores previous and new data",
    async () => {
      const b = (await req(owner, "/branches?q=Cairo")).j.data[0];
      assert.equal(
        (
          await req(owner, `/branches/${branch}`, "PUT", {
            ...b,
            name: "Cairo Learning Hub",
          })
        ).r.status,
        200,
      );
      const audit = (await req(owner, "/audit")).j.data.find(
        (a: any) => a.action === "update",
      );
      assert.equal(JSON.parse(audit.before_json).name, "Cairo Campus");
      assert.equal(JSON.parse(audit.after_json).name, "Cairo Learning Hub");
    },
  );
  await t.test("SQL injection remains data", async () => {
    assert.equal((await req(owner, "/branches?q='+OR+1=1--")).j.total, 0);
  });
  await t.test("create branch manager", async () => {
    const { j, r } = await req(owner, "/users", "POST", {
      name: "Branch Manager",
      email: "manager@example.invalid",
      password: "Test-only-password-123",
      role_id: role,
      branch_id: branch,
    });
    assert.equal(r.status, 201);
    membership = j.id;
  });
  const manager = client();
  await t.test("login and branch isolation", async () => {
    assert.equal(
      (
        await req(manager, "/auth/login", "POST", {
          email: "manager@example.invalid",
          password: "Test-only-password-123",
        })
      ).r.status,
      200,
    );
    await req(manager, "/me");
    const { j } = await req(manager, "/branches");
    assert.equal(j.total, 1);
    assert.equal(j.data[0].id, branch);
    assert.equal((await req(manager, "/roles")).r.status, 403);
    assert.equal((await req(manager, "/users")).r.status, 403);
    assert.equal(
      (await req(manager, "/organization", "PUT", {})).r.status,
      403,
    );
  });
  await t.test(
    "branch manager cannot create organization-wide records",
    async () => {
      assert.equal(
        (
          await req(manager, "/branches", "POST", {
            name: "Bad",
            code: "BAD",
            capacity: 100,
          })
        ).r.status,
        403,
      );
    },
  );
  await t.test("separate organization is isolated", async () => {
    assert.equal((await req(other, "/auth/demo", "POST", {})).r.status, 201);
    await req(other, "/me");
    assert.equal((await req(other, "/branches")).j.total, 3);
    assert.equal(
      (
        await req(other, `/branches/${branch}`, "PUT", {
          name: "Bad",
          code: "BAD",
          capacity: 100,
        })
      ).r.status,
      404,
    );
  });
  await t.test(
    "role changes are persisted with explicit permissions",
    async () => {
      const { j, r } = await req(owner, "/roles", "POST", {
        name: "Records Viewer",
        permissions: ["branches:view"],
      });
      assert.equal(r.status, 201);
      assert.equal(
        (
          await req(owner, `/roles/${j.id}`, "PUT", {
            name: "Branch Reader",
            permissions: ["branches:view", "audit:view"],
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await req(owner, "/roles", "POST", {
            name: "Invalid",
            permissions: ["secrets:read"],
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test("protected roles cannot be weakened", async () => {
    const roles = (await req(owner, "/roles")).j.data;
    const own = roles.find((x: any) => x.name === "Business Owner");
    assert.equal(
      (
        await req(owner, `/roles/${own.id}`, "PUT", {
          name: "Weak",
          permissions: [],
        })
      ).r.status,
      403,
    );
  });
  await t.test("suspension revokes existing sessions immediately", async () => {
    assert.equal(
      (
        await req(owner, `/users/${membership}/status`, "PATCH", {
          status: "suspended",
        })
      ).r.status,
      200,
    );
    assert.equal((await req(manager, "/me")).r.status, 401);
    assert.equal(
      (
        await req(manager, "/auth/login", "POST", {
          email: "manager@example.invalid",
          password: "Test-only-password-123",
        })
      ).r.status,
      401,
    );
  });
  await t.test(
    "passwords never enter audit data or user responses",
    async () => {
      const audit = JSON.stringify((await req(owner, "/audit")).j);
      assert.ok(!audit.includes("Test-only-password"));
      assert.ok(
        !JSON.stringify((await req(owner, "/users")).j).includes(
          "password_hash",
        ),
      );
    },
  );
  await t.test("organization settings persist", async () => {
    assert.equal(
      (
        await req(owner, "/organization", "PUT", {
          name: "Fictional Center Updated",
          currency: "EGP",
          timezone: "Africa/Cairo",
          academic_year: "2026/2027",
        })
      ).r.status,
      200,
    );
    assert.equal(
      (await req(owner, "/me")).j.organization.name,
      "Fictional Center Updated",
    );
  });
  await t.test("dashboard stats come from stored data", async () => {
    const { j } = await req(owner, "/dashboard");
    assert.equal(j.branches.length, 2);
    assert.equal(j.roles, 19);
    assert.equal(j.members, 1);
  });
  await t.test("auth rate limit enforced", async () => {
    const attacker = client();
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await req(attacker, "/auth/login", "POST", {
            email: "missing@example.invalid",
            password: "x",
          })
        ).r.status,
        401,
      );
    assert.equal(
      (
        await req(attacker, "/auth/login", "POST", {
          email: "missing@example.invalid",
          password: "x",
        })
      ).r.status,
      429,
    );
  });
  await t.test("logout invalidates session", async () => {
    assert.equal((await req(owner, "/auth/logout", "POST", {})).r.status, 200);
    assert.equal((await req(owner, "/me")).r.status, 401);
  });
});
