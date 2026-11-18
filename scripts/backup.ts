/** Local isolated-namespace backup and restore rehearsal. Never connects to production. */
import { DatabaseSync } from "node:sqlite";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
const [mode, input, output] = process.argv.slice(2);
if (!["export", "restore"].includes(mode) || !input || !output)
  throw new Error(
    "Usage: npx tsx scripts/backup.ts export SOURCE.sqlite BACKUP.json | restore BACKUP.json NEW.sqlite",
  );
const source = resolve(input),
  destination = resolve(output);
if (source === destination || existsSync(destination))
  throw new Error(
    "Output must be a new file. Never overwrite a database or backup.",
  );
const safe = (s: string) =>
  /^el_[a-z0-9_]+$/.test(s) &&
  ![
    "el_migrations",
    "el_local_migrations",
    "el_sessions",
    "el_login_limits",
  ].includes(s);
const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
if (mode === "export") {
  const db = new DatabaseSync(source, { readOnly: true });
  db.exec("BEGIN");
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'el_*' ORDER BY name",
      )
      .all() as { name: string }[];
    const data: Record<string, { columns: string[]; rows: unknown[][] }> = {};
    for (const { name } of tables) {
      if (!safe(name)) continue;
      const columns = (
        db.prepare(`PRAGMA table_info(${quote(name)})`).all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      const rows = db
        .prepare(`SELECT * FROM ${quote(name)}`)
        .all()
        .map((r) => columns.map((c) => r[c]));
      data[name] = { columns, rows };
    }
    const body = JSON.stringify({
      format: "elcenter-isolated-backup",
      version: 1,
      created_at: new Date().toISOString(),
      namespace: "el_",
      tables: data,
    });
    writeFileSync(destination, body, { mode: 0o600, flag: "wx" });
    const checksum = createHash("sha256").update(body).digest("hex");
    writeFileSync(destination + ".sha256", checksum + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    db.exec("COMMIT");
    console.log(
      JSON.stringify({
        ok: true,
        tables: Object.keys(data).length,
        rows: Object.values(data).reduce((n, t) => n + t.rows.length, 0),
        sha256: checksum,
        private_backup: destination,
      }),
    );
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
} else {
  const body = readFileSync(source, "utf8"),
    expected = readFileSync(source + ".sha256", "utf8").trim();
  if (createHash("sha256").update(body).digest("hex") !== expected)
    throw new Error("Checksum mismatch. No database was created.");
  const backup = JSON.parse(body);
  if (
    backup.format !== "elcenter-isolated-backup" ||
    backup.version !== 1 ||
    backup.namespace !== "el_" ||
    !backup.tables ||
    typeof backup.tables !== "object"
  )
    throw new Error("Unsupported backup");
  writeFileSync(destination, "", { mode: 0o600, flag: "wx" });
  const db = new DatabaseSync(destination);
  try {
    db.exec("PRAGMA foreign_keys=ON;");
    for (const f of readdirSync("migrations")
      .filter((f) => /^\d+_[a-z0-9_]+\.sql$/.test(f))
      .sort())
      db.exec(readFileSync("migrations/" + f, "utf8"));
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[]
      ).map((t) => t.name),
    );
    const triggers = db
      .prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'")
      .all() as { name: string; sql: string }[];
    db.exec("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;");
    for (const tr of triggers) {
      if (!/^el_[a-z0-9_]+$/.test(tr.name))
        throw new Error("Unexpected trigger");
      db.exec(`DROP TRIGGER ${quote(tr.name)}`);
    }
    for (const [name, data] of Object.entries(backup.tables) as [
      string,
      { columns: string[]; rows: unknown[][] },
    ][]) {
      if (!safe(name) || !tables.has(name))
        throw new Error("Backup table does not match this release");
      const actual = (
        db.prepare(`PRAGMA table_info(${quote(name)})`).all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      if (
        !Array.isArray(data.columns) ||
        !data.columns.length ||
        data.columns.some((c) => !actual.includes(c)) ||
        new Set(data.columns).size !== data.columns.length ||
        !Array.isArray(data.rows)
      )
        throw new Error("Invalid backup columns");
      const statement = db.prepare(
        `INSERT INTO ${quote(name)}(${data.columns.map(quote).join(",")}) VALUES(${data.columns.map(() => "?").join(",")})`,
      );
      for (const row of data.rows) {
        if (
          !Array.isArray(row) ||
          row.length !== data.columns.length ||
          row.some(
            (v) => v !== null && !["string", "number"].includes(typeof v),
          )
        )
          throw new Error("Invalid row value");
        statement.run(...(row as never[]));
      }
    }
    for (const tr of triggers) db.exec(tr.sql);
    if (db.prepare("PRAGMA foreign_key_check").all().length)
      throw new Error("Foreign-key check failed");
    const check = db.prepare("PRAGMA integrity_check").get();
    if (check?.integrity_check !== "ok")
      throw new Error("Integrity check failed");
    db.exec("COMMIT");
    console.log(
      JSON.stringify({
        ok: true,
        restored_tables: Object.keys(backup.tables).length,
        new_database: destination,
        foreign_keys: "passed",
        integrity: "ok",
      }),
    );
    db.close();
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.close();
    unlinkSync(destination);
    throw e;
  }
}
