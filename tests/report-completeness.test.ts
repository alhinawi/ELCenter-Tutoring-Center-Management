import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
let cookie = "",
  csrf = "";
async function call(p: string, m = "GET", b?: unknown) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrf,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) csrf = j.user.csrf;
  return { r, j };
}
const path = "/reports/overview?from=2026-11-01&to=2026-11-30";
test("operational report sections are complete at their bound or reject the entire report", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "report-bound@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Report Center",
  });
  const org = (await call("/me")).j.organization.id,
    branch = (await call("/branches")).j.data[0].id;
  await t.test(
    "exact300 rooms returned,301 rejected even when other sections fit; branch narrowing works",
    async () => {
      const insert = raw.prepare(
        "INSERT INTO el_classrooms(id,org_id,branch_id,code,name,capacity) VALUES(?,?,?,?,?,?)",
      );
      for (let i = 0; i < 300; i++)
        insert.run(
          randomUUID(),
          org,
          branch,
          "ROOM-" + i,
          "Fictional Room " + i,
          30,
        );
      const exact = await call(path);
      assert.equal(exact.r.status, 200);
      assert.equal(exact.j.rooms.length, 300);
      assert.equal(exact.j.limits.rooms, 300);
      const id = randomUUID();
      insert.run(id, org, branch, "ROOM-301", "Overflow room", 30);
      const over = await call(path);
      assert.equal(over.r.status, 400);
      assert(over.j.error.includes("rooms exceeds 300"));
      assert(!("rooms" in over.j));
      assert(!("finance" in over.j));
      const isolated = (
        await call("/branches", "POST", {
          name: "Narrow branch",
          code: "NARROW",
          capacity: 100,
          status: "active",
        })
      ).j.id;
      const narrow = await call(path + "&branch_id=" + isolated);
      assert.equal(narrow.r.status, 200);
      assert.equal(narrow.j.rooms.length, 0);
      raw.prepare("DELETE FROM el_classrooms WHERE id=?").run(id);
    },
  );
  await t.test(
    "exact100 branches complete;101 rejects rather than return misleading branch/finance totals",
    async () => {
      const current = (
        raw
          .prepare("SELECT count(*) n FROM el_branches WHERE org_id=?")
          .get(org) as any
      ).n;
      for (let i = current; i < 100; i++)
        raw
          .prepare(
            "INSERT INTO el_branches(id,org_id,name,code,address,capacity) VALUES(?,?,?,?,?,?)",
          )
          .run(randomUUID(), org, "Fictional Branch " + i, "R-" + i, "", 100);
      const exact = await call(path);
      assert.equal(exact.r.status, 200);
      assert.equal(exact.j.branches.length, 100);
      assert.equal(exact.j.finance.length, 100);
      raw
        .prepare(
          "INSERT INTO el_branches(id,org_id,name,code,address,capacity) VALUES(?,?,?,?,?,?)",
        )
        .run(randomUUID(), org, "Overflow branch", "R-OVER", "", 100);
      const over = await call(path);
      assert.equal(over.r.status, 400);
      assert(over.j.error.includes("branches exceeds 100"));
      assert(!over.j.academic);
      assert(!over.j.finance);
      const narrow = await call(path + "&branch_id=" + branch);
      assert.equal(narrow.r.status, 200);
      assert.equal(narrow.j.rooms.length, 300);
      assert.equal(narrow.j.branches.length, 1);
    },
  );
});
