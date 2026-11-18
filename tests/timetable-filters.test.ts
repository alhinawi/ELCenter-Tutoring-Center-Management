import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner: Client = { cookie: "", csrf: "" },
  viewer: Client = { cookie: "", csrf: "" },
  foreign: Client = { cookie: "", csrf: "" };
async function call(p: string, m = "GET", b?: unknown, c = owner) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
        "cf-connecting-ip":
          c === owner
            ? "team-owner"
            : c === viewer
              ? "team-viewer"
              : "team-foreign",
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
test("timetable filters use recorded session resources with current scoped choices", async (t) => {
  await call("/auth/register", "POST", {
    name: "Fictional Owner",
    email: "timetable-filter-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Timetable Academy",
  });
  const org = (await call("/me")).j.organization.id,
    b = (await call("/branches")).j.data[0].id;
  async function make(entity: string, code: string, extra: any = {}) {
    const r = await call("/" + entity, "POST", {
      name: "Fictional " + code,
      code,
      branch_id: b,
      ...extra,
    });
    assert.equal(r.r.status, 201, JSON.stringify(r.j));
    return r.j.id;
  }
  const teacher = await make("teachers", "FILTER-T1"),
    replacement = await make("teachers", "FILTER-T2"),
    room = await make("classrooms", "FILTER-R1", { capacity: 20 }),
    replacementRoom = await make("classrooms", "FILTER-R2", { capacity: 20 }),
    course = await make("courses", "FILTER-C1"),
    group = await make("groups", "FILTER-G1", {
      teacher_id: teacher,
      course_id: course,
      classroom_id: room,
      capacity: 20,
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    });
  const start = 1800000000,
    base = "/sessions?from=" + start + "&to=" + (start + 3600);
  const insert = raw.prepare(
    "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status) VALUES(?,?,?,?,?,?,?,?,?,'cancelled')",
  );
  const id1 = crypto.randomUUID(),
    id2 = crypto.randomUUID();
  insert.run(
    id1,
    org,
    b,
    group,
    teacher,
    room,
    start,
    start + 60,
    "Original resources",
  );
  insert.run(
    id2,
    org,
    b,
    group,
    replacement,
    replacementRoom,
    start + 120,
    start + 180,
    "Replacement resources",
  );
  await t.test(
    "actual replacement teacher and room, combined intersection and interval semantics",
    async () => {
      for (const [suffix, ids] of [
        ["", [id1, id2]],
        ["&teacher=" + teacher, [id1]],
        ["&teacher=" + replacement, [id2]],
        ["&classroom=" + room, [id1]],
        ["&classroom=" + replacementRoom, [id2]],
        [
          "&group=" +
            group +
            "&teacher=" +
            replacement +
            "&classroom=" +
            replacementRoom,
          [id2],
        ],
        ["&teacher=" + replacement + "&classroom=" + room, []],
        ["&teacher=&classroom=", [id1, id2]],
      ] as [string, string[]][]) {
        const r = await call(base + suffix);
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.deepEqual(
          r.j.data.map((r: any) => r.id),
          ids,
        );
      }
      const overlap = await call(
        "/sessions?from=" +
          (start + 30) +
          "&to=" +
          (start + 45) +
          "&teacher=" +
          teacher,
      );
      assert.equal(overlap.j.data[0].id, id1);
      assert.deepEqual(
        (
          await call(
            "/sessions?from=" +
              (start + 60) +
              "&to=" +
              (start + 120) +
              "&teacher=" +
              teacher,
          )
        ).j.data,
        [],
      );
      const choices = (await call("/scheduling/filter-options")).j;
      assert(choices.teachers.some((r: any) => r.id === replacement));
      assert(choices.classrooms.some((r: any) => r.id === replacementRoom));
      assert.deepEqual(Object.keys(choices.teachers[0]).sort(), ["id", "name"]);
    },
  );
  await t.test(
    "strict identifiers and current existence checked even on empty windows",
    async () => {
      for (const key of ["teacher", "classroom"]) {
        assert.equal((await call(base + "&" + key + "=invalid")).r.status, 400);
        assert.equal(
          (
            await call(
              "/sessions?from=100&to=200&" + key + "=" + crypto.randomUUID(),
            )
          ).r.status,
          404,
        );
      }
    },
  );
  const other = (
    await call("/branches", "POST", {
      name: "Fictional Other Branch",
      code: "FB2",
      capacity: 50,
      status: "active",
    })
  ).j.id;
  const role = (
      await call("/roles", "POST", {
        name: "Session-only viewer",
        permissions: ["sessions:view"],
      })
    ).j.id,
    membership = (
      await call("/users", "POST", {
        name: "Fictional Viewer",
        email: "timetable-filter-viewer@example.invalid",
        password: "Testing-password-2026",
        role_id: role,
        branch_id: b,
      })
    ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "timetable-filter-viewer@example.invalid",
      password: "Testing-password-2026",
    },
    viewer,
  );
  await call("/me", "GET", undefined, viewer);
  const externalTeacher = await make("teachers", "FILTER-EXTERNAL", {
      branch_id: other,
    }),
    externalRoom = await make("classrooms", "FILTER-EXTERNAL-ROOM", {
      branch_id: other,
      capacity: 20,
    });
  await t.test(
    "session-only viewer gets minimal filter choices, extra branch and historic session teachers",
    async () => {
      const extra = await make("teachers", "FILTER-EXTRA", {
        branch_id: other,
      });
      raw
        .prepare(
          "INSERT INTO el_teacher_branches(org_id,teacher_id,branch_id) VALUES(?,?,?)",
        )
        .run(org, extra, b);
      // A transfer must not hide the teacher of an existing branch session.
      raw
        .prepare("UPDATE el_teachers SET branch_id=? WHERE id=?")
        .run(other, replacement);
      raw
        .prepare(
          "DELETE FROM el_teacher_branches WHERE teacher_id=? AND branch_id=?",
        )
        .run(replacement, b);
      let r = await call(
        "/scheduling/filter-options",
        "GET",
        undefined,
        viewer,
      );
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      for (const id of [teacher, replacement])
        assert(r.j.teachers.some((r: any) => r.id === id));
      assert(
        !r.j.teachers.some((r: any) => r.id === extra),
        "session-only permission cannot list an unscheduled teacher",
      );
      assert(!r.j.teachers.some((r: any) => r.id === externalTeacher));
      assert(!r.j.classrooms.some((r: any) => r.id === externalRoom));
      assert.equal(
        (await call(base + "&teacher=" + replacement, "GET", undefined, viewer))
          .j.data[0].id,
        id2,
      );
      assert.equal(
        (
          await call(
            base + "&teacher=" + externalTeacher,
            "GET",
            undefined,
            viewer,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(
            base + "&classroom=" + externalRoom,
            "GET",
            undefined,
            viewer,
          )
        ).r.status,
        403,
      );
      assert.equal(
        (await call(base + "&teacher=" + extra, "GET", undefined, viewer)).r
          .status,
        200,
      );
      raw
        .prepare(
          "DELETE FROM el_teacher_branches WHERE teacher_id=? AND branch_id=?",
        )
        .run(extra, b);
      assert.equal(
        (await call(base + "&teacher=" + extra, "GET", undefined, viewer)).r
          .status,
        404,
      );
    },
  );
  await t.test(
    "explicit branch constrains filters even at headquarters; mismatched existing resources do not leak sessions",
    async () => {
      assert.equal(
        (await call(base + "&branch=" + b + "&teacher=" + externalTeacher)).r
          .status,
        404,
      );
      assert.equal(
        (await call(base + "&branch=" + b + "&classroom=" + externalRoom)).r
          .status,
        400,
      );
      assert.equal(
        (await call(base + "&branch=" + other + "&teacher=" + replacement)).j
          .data.length,
        0,
      );
      assert.equal(
        (await call(base + "&branch=" + b + "&teacher=" + replacement)).j.data
          .length,
        1,
      );
    },
  );
  await t.test(
    "membership transfer and permission revocation apply without a new login",
    async () => {
      raw
        .prepare("UPDATE el_memberships SET branch_id=? WHERE id=?")
        .run(other, membership);
      let r = await call(
        "/scheduling/filter-options",
        "GET",
        undefined,
        viewer,
      );
      assert(!r.j.teachers.some((r: any) => r.id === teacher));
      assert.equal(
        (await call(base + "&teacher=" + teacher, "GET", undefined, viewer)).r
          .status,
        404,
      );
      assert.equal(
        (await call(base + "&classroom=" + room, "GET", undefined, viewer)).r
          .status,
        403,
      );
      raw
        .prepare(
          "DELETE FROM el_role_permissions WHERE role_id=? AND resource='sessions' AND action='view'",
        )
        .run(role);
      assert.equal(
        (await call("/scheduling/filter-options", "GET", undefined, viewer)).r
          .status,
        403,
      );
      assert.equal((await call(base, "GET", undefined, viewer)).r.status, 403);
    },
  );
  await t.test(
    "foreign organization and unauthenticated access fail closed",
    async () => {
      await call(
        "/auth/register",
        "POST",
        {
          name: "Fictional Other Owner",
          email: "timetable-filter-foreign@example.invalid",
          password: "Testing-password-2026",
          organization: "Fictional Other Academy",
        },
        foreign,
      );
      await call("/me", "GET", undefined, foreign);
      assert.deepEqual(
        (await call("/scheduling/filter-options", "GET", undefined, foreign)).j,
        { teachers: [], classrooms: [], groups: [] },
      );
      for (const suffix of ["&teacher=" + teacher, "&classroom=" + room])
        assert.equal(
          (await call(base + suffix, "GET", undefined, foreign)).r.status,
          404,
        );
      assert.equal(
        (
          await call("/scheduling/filter-options", "GET", undefined, {
            cookie: "",
            csrf: "",
          })
        ).r.status,
        401,
      );
    },
  );
  await t.test(
    "filter choices return all 1000 or reject 1001 rather than silently hiding choices",
    async () => {
      const count = (
        raw
          .prepare("SELECT count(*) n FROM el_teachers WHERE org_id=?")
          .get(org) as any
      ).n;
      const ins = raw.prepare(
        "INSERT INTO el_teachers(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
      );
      for (let i = count; i < 1000; i++)
        ins.run(crypto.randomUUID(), org, b, "Fictional cap " + i, "CAP-" + i);
      let r = await call("/scheduling/filter-options");
      assert.equal(r.r.status, 200);
      assert.equal(r.j.teachers.length, 1000);
      ins.run(
        crypto.randomUUID(),
        org,
        b,
        "Fictional overflow",
        "CAP-OVERFLOW",
      );
      r = await call("/scheduling/filter-options");
      assert.equal(r.r.status, 409);
      assert(!r.j.teachers);
      assert.equal((await call(base + "&teacher=" + teacher)).r.status, 200);
    },
  );
  await t.test(
    "classroom and group option lists also reject their own 1001st record",
    async () => {
      raw
        .prepare(
          "DELETE FROM el_teacher_branches WHERE teacher_id IN (SELECT id FROM el_teachers WHERE org_id=? AND code='CAP-OVERFLOW')",
        )
        .run(org);
      raw
        .prepare(
          "DELETE FROM el_teachers WHERE org_id=? AND code='CAP-OVERFLOW'",
        )
        .run(org);
      const roomCount = (
        raw
          .prepare("SELECT count(*) n FROM el_classrooms WHERE org_id=?")
          .get(org) as any
      ).n;
      const roomInsert = raw.prepare(
        "INSERT INTO el_classrooms(id,org_id,branch_id,name,code,capacity) VALUES(?,?,?,?,?,20)",
      );
      for (let i = roomCount; i < 1000; i++)
        roomInsert.run(
          crypto.randomUUID(),
          org,
          b,
          "Fictional Room Cap " + i,
          "RC-" + i,
        );
      assert.equal(
        (await call("/scheduling/filter-options")).j.classrooms.length,
        1000,
      );
      roomInsert.run(
        crypto.randomUUID(),
        org,
        b,
        "Fictional Room Overflow",
        "RC-OVERFLOW",
      );
      assert.equal((await call("/scheduling/filter-options")).r.status, 409);
      raw
        .prepare(
          "DELETE FROM el_classrooms WHERE org_id=? AND code LIKE 'RC-%'",
        )
        .run(org);
      const groupInsert = raw.prepare(
        "INSERT INTO el_groups(id,org_id,branch_id,name,code,teacher_id,classroom_id,course_id,capacity,start_date,end_date) VALUES(?,?,?,?,?,?,?,?,20,'2026-01-01','2026-12-31')",
      );
      for (let i = 1; i < 1000; i++)
        groupInsert.run(
          crypto.randomUUID(),
          org,
          b,
          "Fictional Group Cap " + i,
          "GC-" + i,
          teacher,
          room,
          course,
        );
      assert.equal(
        (await call("/scheduling/filter-options")).j.groups.length,
        1000,
      );
      groupInsert.run(
        crypto.randomUUID(),
        org,
        b,
        "Fictional Group Overflow",
        "GC-OVERFLOW",
        teacher,
        room,
        course,
      );
      assert.equal((await call("/scheduling/filter-options")).r.status, 409);
    },
  );
});
