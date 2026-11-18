import type { Hono } from "hono";
import { z } from "zod";
import { permit, scope, audit, type AppContext } from "./app";
import { now } from "./db";
import { assert } from "./security";
export function registerExamResultSheet(app: Hono<any>) {
  app.post("/api/exams/:id/result-sheet", async (c: AppContext) => {
    const d = z
      .object({ action: z.enum(["print", "export"]) })
      .strict()
      .parse(await c.req.json());
    permit(c, "exams");
    permit(c, "exams", d.action);
    const a = c.get("actor");
    const exam = await c.env.DB.prepare(
      "SELECT e.id,e.branch_id,e.name,e.scheduled_at,e.max_score,e.pass_score,e.status,g.name group_name,g.code group_code,c.name course_name,b.name branch_name,o.name organization_name FROM el_exams e JOIN el_groups g ON g.id=e.group_id AND g.org_id=e.org_id JOIN el_courses c ON c.id=g.course_id AND c.org_id=g.org_id JOIN el_branches b ON b.id=e.branch_id AND b.org_id=e.org_id JOIN el_organizations o ON o.id=e.org_id WHERE e.id=? AND e.org_id=?",
    )
      .bind(c.req.param("id"), a.org_id)
      .first<Record<string, any>>();
    assert(exam, 404, "Exam not found");
    scope(c, exam.branch_id);
    assert(
      exam.status !== "draft",
      409,
      "Publish the exam before generating a result sheet",
    );
    // One result read, including pending rows, bounds the entire snapshot and summary consistently.
    const records = (
      await c.env.DB.prepare(
        "SELECT s.name,s.code,r.score,r.status,rank() OVER(ORDER BY CASE WHEN r.status='final' THEN r.score ELSE -1 END DESC) rank FROM el_exam_results r JOIN el_students s ON s.id=r.student_id AND s.org_id=r.org_id WHERE r.org_id=? AND r.exam_id=? ORDER BY CASE WHEN r.status='final' THEN r.score ELSE -1 END DESC,s.name,s.id LIMIT 5001",
      )
        .bind(a.org_id, exam.id)
        .all<Record<string, any>>()
    ).results;
    assert(
      records.length <= 5000,
      409,
      "Result sheet exceeds 5000 recorded results; no partial sheet was prepared",
    );
    const results: Record<string, any>[] = records
      .filter((r) => r.status === "final")
      .map(({ status, ...r }) => ({
        ...r,
        percent: Math.round((1000 * r.score) / exam.max_score) / 10,
        outcome: r.score >= exam.pass_score ? "passed" : "needs_support",
      }));
    const summary = {
      final: results.length,
      pending_review: records.length - results.length,
      passed: results.filter((r) => r.outcome === "passed").length,
      needs_support: results.filter((r) => r.outcome === "needs_support")
        .length,
      average_score: results.length
        ? results.reduce((s, r) => s + r.score, 0) / results.length
        : null,
    };
    const generated = now();
    await c.env.DB.batch([
      audit(c, "exam_result_sheet", exam.id, d.action, null, {
        branch_id: exam.branch_id,
        count: results.length,
        pending_review: summary.pending_review,
        generated_at: generated,
      }),
    ]);
    return c.json({ exam, results, summary, generated_at: generated });
  });
}
