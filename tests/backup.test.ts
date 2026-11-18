import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sqliteDatabase } from "../scripts/sqlite";
import { initializeOrganization } from "../src/server/app";
test("isolated backup excludes other applications and restores trigger-derived records once", async () => {
  const dir = mkdtempSync(join(tmpdir(), "elcenter-backup-test-")),
    source = join(dir, "source.sqlite"),
    file = join(dir, "backup.json"),
    dest = join(dir, "restored.sqlite");
  try {
    const { raw, db } = sqliteDatabase(source);
    for (const f of readdirSync("migrations")
      .filter((f) => f.endsWith(".sql"))
      .sort())
      raw.exec(readFileSync("migrations/" + f, "utf8"));
    const x = await initializeOrganization(db, {
      name: "Fixture Owner",
      email: "backup@example.invalid",
      password: "Test-only-backup-password",
      organization: "Backup Fixture",
    });
    const br = raw
      .prepare("SELECT id,org_id FROM el_branches LIMIT 1")
      .get() as any;
    const item = randomUUID(),
      movement = randomUUID();
    raw
      .prepare(
        "INSERT INTO el_inventory_items(id,org_id,sku,name,category,created_at) VALUES(?,?,'FIXTURE','Fictional workbook','Books',1)",
      )
      .run(item, br.org_id);
    raw
      .prepare(
        "INSERT INTO el_stock_movements(id,org_id,branch_id,item_id,quantity,kind,reason,idempotency_key,created_by,created_at) VALUES(?,?,?,?,5,'adjustment','Fixture count',?,?,1)",
      )
      .run(movement, br.org_id, br.id, item, randomUUID(), x.user);
    raw.exec(
      "CREATE TABLE sherkty_private(id TEXT,private_value TEXT); INSERT INTO sherkty_private VALUES('private','DO_NOT_EXPORT');",
    );
    raw.close();
    const run = (mode: string, a: string, b: string) =>
      spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/backup.ts", mode, a, b],
        { encoding: "utf8" },
      );
    const exported = run("export", source, file);
    assert.equal(exported.status, 0, exported.stderr);
    const text = readFileSync(file, "utf8");
    assert(!text.includes("DO_NOT_EXPORT"));
    assert(!text.includes("sherkty_private"));
    assert.equal(run("export", source, file).status, 1);
    const restored = run("restore", file, dest);
    assert.equal(restored.status, 0, restored.stderr);
    const target = sqliteDatabase(dest);
    assert.equal(
      (
        target.raw
          .prepare("SELECT quantity FROM el_stock_balances WHERE item_id=?")
          .get(item) as any
      ).quantity,
      5,
    );
    assert.equal(
      (
        target.raw
          .prepare("SELECT count(*) n FROM el_stock_movements")
          .get() as any
      ).n,
      1,
    );
    assert.throws(() =>
      target.raw
        .prepare("UPDATE el_stock_movements SET quantity=9 WHERE id=?")
        .run(movement),
    );
    assert.equal(
      target.raw
        .prepare("SELECT name FROM sqlite_master WHERE name='sherkty_private'")
        .get(),
      undefined,
    );
    target.raw.close();
    writeFileSync(file, text + " ");
    const corrupt = join(dir, "corrupt.sqlite");
    assert.equal(run("restore", file, corrupt).status, 1);
    assert(!existsSync(corrupt));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
