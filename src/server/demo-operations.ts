import type { Hono } from "hono";
import { uid } from "./db";
import { permit, audit, type AppContext } from "./app";
import { assert } from "./security";
export function registerOperationsDemo(app: Hono<any>) {
  app.post("/api/settings/demo/operations", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor"),
      db = c.env.DB;
    assert(!a.branch_id, 403, "Organization-wide permission required");
    assert(
      (
        await db
          .prepare("SELECT demo_enabled FROM el_organizations WHERE id=?")
          .bind(a.org_id)
          .first<{ demo_enabled: number }>()
      )?.demo_enabled,
      409,
      "Enable demo mode first",
    );
    if (
      await db
        .prepare(
          "SELECT id FROM el_employees WHERE org_id=? AND is_demo=1 LIMIT 1",
        )
        .bind(a.org_id)
        .first()
    )
      return c.json({ ok: true });
    const b = await db
      .prepare(
        "SELECT id FROM el_branches WHERE org_id=? AND is_demo=1 LIMIT 1",
      )
      .bind(a.org_id)
      .first<{ id: string }>();
    assert(b, 409, "Populate academic demo first");
    const ids = {
      department: uid(),
      employee: uid(),
      campaign: uid(),
      lead: uid(),
      application: uid(),
      visit: uid(),
      announcement: uid(),
    };
    const org = await db
        .prepare("SELECT timezone FROM el_organizations WHERE id=?")
        .bind(a.org_id)
        .first<{ timezone: string }>(),
      today = new Intl.DateTimeFormat("en-CA", {
        timeZone: org?.timezone || "Africa/Cairo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      year = today.slice(0, 4);
    await db.batch([
      db
        .prepare(
          "INSERT INTO el_departments(id,org_id,branch_id,name,manager,is_demo) VALUES(?,?,?,?,?,1)",
        )
        .bind(
          ids.department,
          a.org_id,
          b.id,
          "Student Experience",
          "Demo Director",
        ),
      db
        .prepare(
          "INSERT INTO el_employees(id,org_id,branch_id,department_id,code,name,email,phone,job_title,hired_on,status,notes,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,'active',?,1)",
        )
        .bind(
          ids.employee,
          a.org_id,
          b.id,
          ids.department,
          "EMP-DEMO",
          "Nour Hassan",
          "nour@example.invalid",
          "01000000000",
          "Admissions Specialist",
          year + "-01-01",
          "Fictional staff profile",
        ),
      db
        .prepare(
          "INSERT INTO el_contracts(id,org_id,branch_id,employee_id,title,starts_on,ends_on,salary,workweek,is_demo) VALUES(?,?,?,?,?,?,?,?,'7,1,2,3,4',1)",
        )
        .bind(
          uid(),
          a.org_id,
          b.id,
          ids.employee,
          "Fictional annual contract",
          year + "-01-01",
          year + "-12-31",
          6500,
        ),
      db
        .prepare(
          "INSERT INTO el_applications(id,org_id,branch_id,name,email,job_title,stage,notes,is_demo) VALUES(?,?,?,?,?,?,'interview',?,1)",
        )
        .bind(
          ids.application,
          a.org_id,
          b.id,
          "Karim Salah",
          "karim@example.invalid",
          "Teaching Assistant",
          "Fictional recruitment example",
        ),
      db
        .prepare(
          "INSERT INTO el_campaigns(id,org_id,branch_id,name,channel,starts_on,ends_on,budget,status,notes,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,1)",
        )
        .bind(
          ids.campaign,
          a.org_id,
          b.id,
          "Winter Learning Week",
          "referral",
          year + "-01-01",
          year + "-12-31",
          2500,
          "active",
          "Fictional campaign, no advertising was purchased",
        ),
      db
        .prepare(
          "INSERT INTO el_leads(id,org_id,branch_id,name,phone,email,source,campaign_id,stage,follow_up_on,notes,is_demo) VALUES(?,?,?,?,?,?,?,?,'interested',?,?,1)",
        )
        .bind(
          ids.lead,
          a.org_id,
          b.id,
          "Laila Mahmoud",
          "01000000001",
          "laila@example.invalid",
          "referral",
          ids.campaign,
          today,
          "Interested in English Foundations. Fictional lead.",
        ),
      db
        .prepare(
          "INSERT INTO el_lead_interactions(id,org_id,lead_id,type,notes,created_by,is_demo) VALUES(?,?,?,'call',?,?,1)",
        )
        .bind(
          uid(),
          a.org_id,
          ids.lead,
          "Fictional inquiry call; no call was made",
          a.user_id,
        ),
      db
        .prepare(
          "INSERT INTO el_visits(id,org_id,branch_id,name,purpose,host,scheduled_at,is_demo) VALUES(?,?,?,?,?,?,?,1)",
        )
        .bind(
          ids.visit,
          a.org_id,
          b.id,
          "Laila Mahmoud",
          "Course inquiry",
          "Reception",
          Math.floor(Date.now() / 1000) + 3600,
        ),
      db
        .prepare(
          "INSERT INTO el_announcements(id,org_id,branch_id,title,body,created_by,is_demo) VALUES(?,?,?,?,?,?,1)",
        )
        .bind(
          ids.announcement,
          a.org_id,
          b.id,
          "Welcome to the team",
          "Fictional in-app announcement. Nothing was sent by email or phone.",
          a.user_id,
        ),
      db
        .prepare(
          "INSERT INTO el_notifications(id,org_id,user_id,announcement_id,title,body,is_demo) VALUES(?,?,?,?,?,?,1)",
        )
        .bind(
          uid(),
          a.org_id,
          a.user_id,
          ids.announcement,
          "Welcome to the team",
          "Fictional in-app announcement. Nothing was sent by email or phone.",
        ),
      db
        .prepare(
          "INSERT INTO el_delivery_logs(id,org_id,announcement_id,user_id,status,is_demo) VALUES(?,?,?,?,'stored',1)",
        )
        .bind(uid(), a.org_id, ids.announcement, a.user_id),
      audit(c, "demo", a.org_id, "seed_operations", null, { fictional: true }),
    ]);
    return c.json({ ok: true });
  });
}
