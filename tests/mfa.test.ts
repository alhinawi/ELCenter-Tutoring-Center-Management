import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { totp, unbase32, base32, verifyMfa } from "../src/server/mfa";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
const env = {
  DB: db,
  ENVIRONMENT: "test",
  DOCUMENT_ENCRYPTION_KEY: "test-only-mfa-encryption-key-2026",
};
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  fresh: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c === owner ? "mfa-owner" : "mfa-new",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    env,
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("RFC 6238 SHA1 reference vectors, including timestamps beyond 2038", async () => {
  const seed = new TextEncoder().encode("12345678901234567890");
  for (const [t, expected] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ] as [number, string][])
    assert.equal(await totp(seed, t, 8), expected);
  assert.deepEqual(unbase32(base32(seed)), seed);
});
test("MFA enrollment, encryption, one-time login and recovery are enforced", async (t) => {
  const password = "Test-only-mfa-password-2026",
    email = "mfa-owner@example.invalid";
  await call("/auth/register", "POST", {
    name: "MFA Owner",
    organization: "MFA Fixture",
    email,
    password,
  });
  const me = (await call("/me")).j,
    user = me.user.user_id;
  assert.equal((await call("/security/mfa")).j.enabled, false);
  assert.equal(
    (await call("/security/mfa/setup", "POST", { password: "wrong" })).r.status,
    403,
  );
  const setup = await call("/security/mfa/setup", "POST", { password });
  assert.equal(setup.r.status, 200, JSON.stringify(setup.j));
  assert(setup.j.uri.startsWith("otpauth://totp/"));
  const row = raw
    .prepare("SELECT * FROM el_mfa WHERE user_id=?")
    .get(user) as any;
  assert(!row.ciphertext.includes(setup.j.secret));
  const code = await totp(
    unbase32(setup.j.secret),
    Math.floor(Date.now() / 1000),
  );
  const confirmed = await call("/security/mfa/confirm", "POST", {
    password,
    code,
  });
  assert.equal(confirmed.r.status, 200, JSON.stringify(confirmed.j));
  assert.equal(confirmed.j.recovery_codes.length, 8);
  assert.equal((await call("/security/mfa")).j.enabled, true);
  assert.equal(
    (await call("/security/mfa/setup", "POST", { password })).r.status,
    409,
  );
  assert.equal(
    (await call("/security/mfa/confirm", "POST", { password, code })).r.status,
    409,
  );
  const login = { email, password };
  assert.equal((await call("/auth/login", "POST", login, fresh)).r.status, 401);
  assert.equal(
    (await call("/auth/login", "POST", { ...login, otp: code }, fresh)).r
      .status,
    401,
  );
  const futureCode = await totp(
    unbase32(setup.j.secret),
    Math.floor(Date.now() / 1000) + 30,
  );
  assert.equal(
    (await call("/auth/login", "POST", { ...login, otp: futureCode }, fresh)).r
      .status,
    200,
  );
  assert.equal(
    (await call("/auth/login", "POST", { ...login, otp: futureCode }, fresh)).r
      .status,
    401,
  );
  const recovery = confirmed.j.recovery_codes[0];
  assert.equal(
    (await call("/auth/login", "POST", { ...login, otp: recovery }, fresh)).r
      .status,
    200,
  );
  assert.equal(
    (await call("/auth/login", "POST", { ...login, otp: recovery }, fresh)).r
      .status,
    401,
  );
  assert.equal((await call("/security/mfa")).j.recovery_remaining, 7);
  assert.equal(
    (
      await call("/security/mfa/disable", "POST", {
        password,
        code: confirmed.j.recovery_codes[1],
      })
    ).r.status,
    200,
  );
  assert.equal((await call("/security/mfa")).j.enabled, false);
  assert.equal((await call("/me", "GET", undefined, fresh)).r.status, 401);
  assert.equal((await call("/auth/login", "POST", login, fresh)).r.status, 200);
});
