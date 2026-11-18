import type { Hono } from "hono";
import { z } from "zod";
import { permit, scope, audit, type AppContext } from "./app";
import { now } from "./db";
import { assert } from "./security";
export function registerGroupRoster(app: Hono<any>) {
  app.post("/api/groups/:id/roster", async (c: AppContext) => {
    const d = z
      .object({
        action: z.enum(["print", "export"]),
        status: z.enum(["active", "waiting", "all"]).default("active"),
      })
      .strict()
      .parse(await c.req.json());
    permit(c, "groups");
    permit(c, "groups", d.action);
    const a = c.get("actor");
    const group = await c.env.DB.prepare(
      "SELECT g.id,g.branch_id,g.name,g.code,g.status,g.start_date,g.end_date,c.name course_name,t.name teacher_name,b.name branch_name,o.name organization_name FROM el_groups g JOIN el_courses c ON c.id=g.course_id AND c.org_id=g.org_id JOIN el_teachers t ON t.id=g.teacher_id AND t.org_id=g.org_id JOIN el_branches b ON b.id=g.branch_id AND b.org_id=g.org_id JOIN el_organizations o ON o.id=g.org_id WHERE g.id=? AND g.org_id=?",
    )
      .bind(c.req.param("id"), a.org_id)
      .first<Record<string, any>>();
    assert(group, 404, "Group not found");
    scope(c, group.branch_id);
    const students = (
      await c.env.DB.prepare(
        "SELECT s.name,s.code,e.status enrollment_status FROM el_enrollments e JOIN el_students s ON s.id=e.student_id AND s.org_id=e.org_id WHERE e.org_id=? AND e.group_id=? AND (?='all' OR e.status=?) ORDER BY s.name,s.id LIMIT 5001",
      )
        .bind(a.org_id, group.id, d.status, d.status)
        .all()
    ).results;
    assert(
      students.length <= 5000,
      409,
      "Roster exceeds 5000 enrollments; choose active or waiting status. No partial roster was prepared.",
    );
    const generated = now();
    await c.env.DB.batch([
      audit(c, "group_roster", group.id, d.action, null, {
        branch_id: group.branch_id,
        status: d.status,
        count: students.length,
        generated_at: generated,
      }),
    ]);
    return c.json({
      group,
      students,
      status: d.status,
      generated_at: generated,
    });
  });
}
