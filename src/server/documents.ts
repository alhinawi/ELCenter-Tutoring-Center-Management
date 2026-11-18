import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import {
  identity,
  ownedStudent,
  groupAccess,
  portalRoles,
} from "./portal-access";
import { ticketAccess } from "./support";
import { date } from "./finance";
const MAX = 131072;
const kind = z.enum([
  "student",
  "teacher",
  "employee",
  "group",
  "ticket",
  "organization",
  "finance",
]);
const schema = z.object({
  branch_id: z.uuid(),
  target_kind: kind,
  target_id: z.uuid(),
  title: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  shared_portal: z.boolean().default(false),
  expires_on: z.union([date, z.literal("")]).default(""),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[^/\\\u0000-\u001f]+$/),
  mime: z.enum(["application/pdf", "image/png", "image/jpeg"]),
  data: z.string().max(174768),
});
function b64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function decode(s: string) {
  assert(/^[A-Za-z0-9+/]*={0,2}$/.test(s), 400, "Invalid file encoding");
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    assert(false, 400, "Invalid file encoding");
  }
}
async function key(c: AppContext) {
  const secret = c.env.DOCUMENT_ENCRYPTION_KEY;
  assert(
    secret && secret.length >= 32,
    503,
    "Secure document storage is not configured",
  );
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
function validateFile(d: { mime: string; data: string }) {
  const bytes = decode(d.data)!;
  assert(
    bytes.length > 0 && bytes.length <= MAX,
    400,
    "Files must be 1–128 KiB",
  );
  const magic =
    d.mime === "application/pdf"
      ? new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
      : d.mime === "image/png"
        ? bytes.length >= 8 &&
          bytes
            .slice(0, 8)
            .every((b, i) => b === [137, 80, 78, 71, 13, 10, 26, 10][i])
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  assert(magic, 400, "File signature does not match its type");
  return bytes;
}
async function target(
  c: AppContext,
  d: { target_kind: string; target_id: string; branch_id: string },
  write = false,
) {
  const a = c.get("actor");
  scope(c, d.branch_id);
  if (d.target_kind === "group") {
    const g = await groupAccess(c, d.target_id, write);
    assert(
      g.branch_id === d.branch_id,
      400,
      "Document branch must match target",
    );
    return;
  }
  if (d.target_kind === "ticket") {
    const t = await ticketAccess(c, d.target_id);
    assert(
      t.ticket.branch_id === d.branch_id,
      400,
      "Document branch must match target",
    );
    return;
  }
  if (portalRoles.includes(a.system_key)) {
    assert(!write, 403, "Document uploads require a class or support ticket");
    if (d.target_kind === "student") {
      const s = await ownedStudent(c, d.target_id);
      assert(s.branch_id === d.branch_id, 403, "Student branch mismatch");
      return;
    }
    const link = await identity(c);
    assert(
      d.target_kind === "teacher" &&
        link.kind === "teacher" &&
        link.teacher_id === d.target_id,
      403,
      "This document is private",
    );
    return;
  }
  const table = {
    student: "students",
    teacher: "teachers",
    employee: "employees",
    finance: "invoices",
    organization: "organizations",
  }[d.target_kind];
  assert(table, 400, "Unsupported document target");
  if (d.target_kind === "organization") {
    assert(d.target_id === a.org_id, 400, "Organization target mismatch");
    return;
  }
  const row = await c.env.DB.prepare(
    `SELECT branch_id FROM el_${table} WHERE id=? AND org_id=?`,
  )
    .bind(d.target_id, a.org_id)
    .first<{ branch_id: string }>();
  assert(
    row && row.branch_id === d.branch_id,
    400,
    "Document target or branch unavailable",
  );
}
async function access(c: AppContext, id: string, write = false) {
  const a = c.get("actor"),
    doc = await c.env.DB.prepare(
      "SELECT * FROM el_documents WHERE id=? AND org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
  assert(doc, 404, "Document not found");
  scope(c, doc.branch_id);
  if (portalRoles.includes(a.system_key)) {
    if (write)
      assert(
        doc.created_by === a.user_id,
        403,
        "Only your own attachment can receive a new version",
      );
    else
      assert(
        doc.shared_portal || doc.created_by === a.user_id,
        403,
        "This document has not been shared with your portal",
      );
    assert(doc.status === "active", 404, "Document is archived");
  } else if (doc.target_kind === "ticket") {
    await ticketAccess(c, doc.target_id, write);
  } else permit(c, "documents", write ? "edit" : "view");
  await target(c, doc as any, write);
  return doc;
}
async function version(
  c: AppContext,
  docId: string,
  d: { filename: string; mime: string; data: string },
  number: number,
) {
  const bytes = validateFile(d),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    aad = new TextEncoder().encode(
      c.get("actor").org_id + ":" + docId + ":" + number,
    ),
    encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await key(c),
        bytes,
      ),
    );
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return {
    id: uid(),
    iv: b64(iv),
    ciphertext: b64(encrypted),
    hash,
    size: bytes.length,
  };
}
export function registerDocuments(app: Hono<any>) {
  for (const prefix of ["/api/documents", "/api/portal/documents"]) {
    app.get(prefix, async (c: AppContext) => {
      const a = c.get("actor"),
        portal = prefix.includes("/portal/");
      const k = kind.optional().parse(c.req.query("target_kind")),
        id = c.req.query("target_id");
      if (portal) await identity(c);
      else if (k === "ticket" && id) await ticketAccess(c, id);
      else permit(c, "documents");
      if (portal) assert(k && id, 400, "Choose a linked document target");
      let sql =
          "SELECT d.id,d.branch_id,d.target_kind,d.target_id,d.title,d.category,d.shared_portal,d.expires_on,d.status,d.created_at,(SELECT max(version) FROM el_document_versions v WHERE v.document_id=d.id) version FROM el_documents d WHERE d.org_id=? AND (? IS NULL OR d.branch_id=?)",
        args: unknown[] = [a.org_id, a.branch_id, a.branch_id];
      if (k && id) {
        sql += " AND d.target_kind=? AND d.target_id=?";
        args.push(k, z.uuid().parse(id));
      }
      if (portal)
        ((sql +=
          " AND d.status='active' AND (d.shared_portal=1 OR d.created_by=?)"),
          args.push(a.user_id));
      const search = (c.req.query("q") ?? "").trim().slice(0, 100),
        expiry = c.req.query("expires_before");
      if (search) {
        sql += " AND instr(lower(d.title||' '||d.category),lower(?))>0";
        args.push(search);
      }
      if (expiry) {
        sql += " AND d.expires_on<>'' AND d.expires_on<=?";
        args.push(date.parse(expiry));
      }
      sql += " ORDER BY d.created_at DESC,d.id LIMIT 100";
      const rows = (
        await c.env.DB.prepare(sql)
          .bind(...args)
          .all<Record<string, any>>()
      ).results;
      if (portal) {
        if (rows.length) await target(c, rows[0] as any);
        else if (k === "student") await ownedStudent(c, id!);
        else if (k === "group") await groupAccess(c, id!);
        else if (k === "ticket") await ticketAccess(c, id!);
        else {
          const link = await identity(c);
          assert(
            k === "teacher" && link.teacher_id === id,
            403,
            "This document target is private",
          );
        }
      }
      return c.json({
        data: rows,
        max_bytes: MAX,
        types: ["application/pdf", "image/png", "image/jpeg"],
      });
    });
    app.post(prefix, async (c: AppContext) => {
      const a = c.get("actor"),
        d = schema.parse(await c.req.json());
      if (!portalRoles.includes(a.system_key)) {
        if (d.target_kind === "ticket")
          await ticketAccess(c, d.target_id, true);
        else permit(c, "documents", "create");
      } else
        assert(
          ["group", "ticket"].includes(d.target_kind),
          403,
          "Upload only to a class or your own support ticket",
        );
      await target(c, d, true);
      if (portalRoles.includes(a.system_key))
        assert(
          !d.shared_portal || a.system_key === "teacher",
          403,
          "Only teachers may share class documents",
        );
      const n =
        (
          await c.env.DB.prepare(
            "SELECT count(*) n FROM el_documents WHERE org_id=?",
          )
            .bind(a.org_id)
            .first<{ n: number }>()
        )?.n ?? 0;
      assert(
        n < 1000,
        409,
        "Free document store is limited to 1000 documents per organization",
      );
      const id = uid(),
        v = await version(c, id, d, 1);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO el_documents(id,org_id,branch_id,target_kind,target_id,title,category,shared_portal,expires_on,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id,
          a.org_id,
          d.branch_id,
          d.target_kind,
          d.target_id,
          d.title,
          d.category,
          d.shared_portal ? 1 : 0,
          d.expires_on,
          a.user_id,
          now(),
        ),
        c.env.DB.prepare(
          "INSERT INTO el_document_versions(id,org_id,document_id,version,filename,mime,byte_size,sha256,iv,ciphertext,created_by,created_at) VALUES(?,?,?,1,?,?,?,?,?,?,?,?)",
        ).bind(
          v.id,
          a.org_id,
          id,
          d.filename,
          d.mime,
          v.size,
          v.hash,
          v.iv,
          v.ciphertext,
          a.user_id,
          now(),
        ),
        audit(c, "document", id, "upload", null, {
          title: d.title,
          mime: d.mime,
          bytes: v.size,
        }),
      ]);
      return c.json({ id, version: 1 }, 201);
    });
    app.get(prefix + "/:id", async (c: AppContext) => {
      const doc = await access(c, c.req.param("id")!),
        versions = (
          await c.env.DB.prepare(
            "SELECT id,version,filename,mime,byte_size,sha256,created_at FROM el_document_versions WHERE org_id=? AND document_id=? ORDER BY version DESC LIMIT 20",
          )
            .bind(doc.org_id, doc.id)
            .all()
        ).results;
      const a = c.get("actor"),
        portal = portalRoles.includes(a.system_key);
      return c.json({
        data: doc,
        versions,
        can_version: portal
          ? doc.created_by === a.user_id
          : doc.target_kind === "ticket"
            ? a.permissions.includes("support:edit")
            : a.permissions.includes("documents:edit"),
      });
    });
    app.post(prefix + "/:id/versions", async (c: AppContext) => {
      const doc = await access(c, c.req.param("id")!, true),
        a = c.get("actor"),
        d = schema
          .pick({ filename: true, mime: true, data: true })
          .parse(await c.req.json()),
        n =
          (await c.env.DB.prepare(
            "SELECT max(version) n FROM el_document_versions WHERE document_id=?",
          )
            .bind(doc.id)
            .first<{ n: number }>())!.n + 1;
      assert(n <= 20, 409, "A document supports at most 20 retained versions");
      const v = await version(c, doc.id, d, n);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO el_document_versions(id,org_id,document_id,version,filename,mime,byte_size,sha256,iv,ciphertext,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          v.id,
          a.org_id,
          doc.id,
          n,
          d.filename,
          d.mime,
          v.size,
          v.hash,
          v.iv,
          v.ciphertext,
          a.user_id,
          now(),
        ),
        audit(c, "document", doc.id, "new_version", null, {
          version: n,
          bytes: v.size,
        }),
      ]);
      return c.json({ id: v.id, version: n }, 201);
    });
    app.get(prefix + "/:id/download/:version", async (c: AppContext) => {
      const doc = await access(c, c.req.param("id")!),
        num = z.coerce
          .number()
          .int()
          .min(1)
          .max(20)
          .parse(c.req.param("version")),
        v = await c.env.DB.prepare(
          "SELECT * FROM el_document_versions WHERE org_id=? AND document_id=? AND version=?",
        )
          .bind(doc.org_id, doc.id, num)
          .first<Record<string, any>>();
      assert(v, 404, "Document version not found");
      let bytes: ArrayBuffer;
      try {
        bytes = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(v.iv),
            additionalData: new TextEncoder().encode(
              doc.org_id + ":" + doc.id + ":" + num,
            ),
          },
          await key(c),
          decode(v.ciphertext)!,
        );
      } catch (e) {
        assert(
          false,
          503,
          "Document decryption is unavailable; check the storage key",
        );
      }
      await audit(c, "document", doc.id, "download", null, {
        version: num,
      }).run();
      c.header("Cache-Control", "private, no-store");
      c.header("Content-Type", v.mime);
      c.header(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" + encodeURIComponent(v.filename),
      );
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(bytes!);
    });
  }
  app.put("/api/documents/:id", async (c: AppContext) => {
    const doc = await access(c, c.req.param("id")!, true),
      d = z
        .object({
          title: z.string().trim().min(1).max(160),
          category: z.string().trim().min(1).max(100),
          shared_portal: z.boolean(),
          expires_on: z.union([date, z.literal("")]),
          status: z.enum(["active", "archived"]),
        })
        .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_documents SET title=?,category=?,shared_portal=?,expires_on=?,status=? WHERE id=?",
      ).bind(
        d.title,
        d.category,
        d.shared_portal ? 1 : 0,
        d.expires_on,
        d.status,
        doc.id,
      ),
      audit(c, "document", doc.id, "metadata", doc, d),
    ]);
    return c.json({ ok: true });
  });
}
