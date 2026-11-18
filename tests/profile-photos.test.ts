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
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF5kAAAAASUVORK5CYII=";
test("private profile photos encrypt, scope and revoke access without sharing URLs", async (t) => {
  await call("/auth/register", "POST", {
    name: "Owner",
    email: "photo-owner@example.invalid",
    password: "Testing-password-2026",
    organization: "Fictional Photo Academy",
  });
  const me = (await call("/me")).j,
    org = me.organization.id,
    branch = (await call("/branches")).j.data[0].id,
    student = (
      await call("/students", "POST", {
        name: "Fictional Photo Learner",
        code: "PHOTO-S",
        branch_id: branch,
      })
    ).j.id,
    path = "/profile-photos/students/" + student;
  await t.test(
    "absent photo has no invented image; invalid format, size and dimensions fail",
    async () => {
      assert.equal((await call(path)).j.data, null);
      for (const body of [
        { mime: "image/svg+xml", data: png },
        { mime: "image/png", data: btoa("not PNG") },
        { mime: "image/jpeg", data: "/9j/" },
        { mime: "image/png", data: "A".repeat(43693) },
      ])
        assert.equal((await call(path, "PUT", body)).r.status, 400);
      const large = Buffer.from(png, "base64");
      large.writeUInt32BE(99999, 16);
      assert.equal(
        (
          await call(path, "PUT", {
            mime: "image/png",
            data: large.toString("base64"),
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test(
    "encrypted bytes round-trip only through current permission checks, replacement changes version",
    async () => {
      assert.equal(
        (await call(path, "PUT", { mime: "image/png", data: png })).r.status,
        200,
      );
      let result = await call(path);
      assert.equal(result.r.headers.get("cache-control"), "private, no-store");
      assert.equal(result.j.data.data, png);
      const row = raw
        .prepare(
          "SELECT * FROM el_profile_photos WHERE org_id=? AND record_id=?",
        )
        .get(org, student) as any;
      assert.notEqual(row.ciphertext, png);
      assert(!JSON.stringify(row).includes(png));
      await call(path, "PUT", { mime: "image/png", data: png });
      assert.notEqual((await call(path)).j.data.version, result.j.data.version);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_profile_photos WHERE org_id=?")
            .get(org) as any
        ).n,
        1,
      );
    },
  );
  await t.test(
    "linked student reads only own photo, cannot write and unlink immediately revokes",
    async () => {
      const role = (await call("/roles")).j.data.find(
          (r: any) => r.system_key === "student",
        ).id,
        email = "photo-student@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Learner",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      const id = (await call("/me", "GET", undefined, other)).j.user.user_id;
      await call("/portal-links", "POST", {
        user_id: id,
        kind: "student",
        profile_id: student,
      });
      assert.equal(
        (
          await call(
            path.replace("/profile-photos/", "/portal/profile-photos/"),
            "GET",
            undefined,
            other,
          )
        ).j.data.data,
        png,
      );
      assert.equal(
        (await call(path, "PUT", { mime: "image/png", data: png }, other)).r
          .status,
        403,
      );
      const another = (
        await call("/students", "POST", {
          name: "Other learner",
          code: "PHOTO-OTHER",
          branch_id: branch,
        })
      ).j.id;
      assert.equal(
        (
          await call(
            "/portal/profile-photos/students/" + another,
            "GET",
            undefined,
            other,
          )
        ).r.status,
        404,
      );
      raw
        .prepare("DELETE FROM el_portal_links WHERE org_id=? AND user_id=?")
        .run(org, id);
      assert.equal(
        (
          await call(
            path.replace("/profile-photos/", "/portal/profile-photos/"),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "guardian family relationship and teacher identity are rechecked; academic rights do not grant HR photos",
    async () => {
      const guardian = randomUUID(),
        teacher = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_guardians(id,org_id,branch_id,name,phone) VALUES(?,?,?,?,?)",
        )
        .run(guardian, org, branch, "Fictional guardian", "01000000000");
      raw
        .prepare(
          "INSERT INTO el_teachers(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
        )
        .run(teacher, org, branch, "Fictional teacher", "PHOTO-T");
      await call("/profile-photos/teachers/" + teacher, "PUT", {
        mime: "image/png",
        data: png,
      });
      const roles = (await call("/roles")).j.data;
      async function login(key: string, profile: string, kind: string) {
        const email = "photo-" + randomUUID() + "@example.invalid",
          password = "Testing-password-2026";
        const created = await call("/users", "POST", {
          name: "Fictional profile",
          email,
          password,
          role_id: roles.find((r: any) => r.system_key === key).id,
          branch_id: branch,
        });
        assert.equal(created.r.status, 201, JSON.stringify(created.j));
        await call("/auth/login", "POST", { email, password }, other);
        const id = (await call("/me", "GET", undefined, other)).j.user.user_id;
        assert.equal(
          (
            await call("/portal-links", "POST", {
              user_id: id,
              kind,
              profile_id: profile,
            })
          ).r.status,
          201,
        );
      }
      await login("parent_guardian", guardian, "guardian");
      const pp = path.replace("/profile-photos/", "/portal/profile-photos/");
      assert.equal((await call(pp, "GET", undefined, other)).r.status, 404);
      await call("/students/" + student + "/guardians", "POST", {
        guardian_id: guardian,
        relationship: "parent",
      });
      assert.equal((await call(pp, "GET", undefined, other)).j.data.data, png);
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE org_id=? AND guardian_id=?",
        )
        .run(org, guardian);
      assert.equal((await call(pp, "GET", undefined, other)).r.status, 404);
      await login("teacher", teacher, "teacher");
      assert.equal(
        (
          await call(
            "/portal/profile-photos/teachers/" + teacher,
            "GET",
            undefined,
            other,
          )
        ).j.data.data,
        png,
      );
      assert.equal((await call(pp, "GET", undefined, other)).r.status, 403);
      assert.equal(
        (
          await call(
            "/portal/profile-photos/employees/" + randomUUID(),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        403,
      );
      raw
        .prepare("UPDATE el_teachers SET status='inactive' WHERE id=?")
        .run(teacher);
      assert.equal(
        (
          await call(
            "/portal/profile-photos/teachers/" + teacher,
            "GET",
            undefined,
            other,
          )
        ).r.status,
        403,
      );
      raw
        .prepare("DELETE FROM el_portal_links WHERE org_id=? AND teacher_id=?")
        .run(org, teacher);
      raw
        .prepare("DELETE FROM el_teacher_branches WHERE teacher_id=?")
        .run(teacher);
      raw.prepare("DELETE FROM el_teachers WHERE id=?").run(teacher);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_profile_photos WHERE entity='teachers'",
            )
            .get() as any
        ).n,
        0,
      );
      const role = (
        await call("/roles", "POST", {
          name: "Academic photo only",
          permissions: ["students:view", "students:edit", "teachers:view"],
        })
      ).j.id;
      const email = "photo-nohr@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Academic photo",
        email,
        password,
        role_id: role,
        branch_id: branch,
      });
      await call("/auth/login", "POST", { email, password }, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (
          await call(
            "/profile-photos/employees/" + randomUUID(),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        403,
      );
      assert.equal((await call(pp, "GET", undefined, other)).j.data.data, png);
    },
  );
  await t.test(
    "current branch scope and organization isolation are not taken from the photo row",
    async () => {
      const branch2 = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch2, org, "Other campus", "PHOTO-B2");
      const role = (
          await call("/roles", "POST", {
            name: "Scoped photo user",
            permissions: ["students:view", "students:edit"],
          })
        ).j.id,
        email = "photo-scoped@example.invalid",
        password = "Testing-password-2026";
      await call("/users", "POST", {
        name: "Scoped",
        email,
        password,
        role_id: role,
        branch_id: branch2,
      });
      await call("/auth/login", "POST", { email, password }, other);
      await call("/me", "GET", undefined, other);
      assert.equal(
        (
          await call(
            path.replace("/profile-photos/", "/portal/profile-photos/"),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        403,
      );
      assert.equal((await call(path, "DELETE", {}, other)).r.status, 403);
      await call(
        "/auth/register",
        "POST",
        {
          name: "Other",
          email: "photo-foreign@example.invalid",
          password,
          organization: "Other photo center",
        },
        other,
      );
      await call("/me", "GET", undefined, other);
      assert.equal(
        (
          await call(
            path.replace("/profile-photos/", "/portal/profile-photos/"),
            "GET",
            undefined,
            other,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "wrong decryption key fails closed; remove is explicit and employee uses HR instead of academic rights",
    async () => {
      const r = await app.request(
        "http://localhost/api" + path,
        { headers: { cookie: owner.cookie } },
        {
          DB: db,
          ENVIRONMENT: "test",
          DOCUMENT_ENCRYPTION_KEY: "wrong-photo-document-key-2026-long",
        },
      );
      assert.equal(r.status, 503);
      const employeeResult = await call("/operations/employees", "POST", {
        name: "Employee",
        job_title: "Fictional coordinator",
        code: "PHOTO-E",
        hired_on: "2026-01-01",
        branch_id: branch,
      });
      assert.equal(
        employeeResult.r.status,
        201,
        JSON.stringify(employeeResult.j),
      );
      const employee = employeeResult.j.id;
      assert(employee);
      assert.equal(
        (
          await call("/profile-photos/employees/" + employee, "PUT", {
            mime: "image/png",
            data: png,
          })
        ).r.status,
        200,
      );
      assert.equal((await call(path, "DELETE", {})).r.status, 200);
      assert.equal((await call(path)).j.data, null);
    },
  );
  await t.test(
    "cap is database-backed and deleting a profile cleans only its photo",
    async () => {
      for (let i = 0; i < 99; i++) {
        const id = randomUUID();
        raw
          .prepare(
            "INSERT INTO el_students(id,org_id,branch_id,name,code) VALUES(?,?,?,?,?)",
          )
          .run(id, org, branch, "Fictional " + i, "PHOTO-CAP-" + i);
        raw
          .prepare(
            "INSERT INTO el_profile_photos(org_id,entity,record_id,version,mime,byte_size,iv,ciphertext,updated_by,updated_at) VALUES(?,'students',?,?,'image/png',1,'iv','cipher',?,1)",
          )
          .run(org, id, randomUUID(), me.user.user_id);
      }
      assert.throws(
        () =>
          raw
            .prepare(
              "INSERT INTO el_profile_photos(org_id,entity,record_id,version,mime,byte_size,iv,ciphertext,updated_by,updated_at) VALUES(?,'students',?,?,'image/png',1,'iv','cipher',?,1)",
            )
            .run(org, student, randomUUID(), me.user.user_id),
        /limit/,
      );
      const employee = (
        raw
          .prepare(
            "SELECT record_id FROM el_profile_photos WHERE org_id=? AND entity='employees'",
          )
          .get(org) as any
      ).record_id;
      assert.equal(
        (
          await call("/profile-photos/employees/" + employee, "PUT", {
            mime: "image/png",
            data: png,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_profile_photos WHERE org_id=?")
            .get(org) as any
        ).n,
        100,
      );
      const id = (
        raw
          .prepare(
            "SELECT record_id FROM el_profile_photos WHERE org_id=? AND entity='students' LIMIT 1",
          )
          .get(org) as any
      ).record_id;
      raw.prepare("DELETE FROM el_students WHERE id=?").run(id);
      assert.equal(
        (
          raw
            .prepare("SELECT count(*) n FROM el_profile_photos WHERE org_id=?")
            .get(org) as any
        ).n,
        99,
      );
    },
  );
  await t.test(
    "demo cleanup removes photos only when the explicitly demo profile is deleted",
    async () => {
      await call("/auth/demo", "POST", {}, other);
      await call("/me", "GET", undefined, other);
      await call("/demo/academic-seed", "POST", {}, other);
      const demo = (await call("/students", "GET", undefined, other)).j.data[0];
      const branch = demo.branch_id;
      const real = (
        await call(
          "/students",
          "POST",
          {
            name: "Real fixture not demo",
            code: "PHOTO-REAL",
            branch_id: branch,
          },
          other,
        )
      ).j.id;
      for (const id of [demo.id, real])
        assert.equal(
          (
            await call(
              "/profile-photos/students/" + id,
              "PUT",
              { mime: "image/png", data: png },
              other,
            )
          ).r.status,
          200,
        );
      const result = await call(
        "/settings/demo",
        "PUT",
        { enabled: false },
        other,
      );
      assert.equal(
        result.r.status,
        409,
        "real record in demo branch must block cleanup atomically",
      );
      assert.equal(
        (
          await call(
            "/portal/profile-photos/students/" + demo.id,
            "GET",
            undefined,
            other,
          )
        ).j.data.data,
        png,
      );
      raw.prepare("DELETE FROM el_students WHERE id=?").run(real);
      const cleared = await call(
        "/settings/demo",
        "PUT",
        { enabled: false },
        other,
      );
      assert.equal(cleared.r.status, 200, JSON.stringify(cleared.j));
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_profile_photos WHERE record_id IN (?,?)",
            )
            .get(demo.id, real) as any
        ).n,
        0,
      );
    },
  );
});
