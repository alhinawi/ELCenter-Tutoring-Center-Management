import { serve } from "@hono/node-server";
import { readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";
import app from "../src/server/app";
import { sqliteDatabase } from "./sqlite";
mkdirSync(".local", { recursive: true });
const { raw, db } = sqliteDatabase(
  process.env.ELCENTER_PREVIEW_DB ?? ".local/preview.sqlite",
);
raw.exec(
  "CREATE TABLE IF NOT EXISTS el_local_migrations(name TEXT PRIMARY KEY)",
);
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  if (
    !raw.prepare("SELECT name FROM el_local_migrations WHERE name=?").get(f)
  ) {
    raw.exec(readFileSync(`migrations/${f}`, "utf8"));
    raw.prepare("INSERT INTO el_local_migrations(name) VALUES(?)").run(f);
  }
const root = resolve("out");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
serve({
  port: 3000,
  hostname: "0.0.0.0",
  fetch: async (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/api/"))
      return app.fetch(req, {
        DB: db,
        ENVIRONMENT: "test",
        DOCUMENT_ENCRYPTION_KEY: process.env.DOCUMENT_ENCRYPTION_KEY,
      });
    let p = resolve(root, "." + decodeURIComponent(u.pathname));
    if (!p.startsWith(root + "/") && p !== root)
      return new Response("", { status: 403 });
    try {
      if (statSync(p).isDirectory()) p += "/index.html";
      return new Response(readFileSync(p), {
        headers: {
          "Content-Type": types[extname(p)] ?? "application/octet-stream",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
});
console.log("ELCenter production preview on :3000");
