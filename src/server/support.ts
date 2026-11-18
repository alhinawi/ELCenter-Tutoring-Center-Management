import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import { identity, ownedStudent, portalRoles } from "./portal-access";
export async function ticketAccess(c: AppContext, id: string, manage = false) {
  const a = c.get("actor"),
    t = await c.env.DB.prepare(
      "SELECT * FROM el_support_tickets WHERE id=? AND org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
  assert(t, 404, "Ticket not found");
  scope(c, t.branch_id);
  const staff =
    !portalRoles.includes(a.system_key) &&
    a.permissions.includes("support:view");
  if (manage) permit(c, "support", "edit");
  else
    assert(staff || t.created_by === a.user_id, 403, "This ticket is private");
  return { ticket: t, staff };
}
export function registerSupport(app: Hono<any>) {
  for (const prefix of ["/api/support", "/api/portal/support"]) {
    app.get(prefix, async (c: AppContext) => {
      const a = c.get("actor"),
        staff = prefix === "/api/support";
      if (staff) permit(c, "support");
      else await identity(c);
      const rows = await c.env.DB.prepare(
        "SELECT t.id,t.number,t.subject,t.category,t.priority,t.status,t.created_at,t.updated_at,t.resolved_at,t.rating,u.name requester,s.name student_name FROM el_support_tickets t JOIN el_users u ON u.id=t.created_by LEFT JOIN el_students s ON s.id=t.student_id WHERE t.org_id=? AND (? IS NULL OR t.branch_id=?)" +
          (staff ? "" : " AND t.created_by=?") +
          " ORDER BY t.updated_at DESC,t.id LIMIT 100",
      )
        .bind(a.org_id, a.branch_id, a.branch_id, ...(staff ? [] : [a.user_id]))
        .all();
      return c.json({ data: rows.results, staff });
    });
    app.post(prefix, async (c: AppContext) => {
      const a = c.get("actor"),
        staff = prefix === "/api/support",
        d = z
          .object({
            branch_id: z.uuid().optional(),
            student_id: z.union([z.uuid(), z.literal("")]).default(""),
            category: z.enum([
              "academic",
              "financial",
              "registration",
              "teacher_complaint",
              "technical",
              "general",
            ]),
            priority: z
              .enum(["low", "normal", "high", "urgent"])
              .default("normal"),
            subject: z.string().trim().min(1).max(160),
            body: z.string().trim().min(1).max(5000),
          })
          .parse(await c.req.json());
      let branch = "";
      if (staff) {
        permit(c, "support", "create");
        assert(d.branch_id, 400, "Choose a branch");
        scope(c, d.branch_id);
        branch = d.branch_id;
        assert(
          await c.env.DB.prepare(
            "SELECT id FROM el_branches WHERE id=? AND org_id=?",
          )
            .bind(branch, a.org_id)
            .first(),
          400,
          "Branch unavailable",
        );
        if (d.student_id) {
          const s = await ownedStudent(c, d.student_id);
          assert(
            s.branch_id === branch,
            400,
            "Student and ticket must share a branch",
          );
        }
      } else {
        const link = await identity(c);
        if (link.kind === "teacher") {
          assert(!d.student_id, 403, "Teachers cannot open family tickets");
          branch = link.profile.branch_id;
        } else {
          assert(d.student_id, 400, "Choose a student");
          branch = (await ownedStudent(c, d.student_id)).branch_id;
        }
      }
      const id = uid(),
        number = "T-" + id.slice(0, 8).toUpperCase();
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO el_support_tickets(id,org_id,branch_id,number,student_id,created_by,category,priority,subject,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          id,
          a.org_id,
          branch,
          number,
          d.student_id || null,
          a.user_id,
          d.category,
          d.priority,
          d.subject,
          d.body,
          now(),
          now(),
        ),
        audit(c, "support_ticket", id, "create", null, {
          category: d.category,
          priority: d.priority,
        }),
      ]);
      return c.json({ id, number }, 201);
    });
    app.get(prefix + "/:id", async (c: AppContext) => {
      const { ticket, staff } = await ticketAccess(c, c.req.param("id")!),
        messages = (
          await c.env.DB.prepare(
            "SELECT m.id,m.body,m.internal,m.created_at,u.name author FROM el_ticket_messages m JOIN el_users u ON u.id=m.user_id WHERE m.org_id=? AND m.ticket_id=?" +
              (staff ? "" : " AND m.internal=0") +
              " ORDER BY m.created_at,m.id LIMIT 300",
          )
            .bind(ticket.org_id, ticket.id)
            .all()
        ).results;
      const data = staff
        ? ticket
        : Object.fromEntries(
            Object.entries(ticket).filter(
              ([k]) => !["assigned_to"].includes(k),
            ),
          );
      return c.json({ data, messages, staff });
    });
    app.post(prefix + "/:id/messages", async (c: AppContext) => {
      const { ticket, staff } = await ticketAccess(c, c.req.param("id")!),
        a = c.get("actor"),
        d = z
          .object({
            body: z.string().trim().min(1).max(5000),
            internal: z.boolean().default(false),
          })
          .parse(await c.req.json());
      assert(
        !d.internal || staff,
        403,
        "Internal support notes require staff access",
      );
      if (staff) permit(c, "support", "edit");
      assert(
        !["resolved", "closed"].includes(ticket.status),
        409,
        "Support ticket is closed",
      );
      const id = uid();
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO el_ticket_messages(id,org_id,ticket_id,user_id,body,internal,created_at) VALUES(?,?,?,?,?,?,?)",
        ).bind(
          id,
          a.org_id,
          ticket.id,
          a.user_id,
          d.body,
          d.internal ? 1 : 0,
          now(),
        ),
        c.env.DB.prepare(
          "UPDATE el_support_tickets SET updated_at=? WHERE id=?",
        ).bind(now(), ticket.id),
        audit(
          c,
          "support_ticket",
          ticket.id,
          d.internal ? "internal_note" : "reply",
          null,
          null,
        ),
      ]);
      return c.json({ id }, 201);
    });
    app.post(prefix + "/:id/rating", async (c: AppContext) => {
      const { ticket } = await ticketAccess(c, c.req.param("id")!),
        a = c.get("actor"),
        d = z
          .object({
            rating: z.number().int().min(1).max(5),
            note: z.string().trim().max(1000).default(""),
          })
          .parse(await c.req.json());
      assert(
        ticket.created_by === a.user_id,
        403,
        "Only the requester can rate support",
      );
      assert(
        ["resolved", "closed"].includes(ticket.status),
        409,
        "Resolve the ticket first",
      );
      assert(ticket.rating === null, 409, "Ticket already rated");
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE el_support_tickets SET rating=?,rating_note=? WHERE id=? AND rating IS NULL",
        ).bind(d.rating, d.note, ticket.id),
        audit(c, "support_ticket", ticket.id, "rate", null, {
          rating: d.rating,
        }),
      ]);
      return c.json({ ok: true });
    });
  }
  app.get("/api/support-options", async (c: AppContext) => {
    permit(c, "support");
    const a = c.get("actor");
    return c.json({
      users: (
        await c.env.DB.prepare(
          "SELECT u.id,u.name FROM el_users u JOIN el_memberships m ON m.user_id=u.id WHERE m.org_id=? AND m.status='active' AND (? IS NULL OR m.branch_id=? OR m.branch_id IS NULL) AND EXISTS(SELECT 1 FROM el_role_permissions p WHERE p.role_id=m.role_id AND p.resource='support' AND p.action='view') ORDER BY u.name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
      branches: (
        await c.env.DB.prepare(
          "SELECT id,name FROM el_branches WHERE org_id=? AND (? IS NULL OR id=?) ORDER BY name LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/support/:id/manage", async (c: AppContext) => {
    const { ticket } = await ticketAccess(c, c.req.param("id")!, true),
      a = c.get("actor"),
      d = z
        .object({
          status: z.enum([
            "open",
            "in_progress",
            "waiting",
            "resolved",
            "closed",
          ]),
          priority: z.enum(["low", "normal", "high", "urgent"]),
          assigned_to: z.union([z.uuid(), z.literal("")]).default(""),
        })
        .parse(await c.req.json());
    if (d.assigned_to)
      assert(
        await c.env.DB.prepare(
          "SELECT m.user_id FROM el_memberships m WHERE m.org_id=? AND m.user_id=? AND m.status='active' AND (m.branch_id IS NULL OR m.branch_id=?) AND EXISTS(SELECT 1 FROM el_role_permissions p WHERE p.role_id=m.role_id AND p.resource='support' AND p.action='view')",
        )
          .bind(a.org_id, d.assigned_to, ticket.branch_id)
          .first(),
        400,
        "Assignee must have support access to this branch",
      );
    assert(
      !ticket.rating || ["resolved", "closed"].includes(d.status),
      409,
      "Rated tickets cannot reopen",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_support_tickets SET status=?,priority=?,assigned_to=?,resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at,?) ELSE NULL END,updated_at=? WHERE id=?",
      ).bind(
        d.status,
        d.priority,
        d.assigned_to || null,
        d.status,
        now(),
        now(),
        ticket.id,
      ),
      audit(
        c,
        "support_ticket",
        ticket.id,
        "manage",
        { status: ticket.status, assigned_to: ticket.assigned_to },
        d,
      ),
    ]);
    return c.json({ ok: true });
  });
}
