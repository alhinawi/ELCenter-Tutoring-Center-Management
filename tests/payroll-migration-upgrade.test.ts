import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
const files = readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort();
const isNew = (f: string) => f.startsWith("0036_") || f.startsWith("0037_");
for (const f of files.filter((f) => !isNew(f)))
  raw.exec(readFileSync("migrations/" + f, "utf8"));
const jar = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: jar.cookie,
        "x-csrf-token": jar.csrf,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    jar.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) jar.csrf = j.user.csrf;
  return { r, j };
}
function snapshot() {
  const out: Record<string, string> = {};
  for (const { name } of raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'el_%' ORDER BY name",
    )
    .all() as any[])
    out[name] =
      (raw.prepare(`SELECT count(*) n FROM ${name}`).get() as any).n +
      ":" +
      createHash("sha1")
        .update(JSON.stringify(raw.prepare(`SELECT * FROM ${name}`).all()))
        .digest("hex");
  return out;
}
test("posted journals survive the 0036/0037 upgrade unchanged", async () => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  const branch = (await call("/branches")).j.data[0].id;
  await call("/finance/initialize", "POST", { year: 2026 });
  const settings = (await call("/finance/settings")).j;
  const acc = (k: string) =>
    settings.accounts.find((a: any) => a.system_key === k).id;
  for (const [i, v] of [100, 40].entries()) {
    const r = await call("/finance/journals", "POST", {
      branch_id: branch,
      date: "2026-11-0" + (i + 1),
      reference: "SYN-" + i,
      memo: "Fictional synthetic journal",
      lines: [
        { account: acc("cash"), debit: v, credit: 0 },
        { account: acc("equity"), debit: 0, credit: v },
      ],
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
  }
  const posted = (
    raw
      .prepare("SELECT count(*) n FROM el_journals WHERE status='posted'")
      .get() as any
  ).n;
  assert.equal(posted, 2);
  const before = snapshot(),
    report = JSON.stringify((await call("/finance/reports")).j);
  for (const f of files.filter(isNew))
    raw.exec(readFileSync("migrations/" + f, "utf8"));
  const after = snapshot();
  for (const k of Object.keys(before)) assert.equal(after[k], before[k], k);
  assert.deepEqual(
    Object.keys(after)
      .filter((k) => !(k in before))
      .sort(),
    ["el_employee_loan_deductions", "el_staff_payroll_cancellations"],
  );
  assert.equal(JSON.stringify((await call("/finance/reports")).j), report);
  assert.equal(
    (raw.prepare("PRAGMA integrity_check").get() as any).integrity_check,
    "ok",
  );
  void me;
});
