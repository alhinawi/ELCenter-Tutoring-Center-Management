import { canViewRecordCounts } from "./dashboard-records";
import type { Hono } from "hono";
import { z } from "zod";
import { permit, audit, type AppContext } from "./app";
import { now } from "./db";
export const dashboardWidgets = [
  "welcome",
  "branch_stats",
  "team_stats",
  "capacity_stats",
  "role_stats",
  "branch_network",
  "activity",
  "active_records",
] as const;
export async function dashboardPreferences(c: AppContext) {
  const a = c.get("actor");
  const saved = await c.env.DB.prepare(
    "SELECT widgets_json FROM el_dashboard_preferences WHERE org_id=? AND user_id=?",
  )
    .bind(a.org_id, a.user_id)
    .first<{ widgets_json: string }>();
  const allowed = dashboardWidgets.filter((w) =>
    w === "active_records"
      ? canViewRecordCounts(a.permissions)
      : w === "team_stats"
        ? a.permissions.includes("users:view")
        : w === "role_stats"
          ? a.permissions.includes("roles:view")
          : w === "activity"
            ? a.permissions.includes("audit:view")
            : true,
  );
  const widgets = saved
    ? z.array(z.enum(dashboardWidgets)).parse(JSON.parse(saved.widgets_json))
    : dashboardWidgets;
  return {
    widgets: widgets.filter((w) => allowed.includes(w)),
    allowed_widgets: allowed,
    customized: !!saved,
  };
}
export function registerDashboardPreferences(app: Hono<any>) {
  app.get("/api/dashboard/preferences", async (c: AppContext) => {
    permit(c, "branches");
    return c.json(await dashboardPreferences(c));
  });
  app.put("/api/dashboard/preferences", async (c: AppContext) => {
    permit(c, "branches");
    const a = c.get("actor"),
      d = z
        .object({
          widgets: z
            .array(z.enum(dashboardWidgets))
            .max(dashboardWidgets.length)
            .refine(
              (w) => new Set(w).size === w.length,
              "Duplicate widgets are not allowed",
            ),
        })
        .strict()
        .parse(await c.req.json());
    const before = await dashboardPreferences(c);
    // Saving a currently forbidden widget is harmless but misleading. Reject rather than accepting hidden controls.
    if (d.widgets.some((w) => !before.allowed_widgets.includes(w)))
      return c.json(
        { error: "Choose only currently permitted dashboard widgets" },
        403,
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_dashboard_preferences(org_id,user_id,widgets_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET widgets_json=excluded.widgets_json,updated_at=excluded.updated_at",
      ).bind(a.org_id, a.user_id, JSON.stringify(d.widgets), now()),
      audit(
        c,
        "dashboard_preferences",
        a.user_id,
        "update",
        before.widgets,
        d.widgets,
      ),
    ]);
    return c.json({ ok: true });
  });
  app.delete("/api/dashboard/preferences", async (c: AppContext) => {
    permit(c, "branches");
    const a = c.get("actor"),
      before = await dashboardPreferences(c);
    await c.env.DB.batch([
      c.env.DB.prepare(
        "DELETE FROM el_dashboard_preferences WHERE org_id=? AND user_id=?",
      ).bind(a.org_id, a.user_id),
      audit(
        c,
        "dashboard_preferences",
        a.user_id,
        "reset",
        before.widgets,
        null,
      ),
    ]);
    return c.json({ ok: true });
  });
}
