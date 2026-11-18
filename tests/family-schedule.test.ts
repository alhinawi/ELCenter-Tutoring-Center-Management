import { Temporal } from "@js-temporal/polyfill";
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
type Client = { cookie: string; csrf: string };
const owner = { cookie: "", csrf: "" },
  student = { cookie: "", csrf: "" },
  guardian = { cookie: "", csrf: "" },
  teacher = { cookie: "", csrf: "" },
  unlinked = { cookie: "", csrf: "" },
  foreign = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c: Client = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("family schedule date windows are complete, organization-local and currently identity scoped", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    group = (await call("/groups")).j.data[0],
    branch = group.branch_id,
    own = (await call("/groups/" + group.id + "/enrollments")).j.data[0]
      .student_id,
    other = (await call("/students")).j.data.find((r: any) => r.id !== own).id,
    roles = (await call("/roles")).j.data;
  raw
    .prepare(
      "UPDATE el_enrollments SET status='active' WHERE student_id=? AND group_id=?",
    )
    .run(own, group.id);
  async function account(key: string, c: Client, profile?: string) {
    const email = crypto.randomUUID() + "@example.invalid",
      role = roles.find((r: any) => r.system_key === key),
      r = await call("/users", "POST", {
        name: "Fictional " + key,
        email,
        password: "Testing-password-2026",
        role_id: role.id,
        branch_id: branch,
      });
    assert.equal(r.r.status, 201);
    await call(
      "/auth/login",
      "POST",
      { email, password: "Testing-password-2026" },
      c,
    );
    const user = (await call("/me", "GET", undefined, c)).j.user.user_id;
    if (profile) {
      const l = await call("/portal-links", "POST", {
        user_id: user,
        kind: key === "parent_guardian" ? "guardian" : key,
        profile_id: profile,
      });
      assert.equal(l.r.status, 201, JSON.stringify(l.j));
    }
    return { user, membership: r.j.id };
  }
  const studentAccount = await account("student", student, own);
  await account("teacher", teacher, group.teacher_id);
  await account("student", unlinked);
  const guardianId = crypto.randomUUID();
  raw
    .prepare(
      "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
    )
    .run(guardianId, org, branch, "Fictional Guardian", "01000000000");
  await call("/students/" + own + "/guardians", "POST", {
    guardian_id: guardianId,
    relationship: "parent",
  });
  await account("parent_guardian", guardian, guardianId);
  const zone = "Africa/Cairo",
    day = "2026-04-24",
    start =
      Number(
        Temporal.PlainDate.from(day).toZonedDateTime(zone).epochMilliseconds,
      ) / 1000,
    end =
      Number(
        Temporal.PlainDate.from(day).add({ days: 1 }).toZonedDateTime(zone)
          .epochMilliseconds,
      ) / 1000,
    insert = raw.prepare(
      "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'cancelled')",
    );
  function session(at: number, topic: string) {
    const id = crypto.randomUUID();
    insert.run(
      id,
      org,
      branch,
      group.id,
      group.teacher_id,
      group.classroom_id,
      at,
      at + 60,
      topic,
    );
    return id;
  }
  const first = session(start, "First local-day second"),
    last = session(end - 1, "Last local-day second");
  session(start - 1, "EXCLUDED prior day");
  session(end, "EXCLUDED next day");
  const path = `/portal/students/${own}/schedule?from=${day}&to=${day}`;
  await t.test(
    "DST day boundaries are local inclusive dates with half-open epoch start bounds",
    async () => {
      assert.equal(end - start, 23 * 3600);
      const r = await call(path, "GET", undefined, student);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.from, day);
      assert.equal(r.j.to, day);
      assert.equal(r.j.timezone, zone);
      assert.equal(r.j.total, 2);
      assert.deepEqual(
        r.j.data.map((r: any) => r.id),
        [first, last],
      );
      assert(!("notes" in r.j.data[0]));
      assert(!("teacher_id" in r.j.data[0]));
      assert.equal(r.j.data[0].status, "cancelled");
      assert.deepEqual(
        (await call(path, "GET", undefined, guardian)).j.data,
        r.j.data,
      );
      const d = await call(
        `/portal/students/${own}/schedule`,
        "GET",
        undefined,
        student,
      );
      const today = Temporal.Instant.fromEpochMilliseconds(Date.now())
        .toZonedDateTimeISO(zone)
        .toPlainDate();
      assert.equal(d.j.from, today.subtract({ days: 1 }).toString());
      assert.equal(d.j.to, today.add({ days: 120 }).toString());
    },
  );
  await t.test(
    "exact1000 complete rows,1001 rejects entirely, narrow day restores access",
    async () => {
      for (let i = 2; i < 1000; i++) session(start, "Fictional bounded " + i);
      let r = await call(path, "GET", undefined, student);
      assert.equal(r.r.status, 200);
      assert.equal(r.j.total, 1000);
      assert.equal(new Set(r.j.data.map((r: any) => r.id)).size, 1000);
      session(start, "Fictional overflow");
      r = await call(path, "GET", undefined, student);
      assert.equal(r.r.status, 409);
      assert(!r.j.data);
      r = await call(
        `/portal/students/${own}/schedule?from=2026-04-25&to=2026-04-25`,
        "GET",
        undefined,
        student,
      );
      assert.equal(r.r.status, 200);
      assert.equal(r.j.total, 1);
    },
  );
  await t.test(
    "invalid rollover dates, reversed and over370-day ranges reject rather than default",
    async () => {
      for (const from of [
        "",
        "2026-02-29",
        "2026-04-31",
        "2026-4-24",
        "2026-04-24T00:00:00Z",
        "NaN",
      ])
        assert.equal(
          (
            await call(
              `/portal/students/${own}/schedule?from=${from}&to=2026-04-25`,
              "GET",
              undefined,
              student,
            )
          ).r.status,
          400,
          from,
        );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/schedule?from=2026-04-25&to=2026-04-24`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/schedule?from=2026-01-01&to=2027-01-06`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            `/portal/students/${own}/schedule?from=2027-01-01&to=2028-01-05`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        200,
      );
    },
  );
  await t.test(
    "current enrollment status controls eligibility, no historical enrollment inference",
    async () => {
      raw
        .prepare(
          "UPDATE el_enrollments SET status='completed' WHERE student_id=? AND group_id=?",
        )
        .run(own, group.id);
      let r = await call(path, "GET", undefined, student);
      assert.equal(r.r.status, 200);
      assert.deepEqual(r.j.data, []);
      raw
        .prepare(
          "UPDATE el_enrollments SET status='active' WHERE student_id=? AND group_id=?",
        )
        .run(own, group.id);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 409);
    },
  );
  await t.test(
    "ownership/profile/relationship/branch/link changes gate every window and foreign access fails",
    async () => {
      assert.equal(
        (
          await call(
            `/portal/students/${other}/schedule`,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
      assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
      assert.equal(
        (await call(path, "GET", undefined, unlinked)).r.status,
        403,
      );
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE student_id=? AND guardian_id=?",
        )
        .run(own, guardianId);
      assert.equal(
        (await call(path, "GET", undefined, guardian)).r.status,
        404,
      );
      raw
        .prepare("UPDATE el_students SET status='suspended' WHERE id=?")
        .run(own);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw.prepare("UPDATE el_students SET status='active' WHERE id=?").run(own);
      const b = (
        await call("/branches", "POST", {
          name: "Fictional Other",
          code: "FS-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b, studentAccount.membership);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(branch, studentAccount.membership);
      raw
        .prepare("DELETE FROM el_portal_links WHERE user_id=?")
        .run(studentAccount.user);
      assert.equal((await call(path, "GET", undefined, student)).r.status, 403);
      await call("/auth/demo", "POST", {}, foreign);
      await call("/me", "GET", undefined, foreign);
      assert.equal((await call(path, "GET", undefined, foreign)).r.status, 404);
      assert.equal(
        (await call(path, "GET", undefined, { cookie: "", csrf: "" })).r.status,
        401,
      );
    },
  );
});
