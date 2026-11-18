import { runAutomation } from "../src/server/system";
import type { Env } from "../src/server/db";
export default {
  async scheduled(_event: unknown, env: Env) {
    const state = await env.DB.prepare(
      "SELECT cursor FROM el_job_state WHERE name='org_cursor'",
    ).first<{ cursor: string }>();
    const orgs = (
      await env.DB.prepare(
        "SELECT o.id FROM el_organizations o JOIN el_automation_settings s ON s.org_id=o.id AND s.enabled=1 WHERE o.id>? ORDER BY o.id LIMIT 1",
      )
        .bind(state?.cursor ?? "")
        .all<{ id: string }>()
    ).results;
    for (const org of orgs)
      await runAutomation(env.DB, org.id, "scheduled-worker");
    await env.DB.prepare(
      "INSERT INTO el_job_state(name,cursor) VALUES('org_cursor',?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor",
    )
      .bind(orgs.length === 1 ? orgs[orgs.length - 1].id : "")
      .run();
  },
};
