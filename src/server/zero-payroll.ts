import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import { date } from "./finance";
export function registerZeroPayroll(app: Hono<any>) {
  for (const [path, table, column] of [
    ["payroll", "el_payroll", "teacher_payroll_id"],
    ["staff-payroll", "el_staff_payroll", "staff_payroll_id"],
  ] as const) {
    app.post("/api/" + path + "/:id/close-zero", async (c: AppContext) => {
      permit(c, "finance", "approve");
      const a = c.get("actor"),
        d = z
          .object({ date, reason: z.string().trim().min(5).max(1000) })
          .strict()
          .parse(await c.req.json());
      const p = await c.env.DB.prepare(
        `SELECT * FROM ${table} WHERE org_id=? AND id=?`,
      )
        .bind(a.org_id, c.req.param("id"))
        .first<Record<string, any>>();
      assert(p, 404, "Payroll record not found");
      scope(c, p.branch_id);
      assert(
        p.total === 0 && p.status === "approved",
        409,
        "Only approved zero payroll can close without payment",
      );
      assert(
        p.created_by !== a.user_id && p.approved_by !== a.user_id,
        403,
        "Use a closer separate from the preparer and approver",
      );
      const existing = await c.env.DB.prepare(
        `SELECT id FROM el_zero_payroll_closures WHERE org_id=? AND ${column}=?`,
      )
        .bind(a.org_id, p.id)
        .first();
      assert(!existing, 409, "Payroll already closed without payment");
      const zone = (await c.env.DB.prepare(
        "SELECT timezone FROM el_organizations WHERE id=?",
      )
        .bind(a.org_id)
        .first<{ timezone: string }>())!.timezone;
      const end = Temporal.PlainYearMonth.from(p.month)
        .toPlainDate({ day: 1 })
        .add({ months: 1 })
        .subtract({ days: 1 })
        .toString();
      assert(
        d.date >= end && d.date <= Temporal.Now.plainDateISO(zone).toString(),
        400,
        "Closure date must be from payroll month end through today",
      );
      const id = uid();
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO el_zero_payroll_closures(id,org_id,branch_id,${column},closed_by,closed_on,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`,
        ).bind(
          id,
          a.org_id,
          p.branch_id,
          p.id,
          a.user_id,
          d.date,
          d.reason,
          now(),
        ),
        audit(
          c,
          path === "payroll" ? "payroll" : "staff_payroll",
          p.id,
          "close_zero_no_payment",
          p,
          { ...d, closure_id: id, money_moved: false },
        ),
      ]);
      return c.json({ id, closed_without_payment: true }, 201);
    });
  }
}
