import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Temporal } from "@js-temporal/polyfill";
import app from "../src/server/app";
import { runAutomation } from "../src/server/system";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
let org: string, branch: string, owner: string;
const day = Temporal.Now.plainDateISO("Africa/Cairo"),
  today = day.toString(),
  future = day.add({ days: 31 }).toString();
function staff(
  id: string,
  resource: string,
  scope: string | null = branch,
  key: string | null = null,
  status = "active",
  optout = false,
) {
  raw
    .prepare(
      "INSERT INTO el_users(id,name,email,password_hash) VALUES(?,?,?,?)",
    )
    .run(id, id, id + "@example.invalid", "test-only-unusable");
  raw
    .prepare("INSERT INTO el_roles(id,org_id,name,system_key) VALUES(?,?,?,?)")
    .run(id + "r", org, id, key);
  if (resource)
    raw
      .prepare(
        "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,?,'view')",
      )
      .run(id + "r", resource);
  raw
    .prepare(
      "INSERT INTO el_memberships(id,org_id,user_id,role_id,branch_id,status) VALUES(?,?,?,?,?,?)",
    )
    .run(id + "m", org, id, id + "r", scope, status);
  if (optout)
    raw
      .prepare(
        "INSERT INTO el_notification_preferences(org_id,user_id,in_app) VALUES(?,?,0)",
      )
      .run(org, id);
}
function lead(
  id: string,
  user: string,
  date = today,
  scope = branch,
  stage = "new",
  demo = 0,
) {
  raw
    .prepare(
      "INSERT INTO el_leads(id,org_id,branch_id,name,source,assigned_to,follow_up_on,stage,is_demo) VALUES(?,?,?,?,?,?,?,?,?)",
    )
    .run(id, org, scope, id, "phone", user, date, stage, demo);
}
function employee(id: string, status = "active", demo = 0, scope = branch) {
  raw
    .prepare(
      "INSERT INTO el_employees(id,org_id,branch_id,code,name,job_title,hired_on,status,is_demo) VALUES(?,?,?,?,?,'Tutor',?,?,?)",
    )
    .run(id, org, scope, id, id, today, status, demo);
}
function contract(
  id: string,
  emp: string,
  end = today,
  demo = 0,
  scope = branch,
) {
  raw
    .prepare(
      "INSERT INTO el_contracts(id,org_id,branch_id,employee_id,title,starts_on,ends_on,salary,is_demo) VALUES(?,?,?,?,?,'2020-01-01',?,1000,?)",
    )
    .run(id, org, scope, emp, id, end, demo);
}
function stock(
  id: string,
  quantity = 0,
  status = "active",
  demo = 0,
  scope = branch,
) {
  raw
    .prepare(
      "INSERT INTO el_inventory_items(id,org_id,sku,name,category,reorder_level,status,is_demo,created_at) VALUES(?,?,?,?,'Books',1,?,?,0)",
    )
    .run(id, org, id, id, status, demo);
  raw
    .prepare(
      "INSERT INTO el_stock_balances(org_id,branch_id,item_id,quantity) VALUES(?,?,?,?)",
    )
    .run(org, scope, id, quantity);
}
const events = (kind: string) =>
  raw
    .prepare(
      "SELECT user_id,entity_id,period FROM el_automation_events WHERE org_id=? AND kind=? ORDER BY user_id,entity_id",
    )
    .all(org, kind) as any[];
