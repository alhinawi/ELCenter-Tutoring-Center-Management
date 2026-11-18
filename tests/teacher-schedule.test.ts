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
test("teacher timetable windows bind actual assigned teacher and current membership scope", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    group = (await call("/groups")).j.data[0],
    branch = group.branch_id,
    roles = (await call("/roles")).j.data;
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
  const replacement = (
      await call("/teachers", "POST", {
        name: "Fictional Replacement",
        code: "TW-REPLACE",
        branch_id: branch,
      })
    ).j.id,
    teacherAccount = await account("teacher", teacher, replacement);
  await account("teacher", unlinked);
  const own = (await call("/students")).j.data[0].id;
  await account("student", student, own);
  const date = "2026-04-24",
    start =
      Number(
        Temporal.PlainDate.from(date).toZonedDateTime("Africa/Cairo")
          .epochMilliseconds,
      ) / 1000,
    end =
      Number(
        Temporal.PlainDate.from(date)
          .add({ days: 1 })
          .toZonedDateTime("Africa/Cairo").epochMilliseconds,
      ) / 1000,
    insert = raw.prepare(
      "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'cancelled')",
    );
  function session(
    at: number,
    teacherId = replacement,
    topic = "Fictional Replacement Session",
  ) {
    const id = crypto.randomUUID();
    insert.run(
      id,
      org,
      branch,
      group.id,
      teacherId,
      group.classroom_id,
      at,
      at + 60,
      topic,
    );
    return id;
  }
  const first = session(start),
    last = session(end - 1);
  session(start, group.teacher_id, "EXCLUDED default-teacher session");
  session(start - 1, replacement, "EXCLUDED prior day");
  session(end, replacement, "Next day replacement");
  const path = `/portal/teacher/schedule?from=${date}&to=${date}`;
  await t.test(
    "actual replacement assignment not group default, DST endpoints and status labels",
    async () => {
      const r = await call(path, "GET", undefined, teacher);
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert.equal(r.j.total, 2);
      assert.deepEqual(
        r.j.data.map((r: any) => r.id),
        [first, last],
      );
      assert.equal(r.j.data[0].teacher_name, "Fictional Replacement");
      assert.equal(r.j.data[0].status, "cancelled");
      assert(!("notes" in r.j.data[0]));
      assert(!("teacher_id" in r.j.data[0]));
      assert.equal(end - start, 23 * 3600);
      const d = await call(
          "/portal/teacher/schedule",
          "GET",
          undefined,
          teacher,
        ),
        today = Temporal.Instant.fromEpochMilliseconds(Date.now())
          .toZonedDateTimeISO("Africa/Cairo")
          .toPlainDate();
      assert.equal(d.j.from, today.subtract({ days: 7 }).toString());
      assert.equal(d.j.to, today.add({ days: 90 }).toString());
    },
  );
  await t.test(
    "1000 complete,1001 rejects all, narrower date returns usable results",
    async () => {
      for (let i = 2; i < 1000; i++) session(start);
      let r = await call(path, "GET", undefined, teacher);
      assert.equal(r.j.total, 1000);
      assert.equal(new Set(r.j.data.map((r: any) => r.id)).size, 1000);
      session(start);
      r = await call(path, "GET", undefined, teacher);
      assert.equal(r.r.status, 409);
      assert(!r.j.data);
      r = await call(
        "/portal/teacher/schedule?from=2026-04-25&to=2026-04-25",
        "GET",
        undefined,
        teacher,
      );
      assert.equal(r.r.status, 200);
      assert.equal(r.j.total, 1);
    },
  );
  await t.test(
    "strict local dates, reversed/oversized ranges reject",
    async () => {
      for (const from of [
        "",
        "2026-02-29",
        "2026-04-31",
        "2026-4-24",
        "2026-04-24T00:00:00Z",
      ])
        assert.equal(
          (
            await call(
              `/portal/teacher/schedule?from=${from}&to=2026-04-25`,
              "GET",
              undefined,
              teacher,
            )
          ).r.status,
          400,
        );
      assert.equal(
        (
          await call(
            "/portal/teacher/schedule?from=2026-04-25&to=2026-04-24",
            "GET",
            undefined,
            teacher,
          )
        ).r.status,
        400,
      );
      assert.equal(
        (
          await call(
            "/portal/teacher/schedule?from=2026-01-01&to=2027-01-06",
            "GET",
            undefined,
            teacher,
          )
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "no teacher identity from query IDs; student/backoffice/unlinked users cannot become this teacher",
    async () => {
      assert.equal(
        (
          await call(
            path + "&teacher_id=" + replacement,
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
      assert.equal((await call(path, "GET", undefined, owner)).r.status, 403);
      assert.equal(
        (await call(path, "GET", undefined, unlinked)).r.status,
        403,
      );
      assert.equal(
        (await call(path, "GET", undefined, { cookie: "", csrf: "" })).r.status,
        401,
      );
    },
  );
  await t.test(
    "profile suspend, changed branch and deleted link revoke live sessions",
    async () => {
      raw
        .prepare("UPDATE el_teachers SET status='inactive' WHERE id=?")
        .run(replacement);
      assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
      raw
        .prepare("UPDATE el_teachers SET status='active' WHERE id=?")
        .run(replacement);
      const b = (
        await call("/branches", "POST", {
          name: "Fictional Other",
          code: "TS-OTHER",
          capacity: 20,
          status: "active",
        })
      ).j.id;
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(b, teacherAccount.membership);
      assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
      raw
        .prepare("UPDATE el_teachers SET branch_id=? WHERE id=?")
        .run(b, replacement);
      const r = await call(path, "GET", undefined, teacher);
      assert.equal(r.r.status, 200);
      assert.deepEqual(r.j.data, []);
      raw
        .prepare("DELETE FROM el_portal_links WHERE user_id=?")
        .run(teacherAccount.user);
      assert.equal((await call(path, "GET", undefined, teacher)).r.status, 403);
    },
  );
});
