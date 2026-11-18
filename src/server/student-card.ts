import type { Hono } from "hono";
import { permit, scope, audit, type AppContext } from "./app";
import { assert } from "./security";
import { now } from "./db";
export function registerStudentCard(app: Hono<any>) {
  app.post("/api/students/:id/id-card", async (c: AppContext) => {
    permit(c, "students");
    permit(c, "students", "print");
    const a = c.get("actor"),
      id = c.req.param("id");
    const row = await c.env.DB.prepare(
      "SELECT s.id,s.code,s.name,s.status,s.branch_id,b.name branch_name,o.name organization_name FROM el_students s JOIN el_branches b ON b.id=s.branch_id AND b.org_id=s.org_id JOIN el_organizations o ON o.id=s.org_id WHERE s.id=? AND s.org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
    assert(row, 404, "Student not found");
    scope(c, row.branch_id);
    const generated = now();
    await c.env.DB.batch([
      audit(c, "student_card", row.id, "generate", null, {
        student_id: row.id,
        branch_id: row.branch_id,
        generated_at: generated,
      }),
    ]);
    return c.json({
      data: { ...row, generated_at: generated, qr_payload: "ELC:" + row.id },
    });
  });
}
