import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { calendarDate, isCalendarDate } from "../src/server/dates";
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
  if (p === "/me") csrf = j.user.csrf;
  return { r, j };
}
function count(table: string) {
  return (raw.prepare("SELECT count(*) n FROM " + table).get() as any).n;
}
test("canonical date-only validation rejects rollover, partial and noncanonical inputs", () => {
  for (const s of [
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2100-02-29",
    "1900-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-01-32",
    "2026-2-01",
    "26-02-01",
    "2026-02-01T00:00:00Z",
    " 2026-02-01",
    "2026-02-01 ",
    "2026-02-01\n",
    "+002026-02-01",
    "2026-02-01[u-ca=iso8601]",
    "",
    "not a date",
  ]) {
    assert.equal(isCalendarDate(s), false, s);
    assert.equal(calendarDate.safeParse(s).success, false, s);
  }
  for (const s of [
    "2028-02-29",
    "2000-02-29",
    "2026-01-31",
    "2026-04-30",
    "2026-12-31",
  ])
    assert.equal(calendarDate.parse(s), s);
});
test("date-only validation is timezone independent and covers the Gregorian leap-year rule", () => {
  const original = process.env.TZ;
  try {
    for (const tz of [
      "Pacific/Kiritimati",
      "America/Los_Angeles",
      "Africa/Cairo",
    ]) {
      process.env.TZ = tz;
      for (let year = 1896; year <= 2104; year++) {
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        assert.equal(isCalendarDate(year + "-02-29"), leap, tz + ":" + year);
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test("academic and holiday APIs reject invalid dates before persistence or success audits", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  const branch = (await call("/branches")).j.data[0].id;
  await t.test(
    "student create/update and mixed import roll back malformed birth dates",
    async () => {
      const student = {
        name: "Fictional calendar student",
        code: "CALENDAR",
        branch_id: branch,
        birth_date: "2028-02-29",
      };
      const saved = await call("/students", "POST", student);
      assert.equal(saved.r.status, 201);
      const before = count("el_students"),
        audits = count("el_audit");
      assert.equal(
        (
          await call("/students", "POST", {
            ...student,
            code: "BAD-DAY",
            birth_date: "2026-02-30",
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call("/students/" + saved.j.id, "PUT", {
            ...student,
            birth_date: "2026-02-29",
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call("/students/import", "POST", {
            rows: [
              { ...student, code: "IMPORT-VALID" },
              { ...student, code: "IMPORT-BAD", birth_date: "2026-04-31" },
            ],
          })
        ).r.status,
        400,
      );
      assert.equal(count("el_students"), before);
      assert.equal(count("el_audit"), audits);
      assert.equal(
        (await call("/students/" + saved.j.id)).j.data.birth_date,
        "2028-02-29",
      );
    },
  );
  await t.test(
    "course windows and group dates reject rollover on both create and edit",
    async () => {
      const course = (await call("/courses")).j.data[0];
      const before = count("el_courses");
      assert.equal(
        (
          await call("/courses", "POST", {
            ...course,
            code: "BAD-CAL",
            registration_start: "2026-02-30",
            registration_end: "2026-03-05",
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call("/courses/" + course.id, "PUT", {
            ...course,
            registration_start: "2026-04-31",
          })
        ).r.status,
        400,
      );
      assert.equal(count("el_courses"), before);
      raw
        .prepare("UPDATE el_courses SET registration_start=? WHERE id=?")
        .run("2026-02-30", course.id);
      const duplicateAudits = count("el_audit");
      assert.equal(
        (
          await call("/courses/" + course.id + "/duplicate", "POST", {
            name: "Invalid date copy",
            code: "CALENDAR-COPY",
          })
        ).r.status,
        400,
      );
      assert.equal(count("el_courses"), before);
      assert.equal(count("el_audit"), duplicateAudits);
      // Existing stored values are not rewritten by this API-boundary fix.
      assert.equal(
        (
          raw
            .prepare("SELECT registration_start FROM el_courses WHERE id=?")
            .get(course.id) as any
        ).registration_start,
        "2026-02-30",
      );
      raw
        .prepare("UPDATE el_courses SET registration_start=? WHERE id=?")
        .run(course.registration_start, course.id);

      const group = (await call("/groups")).j.data[0],
        full = (await call("/groups/" + group.id)).j.data,
        groups = count("el_groups"),
        audits = count("el_audit");
      assert.equal(
        (
          await call("/groups", "POST", {
            ...full,
            code: "BAD-GROUP",
            start_date: "2026-02-30",
          })
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call("/groups/" + group.id, "PUT", {
            ...full,
            end_date: "2026-11-31",
          })
        ).r.status,
        400,
      );
      assert.equal(count("el_groups"), groups);
      assert.equal(count("el_audit"), audits);
    },
  );
  await t.test(
    "holiday API rejects impossible dates and accepts a real leap day",
    async () => {
      const before = count("el_holidays"),
        audits = count("el_audit");
      for (const day of [
        "2026-02-30",
        "2026-02-29",
        "2026-04-31",
        "2026-13-01",
      ])
        assert.equal(
          (
            await call("/scheduling/holidays", "POST", {
              branch_id: branch,
              date: day,
              name: "Fictional holiday",
            })
          ).r.status,
          400,
        );
      assert.equal(count("el_holidays"), before);
      assert.equal(count("el_audit"), audits);
      assert.equal(
        (
          await call("/scheduling/holidays", "POST", {
            branch_id: branch,
            date: "2028-02-29",
            name: "Fictional leap-day closure",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT date FROM el_holidays WHERE date=?")
            .get("2028-02-29") as any
        ).date,
        "2028-02-29",
      );
    },
  );
  await t.test(
    "existing strict financial exports retain rejection without audit success",
    async () => {
      const audits = count("el_audit");
      assert.equal(
        (
          await call("/finance/ledger-export", "POST", {
            from: "2026-02-30",
            to: "2026-03-01",
          })
        ).r.status,
        400,
      );
      assert.equal(
        (await call("/finance/ledger?from=2026-02-30&to=2026-03-01")).r.status,
        400,
      );
      assert.equal(count("el_audit"), audits);
    },
  );
});
