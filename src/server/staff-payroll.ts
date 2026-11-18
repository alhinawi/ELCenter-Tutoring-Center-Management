import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { uid } from "./db";
import { assert } from "./security";
import { permit, audit, type AppContext } from "./app";
import { date, accounts, journal } from "./finance";
import { operationRecord } from "./operations";
async function row(c: AppContext, id: string) {
  const p = await c.env.DB.prepare(
    "SELECT * FROM el_staff_payroll WHERE id=? AND org_id=?",
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(p, 404, "Payroll record not found");
  const a = c.get("actor");
  assert(
    !a.branch_id || a.branch_id === p.branch_id,
    403,
    "Branch access denied",
  );
  return p;
}
export function registerStaffPayroll(app: Hono<any>) {
  app.get("/api/staff-payroll/options", async (c: AppContext) => {
    permit(c, "payroll");
    const a = c.get("actor");
    return c.json({
      employees: (
        await c.env.DB.prepare(
          "SELECT id,name,branch_id FROM el_employees WHERE org_id=? AND (? IS NULL OR branch_id=?) AND status IN ('active','onboarding','on_leave') ORDER BY name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.get("/api/staff-payroll", async (c: AppContext) => {
    permit(c, "payroll");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT p.*,e.name,z.closed_on zero_closed_on,z.reason zero_closure_reason FROM el_staff_payroll p JOIN el_employees e ON e.id=p.employee_id LEFT JOIN el_zero_payroll_closures z ON z.org_id=p.org_id AND z.staff_payroll_id=p.id WHERE p.org_id=? AND (? IS NULL OR p.branch_id=?) ORDER BY p.month DESC,p.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/staff-payroll", async (c: AppContext) => {
    permit(c, "payroll", "create");
    const d = z
      .object({
        employee_id: z.uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        bonus: z.number().int().min(0).max(100000000).default(0),
        deduction: z.number().int().min(0).max(100000000).default(0),
        reason: z.string().trim().max(500).default(""),
      })
      .parse(await c.req.json());
    assert(
      !(d.bonus || d.deduction) || d.reason,
      400,
      "Adjustment reason required",
    );
    const employee = await operationRecord(c, "employees", d.employee_id);
    let month;
    try {
      month = Temporal.PlainYearMonth.from(d.month);
    } catch {
      assert(false, 400, "Invalid payroll month");
    }
    const start = month.toPlainDate({ day: 1 }),
      end = start.add({ months: 1 }),
      last = end.subtract({ days: 1 });
    const contracts = (
      await c.env.DB.prepare(
        "SELECT * FROM el_contracts WHERE org_id=? AND employee_id=? AND starts_on<=? AND ends_on>=? ORDER BY starts_on DESC LIMIT 2",
      )
        .bind(employee.org_id, employee.id, start.toString(), last.toString())
        .all<Record<string, any>>()
    ).results;
    assert(
      contracts.length === 1,
      409,
      "Payroll needs exactly one contract covering the full month; prorated contracts need review",
    );
    const contract = contracts[0];
    assert(
      /^[1-7](,[1-7])*$/.test(contract.workweek),
      409,
      "Set explicit ISO working weekdays on the contract first",
    );
    const workweek = new Set(contract.workweek.split(",").map(Number));
    const attendance = (
      await c.env.DB.prepare(
        "SELECT * FROM el_employee_attendance WHERE org_id=? AND employee_id=? AND date>=? AND date<?",
      )
        .bind(employee.org_id, employee.id, start.toString(), end.toString())
        .all<Record<string, any>>()
    ).results;
    const leave = (
      await c.env.DB.prepare(
        "SELECT * FROM el_leave_requests WHERE org_id=? AND employee_id=? AND status='approved' AND starts_on<=? AND ends_on>=?",
      )
        .bind(employee.org_id, employee.id, last.toString(), start.toString())
        .all<Record<string, any>>()
    ).results;
    let scheduled = 0,
      absent = 0,
      unpaid = 0,
      missing = 0,
      overtime = 0;
    for (
      let day = start;
      Temporal.PlainDate.compare(day, end) < 0;
      day = day.add({ days: 1 })
    ) {
      const key = day.toString(),
        record = attendance.find((x) => x.date === key),
        off = leave.find((x) => x.starts_on <= key && x.ends_on >= key),
        working = workweek.has(day.dayOfWeek);
      if (working) {
        scheduled++;
        if (off?.type === "unpaid") unpaid++;
        else if (!off && !record) missing++;
        else if (!off && record?.status === "absent") absent++;
      }
      if (record && ["present", "late"].includes(record.status))
        overtime += Math.max(
          0,
          record.minutes - (working ? contract.hours_per_day * 60 : 0),
        );
    }
    assert(
      scheduled > 0 && missing === 0,
      409,
      `Attendance is incomplete for ${missing} scheduled day(s); record attendance or approved leave first`,
    );
    const absence_deduction = Math.round(
        (contract.salary * (absent + unpaid)) / scheduled,
      ),
      overtime_pay = Math.round((overtime * contract.overtime_rate) / 60),
      total =
        contract.salary -
        absence_deduction +
        overtime_pay +
        d.bonus -
        d.deduction;
    assert(
      Number.isSafeInteger(total) && total >= 0 && total <= 1000000000,
      400,
      "Payroll total out of range",
    );
    const calculation = {
        contract: {
          id: contract.id,
          salary: contract.salary,
          hours_per_day: contract.hours_per_day,
          workweek: contract.workweek,
          overtime_rate: contract.overtime_rate,
        },
        scheduled_days: scheduled,
        absent_days: absent,
        unpaid_leave_days: unpaid,
        absence_deduction,
        overtime_minutes: overtime,
        overtime_pay,
        bonus: d.bonus,
        deduction: d.deduction,
        reason: d.reason,
        rounding: "nearest whole currency unit",
        attendance_ids: attendance.map((x) => x.id),
        leave_ids: leave.map((x) => x.id),
      },
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_staff_payroll(id,org_id,branch_id,employee_id,contract_id,month,calculation_json,total,created_by) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        employee.org_id,
        employee.branch_id,
        employee.id,
        contract.id,
        d.month,
        JSON.stringify(calculation),
        total,
        c.get("actor").user_id,
      ),
      audit(c, "staff_payroll", id, "calculate", null, {
        ...d,
        total,
        calculation,
      }),
    ]);
    return c.json({ id, total }, 201);
  });
  for (const action of ["approve", "pay"] as const)
    app.post("/api/staff-payroll/:id/" + action, async (c: AppContext) => {
      permit(c, action === "approve" ? "payroll" : "finance", "approve");
      const p = await row(c, c.req.param("id")!),
        a = c.get("actor"),
        d = z
          .object({ date, method: z.enum(["cash", "bank"]).default("bank") })
          .parse(await c.req.json());
      assert(
        p.status === (action === "approve" ? "draft" : "approved"),
        409,
        "Invalid employee payroll state",
      );
      assert(
        a.user_id !== p.created_by &&
          (action === "approve" || a.user_id !== p.approved_by),
        403,
        "Use a separate preparer approver and payer",
      );
      if (action === "approve")
        assert(
          d.date >=
            Temporal.PlainYearMonth.from(p.month)
              .toPlainDate({ day: 1 })
              .add({ months: 1 })
              .subtract({ days: 1 })
              .toString(),
          400,
          "Approval date cannot precede the payroll month end",
        );
      else if (p.accrual_journal_id) {
        const accrual = await c.env.DB.prepare(
          "SELECT date FROM el_journals WHERE id=?",
        )
          .bind(p.accrual_journal_id)
          .first<{ date: string }>();
        assert(
          accrual && d.date >= accrual.date,
          400,
          "Payment cannot precede payroll accrual",
        );
      }
      if (action === "pay")
        assert(p.total > 0, 409, "Zero payroll must close without payment");
      const ac = p.total ? await accounts(c) : null;
      const j = p.total
        ? await journal(c, {
            branch: p.branch_id,
            date: d.date,
            reference:
              (action === "approve" ? "SAL-ACCRUAL-" : "SAL-PAY-") + p.id,
            source:
              action === "approve"
                ? "staff_payroll_accrual"
                : "staff_payroll_payment",
            sourceId: p.id,
            memo: "Employee payroll " + p.month,
            lines:
              action === "approve"
                ? [
                    { account: ac!.payroll_expense, debit: p.total, credit: 0 },
                    { account: ac!.payroll_payable, debit: 0, credit: p.total },
                  ]
                : [
                    { account: ac!.payroll_payable, debit: p.total, credit: 0 },
                    {
                      account: d.method === "cash" ? ac!.cash : ac!.bank,
                      debit: 0,
                      credit: p.total,
                    },
                  ],
          })
        : null;
      await c.env.DB.batch([
        ...(j?.statements ?? []),
        c.env.DB.prepare(
          `UPDATE el_staff_payroll SET status=?,${action === "approve" ? "approved_by=?,accrual_journal_id" : "paid_by=?,payment_journal_id"}=? WHERE id=?`,
        ).bind(
          action === "approve" ? "approved" : "paid",
          a.user_id,
          j?.id ?? null,
          p.id,
        ),
        audit(c, "staff_payroll", p.id, action, p, d),
      ]);
      return c.json({ ok: true });
    });
}
