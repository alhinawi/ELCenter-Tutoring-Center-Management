import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/server/app";
import { sqliteDatabase } from "../scripts/sqlite";
const { raw, db } = sqliteDatabase();
for (const f of readdirSync("migrations")
  .filter((x) => x.endsWith(".sql"))
  .sort())
  raw.exec(readFileSync("migrations/" + f, "utf8"));
type Client = { cookie: string; csrf: string };
const owner = { cookie: "", csrf: "" },
  second = { cookie: "", csrf: "" },
  student = { cookie: "", csrf: "" },
  foreign = { cookie: "", csrf: "" };
async function call(
  p: string,
  m = "GET",
  b?: unknown,
  c: Client = owner,
  key: string | undefined = "test-only-document-encryption-key-2026",
) {
  const r = await app.request(
    "http://localhost/api" + p,
    {
      method: m,
      headers: {
        "content-type": "application/json",
        cookie: c.cookie,
        "x-csrf-token": c.csrf,
      },
      ...(b ? { body: JSON.stringify(b) } : {}),
    },
    { DB: db, ENVIRONMENT: "test", DOCUMENT_ENCRYPTION_KEY: key },
  );
  if (r.headers.get("set-cookie"))
    c.cookie = r.headers.get("set-cookie")!.split(";")[0];
  let j: any = {};
  if (r.headers.get("content-type")?.includes("application/json"))
    j = await r.json();
  if (p === "/me" && j.user) c.csrf = j.user.csrf;
  return { r, j };
}
test("resources service and encrypted documents", async (t) => {
  await call("/auth/demo", "POST", {});
  const me = (await call("/me")).j;
  await call("/demo/academic-seed", "POST", {});
  const org = me.organization.id,
    g = (await call("/groups")).j.data[0],
    s = (await call("/groups/" + g.id + "/enrollments")).j.data[0],
    branch = g.branch_id,
    roles = (await call("/roles")).j.data;
  async function account(key: string, c: Client) {
    const email = key + randomUUID() + "@example.invalid";
    await call("/users", "POST", {
      name: key,
      email,
      password: "Test-only-password-2026",
      role_id: roles.find((r: any) => r.system_key === key).id,
      branch_id: null,
    });
    await call(
      "/auth/login",
      "POST",
      { email, password: "Test-only-password-2026" },
      c,
    );
    return (await call("/me", "GET", undefined, c)).j.user;
  }
  await account("business_owner", second);
  const stu = await account("student", student);
  await call("/portal-links", "POST", {
    user_id: stu.user_id,
    kind: "student",
    profile_id: s.student_id,
  });
  await call("/auth/demo", "POST", {}, foreign);
  await call("/me", "GET", undefined, foreign);
  let ticket = "",
    document = "",
    item = "",
    supplier = "",
    purchase = "",
    transfer = "",
    book = "",
    copy = "",
    loan = "";
  await t.test(
    "requester tickets, staff notes, assignment, resolution and satisfaction",
    async () => {
      const r = await call(
        "/portal/support",
        "POST",
        {
          student_id: s.student_id,
          category: "academic",
          subject: "Learning question",
          body: "Please help with the course.",
        },
        student,
      );
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      ticket = r.j.id;
      assert.equal(
        (
          await call("/support/" + ticket + "/messages", "POST", {
            body: "Internal note",
            internal: true,
          })
        ).r.status,
        201,
      );
      assert.equal(
        (await call("/portal/support/" + ticket, "GET", undefined, student)).j
          .messages.length,
        0,
      );
      assert.equal(
        (
          await call(
            "/portal/support/" + ticket + "/messages",
            "POST",
            { body: "I need more detail", internal: true },
            student,
          )
        ).r.status,
        403,
      );
      await call("/support/" + ticket + "/messages", "POST", {
        body: "We can help.",
      });
      assert.equal(
        (await call("/portal/support/" + ticket, "GET", undefined, student)).j
          .messages.length,
        1,
      );
      assert.equal(
        (await call("/support/" + ticket, "GET", undefined, foreign)).r.status,
        404,
      );
      assert.equal(
        (
          await call("/support/" + ticket + "/manage", "POST", {
            status: "resolved",
            priority: "high",
            assigned_to: me.user.user_id,
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/portal/support/" + ticket + "/rating",
            "POST",
            { rating: 5, note: "Helpful" },
            student,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call(
            "/portal/support/" + ticket + "/rating",
            "POST",
            { rating: 1 },
            student,
          )
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call("/support/" + ticket + "/manage", "POST", {
            status: "open",
            priority: "normal",
          })
        ).r.status,
        409,
      );
    },
  );
  const pdf = Buffer.from("%PDF-1.4\nFixture document\n%%EOF").toString(
      "base64",
    ),
    file = {
      branch_id: branch,
      target_kind: "student",
      target_id: s.student_id,
      title: "Enrollment certificate",
      category: "student",
      shared_portal: true,
      expires_on: "2027-12-31",
      filename: "certificate.pdf",
      mime: "application/pdf",
      data: pdf,
    };
  await t.test(
    "uploads fail closed, encrypt bytes and preserve exact authenticated downloads",
    async () => {
      assert.equal(
        (await call("/documents", "POST", file, owner, "")).r.status,
        503,
      );
      assert.equal(
        (
          await call("/documents", "POST", {
            ...file,
            data: Buffer.from("not a pdf").toString("base64"),
          })
        ).r.status,
        400,
      );
      const r = await call("/documents", "POST", file);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      document = r.j.id;
      const stored = raw
        .prepare(
          "SELECT ciphertext,iv FROM el_document_versions WHERE document_id=?",
        )
        .get(document) as any;
      assert(!stored.ciphertext.includes("Fixture"));
      assert.notEqual(stored.ciphertext, pdf);
      const download = await call(
        "/portal/documents/" + document + "/download/1",
        "GET",
        undefined,
        student,
      );
      assert.equal(download.r.status, 200);
      assert.equal(
        Buffer.from(await download.r.arrayBuffer()).toString("base64"),
        pdf,
      );
      assert.equal(
        download.r.headers.get("cache-control"),
        "private, no-store",
      );
      assert(
        download.r.headers
          .get("content-disposition")
          ?.startsWith("attachment;"),
      );
      assert.equal(
        (
          await call(
            "/documents/" + document + "/download/1",
            "GET",
            undefined,
            foreign,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call(
            "/documents/" + document + "/download/1",
            "GET",
            undefined,
            owner,
            "wrong-test-only-encryption-key-2026",
          )
        ).r.status,
        503,
      );
    },
  );
  await t.test(
    "new versions are immutable and private/archived files are denied to learners",
    async () => {
      assert.equal(
        (
          await call("/documents/" + document + "/versions", "POST", {
            filename: "updated.pdf",
            mime: "application/pdf",
            data: pdf,
          })
        ).r.status,
        201,
      );
      assert.equal((await call("/documents/" + document)).j.versions.length, 2);
      assert.throws(() =>
        raw
          .prepare(
            "UPDATE el_document_versions SET filename=? WHERE document_id=?",
          )
          .run("changed.pdf", document),
      );
      assert.equal(
        (
          await call(
            "/portal/documents/" + document + "/versions",
            "POST",
            { filename: "bad.pdf", mime: "application/pdf", data: pdf },
            student,
          )
        ).r.status,
        403,
      );
      await call("/documents/" + document, "PUT", {
        title: file.title,
        category: file.category,
        shared_portal: false,
        expires_on: "",
        status: "active",
      });
      assert.equal(
        (await call("/portal/documents/" + document, "GET", undefined, student))
          .r.status,
        403,
      );
      await call("/documents/" + document, "PUT", {
        title: file.title,
        category: file.category,
        shared_portal: true,
        expires_on: "",
        status: "archived",
      });
      assert.equal(
        (
          await call(
            "/portal/documents/" + document + "/download/1",
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
    },
  );
  await t.test(
    "resource-specific roles get minimal choices and support attachments without unrelated access",
    async () => {
      const inventory = { cookie: "", csrf: "" },
        support = { cookie: "", csrf: "" };
      await account("inventory_manager", inventory);
      await account("customer_support_agent", support);
      const o = await call("/resource-options", "GET", undefined, inventory);
      assert.equal(o.r.status, 200, JSON.stringify(o.j));
      assert(o.j.branches.length);
      assert(o.j.students.length);
      assert.equal(
        (await call("/students", "GET", undefined, inventory)).r.status,
        403,
      );
      assert.equal(
        (await call("/resource-options", "GET", undefined, support)).r.status,
        403,
      );
      assert.equal(
        (await call("/documents/" + document, "GET", undefined, support)).r
          .status,
        403,
      );
      const own = await call(
        "/portal/documents",
        "POST",
        {
          ...file,
          target_kind: "ticket",
          target_id: ticket,
          shared_portal: false,
        },
        student,
      );
      assert.equal(own.r.status, 201, JSON.stringify(own.j));
      const path = "/documents/" + own.j.id;
      assert.equal(
        (
          await call(
            "/documents?target_kind=ticket&target_id=" + ticket,
            "GET",
            undefined,
            support,
          )
        ).r.status,
        200,
      );
      assert.equal(
        (await call(path, "GET", undefined, support)).j.can_version,
        true,
      );
      assert.equal(
        (
          await call(
            path + "/versions",
            "POST",
            { filename: file.filename, mime: file.mime, data: pdf },
            support,
          )
        ).r.status,
        201,
      );
      assert.equal(
        (await call("/portal/documents/" + own.j.id, "GET", undefined, student))
          .j.can_version,
        true,
      );
      assert.equal(
        (
          await call(
            "/portal/documents?target_kind=student&target_id=" + randomUUID(),
            "GET",
            undefined,
            student,
          )
        ).r.status,
        404,
      );
      assert.equal(
        (
          await call("/documents", "POST", {
            ...file,
            mime: "image/png",
            data: Buffer.from([137]).toString("base64"),
          })
        ).r.status,
        400,
      );
      const search = await call(
        "/documents?q=certificate&expires_before=2027-12-31",
      );
      assert.equal(search.r.status, 200);
      assert(search.j.data.every((r: any) => r.title.includes("certificate")));
      assert.equal((await call("/reports/options")).r.status, 200);
    },
  );
  await t.test(
    "catalog, idempotent adjustments and nonnegative atomic balances",
    async () => {
      const r = await call("/inventory/inventory_items", "POST", {
        sku: "BK-1",
        name: "Practice book",
        category: "books",
        unit_cost: 100,
        sale_price: 150,
        reorder_level: 2,
      });
      assert.equal(r.r.status, 201);
      item = r.j.id;
      const key = randomUUID(),
        d = {
          branch_id: branch,
          item_id: item,
          quantity: 5,
          reason: "Opening count",
          idempotency_key: key,
        };
      assert.equal(
        (await call("/inventory/adjustments", "POST", d)).r.status,
        200,
      );
      assert.equal(
        (await call("/inventory/adjustments", "POST", d)).j.replayed,
        true,
      );
      assert.equal((await call("/inventory/stock")).j.data[0].quantity, 5);
      assert.equal(
        (
          await call("/inventory/adjustments", "POST", {
            ...d,
            quantity: -6,
            idempotency_key: randomUUID(),
          })
        ).r.status,
        409,
      );
      assert.equal((await call("/inventory/stock")).j.data[0].quantity, 5);
      assert.equal(
        (await call("/inventory/stock", "GET", undefined, student)).r.status,
        403,
      );
    },
  );
  await t.test(
    "purchase orders require separate receipt and receive only once",
    async () => {
      supplier = (
        await call("/inventory/suppliers", "POST", {
          branch_id: branch,
          name: "Learning supplies",
        })
      ).j.id;
      const p = await call("/inventory/purchases", "POST", {
        branch_id: branch,
        supplier_id: supplier,
        number: "PO-1",
        date: "2026-11-18",
        lines: [{ item_id: item, quantity: 3, unit_cost: 100 }],
      });
      assert.equal(p.r.status, 201);
      purchase = p.j.id;
      assert.equal(p.j.total, 300);
      assert.equal(
        (
          await call("/inventory/purchases/" + purchase + "/action", "POST", {
            action: "order",
          })
        ).r.status,
        200,
      );
      assert.equal(
        (
          await call("/inventory/purchases/" + purchase + "/action", "POST", {
            action: "receive",
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            "/inventory/purchases/" + purchase + "/action",
            "POST",
            { action: "receive" },
            second,
          )
        ).r.status,
        200,
      );
      assert.equal((await call("/inventory/stock")).j.data[0].quantity, 8);
      assert.equal(
        (
          await call(
            "/inventory/purchases/" + purchase + "/action",
            "POST",
            { action: "receive" },
            second,
          )
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "independently approved transfers conserve stock and reject insufficient units",
    async () => {
      const target = (await call("/branches")).j.data.find(
        (b: any) => b.id !== branch,
      ).id;
      transfer = (
        await call("/inventory/transfers", "POST", {
          from_branch: branch,
          to_branch: target,
          item_id: item,
          quantity: 2,
        })
      ).j.id;
      assert.equal(
        (
          await call("/inventory/transfers/" + transfer + "/decision", "POST", {
            decision: "approved",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call(
            "/inventory/transfers/" + transfer + "/decision",
            "POST",
            { decision: "approved" },
            second,
          )
        ).r.status,
        200,
      );
      const rows = (await call("/inventory/stock")).j.data;
      assert.equal(
        rows.reduce((n: number, r: any) => n + r.quantity, 0),
        8,
      );
      assert.equal(rows.find((r: any) => r.branch_id === branch).quantity, 6);
      assert.equal(
        (
          await call(
            "/inventory/transfers/" + transfer + "/decision",
            "POST",
            { decision: "approved" },
            second,
          )
        ).r.status,
        409,
      );
    },
  );
  await t.test(
    "library copies checkout once, returns compute saved penalties without collecting money",
    async () => {
      book = (
        await call("/library/books", "POST", {
          title: "Learning how to learn",
          author: "Fictional author",
          category: "study",
          isbn: "TEST-BOOK",
        })
      ).j.id;
      copy = (
        await call("/library/copies", "POST", {
          book_id: book,
          branch_id: branch,
          barcode: "COPY-1",
        })
      ).j.id;
      const d = {
        copy_id: copy,
        student_id: s.student_id,
        borrowed_on: "2026-11-01",
        due_on: "2026-11-10",
        daily_penalty: 5,
      };
      const r = await call("/library/loans", "POST", d);
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      loan = r.j.id;
      assert.equal((await call("/library/loans", "POST", d)).r.status, 409);
      assert.equal((await call("/library/copies")).j.data[0].status, "loaned");
      const ret = await call("/library/loans/" + loan + "/return", "POST", {
        returned_on: "2026-11-13",
      });
      assert.equal(ret.r.status, 200);
      assert.equal(ret.j.penalty_total, 15);
      assert.equal(
        (
          await call("/library/loans/" + loan + "/return", "POST", {
            returned_on: "2026-11-13",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/library/copies")).j.data[0].status,
        "available",
      );
      assert.equal(
        (
          await call(
            "/portal/library/" + s.student_id,
            "GET",
            undefined,
            student,
          )
        ).j.data.length,
        1,
      );
    },
  );
  await t.test(
    "library reservations preserve a first-requested queue",
    async () => {
      const others = (await call("/students")).j.data,
        other = others.find(
          (x: any) => x.id !== s.student_id && x.branch_id === branch,
        );
      if (!other) return;
      const reserve = await call("/library/reservations", "POST", {
        book_id: book,
        student_id: other.id,
      });
      assert.equal(reserve.r.status, 201);
      assert.equal(
        (
          await call("/library/loans", "POST", {
            copy_id: copy,
            student_id: s.student_id,
            borrowed_on: "2026-11-18",
            due_on: "2026-11-25",
          })
        ).r.status,
        409,
      );
      assert.equal(
        (
          await call("/library/loans", "POST", {
            copy_id: copy,
            student_id: other.id,
            borrowed_on: "2026-11-18",
            due_on: "2026-11-25",
          })
        ).r.status,
        201,
      );
      assert.equal(
        (await call("/library/reservations")).j.data[0].status,
        "fulfilled",
      );
    },
  );
  await t.test(
    "operational report uses saved records and honors date and role scope",
    async () => {
      const r = await call("/reports/overview?from=2026-11-01&to=2026-11-30");
      assert.equal(r.r.status, 200, JSON.stringify(r.j));
      assert(r.j.academic.length);
      assert(Array.isArray(r.j.finance));
      assert.equal(
        (await call("/reports/overview?from=2026-11-01&to=2028-11-30")).r
          .status,
        400,
      );
      assert.equal(
        (
          await call(
            "/reports/overview?from=2026-11-01&to=2026-11-30",
            "GET",
            undefined,
            student,
          )
        ).r.status,
        403,
      );
    },
  );
  await t.test(
    "assets need independent headquarters transfer decisions and retain branch history",
    async () => {
      const dest = (await call("/branches")).j.data.find(
        (r: any) => r.id !== branch,
      );
      const asset = await call("/inventory/assets", "POST", {
        branch_id: branch,
        code: "TRANSFER-1",
        name: "Projector",
        value: 5000,
      });
      assert.equal(asset.r.status, 201, JSON.stringify(asset.j));
      const path = "/inventory/assets/" + asset.j.id;
      const tr = await call(path + "/transfer", "POST", {
        to_branch: dest.id,
        notes: "Moved for a new classroom",
      });
      assert.equal(tr.r.status, 201, JSON.stringify(tr.j));
      assert.equal(
        (
          await call(path + "/transfer/" + tr.j.id + "/decision", "POST", {
            decision: "approved",
          })
        ).r.status,
        403,
      );
      assert.equal(
        (
          await call(
            path + "/transfer/" + tr.j.id + "/decision",
            "POST",
            { decision: "approved" },
            second,
          )
        ).r.status,
        200,
      );
      const got = (await call(path)).j;
      assert.equal(got.data.branch_id, dest.id);
      assert.equal(got.transfers[0].status, "approved");
      assert.equal(got.events.length, 1);
    },
  );
  await t.test(
    "physical dispatch needs an issued invoice and returns stock without recording funds",
    async () => {
      const inv = randomUUID();
      raw
        .prepare(
          "INSERT INTO el_invoices(id,org_id,branch_id,student_id,number,date,due_date,total,status,created_by) VALUES(?,?,?,?,?,'2026-11-18','2026-12-18',300,'issued',?)",
        )
        .run(inv, org, branch, s.student_id, "STOCK-SALE", me.user.user_id);
      const before = (await call("/inventory/stock")).j.data.find(
        (r: any) => r.branch_id === branch,
      ).quantity;
      const r = await call("/inventory/sales", "POST", {
        invoice_id: inv,
        lines: [{ item_id: item, quantity: 2, unit_price: 150 }],
      });
      assert.equal(r.r.status, 201, JSON.stringify(r.j));
      assert.equal(
        (await call("/inventory/stock")).j.data.find(
          (r: any) => r.branch_id === branch,
        ).quantity,
        before - 2,
      );
      assert.equal(
        (
          await call("/inventory/sales", "POST", {
            invoice_id: inv,
            lines: [{ item_id: item, quantity: 1, unit_price: 150 }],
          })
        ).r.status,
        409,
      );
      assert.equal(
        (await call("/inventory/sales/" + r.j.id + "/return", "POST", {})).j
          .funds_moved,
        false,
      );
      assert.equal(
        (await call("/inventory/stock")).j.data.find(
          (r: any) => r.branch_id === branch,
        ).quantity,
        before,
      );
      assert.equal(
        (await call("/inventory/sales/" + r.j.id + "/return", "POST", {})).r
          .status,
        409,
      );
    },
  );
});

test("flagged resource demo is idempotent, removable and real references roll cleanup back", async () => {
  const c = { cookie: "", csrf: "" };
  await call("/auth/demo", "POST", {}, c);
  await call("/me", "GET", undefined, c);
  await call("/demo/academic-seed", "POST", {}, c);
  assert.equal(
    (await call("/settings/demo/resources", "POST", {}, c)).r.status,
    200,
  );
  assert.equal(
    (await call("/settings/demo/resources", "POST", {}, c)).r.status,
    200,
  );
  const items = (await call("/inventory/inventory_items", "GET", undefined, c))
    .j.data;
  assert.equal(items.length, 1);
  const br = (await call("/resource-options", "GET", undefined, c)).j
    .branches[0];
  const demoItem = items[0];
  const bal = raw
    .prepare("SELECT branch_id FROM el_stock_balances WHERE item_id=?")
    .get(demoItem.id) as any;
  await call(
    "/inventory/adjustments",
    "POST",
    {
      branch_id: bal.branch_id,
      item_id: demoItem.id,
      quantity: 1,
      reason: "Real adjustment",
      idempotency_key: randomUUID(),
    },
    c,
  );
  assert.equal(
    (await call("/settings/demo", "PUT", { enabled: false }, c)).r.status,
    409,
  );
  assert.equal(
    (await call("/inventory/inventory_items", "GET", undefined, c)).j.data
      .length,
    1,
  );
  const clean = { cookie: "", csrf: "" };
  await call("/auth/demo", "POST", {}, clean);
  await call("/me", "GET", undefined, clean);
  await call("/demo/academic-seed", "POST", {}, clean);
  await call("/settings/demo/resources", "POST", {}, clean);
  const off = await call("/settings/demo", "PUT", { enabled: false }, clean);
  assert.equal(off.r.status, 200, JSON.stringify(off.j));
  assert.equal(
    (await call("/inventory/inventory_items", "GET", undefined, clean)).j.data
      .length,
    0,
  );
});
