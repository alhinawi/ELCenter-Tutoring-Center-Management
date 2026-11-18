import type { Hono } from "hono";
import { z } from "zod";
import { getCookie } from "hono/cookie";
import { audit, type AppContext } from "./app";
import { now, type Env, type Database } from "./db";
import { assert, checkPassword, digest } from "./security";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(bytes: Uint8Array) {
  let bits = 0,
    value = 0,
    out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function unbase32(text: string) {
  let bits = 0,
    value = 0;
  const out = [];
  for (const c of text.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(c);
    assert(n >= 0, 400, "Invalid authenticator setup");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
// RFC 6238, HMAC-SHA1, 30-second periods. https://www.rfc-editor.org/rfc/rfc6238
export async function totp(secret: Uint8Array, seconds: number, digits = 6) {
  const counter = new ArrayBuffer(8);
  new DataView(counter).setBigUint64(0, BigInt(Math.floor(seconds / 30)));
  const key = await crypto.subtle.importKey(
      "raw",
      secret as Uint8Array<ArrayBuffer>,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    ),
    hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter)),
    offset = hash[hash.length - 1] & 15;
  const n =
    ((hash[offset] & 127) << 24) |
    ((hash[offset + 1] & 255) << 16) |
    ((hash[offset + 2] & 255) << 8) |
    (hash[offset + 3] & 255);
  return String(n % 10 ** digits).padStart(digits, "0");
}
const b64 = (x: Uint8Array) => btoa(String.fromCharCode(...x)),
  unb64 = (x: string) => Uint8Array.from(atob(x), (c) => c.charCodeAt(0));
async function encryptionKey(env: Env) {
  assert(
    env.DOCUMENT_ENCRYPTION_KEY && env.DOCUMENT_ENCRYPTION_KEY.length >= 32,
    503,
    "Secure authenticator storage is not configured",
  );
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(env.DOCUMENT_ENCRYPTION_KEY + ":mfa"),
    ),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
async function secret(env: Env, user: string, row: Record<string, any>) {
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unb64(row.iv),
          additionalData: new TextEncoder().encode(user),
        },
        await encryptionKey(env),
        unb64(row.ciphertext),
      ),
    );
  } catch {
    assert(false, 503, "Authenticator storage is unavailable");
  }
}
function changed(result: unknown) {
  const r = result as {
    meta?: { changes?: number };
    changes?: number | bigint;
  };
  return Number(r.meta?.changes ?? r.changes ?? 0) > 0;
}
export async function verifyMfa(
  env: Env,
  user: string,
  code: string,
  seconds = now(),
) {
  const row = await env.DB.prepare(
    "SELECT * FROM el_mfa WHERE user_id=? AND enabled=1",
  )
    .bind(user)
    .first<Record<string, any>>();
  if (!row) return true;
  const rateKey = "mfa-login:" + user;
  await env.DB.prepare(
    "INSERT INTO el_login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END",
  )
    .bind(rateKey, seconds + 900, seconds, seconds, seconds + 900)
    .run();
  const attempts = await env.DB.prepare(
    "SELECT attempts FROM el_login_limits WHERE key=?",
  )
    .bind(rateKey)
    .first<{ attempts: number }>();
  if (!attempts || attempts.attempts > 10) return false;

  if (/^[a-f0-9]{32}$/.test(code)) {
    const hash = await digest(user + ":" + code);
    return changed(
      await env.DB.prepare(
        "UPDATE el_mfa_recovery SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL",
      )
        .bind(seconds, user, hash)
        .run(),
    );
  }
  if (!/^\d{6}$/.test(code)) return false;
  const bytes = await secret(env, user, row);
  for (const drift of [0, -1, 1]) {
    const at = seconds + drift * 30,
      step = Math.floor(at / 30);
    if (step > row.last_step && (await totp(bytes!, at)) === code)
      return changed(
        await env.DB.prepare(
          "UPDATE el_mfa SET last_step=? WHERE user_id=? AND enabled=1 AND last_step<?",
        )
          .bind(step, user, step)
          .run(),
      );
  }
  return false;
}
async function reauthenticate(c: AppContext, password: string) {
  const a = c.get("actor"),
    key = "mfa:" + a.user_id,
    time = now();
  await c.env.DB.prepare(
    "INSERT INTO el_login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END",
  )
    .bind(key, time + 900, time, time, time + 900)
    .run();
  const limit = await c.env.DB.prepare(
    "SELECT attempts FROM el_login_limits WHERE key=?",
  )
    .bind(key)
    .first<{ attempts: number }>();
  assert(
    limit && limit.attempts <= 8,
    429,
    "Too many security changes. Try again in 15 minutes.",
  );
  const u = await c.env.DB.prepare(
    "SELECT password_hash FROM el_users WHERE id=?",
  )
    .bind(a.user_id)
    .first<{ password_hash: string }>();
  assert(
    u && (await checkPassword(password, u.password_hash)),
    403,
    "Current password is incorrect",
  );
}
export function registerMfa(app: Hono<any>) {
  app.get("/api/security/mfa", async (c: AppContext) => {
    const row = await c.env.DB.prepare(
      "SELECT enabled FROM el_mfa WHERE user_id=?",
    )
      .bind(c.get("actor").user_id)
      .first<{ enabled: number }>();
    const remaining = await c.env.DB.prepare(
      "SELECT count(*) n FROM el_mfa_recovery WHERE user_id=? AND used_at IS NULL",
    )
      .bind(c.get("actor").user_id)
      .first<{ n: number }>();
    return c.json({
      enabled: !!row?.enabled,
      recovery_remaining: remaining?.n ?? 0,
      configured: !!c.env.DOCUMENT_ENCRYPTION_KEY,
    });
  });
  app.post("/api/security/mfa/setup", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z
        .object({ password: z.string().min(1).max(128) })
        .parse(await c.req.json());
    await reauthenticate(c, d.password);
    assert(
      !(await c.env.DB.prepare(
        "SELECT user_id FROM el_mfa WHERE user_id=? AND enabled=1",
      )
        .bind(a.user_id)
        .first()),
      409,
      "Authenticator is already enabled",
    );
    const bytes = crypto.getRandomValues(new Uint8Array(20)),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(a.user_id),
        },
        await encryptionKey(c.env),
        bytes,
      );
    await c.env.DB.prepare(
      "INSERT INTO el_mfa(user_id,ciphertext,iv,expires_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET ciphertext=excluded.ciphertext,iv=excluded.iv,expires_at=excluded.expires_at,last_step=-1 WHERE enabled=0",
    )
      .bind(a.user_id, b64(new Uint8Array(encrypted)), b64(iv), now() + 600)
      .run();
    c.header("Cache-Control", "no-store");
    return c.json({
      secret: base32(bytes),
      uri:
        "otpauth://totp/" +
        encodeURIComponent("ELCenter:" + a.email) +
        "?secret=" +
        base32(bytes) +
        "&issuer=ELCenter&algorithm=SHA1&digits=6&period=30",
      expires_in: 600,
    });
  });
  app.post("/api/security/mfa/confirm", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z
        .object({
          password: z.string().min(1).max(128),
          code: z.string().regex(/^\d{6}$/),
        })
        .parse(await c.req.json());
    await reauthenticate(c, d.password);
    const row = await c.env.DB.prepare(
      "SELECT * FROM el_mfa WHERE user_id=? AND enabled=0 AND expires_at>?",
    )
      .bind(a.user_id, now())
      .first<Record<string, any>>();
    assert(row, 409, "Restart authenticator setup");
    const bytes = await secret(c.env, a.user_id, row);
    let step = -1;
    for (const drift of [0, -1, 1])
      if ((await totp(bytes!, now() + drift * 30)) === d.code)
        step = Math.floor(now() / 30) + drift;
    assert(step >= 0, 400, "Authenticator code is invalid");
    const codes = Array.from({ length: 8 }, () =>
        Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join(""),
      ),
      hashes = await Promise.all(
        codes.map((code) => digest(a.user_id + ":" + code)),
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_mfa_enrollments(user_id,expected_ciphertext) VALUES(?,?)",
      ).bind(a.user_id, row.ciphertext),
      c.env.DB.prepare(
        "UPDATE el_mfa SET enabled=1,last_step=?,expires_at=0 WHERE user_id=? AND enabled=0",
      ).bind(step, a.user_id),
      c.env.DB.prepare("DELETE FROM el_mfa_recovery WHERE user_id=?").bind(
        a.user_id,
      ),
      ...hashes.map((hash) =>
        c.env.DB.prepare(
          "INSERT INTO el_mfa_recovery(user_id,code_hash) VALUES(?,?)",
        ).bind(a.user_id, hash),
      ),
      c.env.DB.prepare(
        "DELETE FROM el_sessions WHERE user_id=? AND id<>?",
      ).bind(a.user_id, await digest(getCookie(c, "elcenter_session")!)),
      audit(c, "user", a.user_id, "mfa_enabled", null, { recovery_count: 8 }),
    ]);
    c.header("Cache-Control", "no-store");
    return c.json({ enabled: true, recovery_codes: codes });
  });
  app.post("/api/security/mfa/disable", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z
        .object({
          password: z.string().min(1).max(128),
          code: z.string().trim().min(6).max(32),
        })
        .parse(await c.req.json());
    await reauthenticate(c, d.password);
    assert(
      await verifyMfa(c.env, a.user_id, d.code),
      403,
      "Authenticator or recovery code is invalid",
    );
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM el_mfa_recovery WHERE user_id=?").bind(
        a.user_id,
      ),
      c.env.DB.prepare("DELETE FROM el_mfa WHERE user_id=?").bind(a.user_id),
      c.env.DB.prepare("DELETE FROM el_mfa_enrollments WHERE user_id=?").bind(
        a.user_id,
      ),
      c.env.DB.prepare(
        "DELETE FROM el_sessions WHERE user_id=? AND id<>?",
      ).bind(a.user_id, await digest(getCookie(c, "elcenter_session")!)),
      audit(c, "user", a.user_id, "mfa_disabled", null, {
        other_sessions_revoked: true,
      }),
    ]);
    return c.json({ ok: true });
  });
}
