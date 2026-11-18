import type { Hono } from "hono";
import { audit, permit, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
export function registerResourceDemo(app: Hono<any>) {
  app.post("/api/settings/demo/resources", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide permission required");
    const org = await c.env.DB.prepare(
      "SELECT demo_enabled FROM el_organizations WHERE id=?",
    )
      .bind(a.org_id)
      .first<{ demo_enabled: number }>();
    assert(org?.demo_enabled, 409, "Enable demo mode first");
    if (
      await c.env.DB.prepare(
        "SELECT id FROM el_inventory_items WHERE org_id=? AND is_demo=1 LIMIT 1",
      )
        .bind(a.org_id)
        .first()
    )
      return c.json({ ok: true });
    const br = await c.env.DB.prepare(
      "SELECT id FROM el_branches WHERE org_id=? AND is_demo=1 ORDER BY name LIMIT 1",
    )
      .bind(a.org_id)
      .first<{ id: string }>();
    assert(br, 409, "Populate academic demo first");
    const item = uid(),
      book = uid(),
      ticket = uid(),
      time = now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_inventory_items(id,org_id,sku,name,category,unit,reorder_level,unit_cost,sale_price,is_demo,created_at) VALUES(?,?,'DEMO-WORKBOOK','Practice workbook · fictional','Books','copy',10,40,60,1,?)",
      ).bind(item, a.org_id, time),
      c.env.DB.prepare(
        "INSERT INTO el_stock_movements(id,org_id,branch_id,item_id,quantity,kind,reason,idempotency_key,created_by,created_at,is_demo) VALUES(?,?,?,?,8,'adjustment','Fictional opening stock',?,?,?,1)",
      ).bind(uid(), a.org_id, br.id, item, uid(), a.user_id, time),
      c.env.DB.prepare(
        "INSERT INTO el_suppliers(id,org_id,branch_id,name,is_demo,created_at) VALUES(?,?,?,'Learning Supplies · fictional',1,?)",
      ).bind(uid(), a.org_id, br.id, time),
      c.env.DB.prepare(
        "INSERT INTO el_assets(id,org_id,branch_id,code,name,location,value,is_demo,created_at) VALUES(?,?,?,'DEMO-PROJECTOR','Class projector · fictional','Room 1',12000,1,?)",
      ).bind(uid(), a.org_id, br.id, time),
      c.env.DB.prepare(
        "INSERT INTO el_library_books(id,org_id,title,author,category,description,is_demo,created_at) VALUES(?,?,'Learning through questions · fictional','Demo author','Study skills','A fictional library catalog example.',1,?)",
      ).bind(book, a.org_id, time),
      c.env.DB.prepare(
        "INSERT INTO el_library_copies(id,org_id,branch_id,book_id,barcode,is_demo) VALUES(?,?,?,?,'DEMO-LIB-001',1)",
      ).bind(uid(), a.org_id, br.id, book),
      c.env.DB.prepare(
        "INSERT INTO el_support_tickets(id,org_id,branch_id,number,created_by,category,priority,subject,body,is_demo,created_at,updated_at) VALUES(?,?,?,'DEMO-HELP-001',?,'general','normal','Library opening hours · fictional','A fictional request to confirm library opening hours.',1,?,?)",
      ).bind(ticket, a.org_id, br.id, a.user_id, time, time),
      c.env.DB.prepare(
        "INSERT INTO el_ticket_messages(id,org_id,ticket_id,user_id,body,internal,is_demo,created_at) VALUES(?,?,?,?,'Demo public reply: please check with reception before visiting.',0,1,?)",
      ).bind(uid(), a.org_id, ticket, a.user_id, time),
      audit(c, "resources_demo", a.org_id, "seed", null, { fictional: true }),
    ]);
    return c.json({ ok: true });
  });
}
