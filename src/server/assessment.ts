import type { Hono } from "hono";
import { z } from "zod";
import { assert } from "./security";
import { uid, now } from "./db";
import { audit, permit, scope, type AppContext } from "./app";
import { record } from "./academic";
const text = z.string().trim().max(2000).default("");
const schema = z
  .object({
    name: z.string().trim().min(1).max(160),
    group_id: z.uuid(),
    scheduled_at: z.number().int().positive(),
    max_score: z.number().positive().max(10000),
    pass_score: z.number().min(0).max(10000),
    status: z.enum(["draft", "published", "closed"]).default("draft"),
  })
  .refine((d) => d.pass_score <= d.max_score, {
    message: "Passing score exceeds maximum",
  });
async function exam(c: AppContext, id: string) {
  const e = await c.env.DB.prepare(
    "SELECT * FROM el_exams WHERE id=? AND org_id=?",
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(e, 404, "Exam not found");
  scope(c, e.branch_id);
  return e;
}
async function eligible(
  c: AppContext,
  e: Record<string, any>,
  studentId: string,
) {
  const s = await record(c, "students", studentId);
  const enrolled = await c.env.DB.prepare(
    "SELECT id FROM el_enrollments WHERE org_id=? AND group_id=? AND student_id=? AND status<>'waiting' AND unixepoch(created_at)<=? AND (status IN ('active','completed') OR unixepoch(updated_at)>=?)",
  )
    .bind(e.org_id, e.group_id, studentId, e.scheduled_at, e.scheduled_at)
    .first();
  assert(enrolled, 409, "Student is not enrolled for this exam");
  return s;
}
export const normalizeAnswer = (s: string) =>
  s.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
export function gradeAnswer(type: string, answer: string, correct: string) {
  if (type === "essay") return null;
  if (type === "matching") {
    try {
      const a = JSON.parse(answer),
        b = JSON.parse(correct);
      if (typeof a !== "object" || typeof b !== "object" || !a || !b)
        return false;
      const keys = Object.keys(b);
      return (
        keys.length === Object.keys(a).length &&
        keys.every(
          (k) =>
            normalizeAnswer(String(a[k])) === normalizeAnswer(String(b[k])),
        )
      );
    } catch {
      return false;
    }
  }
  if (type === "fill_blanks") {
    try {
      const a = JSON.parse(answer),
        b = JSON.parse(correct);
      return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        a.length === b.length &&
        a.every(
          (x, i) =>
            normalizeAnswer(String(x)) === normalizeAnswer(String(b[i])),
        )
      );
    } catch {
      return false;
    }
  }
  return normalizeAnswer(answer) === normalizeAnswer(correct);
}
export function registerAssessment(app: Hono<any>) {
  app.get("/api/exams", async (c: AppContext) => {
    permit(c, "exams");
    const a = c.get("actor");
    const rows = await c.env.DB.prepare(
      "SELECT e.*,g.name group_name FROM el_exams e JOIN el_groups g ON g.id=e.group_id WHERE e.org_id=? AND (? IS NULL OR e.branch_id=?) ORDER BY e.scheduled_at DESC LIMIT 300",
    )
      .bind(a.org_id, a.branch_id, a.branch_id)
      .all();
    return c.json({ data: rows.results });
  });
  app.post("/api/exams", async (c: AppContext) => {
    permit(c, "exams", "create");
    const d = schema.parse(await c.req.json()),
      g = await record(c, "groups", d.group_id),
      id = uid();
    assert(d.status === "draft", 400, "Create exams as drafts first");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        g.org_id,
        g.branch_id,
        g.id,
        d.name,
        d.scheduled_at,
        d.max_score,
        d.pass_score,
        d.status,
      ),
      audit(c, "exam", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/exams/:id", async (c: AppContext) => {
    permit(c, "exams", "edit");
    const id = c.req.param("id")!,
      before = await exam(c, id),
      d = schema.parse(await c.req.json());
    assert(
      before.status === "draft" ||
        (d.status === "closed" &&
          d.group_id === before.group_id &&
          d.max_score === before.max_score &&
          d.pass_score === before.pass_score &&
          d.scheduled_at === before.scheduled_at),
      409,
      "Published exams are locked; close without changing grading rules",
    );
    assert(before.status !== "closed", 409, "Closed exams are immutable");
    const g = await record(c, "groups", d.group_id);
    assert(g.branch_id === before.branch_id, 409, "Exam branch is fixed");
    if (d.status === "published") {
      const q = await c.env.DB.prepare(
        "SELECT count(*) n,COALESCE(sum(points),0) total FROM el_questions WHERE exam_id=?",
      )
        .bind(id)
        .first<{ n: number; total: number }>();
      assert(
        !q?.n || Math.abs(q.total - d.max_score) < 0.00001,
        409,
        "Question points must equal the maximum score before publishing",
      );
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_exams SET name=?,group_id=?,scheduled_at=?,max_score=?,pass_score=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?",
      ).bind(
        d.name,
        d.group_id,
        d.scheduled_at,
        d.max_score,
        d.pass_score,
        d.status,
        id,
        c.get("actor").org_id,
      ),
      audit(c, "exam", id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/exams/:id", async (c: AppContext) => {
    permit(c, "exams");
    const e = await exam(c, c.req.param("id")!);
    const questions = await c.env.DB.prepare(
      "SELECT * FROM el_questions WHERE exam_id=? AND org_id=? ORDER BY position,id",
    )
      .bind(e.id, e.org_id)
      .all();
    const results = await c.env.DB.prepare(
      "SELECT r.*,s.name student_name,round(100.0*r.score/e.max_score,1) percent,CASE WHEN r.status='final' THEN CASE WHEN r.score>=e.pass_score THEN 'passed' ELSE 'needs_support' END ELSE 'pending_review' END outcome,rank() OVER(ORDER BY CASE WHEN r.status='final' THEN r.score ELSE -1 END DESC) rank FROM el_exam_results r JOIN el_students s ON s.id=r.student_id JOIN el_exams e ON e.id=r.exam_id WHERE r.exam_id=? AND r.org_id=? ORDER BY r.score DESC",
    )
      .bind(e.id, e.org_id)
      .all();
    const students = await c.env.DB.prepare(
      "SELECT s.id,s.name FROM el_enrollments en JOIN el_students s ON s.id=en.student_id WHERE en.group_id=? AND en.org_id=? AND en.status<>'waiting' AND unixepoch(en.created_at)<=? AND (en.status IN ('active','completed') OR unixepoch(en.updated_at)>=?) ORDER BY s.name",
    )
      .bind(e.group_id, e.org_id, e.scheduled_at, e.scheduled_at)
      .all();
    return c.json({
      data: e,
      questions: questions.results,
      results: results.results,
      students: students.results,
    });
  });
  const question = z.object({
    type: z.enum([
      "multiple_choice",
      "true_false",
      "short_answer",
      "essay",
      "matching",
      "fill_blanks",
    ]),
    prompt: z.string().trim().min(1).max(2000),
    options: z.array(z.string().max(500)).max(20).default([]),
    correct_answer: text,
    points: z.number().positive().max(10000),
    position: z.number().int().min(0).max(500).default(0),
  });
  app.post("/api/exams/:id/questions", async (c: AppContext) => {
    permit(c, "exams", "edit");
    const e = await exam(c, c.req.param("id")!),
      d = question.parse(await c.req.json());
    assert(e.status === "draft", 409, "Published exam questions are locked");
    if (d.type === "multiple_choice")
      assert(
        d.options.length >= 2 && d.options.includes(d.correct_answer),
        400,
        "Provide options and a correct answer from those options",
      );
    if (d.type === "true_false")
      assert(
        ["true", "false"].includes(d.correct_answer),
        400,
        "Correct answer must be true or false",
      );
    if (d.type === "matching" || d.type === "fill_blanks") {
      try {
        const value = JSON.parse(d.correct_answer);
        assert(
          d.type === "fill_blanks"
            ? Array.isArray(value)
            : value && typeof value === "object" && !Array.isArray(value),
          400,
          "Use valid structured answers",
        );
      } catch {
        assert(
          false,
          400,
          "Matching answers need a JSON object, fill-blanks answers need a JSON array",
        );
      }
    }
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_questions(id,org_id,exam_id,type,prompt,options_json,correct_answer,points,position,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        e.org_id,
        e.id,
        d.type,
        d.prompt,
        JSON.stringify(d.options),
        d.correct_answer,
        d.points,
        d.position,
        e.is_demo,
      ),
      audit(c, "question", id, "create", null, {
        ...d,
        correct_answer: "[redacted]",
      }),
    ]);
    return c.json({ id }, 201);
  });
  app.delete("/api/questions/:id", async (c: AppContext) => {
    permit(c, "exams", "edit");
    const q = await c.env.DB.prepare(
      "SELECT * FROM el_questions WHERE id=? AND org_id=?",
    )
      .bind(c.req.param("id")!, c.get("actor").org_id)
      .first<Record<string, any>>();
    assert(q, 404, "Question not found");
    const e = await exam(c, q.exam_id);
    assert(e.status === "draft", 409, "Published exam questions are locked");
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM el_questions WHERE id=?").bind(q.id),
      audit(c, "question", q.id, "delete", { prompt: q.prompt }, null),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/exams/:id/results", async (c: AppContext) => {
    permit(c, "exams", "edit");
    const e = await exam(c, c.req.param("id")!),
      d = z
        .object({
          student_id: z.uuid(),
          score: z.number().min(0).max(10000),
          feedback: text,
        })
        .parse(await c.req.json());
    assert(
      e.status === "published",
      409,
      "Only published open exams accept grading",
    );
    assert(
      e.scheduled_at <= now(),
      409,
      "Cannot pre-record results for a future exam",
    );
    assert(d.score <= e.max_score, 400, "Score exceeds maximum");
    const s = await eligible(c, e, d.student_id);
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,feedback,graded_by,is_demo) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET score=excluded.score,feedback=excluded.feedback,status='final',graded_by=excluded.graded_by,updated_at=CURRENT_TIMESTAMP",
      ).bind(
        id,
        e.org_id,
        e.id,
        s.id,
        d.score,
        d.feedback,
        c.get("actor").user_id,
        e.is_demo && s.is_demo ? 1 : 0,
      ),
      audit(c, "exam_result", `${e.id}:${s.id}`, "grade", null, {
        score: d.score,
        feedback: d.feedback,
      }),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/exams/:id/grade-answers", async (c: AppContext) => {
    permit(c, "exams", "edit");
    const e = await exam(c, c.req.param("id")!),
      d = z
        .object({
          student_id: z.uuid(),
          answers: z
            .array(
              z.object({
                question_id: z.uuid(),
                answer: z.string().max(10000),
              }),
            )
            .max(40),
        })
        .parse(await c.req.json());
    assert(
      e.status === "published",
      409,
      "Only published open exams accept submissions",
    );
    assert(e.scheduled_at <= now(), 409, "Cannot submit a future exam");
    const student = await eligible(c, e, d.student_id),
      questions = (
        await c.env.DB.prepare(
          "SELECT * FROM el_questions WHERE exam_id=? AND org_id=? ORDER BY position",
        )
          .bind(e.id, e.org_id)
          .all<Record<string, any>>()
      ).results;
    assert(
      questions.length > 0 && questions.length <= 40,
      400,
      "Automatic grading supports 1 to 40 questions per submission",
    );
    assert(
      new Set(d.answers.map((x) => x.question_id)).size === d.answers.length &&
        d.answers.every((x) => questions.some((q) => q.id === x.question_id)),
      400,
      "Invalid or duplicate question",
    );
    let score = 0,
      needsReview = false;
    const statements = [];
    for (const q of questions) {
      const answer =
          d.answers.find((x) => x.question_id === q.id)?.answer ?? "",
        correct = gradeAnswer(q.type, answer, q.correct_answer);
      if (correct === null) needsReview = true;
      const points = correct ? q.points : 0;
      score += points;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_exam_answers(id,org_id,exam_id,student_id,question_id,answer,score,is_demo) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(exam_id,student_id,question_id) DO UPDATE SET answer=excluded.answer,score=excluded.score",
        ).bind(
          uid(),
          e.org_id,
          e.id,
          student.id,
          q.id,
          answer,
          points,
          e.is_demo && student.is_demo ? 1 : 0,
        ),
      );
    }
    await c.env.DB.batch([
      ...statements,
      c.env.DB.prepare(
        "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,graded_by,is_demo) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(exam_id,student_id) DO UPDATE SET score=excluded.score,status=excluded.status,graded_by=excluded.graded_by,updated_at=CURRENT_TIMESTAMP",
      ).bind(
        uid(),
        e.org_id,
        e.id,
        student.id,
        score,
        needsReview ? "pending_review" : "final",
        c.get("actor").user_id,
        e.is_demo && student.is_demo ? 1 : 0,
      ),
      audit(
        c,
        "exam_result",
        `${e.id}:${student.id}`,
        "automatic_grade",
        null,
        { score, needsReview },
      ),
    ]);
    return c.json({ score, max_score: e.max_score, needs_review: needsReview });
  });
}
