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
test("course package enrollments and draft billing are atomic", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    student = (
      await call("/students", "POST", {
        branch_id: g.branch_id,
        name: "Package learner",
        code: "PACKAGE-STUDENT",
      })
    ).j.id;
  const course = (
      await call("/courses", "POST", {
        branch_id: g.branch_id,
        name: "Package second course",
        code: "PACKAGE-SECOND",
      })
    ).j.id,
    group = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_groups(id,org_id,branch_id,course_id,teacher_id,classroom_id,name,code,capacity,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,1,'2020-01-01','2030-12-31')",
    )
    .run(
      group,
      org,
      g.branch_id,
      course,
      g.teacher_id,
      g.classroom_id,
      "Second package group",
      "PACKAGE-G",
    );
  const def = {
    branch_id: g.branch_id,
    name: "Fictional two-course bundle",
    price: 1500,
    course_ids: [g.course_id, course],
  };
  let pack = "";
  await t.test(
    "terms are immutable, courses are valid and branch-scoped",
    async () => {
      const r = await call("/course-packages", "POST", def);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      pack = r.j.id;
      assert.equal(
        (await call("/course-packages")).j.data[0].courses.length,
        2,
      );
      assert.equal(
        (await call("/course-packages", "POST", { ...def, price: 1.5 })).r
          .status,
        400,
      );
      assert.equal(
        (
          await call("/course-packages", "POST", {
            ...def,
            course_ids: [course, course],
          })
        ).r.status,
        400,
      );
      assert.throws(() =>
        raw
          .prepare("UPDATE el_course_packages SET price=1 WHERE id=?")
          .run(pack),
      );
    },
  );
  const enroll = (id = student, number = "PKG-INV-1") =>
    call("/course-packages/" + pack + "/enroll", "POST", {
      student_id: id,
      group_ids: [g.id, group],
      invoice_number: number,
      date: "2026-11-18",
      due_date: "2026-12-01",
    });
  await t.test("all groups and one draft invoice commit once", async () => {
    const r = await enroll();
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    assert.equal(r.j.invoice_status, "draft");
    const i = raw
      .prepare("SELECT * FROM el_invoices WHERE id=?")
      .get(r.j.invoice_id) as any;
    assert.equal(i.total, 1500);
    assert.equal(i.status, "draft");
    assert.equal(
      (
        raw
          .prepare("SELECT count(*) n FROM el_enrollments WHERE student_id=?")
          .get(student) as any
      ).n,
      2,
    );
    assert.equal((await enroll()).r.status, 409);
    assert.equal(
      (
        raw
          .prepare("SELECT count(*) n FROM el_payments WHERE invoice_id=?")
          .get(i.id) as any
      ).n,
      0,
    );
  });
  await t.test(
    "a full group rolls back invoice and every earlier enrollment",
    async () => {
      const otherStudent = (
        await call("/students", "POST", {
          branch_id: g.branch_id,
          name: "Package rollback learner",
          code: "PACKAGE-ROLLBACK",
        })
      ).j.id;
      const before = (
        raw.prepare("SELECT count(*) n FROM el_invoices").get() as any
      ).n;
      assert.equal((await enroll(otherStudent, "PKG-ROLLBACK")).r.status, 409);
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_invoices").get() as any).n,
        before,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_enrollments WHERE student_id=?")
            .get(otherStudent) as any
        ).n,
        0,
      );
    },
  );
  await t.test(
    "an unmet prerequisite rolls back the whole package",
    async () => {
      raw.prepare("UPDATE el_groups SET capacity=10 WHERE id=?").run(group);
      const requirement = (
        await call("/courses", "POST", {
          branch_id: g.branch_id,
          name: "Package prerequisite",
          code: "PACKAGE-PRIOR",
        })
      ).j.id;
      assert.equal(
        (
          await call("/courses/" + course + "/prerequisites", "POST", {
            prerequisite_id: requirement,
          })
        ).r.status,
        201,
      );
      const st = (
        await call("/students", "POST", {
          branch_id: g.branch_id,
          name: "Prerequisite blocked package learner",
          code: "PACKAGE-PREREQ",
        })
      ).j.id;
      const before = (
        raw.prepare("SELECT count(*) n FROM el_invoices").get() as any
      ).n;
      assert.equal((await enroll(st, "PKG-PREREQ")).r.status, 409);
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_invoices").get() as any).n,
        before,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_enrollments WHERE student_id=?")
            .get(st) as any
        ).n,
        0,
      );
    },
  );
  await t.test(
    "archive blocks new orders, existing order history stays intact",
    async () => {
      assert.equal(
        (await call("/course-packages/" + pack, "PUT", { status: "archived" }))
          .r.status,
        200,
      );
      assert.equal((await enroll()).r.status, 404);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_course_package_orders WHERE package_id=?",
            )
            .get(pack) as any
        ).n,
        1,
      );
      assert.throws(() =>
        raw
          .prepare("DELETE FROM el_course_package_orders WHERE package_id=?")
          .run(pack),
      );
      await call("/course-packages/" + pack, "PUT", { status: "active" });
    },
  );
  await t.test(
    "foreign organizations and unauthorized roles cannot access or enroll",
    async () => {
      await call("/auth/demo", "POST", {}, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (await call("/course-packages", "GET", undefined, other)).j.data.length,
        0,
      );
      const role = (
        await call("/roles", "POST", {
          name: "Course reader",
          permissions: ["courses:view"],
        })
      ).j.id;
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE org_id=? AND user_id=?",
        )
        .run(role, org, me.user.user_id);
      assert.equal((await enroll()).r.status, 403);
      assert.equal((await call("/course-packages", "POST", def)).r.status, 403);
    },
  );
});
