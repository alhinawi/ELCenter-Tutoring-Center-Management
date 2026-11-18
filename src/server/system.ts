import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { audit, permit, type AppContext } from "./app";
import { uid, now, searchPattern, type Database } from "./db";
import { assert, checkPassword, hashPassword, digest } from "./security";
export async function runAutomation(
  db: Database,
  org: string,
  triggeredBy: string,
) {
  const zone = (
    await db
      .prepare("SELECT timezone FROM el_organizations WHERE id=?")
      .bind(org)
      .first<{ timezone: string }>()
  )?.timezone;
  assert(zone, 404, "Organization not found");
  const today = Temporal.Now.plainDateISO(zone),
    day = today.toString(),
    until = today.add({ days: 30 }).toString(),
    time = now();
  let made = 0;
  const candidates: {
    user: string;
    kind: string;
    entity: string;
    period: string;
    title: string;
    body: string;
  }[] = [];
  const docs = (
    await db
      .prepare(
        "SELECT d.id,d.created_by,d.title,d.expires_on FROM el_documents d JOIN el_memberships m ON m.org_id=d.org_id AND m.user_id=d.created_by WHERE d.org_id=? AND NOT EXISTS(SELECT 1 FROM el_notification_preferences np WHERE np.org_id=d.org_id AND np.user_id=d.created_by AND np.in_app=0) AND EXISTS(SELECT 1 FROM el_role_permissions rp WHERE rp.role_id=m.role_id AND rp.resource='documents' AND rp.action='view') AND (m.branch_id IS NULL OR m.branch_id=d.branch_id) AND d.is_demo=0 AND d.status='active' AND d.expires_on<>'' AND d.expires_on<=? AND m.status='active' AND NOT EXISTS(SELECT 1 FROM el_automation_events ev WHERE ev.org_id=d.org_id AND ev.user_id=d.created_by AND ev.kind='document_expiry' AND ev.entity_id=d.id AND ev.period=substr(?,1,7)) ORDER BY d.expires_on,d.id LIMIT 100",
      )
      .bind(org, until, day)
      .all<Record<string, any>>()
  ).results;
  for (const d of docs)
    candidates.push({
      user: d.created_by,
      kind: "document_expiry",
      entity: d.id,
      period: day.slice(0, 7),
      title: "Document expiration / انتهاء مستند",
      body: d.title + " · " + d.expires_on,
    });
  // Match current portal role, profile availability and BOTH profile/student
  // branch scopes before disclosing new family reminders into the inbox.
  const familyAccess = (alias: string) => `
    AND EXISTS(SELECT 1 FROM el_roles pr WHERE pr.id=m.role_id AND
      ((l.kind='student' AND pr.system_key='student') OR
       (l.kind='guardian' AND pr.system_key='parent_guardian')))
    AND EXISTS(SELECT 1 FROM el_students ps WHERE ps.id=${alias}.student_id
      AND ps.org_id=${alias}.org_id AND ps.status NOT IN ('inactive','suspended','withdrawn')
      AND (m.branch_id IS NULL OR m.branch_id=ps.branch_id))
    AND (l.kind='student' OR EXISTS(SELECT 1 FROM el_guardians pg
      WHERE pg.id=l.guardian_id AND pg.org_id=l.org_id AND pg.status='active'
      AND (m.branch_id IS NULL OR m.branch_id=pg.branch_id)))
    AND (m.branch_id IS NULL OR m.branch_id=${alias}.branch_id)`;
  const overdue = (
    await db
      .prepare(
        `SELECT i.id,i.number,l.user_id FROM el_invoices i JOIN el_portal_links l ON l.org_id=i.org_id AND (l.student_id=i.student_id OR l.guardian_id IN (SELECT guardian_id FROM el_student_guardians sg WHERE sg.student_id=i.student_id AND sg.org_id=i.org_id)) JOIN el_memberships m ON m.org_id=l.org_id AND m.user_id=l.user_id WHERE i.org_id=? AND NOT EXISTS(SELECT 1 FROM el_notification_preferences np WHERE np.org_id=i.org_id AND np.user_id=l.user_id AND np.in_app=0) AND i.is_demo=0 AND i.status='issued' AND i.due_date<? AND m.status='active' AND NOT EXISTS(SELECT 1 FROM el_automation_events ev WHERE ev.org_id=i.org_id AND ev.user_id=l.user_id AND ev.kind='invoice_due' AND ev.entity_id=i.id AND ev.period=substr(?,1,7)) AND i.total>COALESCE((SELECT sum(CASE WHEN p.kind='receipt' THEN p.amount ELSE -p.amount END) FROM el_payments p WHERE p.invoice_id=i.id),0) ${familyAccess("i")} ORDER BY i.due_date,i.id LIMIT 100`,
      )
      .bind(org, day, day)
      .all<Record<string, any>>()
  ).results;
  for (const i of overdue)
    candidates.push({
      user: i.user_id,
      kind: "invoice_due",
      entity: i.id,
      period: day.slice(0, 7),
      title: "Invoice due / فاتورة مستحقة",
      body:
        "Invoice / فاتورة " +
        i.number +
        ". Review your family portal. / راجع بوابة الأسرة.",
    });
  const loans = (
    await db
      .prepare(
        `SELECT r.id,r.due_on,l.user_id,b.title FROM el_borrow_records r JOIN el_library_copies co ON co.id=r.copy_id JOIN el_library_books b ON b.id=co.book_id JOIN el_portal_links l ON l.org_id=r.org_id AND (l.student_id=r.student_id OR l.guardian_id IN(SELECT guardian_id FROM el_student_guardians WHERE org_id=r.org_id AND student_id=r.student_id)) JOIN el_memberships m ON m.org_id=l.org_id AND m.user_id=l.user_id WHERE r.org_id=? AND NOT EXISTS(SELECT 1 FROM el_notification_preferences np WHERE np.org_id=r.org_id AND np.user_id=l.user_id AND np.in_app=0) AND r.is_demo=0 AND r.returned_on IS NULL AND r.due_on<=? AND m.status='active' AND NOT EXISTS(SELECT 1 FROM el_automation_events ev WHERE ev.org_id=r.org_id AND ev.user_id=l.user_id AND ev.kind='library_due' AND ev.entity_id=r.id AND ev.period=substr(?,1,7)) ${familyAccess("r")} ORDER BY r.due_on,r.id LIMIT 100`,
      )
      .bind(org, today.add({ days: 2 }).toString(), day)
      .all<Record<string, any>>()
  ).results;
  for (const r of loans)
    candidates.push({
      user: r.user_id,
      kind: "library_due",
      entity: r.id,
      period: day.slice(0, 7),
      title: "Library return / إرجاع كتاب",
      body: r.title + " · " + r.due_on,
    });
  const schedules = (
    await db
      .prepare(
        "SELECT s.*,r.id role_id,m.branch_id current_branch,EXISTS(SELECT 1 FROM el_role_permissions fp WHERE fp.role_id=r.id AND fp.resource='finance' AND fp.action='view') can_finance FROM el_report_schedules s JOIN el_memberships m ON m.org_id=s.org_id AND m.user_id=s.user_id JOIN el_roles r ON r.id=m.role_id JOIN el_role_permissions p ON p.role_id=r.id AND p.resource='reports' AND p.action='view' WHERE s.org_id=? AND s.status='active' AND m.status='active' AND s.branch_id IS m.branch_id AND NOT EXISTS(SELECT 1 FROM el_report_snapshots rs WHERE rs.schedule_id=s.id AND rs.period=CASE s.frequency WHEN 'daily' THEN ? WHEN 'monthly' THEN substr(?,1,7) ELSE ? END) ORDER BY s.id LIMIT 5",
      )
      .bind(
        org,
        day,
        day,
        today.subtract({ days: today.dayOfWeek - 1 }).toString(),
      )
      .all<Record<string, any>>()
  ).results;
  for (const s of schedules) {
    const period =
      s.frequency === "daily"
        ? day
        : s.frequency === "monthly"
          ? day.slice(0, 7)
          : today.subtract({ days: today.dayOfWeek - 1 }).toString();
    const start =
      s.frequency === "monthly"
        ? today.with({ day: 1 })
        : s.frequency === "weekly"
          ? today.subtract({ days: today.dayOfWeek - 1 })
          : today;
    const from = Math.floor(
        start.toZonedDateTime(zone).epochMilliseconds / 1000,
      ),
      to = Math.floor(
        today.add({ days: 1 }).toZonedDateTime(zone).epochMilliseconds / 1000,
      );
    if (s.current_branch !== s.branch_id) continue;
    const reads = (await db.batch([
      db
        .prepare(
          "SELECT count(*) groups,COALESCE(sum(capacity),0) seats FROM el_groups WHERE org_id=? AND (? IS NULL OR branch_id=?) AND status='active'",
        )
        .bind(org, s.branch_id, s.branch_id),
      db
        .prepare(
          "SELECT count(*) sessions,COALESCE(sum(CASE WHEN status='completed' THEN 1 ELSE 0 END),0) completed FROM el_class_sessions WHERE org_id=? AND (? IS NULL OR branch_id=?) AND starts_at>=? AND starts_at<? AND status<>'cancelled'",
        )
        .bind(org, s.branch_id, s.branch_id, from, to),
      db
        .prepare(
          "SELECT COALESCE(sum(CASE WHEN kind='receipt' THEN amount ELSE -amount END),0) net_collections FROM el_payments WHERE org_id=? AND (? IS NULL OR branch_id=?) AND date>=? AND date<=? AND ?=1",
        )
        .bind(
          org,
          s.branch_id,
          s.branch_id,
          start.toString(),
          day,
          s.can_finance ? 1 : 0,
        ),
    ])) as { results: Record<string, any>[] }[];
    const group = reads[0].results[0],
      classes = reads[1].results[0],
      financial = s.can_finance ? reads[2].results[0] : null;
    await db
      .prepare(
        "INSERT INTO el_report_snapshots(id,org_id,user_id,schedule_id,branch_id,period,name,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(schedule_id,period) DO NOTHING",
      )
      .bind(
        uid(),
        org,
        s.user_id,
        s.id,
        s.branch_id,
        period,
        s.name,
        JSON.stringify({
          from: start.toString(),
          to: day,
          as_of: time,
          academic: group,
          teaching: classes,
          finance: financial,
          notes:
            "Current group capacity and range sessions. Collections are not profit.",
        }),
        time,
      )
      .run();
    candidates.push({
      user: s.user_id,
      kind: "scheduled_report",
      entity: s.id,
      period,
      title: "Report ready / التقرير جاهز",
      body:
        s.name +
        " · " +
        period +
        ". Open Reports for your saved digest. / افتح التقارير لعرض الملخص المحفوظ.",
    });
  }
  // Unique event and notification share a transaction. Preferences are checked before selecting a delivery.
  const blocked = new Set(
    (
      await db
        .prepare(
          "SELECT user_id FROM el_notification_preferences WHERE org_id=? AND in_app=0",
        )
        .bind(org)
        .all<{ user_id: string }>()
    ).results.map((r) => r.user_id),
  );
  const allowed = candidates.filter((c) => !blocked.has(c.user));
  const before = await db
    .prepare("SELECT count(*) n FROM el_automation_events WHERE org_id=?")
    .bind(org)
    .first<{ n: number }>();
  for (let offset = 0; offset < allowed.length; offset += 100) {
    const statements = [];
    for (const c of allowed.slice(offset, offset + 100)) {
      const id = uid();
      statements.push(
        db
          .prepare(
            "INSERT INTO el_notifications(id,org_id,user_id,title,body) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM el_automation_events WHERE org_id=? AND user_id=? AND kind=? AND entity_id=? AND period=?)",
          )
          .bind(
            id,
            org,
            c.user,
            c.title,
            c.body,
            org,
            c.user,
            c.kind,
            c.entity,
            c.period,
          ),
        db
          .prepare(
            "INSERT INTO el_automation_events(id,org_id,user_id,kind,entity_id,period,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM el_notifications WHERE id=?) ON CONFLICT(org_id,user_id,kind,entity_id,period) DO NOTHING",
          )
          .bind(id, org, c.user, c.kind, c.entity, c.period, time, id),
      );
    }
    if (statements.length) await db.batch(statements);
  }
  const after = await db
    .prepare("SELECT count(*) n FROM el_automation_events WHERE org_id=?")
    .bind(org)
    .first<{ n: number }>();
  made = (after?.n ?? 0) - (before?.n ?? 0);
  await db
    .prepare(
      "INSERT INTO el_automation_runs(id,org_id,started_at,completed_at,created_count,triggered_by) VALUES(?,?,?,?,?,?)",
    )
    .bind(uid(), org, time, now(), made, triggeredBy)
    .run();
  return { created: made, scanned: candidates.length, limit_per_kind: 100 };
}
export function registerSystem(app: Hono<any>) {
  app.get("/api/security/sessions", async (c: AppContext) => {
    const a = c.get("actor"),
      current = await digest(getCookie(c, "elcenter_session")!);
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT id,user_agent,created_at,expires_at FROM el_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 50",
        )
          .bind(a.user_id, now())
          .all<Record<string, any>>()
      ).results.map((s) => ({ ...s, current: s.id === current })),
    });
  });
  app.get("/api/security/history", async (c: AppContext) => {
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT user_agent,ip,created_at FROM el_login_history WHERE user_id=? ORDER BY created_at DESC LIMIT 30",
        )
          .bind(c.get("actor").user_id)
          .all()
      ).results,
    });
  });
  app.post("/api/security/sessions/revoke", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z
        .object({ id: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM el_sessions WHERE id=? AND user_id=?").bind(
        d.id,
        a.user_id,
      ),
      audit(c, "session", d.id, "revoke", null, { self: true }),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/security/password", async (c: AppContext) => {
    const a = c.get("actor"),
      d = z
        .object({
          current_password: z.string().min(1).max(128),
          new_password: z.string().min(12).max(128),
        })
        .parse(await c.req.json());
    const attemptKey = "password-change:" + a.user_id,
      time = now();
    await c.env.DB.prepare(
      "INSERT INTO el_login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END",
    )
      .bind(attemptKey, time + 900, time, time, time + 900)
      .run();
    const limit = await c.env.DB.prepare(
      "SELECT attempts FROM el_login_limits WHERE key=?",
    )
      .bind(attemptKey)
      .first<{ attempts: number }>();
    assert(
      limit && limit.attempts <= 5,
      429,
      "Too many password changes. Try again in 15 minutes.",
    );
    const stored = await c.env.DB.prepare(
      "SELECT password_hash FROM el_users WHERE id=?",
    )
      .bind(a.user_id)
      .first<{ password_hash: string }>();
    assert(
      stored && (await checkPassword(d.current_password, stored.password_hash)),
      403,
      "Current password is incorrect",
    );
    const current = await digest(getCookie(c, "elcenter_session")!);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE el_users SET password_hash=? WHERE id=?").bind(
        await hashPassword(d.new_password),
        a.user_id,
      ),
      c.env.DB.prepare(
        "DELETE FROM el_sessions WHERE user_id=? AND id<>?",
      ).bind(a.user_id, current),
      audit(c, "user", a.user_id, "password_change", null, {
        other_sessions_revoked: true,
      }),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/system/automation", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    return c.json({
      runs: (
        await c.env.DB.prepare(
          "SELECT * FROM el_automation_runs WHERE org_id=? ORDER BY started_at DESC LIMIT 20",
        )
          .bind(a.org_id)
          .all()
      ).results,
      scope:
        "In-app notifications only; up to 100 records per kind per run. No external delivery.",
      enabled: !!(
        await c.env.DB.prepare(
          "SELECT enabled FROM el_automation_settings WHERE org_id=?",
        )
          .bind(a.org_id)
          .first<{ enabled: number }>()
      )?.enabled,
      scheduler_status: "Check deployment status with your operator",
    });
  });
  app.put("/api/system/automation", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = z.object({ enabled: z.boolean() }).parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_automation_settings(org_id,enabled) VALUES(?,?) ON CONFLICT(org_id) DO UPDATE SET enabled=excluded.enabled",
      ).bind(a.org_id, d.enabled ? 1 : 0),
      audit(c, "automation", a.org_id, "settings", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/reports/snapshots", async (c: AppContext) => {
    permit(c, "reports");
    const a = c.get("actor"),
      rows = (
        await c.env.DB.prepare(
          "SELECT * FROM el_report_snapshots WHERE org_id=? AND user_id=? AND branch_id IS ? ORDER BY created_at DESC LIMIT 30",
        )
          .bind(a.org_id, a.user_id, a.branch_id)
          .all<Record<string, any>>()
      ).results;
    return c.json({
      data: rows.map((r) => {
        const payload = JSON.parse(r.payload_json);
        if (!a.permissions.includes("finance:view")) delete payload.finance;
        const { payload_json, ...safe } = r;
        return { ...safe, payload };
      }),
    });
  });
  app.post("/api/system/automation/run", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const recent = await c.env.DB.prepare(
      "SELECT id FROM el_automation_runs WHERE org_id=? AND started_at>? LIMIT 1",
    )
      .bind(a.org_id, now() - 300)
      .first();
    assert(!recent, 429, "Automation was run in the last five minutes");
    return c.json(await runAutomation(c.env.DB, a.org_id, a.user_id));
  });
  app.get("/api/reports/schedules", async (c: AppContext) => {
    permit(c, "reports");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT * FROM el_report_schedules WHERE org_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30",
        )
          .bind(c.get("actor").org_id, c.get("actor").user_id)
          .all()
      ).results,
    });
  });
  app.post("/api/reports/schedules", async (c: AppContext) => {
    permit(c, "reports", "create");
    const a = c.get("actor"),
      d = z
        .object({
          name: z.string().trim().min(1).max(120),
          frequency: z.enum(["daily", "weekly", "monthly"]),
        })
        .parse(await c.req.json()),
      id = uid();
    const n = await c.env.DB.prepare(
      "SELECT count(*) n FROM el_report_schedules WHERE org_id=? AND user_id=?",
    )
      .bind(a.org_id, a.user_id)
      .first<{ n: number }>();
    assert((n?.n ?? 0) < 30, 409, "At most 30 report schedules");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_report_schedules(id,org_id,user_id,branch_id,name,frequency,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(id, a.org_id, a.user_id, a.branch_id, d.name, d.frequency, now()),
      audit(c, "report_schedule", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/reports/schedules/:id", async (c: AppContext) => {
    permit(c, "reports", "edit");
    const a = c.get("actor"),
      d = z
        .object({ status: z.enum(["active", "paused"]) })
        .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_report_schedules SET status=? WHERE id=? AND org_id=? AND user_id=?",
      ).bind(d.status, c.req.param("id"), a.org_id, a.user_id),
      audit(c, "report_schedule", c.req.param("id")!, "status", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/search", async (c: AppContext) => {
    const a = c.get("actor"),
      q = z.string().trim().min(2).max(80).parse(c.req.query("q")),
      kind = c.req.query("kind"),
      data: Record<string, unknown> = {};
    const defs = [
      ["students", "students", "name"],
      ["guardians", "guardians", "name"],
      ["teachers", "teachers", "name"],
      ["employees", "hr", "name"],
      ["courses", "courses", "name"],
      ["groups", "groups", "name"],
      ["branches", "branches", "name"],
      ["invoices", "finance", "number"],
      ["payments", "finance", "reference"],
      ["journals", "finance", "reference"],
      ["support_tickets", "support", "subject"],
      ["documents", "documents", "title"],
    ];
    for (const [table, permission, title] of defs) {
      if (
        (kind && kind !== table) ||
        !a.permissions.includes(permission + ":view")
      )
        continue;
      const branch = table === "branches" ? "id" : "branch_id";
      data[table] = (
        await c.env.DB.prepare(
          `SELECT id,${title} label FROM el_${table} WHERE org_id=? AND (? IS NULL OR ${branch}=?) AND ${title} LIKE ? ORDER BY ${title},id LIMIT 8`,
        )
          .bind(a.org_id, a.branch_id, a.branch_id, searchPattern(q))
          .all()
      ).results;
    }
    return c.json({ data, limit_per_kind: 8 });
  });
}
