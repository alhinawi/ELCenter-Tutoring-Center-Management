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
test("family library history pages complete current-owned borrowing records", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    group = (await call("/groups")).j.data[0],
    branch = group.branch_id,
    students = (await call("/students")).j.data,
    own = students[0].id,
    other = students[1].id,
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
  const guardianAccount = await account(
    "parent_guardian",
    guardian,
    guardianId,
  );
  const book = randomUUID();
  raw
    .prepare(
      "INSERT INTO el_library_books(id,org_id,title,author,category,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      book,
      org,
      "Fictional History Book",
      "Fictional Author",
      "Learning",
      1800000000,
    );
  const ids = new Set<string>();
  for (let i = 0; i < 221; i++) {
    const copy = randomUUID(),
      id = randomUUID();
    ids.add(id);
    raw
      .prepare(
        "INSERT INTO el_library_copies(id,org_id,branch_id,book_id,barcode) VALUES(?,?,?,?,?)",
      )
      .run(copy, org, branch, book, "HISTORY-" + i);
    raw
      .prepare(
        "INSERT INTO el_borrow_records(id,org_id,branch_id,copy_id,student_id,borrowed_on,due_on,issued_by,notes,created_at) VALUES(?,?,?,?,?,'2026-01-01','2026-01-10',?,'PRIVATE STAFF NOTES',1800000000)",
      )
      .run(id, org, branch, copy, own, me.user.user_id);
    if (i % 2 === 0)
      raw
        .prepare(
          "UPDATE el_borrow_records SET returned_on='2026-01-12',late_days=2,penalty_total=10,returned_by=? WHERE id=?",
        )
        .run(me.user.user_id, id);
  }
  const path = `/portal/library/${own}`;
  await t.test(
    "221 tied-time loans enumerate exactly with private fields omitted",
    async () => {
      const seen = new Set<string>();
      for (let page = 1; page <= 12; page++) {
        const r = await call(path + "?page=" + page, "GET", undefined, student);
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 221);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          assert(ids.has(row.id));
          assert(!seen.has(row.id));
          seen.add(row.id);
          assert.equal(row.title, "Fictional History Book");
          assert.equal(row.penalty_total, row.returned_on ? 10 : 0);
          for (const key of [
            "notes",
            "issued_by",
            "returned_by",
            "student_id",
            "branch_id",
            "daily_penalty",
          ])
            assert(!(key in row));
        }
      }
      assert.equal(seen.size, 221);
      assert.deepEqual(
        (await call(path + "?page=13", "GET", undefined, student)).j.data,
        [],
      );
      assert.deepEqual(
        (await call(path + "?page=2", "GET", undefined, student)).j.data,
        (await call(path + "?page=2", "GET", undefined, guardian)).j.data,
      );
      assert.equal(
        (await call(`/portal/library/${other}`, "GET", undefined, student)).r
          .status,
        404,
      );
    },
  );
  await t.test(
    "on-loan and returned filters have exact counts; malformed filters reject",
    async () => {
      for (const [status, total] of [
        ["on_loan", 110],
        ["returned", 111],
      ] as const) {
        const r = await call(
          path + "?status=" + status,
          "GET",
          undefined,
          student,
        );
        assert.equal(r.j.total, total);
        assert(
          r.j.data.every(
            (row: any) =>
              (row.returned_on !== null) === (status === "returned"),
          ),
        );
      }
      for (const q of [
        "page=",
        "page=0",
        "page=-1",
        "page=1.5",
        "page=Infinity",
        "page=10001",
        "status=overdue",
      ])
        assert.equal(
          (await call(path + "?" + q, "GET", undefined, student)).r.status,
          400,
          q,
        );
    },
  );
  await t.test(
    "staff complete scoped pages expose older active loans and reject portal callers",
    async () => {
      const staff = { cookie: "", csrf: "" };
      await account("business_owner", staff);
      const seen = new Set<string>();
      for (let page = 1; page <= 12; page++) {
        const r = await call(
          "/library/loans?page=" + page,
          "GET",
          undefined,
          staff,
        );
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 221);
        for (const row of r.j.data) {
          assert(!seen.has(row.id));
          seen.add(row.id);
          assert(row.student_name);
          for (const key of [
            "issued_by",
            "returned_by",
            "notes",
            "student_id",
            "branch_id",
          ])
            assert(!(key in row));
        }
      }
      assert.equal(seen.size, 221);
      for (const [status, total] of [
        ["on_loan", 110],
        ["returned", 111],
      ] as const)
        assert.equal(
          (
            await call(
              "/library/loans?status=" + status,
              "GET",
              undefined,
              staff,
            )
          ).j.total,
          total,
        );
      for (const q of ["page=0", "page=1.5", "page=10001", "status=overdue"])
        assert.equal(
          (await call("/library/loans?" + q, "GET", undefined, staff)).r.status,
          400,
        );
      for (const c of [student, guardian, teacher])
        assert.equal(
          (await call("/library/loans", "GET", undefined, c)).r.status,
          403,
        );
      const b = (
          await call("/branches", "POST", {
            name: "Fictional Remote",
            code: "FL-REMOTE",
            capacity: 20,
            status: "active",
          })
        ).j.id,
        learner = (
          await call("/students", "POST", {
            name: "Fictional Remote Reader",
            code: "FLR",
            branch_id: b,
          })
        ).j.id,
        copy = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_library_copies(id,org_id,branch_id,book_id,barcode) VALUES(?,?,?,?,?)",
        )
        .run(copy, org, b, book, "PRIVATE-REMOTE-COPY");
      raw
        .prepare(
          "INSERT INTO el_borrow_records(id,org_id,branch_id,copy_id,student_id,borrowed_on,due_on,issued_by,created_at) VALUES(?,?,?,?,?,'2026-01-01','2026-01-10',?,1800000000)",
        )
        .run(randomUUID(), org, b, copy, learner, me.user.user_id);
      assert.equal(
        (await call("/library/loans", "GET", undefined, staff)).j.total,
        221,
      );
      assert.equal((await call("/library/loans")).j.total, 222);
      const f = { cookie: "", csrf: "" };
      await call("/auth/demo", "POST", {}, f);
      await call("/me", "GET", undefined, f);
      assert.equal(
        (await call("/library/loans", "GET", undefined, f)).j.total,
        0,
      );
    },
  );
  await t.test(
    "reservation pages retain complete oldest-first ties, status counts, branch isolation and FIFO cancellation",
    async () => {
      const insert = raw.prepare(
          "INSERT INTO el_library_reservations(id,org_id,branch_id,book_id,student_id,status,created_at) VALUES(?,?,?,?,?,?,?)",
        ),
        all: string[] = [];
      for (let i = 0; i < 221; i++) {
        const id = randomUUID();
        all.push(id);
        insert.run(
          id,
          org,
          branch,
          book,
          own,
          i % 2 ? "fulfilled" : "cancelled",
          1700000000,
        );
      }
      const first = randomUUID(),
        second = randomUUID();
      all.push(first, second);
      insert.run(first, org, branch, book, own, "waiting", 1800000001);
      insert.run(second, org, branch, book, other, "waiting", 1800000002);
      const staff = { cookie: "", csrf: "" };
      await account("business_owner", staff);
      const seen: string[] = [];
      for (let page = 1; page <= 12; page++) {
        const r = await call(
          "/library/reservations?page=" + page,
          "GET",
          undefined,
          staff,
        );
        assert.equal(r.r.status, 200, JSON.stringify(r.j));
        assert.equal(r.j.total, 223);
        assert.equal(r.j.page_size, 20);
        for (const row of r.j.data) {
          seen.push(row.id);
          assert(row.student_name && row.branch_name && row.title);
          for (const key of [
            "student_id",
            "book_id",
            "org_id",
            "branch_id",
            "borrow_id",
            "is_demo",
          ])
            assert(!(key in row));
        }
      }
      assert.deepEqual(seen, [...all.slice(0, 221).sort(), first, second]);
      for (const [status, total] of [
        ["waiting", 2],
        ["fulfilled", 110],
        ["cancelled", 111],
      ] as const)
        assert.equal(
          (
            await call(
              "/library/reservations?status=" + status,
              "GET",
              undefined,
              staff,
            )
          ).j.total,
          total,
        );
      for (const q of [
        "page=",
        "page=0",
        "page=1.5",
        "page=10001",
        "status=other",
      ])
        assert.equal(
          (await call("/library/reservations?" + q, "GET", undefined, staff)).r
            .status,
          400,
        );
      for (const c of [student, guardian, teacher])
        assert.equal(
          (await call("/library/reservations", "GET", undefined, c)).r.status,
          403,
        );
      const remote = (
        raw
          .prepare(
            "SELECT id FROM el_branches WHERE org_id=? AND code='FL-REMOTE'",
          )
          .get(org) as any
      ).id;
      insert.run(randomUUID(), org, remote, book, own, "cancelled", 1700000000);
      assert.equal(
        (await call("/library/reservations", "GET", undefined, staff)).j.total,
        223,
      );
      assert.equal((await call("/library/reservations")).j.total, 224);
      const copy = (
        await call("/library/copies", "POST", {
          book_id: book,
          branch_id: branch,
          barcode: "FIFO-CHECK",
        })
      ).j.id;
      assert.equal(
        (
          await call("/library/loans", "POST", {
            copy_id: copy,
            student_id: other,
            borrowed_on: "2026-01-01",
            due_on: "2026-01-10",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/library/reservations/" + first + "/cancel", "POST", {})).r
          .status,
        200,
      );
      assert.equal(
        (await call("/library/reservations/" + first + "/cancel", "POST", {})).r
          .status,
        409,
      );
      assert.equal(
        (
          await call("/library/loans", "POST", {
            copy_id: copy,
            student_id: other,
            borrowed_on: "2026-01-01",
            due_on: "2026-01-10",
          })
        ).r.status,
        201,
      );
      const r = await call(
        "/library/reservations?status=waiting",
        "GET",
        undefined,
        staff,
      );
      assert.equal(r.j.total, 0);
      const f = { cookie: "", csrf: "" };
      await call("/auth/demo", "POST", {}, f);
      await call("/me", "GET", undefined, f);
      assert.equal(
        (await call("/library/reservations", "GET", undefined, f)).j.total,
        0,
      );
    },
  );
  await t.test(
    "current role, relationship, profile, branch and link gate every page",
    async () => {
      for (const c of [teacher, unlinked])
        assert.equal((await call(path, "GET", undefined, c)).r.status, 403);
      raw
        .prepare(
          "DELETE FROM el_student_guardians WHERE student_id=? AND guardian_id=?",
        )
        .run(own, guardianId);
      assert.equal(
        (await call(path + "?page=2", "GET", undefined, guardian)).r.status,
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
          code: "FR-OTHER",
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
      assert.equal(
        (await call(path, "GET", undefined, { cookie: "", csrf: "" })).r.status,
        401,
      );
    },
  );
});
