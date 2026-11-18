import type { Hono } from "hono";
import { z } from "zod";
import { permit, scope, audit, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import { portalRoles, ownedStudent, identity } from "./portal-access";
import { b64, decode, key, validateFile } from "./documents";
async function access(c: AppContext, write = false) {
  const entity = z
      .enum(["students", "teachers", "employees"])
      .parse(c.req.param("entity")),
    id = z.uuid().parse(c.req.param("id")),
    a = c.get("actor");
  if (portalRoles.includes(a.system_key)) {
    assert(!write, 403, "Profile photo changes require administration");
    if (entity === "students") await ownedStudent(c, id);
    else if (entity === "teachers") {
      const l = await identity(c);
      assert(
        l.kind === "teacher" && l.teacher_id === id,
        403,
        "Your own teacher photo only",
      );
    } else assert(false, 403, "Employee photo is private");
  } else {
    permit(c, entity === "employees" ? "hr" : entity, write ? "edit" : "view");
    const row = await c.env.DB.prepare(
      `SELECT id,branch_id FROM el_${entity} WHERE org_id=? AND id=?`,
    )
      .bind(a.org_id, id)
      .first<{ id: string; branch_id: string }>();
    assert(row, 404, "Profile not found");
    scope(c, row.branch_id);
  }
  return { entity, id, org: a.org_id, user: a.user_id };
}
export function validatePhotoDimensions(bytes: Uint8Array, mime: string) {
  let width = 0,
    height = 0;
  if (mime === "image/png") {
    assert(
      bytes.length >= 24 &&
        new TextDecoder().decode(bytes.slice(12, 16)) === "IHDR",
      400,
      "Invalid PNG dimensions",
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else {
    let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at] !== 255) break;
      const marker = bytes[at + 1];
      at += 2;
      if (marker === 217 || marker === 218) break;
      const length = (bytes[at] << 8) | bytes[at + 1];
      if (length < 2 || at + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      ) {
        height = (bytes[at + 3] << 8) | bytes[at + 4];
        width = (bytes[at + 5] << 8) | bytes[at + 6];
        break;
      }
      at += length;
    }
  }
  assert(
    width > 0 && height > 0 && width <= 512 && height <= 512,
    400,
    "Profile photos must have valid dimensions up to 512 pixels",
  );
}
export function registerProfilePhotos(app: Hono<any>) {
  for (const path of [
    "/api/profile-photos/:entity/:id",
    "/api/portal/profile-photos/:entity/:id",
  ])
    app.get(path, async (c: AppContext) => {
      const p = await access(c),
        row = await c.env.DB.prepare(
          "SELECT * FROM el_profile_photos WHERE org_id=? AND entity=? AND record_id=?",
        )
          .bind(p.org, p.entity, p.id)
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
              p.org + ":" + p.entity + ":" + p.id + ":" + row.version,
            ),
          },
          await key(c),
          decode(row.ciphertext),
        );
      } catch {
        assert(false, 503, "Secure photo cannot be read");
      }
      await c.env.DB.batch([
        audit(c, "profile_photo", p.id, "view", null, {
          entity: p.entity,
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
  app.put("/api/profile-photos/:entity/:id", async (c: AppContext) => {
    const p = await access(c, true),
      d = z
        .object({
          mime: z.enum(["image/png", "image/jpeg"]),
          data: z.string().max(43692),
        })
        .strict()
        .parse(await c.req.json()),
      bytes = validateFile(d);
    assert(bytes.length <= 32768, 400, "Profile photos must be at most 32 KiB");
    validatePhotoDimensions(bytes, d.mime);
    const token = uid(),
      iv = crypto.getRandomValues(new Uint8Array(12)),
      cipher = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: new TextEncoder().encode(
            p.org + ":" + p.entity + ":" + p.id + ":" + token,
          ),
        },
        await key(c),
        bytes,
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_profile_photos(org_id,entity,record_id,version,mime,byte_size,iv,ciphertext,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id,entity,record_id) DO UPDATE SET version=excluded.version,mime=excluded.mime,byte_size=excluded.byte_size,iv=excluded.iv,ciphertext=excluded.ciphertext,updated_by=excluded.updated_by,updated_at=excluded.updated_at",
      ).bind(
        p.org,
        p.entity,
        p.id,
        token,
        d.mime,
        bytes.length,
        b64(iv),
        b64(new Uint8Array(cipher)),
        p.user,
        now(),
      ),
      audit(c, "profile_photo", p.id, "replace", null, {
        entity: p.entity,
        version: token,
        bytes: bytes.length,
      }),
    ]);
    return c.json({ ok: true });
  });
  app.delete("/api/profile-photos/:entity/:id", async (c: AppContext) => {
    const p = await access(c, true);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_profile_photos WHERE org_id=? AND entity=? AND record_id=?",
      ).bind(p.org, p.entity, p.id),
      audit(c, "profile_photo", p.id, "remove", null, { entity: p.entity }),
    ]);
    return c.json({ ok: true });
  });
}
