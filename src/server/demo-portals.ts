import type { Hono } from "hono";
import { audit, permit, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
export function registerPortalDemo(app: Hono<any>) {
  app.post("/api/settings/demo/portals", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide permission required");
    assert(
      (
        await c.env.DB.prepare(
          "SELECT demo_enabled FROM el_organizations WHERE id=?",
        )
          .bind(a.org_id)
          .first<{ demo_enabled: number }>()
      )?.demo_enabled,
      409,
      "Enable demo mode first",
    );
    if (
      await c.env.DB.prepare(
        "SELECT id FROM el_lessons WHERE org_id=? AND is_demo=1 LIMIT 1",
      )
        .bind(a.org_id)
        .first()
    )
      return c.json({ ok: true });
    const g = await c.env.DB.prepare(
      "SELECT id,branch_id FROM el_groups WHERE org_id=? AND is_demo=1 LIMIT 1",
    )
      .bind(a.org_id)
      .first<{ id: string; branch_id: string }>();
    assert(g, 409, "Populate academic demo first");
    const lesson = uid(),
      video = uid(),
      assignment = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_lessons(id,org_id,branch_id,group_id,title,description,kind,content,position,status,published_at,is_demo,created_by) VALUES(?,?,?,?,?,?,'article',?,1,'published',?,1,?)",
      ).bind(
        lesson,
        a.org_id,
        g.branch_id,
        g.id,
        "Welcome to your learning space",
        "A short guide to building a steady study habit.",
        "Start with one clear goal. Read the lesson, write a short summary in your own words, then test yourself without looking at your notes.\n\nBefore your next class, prepare one question to discuss with your teacher. Small, consistent steps make learning last.",
        now(),
        a.user_id,
      ),
      c.env.DB.prepare(
        "INSERT INTO el_lessons(id,org_id,branch_id,group_id,title,description,kind,content,url,position,status,published_at,is_demo,created_by) VALUES(?,?,?,?,?,?,'material',?,?,2,'published',?,1,?)",
      ).bind(
        video,
        a.org_id,
        g.branch_id,
        g.id,
        "Independent practice",
        "An external educational resource to explore after class.",
        "External resource. Your center has not uploaded or hosted this content.",
        "https://www.britishcouncil.org/english",
        now(),
        a.user_id,
      ),
      c.env.DB.prepare(
        "INSERT INTO el_assignments(id,org_id,branch_id,group_id,title,instructions,due_at,max_score,status,is_demo,created_by) VALUES(?,?,?,?,?,?,?,20,'published',1,?)",
      ).bind(
        assignment,
        a.org_id,
        g.branch_id,
        g.id,
        "Introduce yourself",
        "Write a short paragraph introducing yourself. Include one learning goal and one question for your teacher.",
        now() + 7 * 86400,
        a.user_id,
      ),
      c.env.DB.prepare(
        "INSERT INTO el_discussions(id,org_id,branch_id,group_id,user_id,body,is_demo) VALUES(?,?,?,?,?,?,1)",
      ).bind(
        uid(),
        a.org_id,
        g.branch_id,
        g.id,
        a.user_id,
        "Welcome to our class discussion. Share a question, help a classmate, and keep every conversation kind and useful.",
      ),
      audit(c, "learning_demo", g.id, "seed", null, { fictional: true }),
    ]);
    return c.json({ ok: true });
  });
}
