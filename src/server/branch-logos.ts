import type { Hono } from "hono";
import { z } from "zod";
import { permit, scope, audit, type AppContext } from "./app";
import { assert } from "./security";
import { b64, decode, key, validateFile } from "./documents";
import { validatePhotoDimensions } from "./profile-photos";
import { uid, now } from "./db";
async function branch(c: AppContext, action = "view") {
  permit(c, "branches", action);
  const a = c.get("actor"),
    id = c.req.param("id");
  assert(id, 400, "Branch ID required");
  scope(c, id);
  const row = await c.env.DB.prepare(
    "SELECT id FROM el_branches WHERE org_id=? AND id=?",
  )
    .bind(a.org_id, id)
    .first();
  assert(row, 404, "Branch not found");
  return id;
}
export function registerBranchLogos(app: Hono<any>) {
  app.get("/api/branches/:id/logo", async (c: AppContext) => {
    const id = await branch(c);
    const a = c.get("actor"),
      row = await c.env.DB.prepare(
        "SELECT * FROM el_branch_logos WHERE org_id=? AND branch_id=?",
      )
        .bind(a.org_id, id)
        .first<Record<string, any>>();
    c.header("Cache-Control", "private, no-store");
    if (!row) return c.json({ data: null });
    let bytes: ArrayBuffer;
    try {
      bytes = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: decode(row.iv),
          additionalData: new TextEncoder().encode(
            a.org_id + ":branch-logo:" + id + ":" + row.version,
          ),
        },
        await key(c),
        decode(row.ciphertext),
      );
    } catch {
      assert(false, 503, "Secure branch logo cannot be read");
    }
    await c.env.DB.batch([
      audit(c, "branch_logo", id, "view", null, {
        version: row.version,
      }),
    ]);
    return c.json({
      data: {
        mime: row.mime,
        data: b64(new Uint8Array(bytes!)),
        version: row.version,
      },
    });
  });
  app.put("/api/branches/:id/logo", async (c: AppContext) => {
    const id = await branch(c, "edit");
    const a = c.get("actor"),
      d = z
        .object({
          mime: z.enum(["image/png", "image/jpeg"]),
          data: z.string().max(43692),
        })
        .strict()
        .parse(await c.req.json()),
      bytes = validateFile(d);
    assert(bytes.length <= 32768, 400, "Branch logo must be at most 32 KiB");
    validatePhotoDimensions(bytes, d.mime);
    const token = uid(),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      cipher = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(
            a.org_id + ":branch-logo:" + id + ":" + token,
          ),
        },
        await key(c),
        bytes,
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_branch_logos(org_id,branch_id,version,mime,byte_size,iv,ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,branch_id) DO UPDATE SET version=excluded.version,mime=excluded.mime,byte_size=excluded.byte_size,iv=excluded.iv,ciphertext=excluded.ciphertext,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
      ).bind(
        a.org_id,
        id,
        token,
        d.mime,
        bytes.length,
        b64(iv),
        b64(new Uint8Array(cipher)),
        a.user_id,
        now(),
      ),
      audit(c, "branch_logo", id, "replace", null, {
        version: token,
        bytes: bytes.length,
      }),
    ]);
    return c.json({ ok: true });
  });
  app.delete("/api/branches/:id/logo", async (c: AppContext) => {
    const id = await branch(c, "edit");
    const a = c.get("actor");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_branch_logos WHERE org_id=? AND branch_id=?",
      ).bind(a.org_id, id),
      audit(c, "branch_logo", id, "remove", null, null),
    ]);
    return c.json({ ok: true });
  });
}