test("staff reminders enforce current resources, roles, scope and dedupe", async (t) => {
  const r = await app.request(
    "http://local/api/auth/register",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-connecting-ip": "staff-automation",
      },
      body: JSON.stringify({
        name: "Owner",
        email: "staff-automation@example.invalid",
        password: "Test-only-password-2026",
        organization: "Fictional Reminder Center",
      }),
    },
    { DB: db, ENVIRONMENT: "test" },
  );
  assert.equal(r.status, 201, await r.text());
  org = (raw.prepare("SELECT id FROM el_organizations").get() as any).id;
  branch = (raw.prepare("SELECT id FROM el_branches").get() as any).id;
  owner = (raw.prepare("SELECT id FROM el_users").get() as any).id;
  raw
    .prepare(
      "INSERT INTO el_branches(id,org_id,name,code) VALUES('other-branch',?,'Other Branch','OTHER')",
    )
    .run(org);
  staff("crm", "crm");
  staff("inventory", "inventory");
  staff("hr", "hr");
  staff("none", "");
  staff("suspended", "crm", branch, null, "suspended");
  staff("portal", "crm", branch, "parent_guardian");
  staff("other", "crm", "other-branch");
  staff("optout", "crm", branch, null, "active", true);
  for (const id of ["crm", "none", "suspended", "portal", "other", "optout"])
    lead("lead-" + id, id);
  lead("future", "crm", future);
  lead("demo", "crm", today, branch, "new", 1);
  lead("lost", "crm", today, branch, "lost");
  lead("registered", "crm", today, branch, "registered");
  employee("employee");
  employee("terminated", "terminated");
  employee("demo-employee", "active", 1);
  contract("contract", "employee");
  contract("future-contract", "employee", future);
  contract("past-contract", "employee", day.subtract({ days: 1 }).toString());
  contract("terminated-contract", "terminated");
  contract("demo-contract", "employee", today, 1);
  contract("demo-person-contract", "demo-employee");
  stock("low");
  stock("sufficient", 2);
  stock("inactive", 0, "inactive");
  stock("demo-stock", 0, "active", 1);
  stock("other-stock", 0, "active", 0, "other-branch");
  await t.test("new staff rules default off", async () => {
    await runAutomation(db, org, "test");
    assert.equal(events("lead_followup").length, 0);
    assert.equal(events("contract_expiry").length, 0);
    assert.equal(events("low_stock").length, 0);
  });
  raw
    .prepare(
      "INSERT INTO el_automation_settings(org_id,enabled,lead_followups,contract_expiry,low_stock) VALUES(?,0,1,1,1)",
    )
    .run(org);
  await t.test(
    "eligible custom role gets reminders; nonstaff, missing permissions and mismatched branches do not",
    async () => {
      await runAutomation(db, org, "test");
      assert.deepEqual(
        events("lead_followup").map((x) => x.user_id),
        ["crm"],
      );
      assert.deepEqual(
        events("contract_expiry").map((x) => x.entity_id),
        ["contract", "contract"],
      );
      assert(events("contract_expiry").some((x) => x.user_id === "hr"));
      assert(events("contract_expiry").some((x) => x.user_id === owner));
      assert.equal(events("low_stock").length, 3);
      assert.equal(
        events("low_stock").filter((x) => x.user_id === "inventory").length,
        1,
      );
      assert.equal(
        events("low_stock").find((x) => x.user_id === "inventory").entity_id,
        branch + ":low",
      );
      assert.equal((await runAutomation(db, org, "test")).created, 0);
    },
  );
  await t.test(
    "reassignment, changed due date and permission revocation are re-evaluated",
    async () => {
      raw
        .prepare("UPDATE el_leads SET follow_up_on=? WHERE id=?")
        .run(day.subtract({ days: 1 }).toString(), "lead-crm");
      assert.equal((await runAutomation(db, org, "test")).created, 1);
      raw.prepare("DELETE FROM el_role_permissions WHERE role_id='crmr'").run();
      lead("new-no-permission", "crm");
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare(
          "UPDATE el_leads SET assigned_to=? WHERE id='new-no-permission'",
        )
        .run(owner);
      assert.equal((await runAutomation(db, org, "test")).created, 1);
    },
  );
  await t.test(
    "100 recipient cap does not starve later outstanding records",
    async () => {
      for (let i = 0; i < 105; i++)
        lead("bulk-" + String(i).padStart(3, "0"), owner);
      assert.equal((await runAutomation(db, org, "test")).created, 100);
      assert.equal((await runAutomation(db, org, "test")).created, 5);
      assert.equal((await runAutomation(db, org, "test")).created, 0);
    },
  );
  await t.test(
    "contract date changes produce a new event; monthly low stock is deduplicated",
    async () => {
      raw
        .prepare("UPDATE el_contracts SET ends_on=? WHERE id='contract'")
        .run(day.add({ days: 30 }).toString());
      assert.equal((await runAutomation(db, org, "test")).created, 2);
      raw
        .prepare("UPDATE el_stock_balances SET quantity=1 WHERE item_id='low'")
        .run();
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      assert(events("low_stock").every((x) => x.period === today.slice(0, 7)));
    },
  );
  await t.test(
    "disabled source rules and notice window are honored",
    async () => {
      raw
        .prepare(
          "UPDATE el_automation_settings SET contract_days=1,low_stock=0,lead_followups=0 WHERE org_id=?",
        )
        .run(org);
      lead("disabled-lead", owner);
      stock("disabled-stock");
      contract("outside-window", "employee", day.add({ days: 2 }).toString());
      assert.equal((await runAutomation(db, org, "test")).created, 0);
      raw
        .prepare(
          "UPDATE el_automation_settings SET contract_days=30,low_stock=1,lead_followups=1 WHERE org_id=?",
        )
        .run(org);
      assert.equal((await runAutomation(db, org, "test")).created, 5);
    },
  );
  await t.test(
    "transaction rechecks permission and changed source records before disclosure",
    async () => {
      raw
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES('crmr','crm','view')",
        )
        .run();
      // Finish any previously denied CRM records before arranging the race.
      await runAutomation(db, org, "test");
      lead("race-lead", "crm");
      stock("race-stock");
      contract("race-contract", "employee");
      let hooked = false;
      const guarded = {
        ...db,
        batch: async (statements: Parameters<typeof db.batch>[0]) => {
          if (!hooked) {
            hooked = true;
            raw
              .prepare(
                "UPDATE el_memberships SET status='suspended' WHERE user_id='crm'",
              )
              .run();
            raw
              .prepare(
                "UPDATE el_stock_balances SET quantity=10 WHERE item_id='race-stock'",
              )
              .run();
            raw
              .prepare(
                "UPDATE el_contracts SET ends_on=? WHERE id='race-contract'",
              )
              .run(future);
          }
          return db.batch(statements);
        },
      };
      assert.equal((await runAutomation(guarded, org, "test")).created, 0);
      assert(hooked);
      assert(!events("lead_followup").some((x) => x.entity_id === "race-lead"));
      assert(
        !events("contract_expiry").some((x) => x.entity_id === "race-contract"),
      );
      assert(
        !events("low_stock").some((x) => x.entity_id.endsWith(":race-stock")),
      );
    },
  );
});
