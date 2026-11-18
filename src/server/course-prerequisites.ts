import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { record } from "./academic";
import { now } from "./db";
import { assert } from "./security";
export function registerCoursePrerequisites(app: Hono<any>) {
  app.get("/api/courses/:id/prerequisites", async (c: AppContext) => {
    permit(c, "courses");
    const course = await record(c, "courses", c.req.param("id")!);
    const rows = (
      await c.env.DB.prepare(
        "SELECT p.prerequisite_id,c.name,c.code,c.status,c.branch_id FROM el_course_prerequisites p JOIN el_courses c ON c.id=p.prerequisite_id AND c.org_id=p.org_id WHERE p.org_id=? AND p.course_id=? ORDER BY c.name",
      )
        .bind(course.org_id, course.id)
        .all<Record<string, any>>()
    ).results;
    for (const row of rows) scope(c, row.branch_id);
    return c.json({ data: rows });
  });
  app.post("/api/courses/:id/prerequisites", async (c: AppContext) => {
    permit(c, "courses", "edit");
    const a = c.get("actor"),
      course = await record(c, "courses", c.req.param("id")!),
      d = z.object({ prerequisite_id: z.uuid() }).parse(await c.req.json()),
      prior = await record(c, "courses", d.prerequisite_id);
    assert(prior.id !== course.id, 400, "A course cannot require itself");
    assert(
      prior.status === "active" && course.status === "active",
      409,
      "Choose active courses",
    );
    const exists = await c.env.DB.prepare(
      "SELECT 1 FROM el_course_prerequisites WHERE org_id=? AND course_id=? AND prerequisite_id=?",
    )
      .bind(a.org_id, course.id, prior.id)
      .first();
    assert(!exists, 409, "Prerequisite already assigned");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_course_prerequisites(org_id,course_id,prerequisite_id,created_by,created_at) VALUES(?,?,?,?,?)",
      ).bind(a.org_id, course.id, prior.id, a.user_id, now()),
      audit(c, "course", course.id, "add_prerequisite", null, {
        prerequisite_id: prior.id,
      }),
    ]);
    return c.json({ ok: true }, 201);
  });
  app.delete("/api/courses/:id/prerequisites/:prior", async (c: AppContext) => {
    permit(c, "courses", "edit");
    const a = c.get("actor"),
      course = await record(c, "courses", c.req.param("id")!);
    await record(c, "courses", c.req.param("prior")!);
    const before = await c.env.DB.prepare(
      "SELECT * FROM el_course_prerequisites WHERE org_id=? AND course_id=? AND prerequisite_id=?",
    )
      .bind(a.org_id, course.id, c.req.param("prior"))
      .first();
    assert(before, 404, "Prerequisite not found");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_course_prerequisites WHERE org_id=? AND course_id=? AND prerequisite_id=?",
      ).bind(a.org_id, course.id, c.req.param("prior")),
      audit(c, "course", course.id, "remove_prerequisite", before, null),
    ]);
    return c.json({ ok: true });
  });
}
