import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  other: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip": c === owner ? "system-owner" : "system-other",
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    {
      DB: db,
      ENVIRONMENT: "test",
      DOCUMENT_ENCRYPTION_KEY: "test-only-system-document-encryption-key",
    },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("course prerequisites enforce completed enrollment without cycles", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    students = (await call("/students")).j.data,
    student = students[0].id;
  const create = async (name: string) => {
    const r = await call("/courses", "POST", {
      branch_id: g.branch_id,
      name,
      code: name.replaceAll(" ", "").slice(0, 20),
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    return r.j.id;
  };
  const a = await create("Foundation course"),
    b = await create("Intermediate course"),
    c = await create("Advanced course");
  const group = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_groups(id,org_id,branch_id,course_id,teacher_id,classroom_id,name,code,capacity,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,20,'2020-01-01','2030-12-31')",
    )
    .run(
      group,
      org,
      g.branch_id,
      c,
      g.teacher_id,
      g.classroom_id,
      "Advanced group",
      "PREREQ-G",
    );
  const link = (target: string, prior: string) =>
    call("/courses/" + target + "/prerequisites", "POST", {
      prerequisite_id: prior,
    });
  await t.test(
    "active courses can require others but cycles, duplicates and self edges fail",
    async () => {
      assert.equal((await link(b, a)).r.status, 201);
      assert.equal((await link(c, b)).r.status, 201);
      assert.equal((await link(c, a)).r.status, 201);
      assert.equal((await link(a, c)).r.status, 409);
      assert.equal((await link(a, a)).r.status, 400);
      assert.equal((await link(c, a)).r.status, 409);
      assert.equal(
        (await call("/courses/" + c + "/prerequisites")).j.data.length,
        2,
      );
    },
  );
  await t.test(
    "active and waiting enrollments need every prerequisite, including direct DB writes",
    async () => {
      for (const status of ["active", "waiting"])
        assert.equal(
          (
            await call("/groups/" + group + "/enrollments", "POST", {
              student_id: student,
              status,
            })
          ).r.status,
          409,
        );
      assert.throws(() =>
        raw
          .prepare(
            "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,'waiting')",
          )
          .run(randomUUID(), org, student, group),
      );
      for (const prior of [a, b]) {
        const id = randomUUID();
        raw
          .prepare(
            "INSERT INTO el_groups(id,org_id,branch_id,course_id,teacher_id,classroom_id,name,code,capacity,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,20,'2020-01-01','2030-12-31')",
          )
          .run(
            id,
            org,
            g.branch_id,
            prior,
            g.teacher_id,
            g.classroom_id,
            "Completed " + prior,
            "PRE-" + prior.slice(0, 8),
          );
        raw
          .prepare(
            "INSERT INTO el_enrollments(id,org_id,student_id,group_id,status) VALUES(?,?,?,?,'completed')",
          )
          .run(randomUUID(), org, student, id);
      }
      assert.equal(
        (
          await call("/groups/" + group + "/enrollments", "POST", {
            student_id: student,
          })
        ).r.status,
        201,
      );
    },
  );
  await t.test(
    "new requirements do not rewrite existing enrollments and archived requirements are visible",
    async () => {
      const d = await create("Extra requirement");
      assert.equal((await link(c, d)).r.status, 201);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT status FROM el_enrollments WHERE student_id=? AND group_id=?",
            )
            .get(student, group) as any
        ).status,
        "active",
      );
      assert.equal((await call("/courses/" + d, "DELETE", {})).r.status, 200);
      const list = (await call("/courses/" + c + "/prerequisites")).j.data;
      assert.equal(
        list.find((x: any) => x.prerequisite_id === d).status,
        "archived",
      );
      assert.equal((await link(a, d)).r.status, 409);
      assert.equal(
        (await call("/courses/" + c + "/prerequisites/" + d, "DELETE", {})).r
          .status,
        200,
      );
    },
  );
  await t.test("organization and branch boundaries hold", async () => {
    await call("/auth/demo", "POST", {}, other);
    await call("/me", "GET", undefined, other);
    assert.equal(
      (await call("/courses/" + c + "/prerequisites", "GET", undefined, other))
        .r.status,
      404,
    );
    const branch = randomUUID();
    raw
      .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
      .run(branch, org, "Other branch", "PRE-OTHER");
    raw
      .prepare(
        "UPDATE el_memberships SET branch_id=? WHERE org_id=? AND user_id=?",
      )
      .run(branch, org, me.user.user_id);
    assert.equal(
      (await call("/courses/" + c + "/prerequisites")).r.status,
      403,
    );
    assert.equal((await link(a, c)).r.status, 403);
  });
});
