import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
import { gradeAnswer } from "../src/server/assessment";
import { Temporal } from "@js-temporal/polyfill";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
let cookie = "",
  csrf = "";
async function call(p: string, method = "GET", body?: unknown) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        cookie,
        "x-csrf-token": csrf,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  const j: any = await r.json();
  if (p === "/me") csrf = j.user.csrf;
  return { r, j };
}
test("scheduling, attendance and assessment", async (t) => {
  await call("/auth/demo", "POST", {});
  await call("/me");
  await call("/demo/academic-seed", "POST", {});
  const g = (await call("/groups")).j.data[0],
    students = (await call("/students")).j.data;
  const start = Math.floor(Date.now() / 86400000) * 86400 + 11 * 3600,
    body = {
      group_id: g.id,
      teacher_id: g.teacher_id,
      classroom_id: g.classroom_id,
      starts_at: start,
      ends_at: start + 3600,
      topic: "Test session",
    };
  let id = "",
    exam = "",
    question = "";
  await t.test("session creation persists real relations", async () => {
    const { r, j } = await call("/sessions", "POST", body);
    assert.equal(r.status, 201);
    id = j.ids[0];
    assert.equal((await call("/sessions")).j.data[0].group_name, g.name);
  });
  await t.test(
    "overlapping teacher, room and group are rejected atomically",
    async () => {
      assert.equal(
        (
          await call("/sessions", "POST", {
            ...body,
            starts_at: start + 60,
            ends_at: start + 3660,
          })
        ).r.status,
        409,
      );
      assert.equal((await call("/sessions")).j.data.length, 1);
    },
  );
  await t.test("adjacent times and weekly recurrence allowed", async () => {
    assert.equal(
      (
        await call("/sessions", "POST", {
          ...body,
          starts_at: start + 3600,
          ends_at: start + 7200,
          repeat_weeks: 3,
        })
      ).r.status,
      201,
    );
    assert.equal((await call("/sessions")).j.data.length, 4);
  });
  await t.test("date range limits enforced", async () => {
    assert.equal((await call("/sessions?from=1&to=9999999999")).r.status, 400);
  });
  await t.test(
    "teacher availability respected in organization timezone",
    async () => {
      const z = Temporal.Instant.fromEpochMilliseconds(
        start * 1000,
      ).toZonedDateTimeISO("Africa/Cairo");
      assert.equal(
        (
          await call("/scheduling/availability", "POST", {
            teacher_id: g.teacher_id,
            weekday: z.dayOfWeek % 7,
            from_minute: 8 * 60,
            to_minute: 10 * 60,
          })
        ).r.status,
        201,
      );
      assert.equal(
        (
          await call("/sessions", "POST", {
            ...body,
            starts_at: start + 10800,
            ends_at: start + 14400,
          })
        ).r.status,
        409,
      );
      const rules = (await call("/scheduling/rules")).j;
      await call(
        "/scheduling/availability/" + rules.availability[0].id,
        "DELETE",
        {},
      );
    },
  );
  await t.test("holidays block future scheduling", async () => {
    const date = Temporal.Instant.fromEpochMilliseconds(
      (start + 7 * 86400) * 1000,
    )
      .toZonedDateTimeISO("Africa/Cairo")
      .toPlainDate()
      .toString();
    const { j } = await call("/scheduling/holidays", "POST", {
      name: "Fictional closure",
      branch_id: null,
      date,
    });
    assert.equal(
      (
        await call("/sessions", "POST", {
          ...body,
          starts_at: start + 7 * 86400 + 7200,
          ends_at: start + 7 * 86400 + 10800,
        })
      ).r.status,
      409,
    );
    await call("/scheduling/holidays/" + j.id, "DELETE", {});
  });
  await t.test("recurring conflict rolls back all occurrences", async () => {
    const count = (await call("/sessions")).j.data.length;
    assert.equal(
      (
        await call("/sessions", "POST", {
          ...body,
          starts_at: start - 7 * 86400,
          ends_at: start - 7 * 86400 + 3600,
          repeat_weeks: 2,
        })
      ).r.status,
      409,
    );
    assert.equal((await call("/sessions")).j.data.length, count);
  });
  await t.test(
    "roster is derived from enrollments, not frontend data",
    async () => {
      const { j } = await call("/sessions/" + id + "/attendance");
      assert.equal(j.data.length, 6);
    },
  );
  await t.test(
    "bulk attendance is persisted with guardian alerts",
    async () => {
      const r = await call(`/sessions/${id}/attendance`, "POST", {
        rows: students.map((s: any, i: number) => ({
          student_id: s.id,
          status: i === 0 ? "absent" : "present",
        })),
      });
      assert.equal(r.r.status, 200);
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_academic_alerts").get() as any)
          .n,
        1,
      );
    },
  );
  await t.test(
    "recorded attendance now requires independent correction approval",
    async () => {
      assert.equal(
        (
          await call(`/sessions/${id}/attendance`, "POST", {
            rows: [{ student_id: students[0].id, status: "late" }],
          })
        ).r.status,
        409,
      );
      assert.equal(
        (raw.prepare("SELECT count(*) n FROM el_academic_alerts").get() as any)
          .n,
        1,
      );
    },
  );
  await t.test(
    "attendance rejects foreign students and impossible departure",
    async () => {
      assert.equal(
        (
          await call(`/sessions/${id}/attendance`, "POST", {
            rows: [{ student_id: crypto.randomUUID(), status: "present" }],
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(`/sessions/${id}/attendance`, "POST", {
            rows: [
              {
                student_id: students[0].id,
                status: "present",
                arrival: start,
                departure: start - 60,
              },
            ],
          })
        ).r.status,
        400,
      );
    },
  );
  await t.test("recorded attendance locks rescheduling", async () => {
    assert.equal(
      (
        await call("/sessions/" + id, "PUT", {
          ...body,
          starts_at: start + 18000,
          ends_at: start + 21600,
        })
      ).r.status,
      409,
    );
  });
  await t.test("exams start as drafts and validate pass score", async () => {
    assert.equal(
      (
        await call("/exams", "POST", {
          name: "Bad",
          group_id: g.id,
          scheduled_at: start,
          max_score: 100,
          pass_score: 101,
        })
      ).r.status,
      400,
    );
    const { r, j } = await call("/exams", "POST", {
      name: "Progress Test",
      group_id: g.id,
      scheduled_at: start,
      max_score: 100,
      pass_score: 50,
    });
    assert.equal(r.status, 201);
    exam = j.id;
  });
  await t.test("supported questions validate options and answer", async () => {
    const bad = await call(`/exams/${exam}/questions`, "POST", {
      type: "multiple_choice",
      prompt: "Greeting?",
      options: ["Hi", "Bye"],
      correct_answer: "No",
      points: 100,
    });
    assert.equal(bad.r.status, 400);
    const { r, j } = await call(`/exams/${exam}/questions`, "POST", {
      type: "multiple_choice",
      prompt: "Greeting?",
      options: ["Hi", "Bye"],
      correct_answer: "Hi",
      points: 100,
    });
    assert.equal(r.status, 201);
    question = j.id;
  });
  await t.test(
    "publishing checks points total and locks questions",
    async () => {
      const e = (await call("/exams/" + exam)).j.data;
      assert.equal(
        (
          await call("/exams/" + exam, "PUT", {
            ...e,
            max_score: 90,
            status: "published",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/exams/" + exam, "PUT", { ...e, status: "published" })).r
          .status,
        200,
      );
      assert.equal(
        (
          await call(`/exams/${exam}/questions`, "POST", {
            type: "essay",
            prompt: "Locked",
            points: 1,
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/questions/" + question, "DELETE", {})).r.status,
        409,
      );
    },
  );
  await t.test("automatic grading computes scores on server", async () => {
    const { r, j } = await call(`/exams/${exam}/grade-answers`, "POST", {
      student_id: students[0].id,
      answers: [{ question_id: question, answer: " hi " }],
    });
    assert.equal(r.status, 200);
    assert.equal(j.score, 100);
    assert.equal(j.needs_review, false);
  });
  await t.test("manual grades are bounded and rankings generated", async () => {
    assert.equal(
      (
        await call(`/exams/${exam}/results`, "POST", {
          student_id: students[1].id,
          score: 101,
        })
      ).r.status,
      400,
    );
    assert.equal(
      (
        await call(`/exams/${exam}/results`, "POST", {
          student_id: students[1].id,
          score: 70,
          feedback: "Good progress",
        })
      ).r.status,
      200,
    );
    const results = (await call("/exams/" + exam)).j.results;
    assert.equal(results[0].rank, 1);
    assert.equal(results[1].percent, 70);
  });
  await t.test(
    "performance uses persisted attendance and final results",
    async () => {
      const data = (await call("/academic/performance")).j.data;
      const s = data.find((s: any) => s.id === students[0].id);
      assert.equal(s.attendance_percent, 0);
      assert.equal(s.exam_percent, 100);
    },
  );
  await t.test("closing exam prevents later grade changes", async () => {
    const e = (await call("/exams/" + exam)).j.data;
    assert.equal(
      (await call("/exams/" + exam, "PUT", { ...e, status: "closed" })).r
        .status,
      200,
    );
    assert.equal(
      (
        await call(`/exams/${exam}/results`, "POST", {
          student_id: students[1].id,
          score: 80,
        })
      ).r.status,
      409,
    );
  });
  await t.test("all automatic answer types behave as documented", () => {
    assert.equal(gradeAnswer("true_false", "TRUE", "true"), true);
    assert.equal(
      gradeAnswer("short_answer", " Good  Morning ", "good morning"),
      true,
    );
    assert.equal(
      gradeAnswer("matching", '{"a":"1","b":"2"}', '{"b":"2","a":"1"}'),
      true,
    );
    assert.equal(
      gradeAnswer("fill_blanks", '["is","are"]', '["is","are"]'),
      true,
    );
    assert.equal(gradeAnswer("essay", "text", ""), null);
  });
});
