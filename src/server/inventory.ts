import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import { date } from "./finance";
const title = z.string().trim().min(1).max(160),
  text = z.string().trim().max(1000).default(""),
  money = z.number().int().min(0).max(1000000000),
  qty = z.number().int().positive().max(1000000);
export async function resource(c: AppContext, table: string, id: string) {
  const r = await c.env.DB.prepare(
    `SELECT * FROM el_${table} WHERE id=? AND org_id=?`,
  )
    .bind(id, c.get("actor").org_id)
    .first<Record<string, any>>();
  assert(r, 404, "Resource not found");
  if (r.branch_id) scope(c, r.branch_id);
  return r;
}
export async function activeBranch(c: AppContext, id: string) {
  scope(c, id);
  assert(
    await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
    )
      .bind(id, c.get("actor").org_id)
      .first(),
    400,
    "Choose an active branch",
  );
}
function move(
  c: AppContext,
  d: {
    branch: string;
    item: string;
    quantity: number;
    kind: string;
    reference?: string;
    reason: string;
    key: string;
  },
) {
  const a = c.get("actor");
  return c.env.DB.prepare(
    "INSERT INTO el_stock_movements(id,org_id,branch_id,item_id,quantity,kind,reference_id,reason,idempotency_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    uid(),
    a.org_id,
    d.branch,
    d.item,
    d.quantity,
    d.kind,
    d.reference ?? null,
    d.reason,
    d.key,
    a.user_id,
    now(),
  );
}
export function registerInventory(app: Hono<any>) {
  app.get("/api/resource-options", async (c: AppContext) => {
    const a = c.get("actor"),
      has = (r: string) => a.permissions.includes(r + ":view");
    assert(
      has("inventory") || has("library") || has("documents") || has("reports"),
      403,
      "Resource access required",
    );
    const out: Record<string, unknown> = {
      branches: (
        await c.env.DB.prepare(
          "SELECT id,name FROM el_branches WHERE org_id=? AND status='active' AND (? IS NULL OR id=?) ORDER BY name LIMIT 200",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    };
    if (has("library"))
      out.students = (
        await c.env.DB.prepare(
          "SELECT id,name,code FROM el_students WHERE org_id=? AND status='active' AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    if (has("inventory"))
      out.employees = (
        await c.env.DB.prepare(
          "SELECT id,name FROM el_employees WHERE org_id=? AND status='active' AND (? IS NULL OR branch_id=?) ORDER BY name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results;
    return c.json(out);
  });

  const schemas = {
    suppliers: z.object({
      branch_id: z.uuid(),
      name: title,
      email: z.union([z.email(), z.literal("")]).default(""),
      phone: text,
      address: text,
      status: z.enum(["active", "inactive"]).default("active"),
    }),
    inventory_items: z.object({
      sku: title,
      name: title,
      category: title,
      unit: title.default("unit"),
      reorder_level: z.number().int().min(0).max(1000000).default(0),
      unit_cost: money.default(0),
      sale_price: money.default(0),
      status: z.enum(["active", "inactive"]).default("active"),
    }),
    assets: z.object({
      branch_id: z.uuid(),
      item_id: z.union([z.uuid(), z.literal("")]).default(""),
      code: title,
      name: title,
      serial: text,
      location: text,
      purchased_on: z.union([date, z.literal("")]).default(""),
      value: money.default(0),
    }),
  };
  for (const table of ["suppliers", "inventory_items", "assets"] as const) {
    app.get("/api/inventory/" + table, async (c: AppContext) => {
      permit(c, "inventory");
      const a = c.get("actor"),
        where =
          table === "inventory_items" ? "" : " AND (? IS NULL OR branch_id=?)";
      return c.json({
        data: (
          await c.env.DB.prepare(
            `SELECT * FROM el_${table} WHERE org_id=?${where} ORDER BY name LIMIT 200`,
          )
            .bind(a.org_id, ...(where ? [a.branch_id, a.branch_id] : []))
            .all()
        ).results,
      });
    });
    app.post("/api/inventory/" + table, async (c: AppContext) => {
      permit(c, "inventory", "create");
      const a = c.get("actor"),
        d = schemas[table].parse(await c.req.json()) as Record<string, any>;
      if (d.branch_id) await activeBranch(c, d.branch_id);
      if (table === "inventory_items")
        assert(
          !a.branch_id,
          403,
          "Organization-wide item catalog management required",
        );
      if (table === "assets") {
        if (d.item_id) await resource(c, "inventory_items", d.item_id);
        else d.item_id = null;
      }
      const id = uid(),
        keys = Object.keys(d);
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO el_${table}(id,org_id,${keys.join(",")},created_at) VALUES(${Array(
            keys.length + 3,
          )
            .fill("?")
            .join(",")})`,
        ).bind(id, a.org_id, ...keys.map((k) => d[k]), now()),
        audit(c, table, id, "create", null, d),
      ]);
      return c.json({ id }, 201);
    });
  }
  app.get("/api/inventory/stock", async (c: AppContext) => {
    permit(c, "inventory");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT b.branch_id,br.name branch_name,b.item_id,i.sku,i.name,i.category,i.reorder_level,i.unit,i.unit_cost,b.quantity,b.quantity*i.unit_cost valuation,CASE WHEN b.quantity<=i.reorder_level THEN 1 ELSE 0 END low_stock FROM el_stock_balances b JOIN el_inventory_items i ON i.id=b.item_id JOIN el_branches br ON br.id=b.branch_id WHERE b.org_id=? AND (? IS NULL OR b.branch_id=?) ORDER BY br.name,i.name LIMIT 500",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.get("/api/inventory/movements", async (c: AppContext) => {
    permit(c, "inventory");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT m.*,i.name item_name,b.name branch_name FROM el_stock_movements m JOIN el_inventory_items i ON i.id=m.item_id JOIN el_branches b ON b.id=m.branch_id WHERE m.org_id=? AND (? IS NULL OR m.branch_id=?) ORDER BY m.created_at DESC,m.id LIMIT 200",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/adjustments", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    const d = z
      .object({
        branch_id: z.uuid(),
        item_id: z.uuid(),
        quantity: z
          .number()
          .int()
          .min(-1000000)
          .max(1000000)
          .refine((x) => x !== 0),
        reason: title,
        idempotency_key: z.uuid(),
      })
      .parse(await c.req.json());
    await activeBranch(c, d.branch_id);
    await resource(c, "inventory_items", d.item_id);
    const old = await c.env.DB.prepare(
      "SELECT item_id,branch_id,quantity FROM el_stock_movements WHERE org_id=? AND idempotency_key=?",
    )
      .bind(c.get("actor").org_id, d.idempotency_key)
      .first<Record<string, any>>();
    if (old) {
      assert(
        old.item_id === d.item_id &&
          old.branch_id === d.branch_id &&
          old.quantity === d.quantity,
        409,
        "Idempotency key does not match",
      );
      return c.json({ ok: true, replayed: true });
    }
    await c.env.DB.batch([
      move(c, {
        branch: d.branch_id,
        item: d.item_id,
        quantity: d.quantity,
        kind: "adjustment",
        reason: d.reason,
        key: d.idempotency_key,
      }),
      audit(c, "stock", d.item_id, "adjustment", null, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/inventory/purchases", async (c: AppContext) => {
    permit(c, "inventory");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT p.*,s.name supplier_name,b.name branch_name FROM el_purchase_orders p JOIN el_suppliers s ON s.id=p.supplier_id JOIN el_branches b ON b.id=p.branch_id WHERE p.org_id=? AND (? IS NULL OR p.branch_id=?) ORDER BY p.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/purchases", async (c: AppContext) => {
    permit(c, "inventory", "create");
    const a = c.get("actor"),
      d = z
        .object({
          branch_id: z.uuid(),
          supplier_id: z.uuid(),
          number: title,
          date,
          lines: z
            .array(
              z.object({ item_id: z.uuid(), quantity: qty, unit_cost: money }),
            )
            .min(1)
            .max(20),
        })
        .parse(await c.req.json());
    await activeBranch(c, d.branch_id);
    const supplier = await resource(c, "suppliers", d.supplier_id);
    assert(
      supplier.branch_id === d.branch_id && supplier.status === "active",
      400,
      "Supplier must be active in this branch",
    );
    assert(
      new Set(d.lines.map((x) => x.item_id)).size === d.lines.length,
      400,
      "Duplicate purchase item",
    );
    for (const line of d.lines)
      await resource(c, "inventory_items", line.item_id);
    const total = d.lines.reduce((s, l) => s + l.quantity * l.unit_cost, 0);
    assert(
      total > 0 && Number.isSafeInteger(total) && total <= 1000000000,
      400,
      "Purchase total out of range",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_purchase_orders(id,org_id,branch_id,supplier_id,number,date,total,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.branch_id,
        d.supplier_id,
        d.number,
        d.date,
        total,
        a.user_id,
        now(),
      ),
      ...d.lines.map((l) =>
        c.env.DB.prepare(
          "INSERT INTO el_purchase_lines(id,org_id,order_id,item_id,quantity,unit_cost) VALUES(?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, id, l.item_id, l.quantity, l.unit_cost),
      ),
      audit(c, "purchase", id, "create", null, {
        total,
        lines: d.lines.length,
      }),
    ]);
    return c.json({ id, total }, 201);
  });
  app.get("/api/inventory/purchases/:id", async (c: AppContext) => {
    permit(c, "inventory");
    const data = await resource(c, "purchase_orders", c.req.param("id")!);
    return c.json({
      data,
      lines: (
        await c.env.DB.prepare(
          "SELECT l.*,i.name item_name FROM el_purchase_lines l JOIN el_inventory_items i ON i.id=l.item_id WHERE l.order_id=? AND l.org_id=?",
        )
          .bind(data.id, data.org_id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/purchases/:id/action", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    const p = await resource(c, "purchase_orders", c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({ action: z.enum(["order", "receive", "cancel"]) })
        .parse(await c.req.json());
    assert(
      (d.action === "order" && p.status === "draft") ||
        (d.action === "receive" && p.status === "ordered") ||
        (d.action === "cancel" && ["draft", "ordered"].includes(p.status)),
      409,
      "Purchase order transition is invalid",
    );
    if (d.action === "receive")
      assert(
        p.ordered_by !== a.user_id,
        403,
        "A different inventory user must receive ordered stock",
      );
    const statements = [];
    if (d.action === "receive") {
      const lines = (
        await c.env.DB.prepare(
          "SELECT * FROM el_purchase_lines WHERE order_id=?",
        )
          .bind(p.id)
          .all<Record<string, any>>()
      ).results;
      for (const l of lines)
        statements.push(
          move(c, {
            branch: p.branch_id,
            item: l.item_id,
            quantity: l.quantity,
            kind: "receipt",
            reference: p.id,
            reason: "Purchase " + p.number,
            key: "purchase:" + p.id + ":" + l.id,
          }),
        );
    }
    statements.push(
      c.env.DB.prepare(
        "UPDATE el_purchase_orders SET status=?,ordered_by=COALESCE(ordered_by,?),received_by=? WHERE id=?",
      ).bind(
        d.action === "order"
          ? "ordered"
          : d.action === "receive"
            ? "received"
            : "cancelled",
        d.action === "order" ? a.user_id : null,
        d.action === "receive" ? a.user_id : null,
        p.id,
      ),
      audit(c, "purchase", p.id, d.action, { status: p.status }, null),
    );
    await c.env.DB.batch(statements);
    return c.json({ ok: true });
  });
  app.get("/api/inventory/transfers", async (c: AppContext) => {
    permit(c, "inventory");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT tr.*,i.name item_name,f.name from_name,t.name to_name FROM el_stock_transfers tr JOIN el_inventory_items i ON i.id=tr.item_id JOIN el_branches f ON f.id=tr.from_branch JOIN el_branches t ON t.id=tr.to_branch WHERE tr.org_id=? AND (? IS NULL OR tr.from_branch=? OR tr.to_branch=?) ORDER BY tr.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/transfers", async (c: AppContext) => {
    permit(c, "inventory", "create");
    const a = c.get("actor"),
      d = z
        .object({
          from_branch: z.uuid(),
          to_branch: z.uuid(),
          item_id: z.uuid(),
          quantity: qty,
        })
        .refine((d) => d.from_branch !== d.to_branch)
        .parse(await c.req.json());
    await activeBranch(c, d.from_branch);
    assert(
      await c.env.DB.prepare(
        "SELECT id FROM el_branches WHERE id=? AND org_id=? AND status='active'",
      )
        .bind(d.to_branch, a.org_id)
        .first(),
      400,
      "Destination unavailable",
    );
    await resource(c, "inventory_items", d.item_id);
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_stock_transfers(id,org_id,from_branch,to_branch,item_id,quantity,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.from_branch,
        d.to_branch,
        d.item_id,
        d.quantity,
        a.user_id,
        now(),
      ),
      audit(c, "stock_transfer", id, "request", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/inventory/transfers/:id/decision", async (c: AppContext) => {
    permit(c, "inventory", "approve");
    const a = c.get("actor");
    assert(
      !a.branch_id,
      403,
      "Headquarters must approve inter-branch stock movements",
    );
    const tr = await resource(c, "stock_transfers", c.req.param("id")!),
      d = z
        .object({ decision: z.enum(["approved", "rejected"]) })
        .parse(await c.req.json());
    assert(
      tr.status === "pending" && tr.requested_by !== a.user_id,
      409,
      "Stock transfer requires an independent pending decision",
    );
    const stmts = [];
    if (d.decision === "approved")
      stmts.push(
        move(c, {
          branch: tr.from_branch,
          item: tr.item_id,
          quantity: -tr.quantity,
          kind: "transfer_out",
          reference: tr.id,
          reason: "Inter-branch transfer",
          key: tr.id + ":out",
        }),
        move(c, {
          branch: tr.to_branch,
          item: tr.item_id,
          quantity: tr.quantity,
          kind: "transfer_in",
          reference: tr.id,
          reason: "Inter-branch transfer",
          key: tr.id + ":in",
        }),
      );
    stmts.push(
      c.env.DB.prepare(
        "UPDATE el_stock_transfers SET status=?,decided_by=? WHERE id=?",
      ).bind(d.decision, a.user_id, tr.id),
      audit(
        c,
        "stock_transfer",
        tr.id,
        d.decision,
        { status: tr.status },
        null,
      ),
    );
    await c.env.DB.batch(stmts);
    return c.json({ ok: true });
  });

  app.get("/api/inventory/sales", async (c: AppContext) => {
    permit(c, "inventory");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT sa.*,i.number invoice_number,s.name student_name FROM el_stock_sales sa JOIN el_invoices i ON i.id=sa.invoice_id JOIN el_students s ON s.id=sa.student_id WHERE sa.org_id=? AND (? IS NULL OR sa.branch_id=?) ORDER BY sa.created_at DESC LIMIT 100",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/sales", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    permit(c, "finance");
    const a = c.get("actor"),
      d = z
        .object({
          invoice_id: z.uuid(),
          lines: z
            .array(
              z.object({ item_id: z.uuid(), quantity: qty, unit_price: money }),
            )
            .min(1)
            .max(20),
        })
        .parse(await c.req.json()),
      i = await resource(c, "invoices", d.invoice_id);
    assert(
      i.status === "issued",
      409,
      "Stock sale requires an issued matching invoice",
    );
    assert(
      new Set(d.lines.map((l) => l.item_id)).size === d.lines.length,
      400,
      "Duplicate sale item",
    );
    for (const l of d.lines) await resource(c, "inventory_items", l.item_id);
    const total = d.lines.reduce((n, l) => n + l.quantity * l.unit_price, 0);
    assert(
      total > 0 && Number.isSafeInteger(total) && total <= i.total,
      400,
      "Stock value must be positive and covered by the issued invoice",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_stock_sales(id,org_id,branch_id,invoice_id,student_id,total,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        i.branch_id,
        i.id,
        i.student_id,
        total,
        a.user_id,
        now(),
      ),
      ...d.lines.flatMap((l) => [
        c.env.DB.prepare(
          "INSERT INTO el_stock_sale_lines(id,org_id,sale_id,item_id,quantity,unit_price) VALUES(?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, id, l.item_id, l.quantity, l.unit_price),
        move(c, {
          branch: i.branch_id,
          item: l.item_id,
          quantity: -l.quantity,
          kind: "sale",
          reference: id,
          reason: "Dispatch on invoice " + i.number,
          key: "sale:" + id + ":" + l.item_id,
        }),
      ]),
      audit(c, "stock_sale", id, "dispatch", null, { invoice_id: i.id, total }),
    ]);
    return c.json({ id, total }, 201);
  });
  app.post("/api/inventory/sales/:id/return", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    const sa = await resource(c, "stock_sales", c.req.param("id")!),
      a = c.get("actor");
    assert(sa.status === "dispatched", 409, "Stock sale can only return once");
    const lines = (
      await c.env.DB.prepare(
        "SELECT * FROM el_stock_sale_lines WHERE sale_id=?",
      )
        .bind(sa.id)
        .all<Record<string, any>>()
    ).results;
    await c.env.DB.batch([
      ...lines.map((l) =>
        move(c, {
          branch: sa.branch_id,
          item: l.item_id,
          quantity: l.quantity,
          kind: "return",
          reference: sa.id,
          reason: "Returned physical goods; finance refund is separate",
          key: "return:" + sa.id + ":" + l.item_id,
        }),
      ),
      c.env.DB.prepare(
        "UPDATE el_stock_sales SET status='returned',returned_by=? WHERE id=?",
      ).bind(a.user_id, sa.id),
      audit(c, "stock_sale", sa.id, "physical_return", null, {
        funds_moved: false,
      }),
    ]);
    return c.json({ ok: true, funds_moved: false });
  });
  app.post("/api/inventory/assets/:id/transfer", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    const asset = await resource(c, "assets", c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({ to_branch: z.uuid(), notes: title })
        .parse(await c.req.json());
    assert(!a.branch_id, 403, "Headquarters must coordinate asset transfers");
    await activeBranch(c, d.to_branch);
    assert(
      asset.status === "available" && asset.branch_id !== d.to_branch,
      409,
      "Only available assets can transfer to another branch",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_asset_transfers(id,org_id,asset_id,from_branch,to_branch,notes,requested_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        asset.id,
        asset.branch_id,
        d.to_branch,
        d.notes,
        a.user_id,
        now(),
      ),
      audit(c, "asset_transfer", id, "request", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post(
    "/api/inventory/assets/:id/transfer/:transfer/decision",
    async (c: AppContext) => {
      permit(c, "inventory", "edit");
      const asset = await resource(c, "assets", c.req.param("id")!),
        a = c.get("actor"),
        d = z
          .object({ decision: z.enum(["approved", "rejected"]) })
          .parse(await c.req.json());
      assert(!a.branch_id, 403, "Headquarters must decide asset transfers");
      const tr = await resource(c, "asset_transfers", c.req.param("transfer")!);
      assert(tr.asset_id === asset.id, 404, "Transfer not found");
      assert(
        tr.status === "pending" && tr.requested_by !== a.user_id,
        403,
        "A different headquarters inventory user must decide",
      );
      await activeBranch(c, tr.to_branch);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE el_asset_transfers SET status=?,decided_by=? WHERE id=? AND status='pending'",
        ).bind(d.decision, a.user_id, tr.id),
        c.env.DB.prepare(
          "INSERT INTO el_asset_events(id,org_id,asset_id,kind,notes,cost,created_by,created_at) VALUES(?,?,?,'transfer',?,0,?,?)",
        ).bind(
          uid(),
          a.org_id,
          asset.id,
          d.decision +
            ": " +
            tr.from_branch +
            " -> " +
            tr.to_branch +
            ". " +
            tr.notes,
          a.user_id,
          now(),
        ),
        audit(c, "asset_transfer", tr.id, "decision", tr, d),
      ]);
      return c.json({ ok: true });
    },
  );
  app.get("/api/inventory/assets/:id", async (c: AppContext) => {
    permit(c, "inventory");
    const data = await resource(c, "assets", c.req.param("id")!);
    return c.json({
      data,
      transfers: (
        await c.env.DB.prepare(
          "SELECT t.*,b.name destination FROM el_asset_transfers t JOIN el_branches b ON b.id=t.to_branch WHERE t.org_id=? AND t.asset_id=? ORDER BY t.created_at DESC LIMIT 30",
        )
          .bind(data.org_id, data.id)
          .all()
      ).results,
      events: (
        await c.env.DB.prepare(
          "SELECT * FROM el_asset_events WHERE org_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 100",
        )
          .bind(data.org_id, data.id)
          .all()
      ).results,
    });
  });
  app.post("/api/inventory/assets/:id/event", async (c: AppContext) => {
    permit(c, "inventory", "edit");
    const asset = await resource(c, "assets", c.req.param("id")!),
      a = c.get("actor"),
      d = z
        .object({
          status: z.enum(["available", "assigned", "maintenance", "retired"]),
          employee_id: z.union([z.uuid(), z.literal("")]).default(""),
          location: text,
          notes: title,
          cost: money.default(0),
        })
        .parse(await c.req.json());
    assert(asset.status !== "retired", 409, "Retired assets are immutable");
    if (d.status === "assigned") {
      assert(d.employee_id, 400, "Choose an employee");
      const employee = await resource(c, "employees", d.employee_id);
      assert(
        employee.branch_id === asset.branch_id,
        400,
        "Assignee must be in the same branch",
      );
    } else
      assert(!d.employee_id, 400, "Only assigned assets may name an employee");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_assets SET status=?,employee_id=?,location=? WHERE id=?",
      ).bind(d.status, d.employee_id || null, d.location, asset.id),
      c.env.DB.prepare(
        "INSERT INTO el_asset_events(id,org_id,asset_id,kind,notes,cost,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        uid(),
        a.org_id,
        asset.id,
        d.status,
        d.notes,
        d.cost,
        a.user_id,
        now(),
      ),
      audit(c, "asset", asset.id, "event", { status: asset.status }, d),
    ]);
    return c.json({ ok: true });
  });
}
