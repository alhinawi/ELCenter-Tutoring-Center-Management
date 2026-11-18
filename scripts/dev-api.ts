import { serve } from "@hono/node-server";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "./sqlite";
mkdirSync(".local", { recursive: true });
const { raw, db } = sqliteDatabase(".local/elcenter.sqlite");
raw.exec(
  "CREATE TABLE IF NOT EXISTS el_local_migrations(name TEXT PRIMARY KEY)",
);
for (const file of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort()) {
  if (
    !raw.prepare("SELECT name FROM el_local_migrations WHERE name=?").get(file)
  ) {
    raw.exec(readFileSync(`migrations/${file}`, "utf8"));
    raw.prepare("INSERT INTO el_local_migrations(name) VALUES(?)").run(file);
  }
}
serve({
  port: 8788,
  hostname: "0.0.0.0",
  fetch: (req) => app.fetch(req, { DB: db, ENVIRONMENT: "test" }),
});
console.log("ELCenter API listening on 8788");
