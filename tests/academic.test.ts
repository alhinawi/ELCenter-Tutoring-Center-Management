import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
const env = { DB: db, ENVIRONMENT: "test" };
let cookie = "",
  csrf = "";
async function req(p: string, m = "GET", body?: unknown) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "Content-Type": "application/json",
        cookie,
        "x-csrf-token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = r.headers.get("content-type")?.includes("application/json")
    ? await r.json()
    : await r.text();
  if (p === "/me") csrf = j.user.csrf;
  return { r, j };
}
test("academic core workflows", async (t) => {
  await req("/auth/demo", "POST", {});
  await req("/me");
  await t.test("private demo seeds linked fictional entities", async () => {
    assert.equal((await req("/demo/academic-seed", "POST", {})).r.status, 200);
    assert.equal((await req("/students")).j.total, 6);
    assert.equal((await req("/guardians")).j.total, 6);
    await req("/demo/academic-seed", "POST", {});
    assert.equal((await req("/students")).j.total, 6);
  });
  const students = (await req("/students")).j.data,
    groups = (await req("/groups")).j.data,
    group = groups[0],
    b = group.branch_id,
    options = (await req("/academic/options")).j;
  const student = students[0];
  let extra = "",
    transfer = "";
  await t.test(
    "student profile exposes guardian and preserved academic relationships",
    async () => {
      const { j } = await req("/students/" + student.id);
      assert.equal(j.guardians.length, 1);
      assert.equal(j.enrollments.length, 1);
      assert.equal(j.enrollments[0].group_name, group.name);
    },
  );
  await t.test("student create and edit persist with validation", async () => {
    const { r, j } = await req("/students", "POST", {
      name: "Test Student",
      code: "S-NEW",
      branch_id: b,
      birth_date: "2010-02-20",
      status: "new",
    });
    assert.equal(r.status, 201);
    extra = j.id;
    const row = (await req("/students/" + extra)).j.data;
    assert.equal(
      (
        await req("/students/" + extra, "PUT", {
          ...row,
          name: "Updated Student",
        })
      ).r.status,
      200,
    );
    assert.equal(
      (await req("/students/" + extra)).j.data.name,
      "Updated Student",
    );
    assert.equal(
      (
        await req("/students", "POST", {
          name: "Bad",
          code: "BAD",
          branch_id: "bad",
        })
      ).r.status,
      400,
    );
  });
  await t.test(
    "enrollment stores real student and group relation",
    async () => {
      assert.equal(
        (
          await req(`/groups/${group.id}/enrollments`, "POST", {
            student_id: extra,
          })
        ).r.status,
        201,
      );
      assert.equal(
        (await req(`/groups/${group.id}/enrollments`)).j.data.length,
        7,
      );
    },
  );
  await t.test("duplicate enrollment rejected", async () => {
    assert.equal(
      (
        await req(`/groups/${group.id}/enrollments`, "POST", {
          student_id: extra,
        })
      ).r.status,
      409,
    );
  });
  await t.test("group cannot exceed classroom capacity", async () => {
    assert.equal(
      (await req("/groups/" + group.id, "PUT", { ...group, capacity: 25 })).r
        .status,
      409,
    );
  });
  await t.test("group cannot shrink below enrollment", async () => {
    assert.equal(
      (await req("/groups/" + group.id, "PUT", { ...group, capacity: 2 })).r
        .status,
      409,
    );
  });
  await t.test(
    "capacity and waiting list are enforced by database",
    async () => {
      assert.equal(
        (await req("/groups/" + group.id, "PUT", { ...group, capacity: 7 })).r
          .status,
        200,
      );
      const s = (
        await req("/students", "POST", {
          name: "Waiting Student",
          code: "WAIT",
          branch_id: b,
        })
      ).j.id;
      assert.equal(
        (
          await req(`/groups/${group.id}/enrollments`, "POST", {
            student_id: s,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await req(`/groups/${group.id}/enrollments`, "POST", {
            student_id: s,
            status: "waiting",
          })
        ).r.status,
        201,
      );
      const e = (await req(`/groups/${group.id}/enrollments`)).j.data.find(
        (x: any) => x.student_id === s,
      );
      assert.equal(
        (await req(`/enrollments/${e.id}`, "PATCH", { status: "active" })).r
          .status,
        409,
      );
    },
  );
  await t.test("invalid dates and fractional money rejected", async () => {
    const c = (await req("/courses")).j.data[0];
    assert.equal(
      (await req("/courses/" + c.id, "PUT", { ...c, price: 19.5 })).r.status,
      400,
    );
    assert.equal(
      (
        await req("/groups/" + group.id, "PUT", {
          ...group,
          start_date: "2027-01-01",
          end_date: "2026-01-01",
        })
      ).r.status,
      400,
    );
  });
  await t.test("active group dependencies cannot be archived", async () => {
    const teacher = (await req("/teachers")).j.data[0],
      room = (await req("/classrooms")).j.data[0];
    assert.equal(
      (await req("/teachers/" + teacher.id, "DELETE", {})).r.status,
      409,
    );
    assert.equal(
      (
        await req("/classrooms/" + room.id, "PUT", {
          ...room,
          status: "maintenance",
        })
      ).r.status,
      409,
    );
  });
  await t.test(
    "atomic Excel import validates all rows before writing",
    async () => {
      const before = (await req("/students")).j.total;
      assert.equal(
        (
          await req("/students/import", "POST", {
            rows: [
              { name: "Import Good", code: "IMP1", branch_id: b },
              { name: "Invalid", code: "IMP2", branch_id: "x" },
            ],
          })
        ).r.status,
        400,
      );
      assert.equal((await req("/students")).j.total, before);
      assert.equal(
        (
          await req("/students/import", "POST", {
            rows: [
              { name: "Import One", code: "IMP1", branch_id: b },
              { name: "Import Two", code: "IMP2", branch_id: b },
            ],
          })
        ).r.status,
        201,
      );
      assert.equal((await req("/students")).j.total, before + 2);
    },
  );
  await t.test("CSV export neutralizes spreadsheet formulas", async () => {
    await req("/students", "POST", {
      name: '=HYPERLINK("evil")',
      code: "FORMULA",
      branch_id: b,
    });
    const { r, j } = await req("/students/export");
    assert.equal(r.status, 200);
    assert.ok(j.includes("'=HYPERLINK"));
    assert.ok(!j.includes("national_id"));
  });
  await t.test("course duplication creates independent record", async () => {
    const c = (await req("/courses")).j.data[0];
    const { r, j } = await req(`/courses/${c.id}/duplicate`, "POST", {
      name: "English Plus",
      code: "ENG-PLUS",
    });
    assert.equal(r.status, 201);
    assert.notEqual(j.id, c.id);
  });
  await t.test("course branch assignment records local price", async () => {
    const c = (await req("/courses")).j.data[0];
    const dest = options.branches.find((x: any) => x.id !== b).id;
    assert.equal(
      (
        await req(`/courses/${c.id}/branches`, "POST", {
          branch_id: dest,
          price: 1200,
        })
      ).r.status,
      200,
    );
    assert.equal(
      (
        raw
          .prepare(
            "SELECT price FROM el_course_branches WHERE course_id=? AND branch_id=?",
          )
          .get(c.id, dest) as any
      ).price,
      1200,
    );
  });
  await t.test("direct branch edits must use transfer workflow", async () => {
    const dest = options.branches.find((x: any) => x.id !== b).id;
    const row = (await req("/students/" + extra)).j.data;
    assert.equal(
      (await req("/students/" + extra, "PUT", { ...row, branch_id: dest })).r
        .status,
      409,
    );
    const { r, j } = await req("/transfers", "POST", {
      student_id: extra,
      to_branch: dest,
      reason: "Family moved",
    });
    assert.equal(r.status, 201);
    transfer = j.id;
    assert.equal((await req("/students/" + extra)).j.data.branch_id, b);
  });
  await t.test("approved transfer preserves academic history", async () => {
    assert.equal(
      (
        await req(`/transfers/${transfer}/decision`, "POST", {
          decision: "approved",
        })
      ).r.status,
      200,
    );
    const j = (await req("/students/" + extra)).j;
    assert.notEqual(j.data.branch_id, b);
    assert.equal(j.enrollments[0].status, "transferred");
    assert.equal(j.enrollments[0].group_id, group.id);
  });
  await t.test("a transfer cannot be approved twice", async () => {
    assert.equal(
      (
        await req(`/transfers/${transfer}/decision`, "POST", {
          decision: "approved",
        })
      ).r.status,
      409,
    );
  });
  await t.test("guardian link is auditable", async () => {
    const guardian = (await req("/guardians")).j.data[1];
    assert.equal(
      (
        await req(`/students/${extra}/guardians`, "POST", {
          guardian_id: guardian.id,
          relationship: "Mother",
        })
      ).r.status,
      200,
    );
    assert.equal((await req("/students/" + extra)).j.guardians.length, 1);
    assert.ok(
      (await req("/audit")).j.data.some(
        (x: any) => x.action === "link_guardian",
      ),
    );
  });
  await t.test("foreign organizations cannot be linked", async () => {
    const original = cookie;
    cookie = "";
    await req("/auth/demo", "POST", {});
    await req("/me");
    assert.equal((await req("/students/" + extra)).r.status, 404);
    const otherBranch = (await req("/branches")).j.data[0].id;
    assert.equal(
      (
        await req("/students", "POST", {
          name: "Cross scope",
          code: "CROSS",
          branch_id: b,
        })
      ).r.status,
      400,
    );
    cookie = original;
    await req("/me");
  });
});
