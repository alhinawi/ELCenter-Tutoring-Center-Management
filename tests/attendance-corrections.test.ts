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
test("attendance corrections require independent approval and preserve history", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j,
    org = me.organization.id;
  await call("/demo/academic-seed", "POST", {});
  await call("/settings/demo/learning", "POST", {});
  const att = raw
    .prepare(
      "SELECT at.*,s.branch_id,s.starts_at,s.ends_at FROM el_attendance at JOIN el_class_sessions s ON s.id=at.session_id LIMIT 1",
    )
    .get() as any;
  assert(att);
  const reviewer = (
    await call("/users", "POST", {
      name: "Independent reviewer",
      email: "correction-reviewer@example.invalid",
      password: "Test-only-password-2026",
      role_id: me.user.role_id,
      branch_id: null,
    })
  ).j.id;
  await call(
    "/auth/login",
    "POST",
    {
      email: "correction-reviewer@example.invalid",
      password: "Test-only-password-2026",
    },
    other,
  );
  const rev = (await call("/me", "GET", undefined, other)).j.user;
  const desired = {
    status: att.status === "absent" ? "present" : "absent",
    arrival: null,
    departure: null,
    notes: "Corrected after register check",
    reason: "Checked signed class register",
  };
  let request = "";
  await t.test(
    "request does not mutate attendance and cannot self approve",
    async () => {
      const r = await call(
        "/attendance/" + att.id + "/corrections",
        "POST",
        desired,
      );
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      request = r.j.id;
      assert.equal(
        (
          raw
            .prepare("SELECT status FROM el_attendance WHERE id=?")
            .get(att.id) as any
        ).status,
        att.status,
      );
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + request + "/decision",
            "POST",
            { decision: "approved", note: "Checked original" },
          )
        ).r.status,
        403,
      );
      assert.equal(
        (await call("/attendance/" + att.id + "/corrections", "POST", desired))
          .r.status,
        409,
      );
    },
  );
  await t.test(
    "approval atomically changes the record, revision and absence alert",
    async () => {
      const r = await call(
        "/attendance-corrections/" + request + "/decision",
        "POST",
        { decision: "approved", note: "Verified with source" },
        other,
      );
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      const after = raw
        .prepare("SELECT * FROM el_attendance WHERE id=?")
        .get(att.id) as any;
      assert.equal(after.status, desired.status);
      assert.equal(after.revision, 1);
      assert.equal(after.recorded_by, rev.user_id);
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_academic_alerts WHERE session_id=? AND student_id=? AND kind='absence'",
            )
            .get(att.session_id, att.student_id) as any
        ).n,
        desired.status === "absent" ? 1 : 0,
      );
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + request + "/decision",
            "POST",
            { decision: "rejected", note: "Second decision" },
            other,
          )
        ).r.status,
        409,
      );
      assert.throws(() =>
        raw
          .prepare("UPDATE el_attendance SET status='late' WHERE id=?")
          .run(att.id),
      );
    },
  );
  await t.test(
    "rejection preserves data, and a subsequent reversal removes absence alerts",
    async () => {
      const d = {
        ...desired,
        status: att.status,
        reason: "Review changed information",
      };
      const r = await call("/attendance/" + att.id + "/corrections", "POST", d);
      assert.equal(r.r.status, 201);
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + r.j.id + "/decision",
            "POST",
            { decision: "rejected", note: "Evidence incomplete" },
            other,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT status FROM el_attendance WHERE id=?")
            .get(att.id) as any
        ).status,
        desired.status,
      );
      const next = await call(
        "/attendance/" + att.id + "/corrections",
        "POST",
        d,
      );
      assert.equal(next.r.status, 201);
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + next.j.id + "/decision",
            "POST",
            { decision: "approved", note: "Further evidence verified" },
            other,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT revision FROM el_attendance WHERE id=?")
            .get(att.id) as any
        ).revision,
        2,
      );
      assert.equal(
        (
          raw
            .prepare(
              "SELECT count(*) n FROM el_academic_alerts WHERE session_id=? AND student_id=? AND kind='absence'",
            )
            .get(att.session_id, att.student_id) as any
        ).n,
        att.status === "absent" ? 1 : 0,
      );
    },
  );
  await t.test(
    "stale session state blocks approval without partial mutation",
    async () => {
      const r = await call(
        "/attendance/" + att.id + "/corrections",
        "POST",
        desired,
      );
      assert.equal(r.r.status, 201);
      raw
        .prepare("UPDATE el_class_sessions SET status='cancelled' WHERE id=?")
        .run(att.session_id);
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + r.j.id + "/decision",
            "POST",
            { decision: "approved", note: "Should not apply stale state" },
            other,
          )
        ).r.status,
        409,
      );
      assert.equal(
        (
          raw
            .prepare("SELECT status FROM el_attendance_corrections WHERE id=?")
            .get(r.j.id) as any
        ).status,
        "pending",
      );
      assert.equal(
        (
          raw
            .prepare("SELECT revision FROM el_attendance WHERE id=?")
            .get(att.id) as any
        ).revision,
        2,
      );
      assert.equal(
        (
          await call(
            "/attendance-corrections/" + r.j.id + "/decision",
            "POST",
            { decision: "rejected", note: "Session is cancelled" },
            other,
          )
        ).r.status,
        200,
      );
      raw
        .prepare("UPDATE el_class_sessions SET status='completed' WHERE id=?")
        .run(att.session_id);
    },
  );
  await t.test(
    "invalid times, branch scopes and permission restrictions hold",
    async () => {
      assert.equal(
        (
          await call("/attendance/" + att.id + "/corrections", "POST", {
            ...desired,
            arrival: att.starts_at - 90000,
          })
        ).r.status,
        400,
      );
      const branch = randomUUID();
      raw
        .prepare("INSERT INTO el_branches(id,org_id,name,code) VALUES(?,?,?,?)")
        .run(branch, org, "Other branch", "CORRECTION-OTHER");
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=? WHERE user_id=? AND org_id=?",
        )
        .run(branch, me.user.user_id, org);
      assert.equal(
        (await call("/attendance/" + att.id + "/corrections", "POST", desired))
          .r.status,
        403,
      );
      assert.equal((await call("/attendance-corrections")).j.data.length, 0);
      raw
        .prepare(
          "UPDATE el_memberships SET branch_id=NULL WHERE user_id=? AND org_id=?",
        )
        .run(me.user.user_id, org);
      const role = (
        await call("/roles", "POST", {
          name: "Attendance reader",
          permissions: ["attendance:view"],
        })
      ).j.id;
      raw
        .prepare(
          "UPDATE el_memberships SET role_id=? WHERE user_id=? AND org_id=?",
        )
        .run(role, me.user.user_id, org);
      assert.equal(
        (await call("/attendance/" + att.id + "/corrections", "POST", desired))
          .r.status,
        403,
      );
    },
  );
});
