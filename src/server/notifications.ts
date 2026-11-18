import type { Hono } from "hono";
import { z } from "zod";
import { uid } from "./db";
import { assert } from "./security";
import { permit, scope, audit, type AppContext } from "./app";
export function registerNotifications(app: Hono<any>) {
  app.get("/api/notifications", async (c: AppContext) => {
    const a = c.get("actor"),
      page = Math.max(1, Math.min(10000, Number(c.req.query("page")) || 1));
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT * FROM el_notifications WHERE org_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 30 OFFSET ?",
        )
          .bind(a.org_id, a.user_id, (page - 1) * 30)
          .all()
      ).results,
      preference: (await c.env.DB.prepare(
        "SELECT in_app FROM el_notification_preferences WHERE org_id=? AND user_id=?",
      )
        .bind(a.org_id, a.user_id)
        .first()) ?? { in_app: 1 },
      page,
    });
  });
  app.put("/api/notifications/preferences", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z.object({ in_app: z.boolean() }).parse(await c.req.json());
    await c.env.DB.prepare(
      "INSERT INTO el_notification_preferences(org_id,user_id,in_app) VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET in_app=excluded.in_app",
    )
      .bind(a.org_id, a.user_id, d.in_app ? 1 : 0)
      .run();
    return c.json({ ok: true });
  });
  app.post("/api/notifications/:id/read", async (c: AppContext) => {
    const a = c.get("actor"),
      id = c.req.param("id")!,
      n = await c.env.DB.prepare(
        "SELECT id,announcement_id FROM el_notifications WHERE id=? AND org_id=? AND user_id=?",
      )
        .bind(id, a.org_id, a.user_id)
        .first<{ id: string; announcement_id: string }>();
    assert(n, 404, "Notification not found");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_notifications SET read_at=unixepoch() WHERE id=? AND org_id=? AND user_id=?",
      ).bind(id, a.org_id, a.user_id),
      c.env.DB.prepare(
        "UPDATE el_delivery_logs SET status='read' WHERE announcement_id=? AND org_id=? AND user_id=? AND status='stored'",
      ).bind(n.announcement_id, a.org_id, a.user_id),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/announcements", async (c: AppContext) => {
    permit(c, "notifications");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT a.*,(SELECT count(*) FROM el_delivery_logs l WHERE l.announcement_id=a.id AND l.status IN ('stored','read')) stored,(SELECT count(*) FROM el_delivery_logs l WHERE l.announcement_id=a.id AND l.status='read') read,(SELECT count(*) FROM el_delivery_logs l WHERE l.announcement_id=a.id AND l.status='blocked') blocked FROM el_announcements a WHERE a.org_id=? AND (? IS NULL OR a.branch_id=?) ORDER BY a.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/announcements", async (c: AppContext) => {
    permit(c, "notifications", "create");
    const a = c.get("actor"),
      d = z
        .object({
          branch_id: z
            .union([z.uuid(), z.literal("")])
            .transform((x) => x || null),
          template_id: z.union([z.uuid(), z.literal("")]).default(""),
          title: z.string().trim().max(160).default(""),
          body: z.string().trim().max(4000).default(""),
          channel: z
            .enum(["in_app", "email", "sms", "whatsapp"])
            .default("in_app"),
        })
        .parse(await c.req.json());
    if (d.template_id) {
      const template = await c.env.DB.prepare(
        "SELECT * FROM el_notification_templates WHERE id=? AND org_id=?",
      )
        .bind(d.template_id, a.org_id)
        .first<Record<string, any>>();
      assert(
        template && template.branch_id === d.branch_id,
        400,
        "Template and announcement must share a branch",
      );
      scope(c, template.branch_id);
      d.title = d.title || template.title;
      d.body = d.body || template.body;
      d.channel = template.channel;
    }
    assert(d.title && d.body, 400, "Message title and body required");
    if (d.branch_id) scope(c, d.branch_id);
    else assert(!a.branch_id, 403, "Organization-wide permission required");
    if (d.branch_id)
      assert(
        await c.env.DB.prepare(
          "SELECT id FROM el_branches WHERE id=? AND org_id=?",
        )
          .bind(d.branch_id, a.org_id)
          .first(),
        400,
        "Branch unavailable",
      );
    const users = (
      await c.env.DB.prepare(
        "SELECT m.user_id,COALESCE(p.in_app,1) in_app FROM el_memberships m LEFT JOIN el_notification_preferences p ON p.org_id=m.org_id AND p.user_id=m.user_id WHERE m.org_id=? AND m.status='active' AND (? IS NULL OR m.branch_id=? OR m.branch_id IS NULL) LIMIT 501",
      )
        .bind(a.org_id, d.branch_id, d.branch_id)
        .all<{ user_id: string; in_app: number }>()
    ).results;
    assert(
      users.length <= 500,
      409,
      "Audience exceeds 500 members; choose a narrower branch",
    );
    const id = uid(),
      statements = [
        c.env.DB.prepare(
          "INSERT INTO el_announcements(id,org_id,branch_id,title,body,created_by) VALUES(?,?,?,?,?,?)",
        ).bind(id, a.org_id, d.branch_id, d.title, d.body, a.user_id),
      ];
    let stored = 0,
      blocked = 0;
    for (const user of users) {
      const deliver = d.channel === "in_app" && !!user.in_app;
      if (deliver) {
        stored++;
        statements.push(
          c.env.DB.prepare(
            "INSERT INTO el_notifications(id,org_id,user_id,announcement_id,title,body) VALUES(?,?,?,?,?,?)",
          ).bind(uid(), a.org_id, user.user_id, id, d.title, d.body),
        );
      } else blocked++;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_delivery_logs(id,org_id,announcement_id,user_id,channel,status,detail) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          uid(),
          a.org_id,
          id,
          user.user_id,
          d.channel,
          deliver ? "stored" : "blocked",
          deliver
            ? "Stored in user inbox"
            : d.channel === "in_app"
              ? "User opted out"
              : "External provider is not configured; nothing sent",
        ),
      );
    }
    await c.env.DB.batch([
      ...statements,
      audit(c, "announcement", id, "publish", null, { ...d, stored, blocked }),
    ]);
    return c.json({ id, stored, blocked, external_sent: 0 }, 201);
  });
}
