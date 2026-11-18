import { packageEnrollmentDay } from "../src/server/course-packages";
import { Temporal } from "@js-temporal/polyfill";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
let database = db;
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
      DB: database,
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
test("seasonal package windows are optional immutable inclusive organization-local enrollment dates", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    branch = g.branch_id;
  const course = (
    await call("/courses", "POST", {
      branch_id: branch,
      name: "Fictional seasonal second",
      code: "SEASON-C2",
    })
  ).j.id;
  const group = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_groups(id,org_id,branch_id,course_id,teacher_id,classroom_id,name,code,capacity,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,20,'2020-01-01','2030-12-31')",
    )
    .run(
      group,
      org,
      branch,
      course,
      g.teacher_id,
      g.classroom_id,
      "Fictional seasonal group",
      "SEASON-G2",
    );
  const student = (
    await call("/students", "POST", {
      name: "Fictional seasonal learner",
      code: "SEASON-ST",
      branch_id: branch,
    })
  ).j.id;
  const zone = (
      raw
        .prepare("SELECT timezone FROM el_organizations WHERE id=?")
        .get(org) as any
    ).timezone,
    today = packageEnrollmentDay(zone),
    local = Temporal.PlainDate.from(today),
    yesterday = local.subtract({ days: 1 }).toString(),
    tomorrow = local.add({ days: 1 }).toString();
  const def = {
    branch_id: branch,
    name: "Fictional seasonal package",
    price: 100,
    course_ids: [g.course_id, course],
  };
  const order = (pack: string, change = {}) =>
    call("/course-packages/" + pack + "/enroll", "POST", {
      student_id: student,
      group_ids: [g.id, group],
      invoice_number: "SEASON-" + randomUUID(),
      date: today,
      due_date: today,
      ...change,
    });
  let future = "",
    expired = "",
    boundary = "";
  await t.test(
    "organization-local day calculation handles midnight and daylight changes",
    () => {
      assert.equal(
        packageEnrollmentDay(
          "Africa/Cairo",
          Date.parse("2026-11-18T22:30:00Z"),
        ),
        "2026-11-19",
      );
      assert.equal(
        packageEnrollmentDay(
          "America/Los_Angeles",
          Date.parse("2026-11-18T22:30:00Z"),
        ),
        "2026-11-18",
      );
      assert.equal(
        packageEnrollmentDay(
          "Africa/Cairo",
          Date.parse("2026-04-23T22:30:00Z"),
        ),
        "2026-04-24",
      );
    },
  );
  await t.test(
    "blank defaults remain unbounded; invalid/nonexistent/backwards date terms reject",
    async () => {
      const r = await call("/course-packages", "POST", def);
      assert.equal(r.r.status, 201);
      const row = (await call("/course-packages")).j.data.find(
        (p: any) => p.id === r.j.id,
      );
      assert.equal(row.enrollment_opens_on, null);
      assert.equal(row.enrollment_closes_on, null);
      assert.equal(row.enrollment_window_open, true);
      for (const change of [
        { enrollment_opens_on: "2026-02-30" },
        { enrollment_closes_on: "not-date" },
        { enrollment_opens_on: tomorrow, enrollment_closes_on: today },
        { enrollment_opens_on: "" },
      ])
        assert.equal(
          (await call("/course-packages", "POST", { ...def, ...change })).r
            .status,
          400,
        );
      future = (
        await call("/course-packages", "POST", {
          ...def,
          enrollment_opens_on: tomorrow,
        })
      ).j.id;
      expired = (
        await call("/course-packages", "POST", {
          ...def,
          enrollment_closes_on: yesterday,
        })
      ).j.id;
      boundary = (
        await call("/course-packages", "POST", {
          ...def,
          enrollment_opens_on: today,
          enrollment_closes_on: today,
        })
      ).j.id;
      assert.throws(
        () =>
          raw
            .prepare(
              "UPDATE el_course_packages SET enrollment_closes_on=? WHERE id=?",
            )
            .run(tomorrow, boundary),
        /immutable/,
      );
    },
  );
  await t.test(
    "closed/future windows reject even forged clock fields or backdated invoices, without draft/enrollment changes",
    async () => {
      const invoices = (
          raw.prepare("SELECT count(*) n FROM el_invoices").get() as any
        ).n,
        enrollments = (
          raw.prepare("SELECT count(*) n FROM el_enrollments").get() as any
        ).n;
      assert.equal(
        (
          await order(future, {
            enrolled_on: tomorrow,
            date: tomorrow,
            due_date: tomorrow,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await order(expired, {
            enrolled_on: yesterday,
            date: yesterday,
            due_date: yesterday,
          })
        ).r.status,
        409,
      );
      await call("/course-packages/" + expired, "PUT", { status: "archived" });
      await call("/course-packages/" + expired, "PUT", { status: "active" });
      assert.equal((await order(expired)).r.status, 409);
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_invoices").get() as any).n,
        invoices,
      );
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_enrollments").get() as any).n,
        enrollments,
      );
      const listed = (await call("/course-packages")).j;
      assert.equal(listed.enrollment_day, today);
      assert.equal(listed.enrollment_timezone, zone);
      assert.equal(
        listed.data.find((p: any) => p.id === future).enrollment_window_open,
        false,
      );
      assert.equal(
        listed.data.find((p: any) => p.id === boundary).enrollment_window_open,
        true,
      );
    },
  );
  await t.test(
    "transaction rechecks captured timezone and rolls back a concurrent timezone change",
    async () => {
      const invoices = (
        raw.prepare("SELECT count(*) n FROM el_invoices").get() as any
      ).n;
      database = {
        prepare: db.prepare.bind(db),
        batch: async (st) => {
          raw
            .prepare(
              "UPDATE el_organizations SET timezone='Pacific/Honolulu' WHERE id=?",
            )
            .run(org);
          return db.batch(st);
        },
      };
      try {
        assert.equal((await order(boundary)).r.status, 409);
      } finally {
        database = db;
        raw
          .prepare("UPDATE el_organizations SET timezone=? WHERE id=?")
          .run(zone, org);
      }
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_invoices").get() as any).n,
        invoices,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_enrollments WHERE student_id=?")
            .get(student) as any
        ).n,
        0,
      );
    },
  );
  await t.test(
    "inclusive same-day enrollment commits a snapshot without changing the invoice date meaning",
    async () => {
      const r = await order(boundary, { date: yesterday, due_date: today });
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      const saved = raw
          .prepare("SELECT * FROM el_course_package_orders WHERE id=?")
          .get(r.j.id) as any,
        summary = JSON.parse(saved.summary_json);
      assert.equal(summary.enrolled_on, today);
      assert.equal(summary.enrollment_timezone, zone);
      assert.equal(summary.enrollment_opens_on, today);
      assert.equal(summary.enrollment_closes_on, today);
      assert.equal(
        (
          raw
            .prepare("SELECT date FROM el_invoices WHERE id=?")
            .get(r.j.invoice_id) as any
        ).date,
        yesterday,
      );
      await call("/course-packages/" + boundary, "PUT", { status: "archived" });
      assert.equal(
        (
          raw
            .prepare(
              "SELECT summary_json FROM el_course_package_orders WHERE id=?",
            )
            .get(r.j.id) as any
        ).summary_json,
        saved.summary_json,
      );
    },
  );
});
