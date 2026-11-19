import type { Hono } from "hono";
import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
import { audit, permit, scope, type AppContext } from "./app";
import { uid, now } from "./db";
import { assert } from "./security";
import { date } from "./finance";
import { ownedStudent } from "./portal-access";
import { resource, activeBranch } from "./inventory";
const title = z.string().trim().min(1).max(160),
  text = z.string().trim().max(1000).default("");
export function registerLibrary(app: Hono<any>) {
  app.get("/api/library/books", async (c: AppContext) => {
    permit(c, "library");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT b.*,(SELECT count(*) FROM el_library_copies co WHERE co.book_id=b.id AND (? IS NULL OR co.branch_id=?)) copies,(SELECT count(*) FROM el_library_copies co WHERE co.book_id=b.id AND co.status='available' AND (? IS NULL OR co.branch_id=?)) available FROM el_library_books b WHERE b.org_id=? ORDER BY b.title LIMIT 200",
        )
          .bind(a.branch_id, a.branch_id, a.branch_id, a.branch_id, a.org_id)
          .all()
      ).results,
    });
  });
  app.post("/api/library/books", async (c: AppContext) => {
    permit(c, "library", "create");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide catalog management required");
    const d = z
        .object({
          title,
          author: title,
          isbn: text,
          category: title,
          description: text,
        })
        .parse(await c.req.json()),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_library_books(id,org_id,title,isbn,author,category,description,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.title,
        d.isbn,
        d.author,
        d.category,
        d.description,
        now(),
      ),
      audit(c, "library_book", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/library/books/:id", async (c: AppContext) => {
    permit(c, "library", "edit");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Organization-wide catalog management required");
    const old = await resource(c, "library_books", c.req.param("id")!),
      d = z
        .object({
          title,
          author: title,
          isbn: text,
          category: title,
          description: text,
          status: z.enum(["active", "archived"]),
        })
        .parse(await c.req.json());
    if (d.status === "archived")
      assert(
        !(await c.env.DB.prepare(
          "SELECT r.id FROM el_borrow_records r JOIN el_library_copies co ON co.id=r.copy_id WHERE co.book_id=? AND r.returned_on IS NULL LIMIT 1",
        )
          .bind(old.id)
          .first()),
        409,
        "Return outstanding copies before archiving",
      );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_library_books SET title=?,author=?,isbn=?,category=?,description=?,status=? WHERE id=? AND org_id=?",
      ).bind(
        d.title,
        d.author,
        d.isbn,
        d.category,
        d.description,
        d.status,
        old.id,
        a.org_id,
      ),
      audit(c, "library_book", old.id, "edit", old, d),
    ]);
    return c.json({ ok: true });
  });
  app.put("/api/library/copies/:id", async (c: AppContext) => {
    permit(c, "library", "edit");
    const old = await resource(c, "library_copies", c.req.param("id")!),
      d = z
        .object({
          status: z.enum(["available", "maintenance", "lost", "retired"]),
        })
        .parse(await c.req.json());
    assert(old.status !== "loaned", 409, "Return the active loan first");
    assert(old.status !== "retired", 409, "Retired copies are immutable");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_library_copies SET status=? WHERE id=? AND status<>'loaned' AND NOT EXISTS(SELECT 1 FROM el_borrow_records WHERE copy_id=? AND returned_on IS NULL)",
      ).bind(d.status, old.id, old.id),
      audit(c, "library_copy", old.id, "status", old, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/library/copies", async (c: AppContext) => {
    permit(c, "library");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT co.*,b.title,b.author,br.name branch_name FROM el_library_copies co JOIN el_library_books b ON b.id=co.book_id JOIN el_branches br ON br.id=co.branch_id WHERE co.org_id=? AND (? IS NULL OR co.branch_id=?) ORDER BY b.title,co.barcode LIMIT 300",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/library/copies", async (c: AppContext) => {
    permit(c, "library", "create");
    const a = c.get("actor"),
      d = z
        .object({ book_id: z.uuid(), branch_id: z.uuid(), barcode: title })
        .parse(await c.req.json());
    await activeBranch(c, d.branch_id);
    await resource(c, "library_books", d.book_id);
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_library_copies(id,org_id,branch_id,book_id,barcode) VALUES(?,?,?,?,?)",
      ).bind(id, a.org_id, d.branch_id, d.book_id, d.barcode),
      audit(c, "library_copy", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/library/loans", async (c: AppContext) => {
    permit(c, "library");
    const a = c.get("actor"),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(c.req.query("page") ?? 1),
      status = z
        .enum(["", "on_loan", "returned"])
        .parse(c.req.query("status") ?? ""),
      where =
        "r.org_id=? AND (? IS NULL OR r.branch_id=?) AND (?='' OR (?='on_loan' AND r.returned_on IS NULL) OR (?='returned' AND r.returned_on IS NOT NULL))",
      args = [a.org_id, a.branch_id, a.branch_id, status, status, status];
    const count = await c.env.DB.prepare(
        "SELECT count(*) total FROM el_borrow_records r WHERE " + where,
      )
        .bind(...args)
        .first<{ total: number }>(),
      rows = await c.env.DB.prepare(
        "SELECT r.id,r.borrowed_on,r.due_on,r.returned_on,r.late_days,r.penalty_total,s.name student_name,co.barcode,b.title FROM el_borrow_records r JOIN el_students s ON s.id=r.student_id AND s.org_id=r.org_id JOIN el_library_copies co ON co.id=r.copy_id AND co.org_id=r.org_id JOIN el_library_books b ON b.id=co.book_id AND b.org_id=co.org_id WHERE " +
          where +
          " ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?",
      )
        .bind(...args, (page - 1) * 20)
        .all();
    return c.json({
      data: rows.results,
      total: count?.total ?? 0,
      page,
      page_size: 20,
    });
  });
  app.post("/api/library/loans", async (c: AppContext) => {
    permit(c, "library", "create");
    const a = c.get("actor"),
      d = z
        .object({
          copy_id: z.uuid(),
          student_id: z.uuid(),
          borrowed_on: date,
          due_on: date,
          daily_penalty: z.number().int().min(0).max(10000).default(0),
          notes: text,
        })
        .refine((d) => d.due_on >= d.borrowed_on)
        .parse(await c.req.json()),
      copy = await resource(c, "library_copies", d.copy_id),
      student = await resource(c, "students", d.student_id);
    assert(
      copy.branch_id === student.branch_id,
      400,
      "Book copy and borrower must share a branch",
    );
    assert(copy.status === "available", 409, "Library copy is unavailable");
    const queue = await c.env.DB.prepare(
      "SELECT id,student_id FROM el_library_reservations WHERE org_id=? AND branch_id=? AND book_id=? AND status='waiting' ORDER BY created_at,id LIMIT 1",
    )
      .bind(a.org_id, copy.branch_id, copy.book_id)
      .first<{ id: string; student_id: string }>();
    assert(
      !queue || queue.student_id === student.id,
      409,
      "Another student is first in the reservation queue",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_borrow_records(id,org_id,branch_id,copy_id,student_id,borrowed_on,due_on,daily_penalty,issued_by,notes,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        copy.branch_id,
        copy.id,
        student.id,
        d.borrowed_on,
        d.due_on,
        d.daily_penalty,
        a.user_id,
        d.notes,
        now(),
      ),
      ...(queue
        ? [
            c.env.DB.prepare(
              "UPDATE el_library_reservations SET status='fulfilled',borrow_id=? WHERE id=? AND status='waiting'",
            ).bind(id, queue.id),
          ]
        : []),
      audit(c, "library_loan", id, "checkout", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/library/loans/:id/return", async (c: AppContext) => {
    permit(c, "library", "edit");
    const loan = await resource(c, "borrow_records", c.req.param("id")!),
      a = c.get("actor"),
      d = z.object({ returned_on: date }).parse(await c.req.json());
    assert(!loan.returned_on, 409, "Library loan already returned");
    assert(
      d.returned_on >= loan.borrowed_on,
      400,
      "Return cannot precede checkout",
    );
    const days = Math.max(
        0,
        Temporal.PlainDate.from(loan.due_on).until(
          Temporal.PlainDate.from(d.returned_on),
        ).days,
      ),
      penalty = days * loan.daily_penalty;
    assert(
      Number.isSafeInteger(penalty) && penalty <= 1000000000,
      400,
      "Penalty out of range",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_borrow_records SET returned_on=?,returned_by=?,late_days=?,penalty_total=? WHERE id=?",
      ).bind(d.returned_on, a.user_id, days, penalty, loan.id),
      audit(c, "library_loan", loan.id, "return", null, {
        returned_on: d.returned_on,
        late_days: days,
        penalty_total: penalty,
      }),
    ]);
    return c.json({ ok: true, late_days: days, penalty_total: penalty });
  });
  app.get("/api/library/reservations", async (c: AppContext) => {
    permit(c, "library");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT r.*,s.name student_name,b.title,br.name branch_name FROM el_library_reservations r JOIN el_students s ON s.id=r.student_id JOIN el_library_books b ON b.id=r.book_id JOIN el_branches br ON br.id=r.branch_id WHERE r.org_id=? AND (? IS NULL OR r.branch_id=?) ORDER BY r.created_at,r.id LIMIT 200",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results,
    });
  });
  app.post("/api/library/reservations", async (c: AppContext) => {
    permit(c, "library", "create");
    const a = c.get("actor"),
      d = z
        .object({ book_id: z.uuid(), student_id: z.uuid() })
        .parse(await c.req.json()),
      student = await resource(c, "students", d.student_id);
    await resource(c, "library_books", d.book_id);
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_library_reservations(id,org_id,branch_id,book_id,student_id,created_at) VALUES(?,?,?,?,?,?)",
      ).bind(id, a.org_id, student.branch_id, d.book_id, student.id, now()),
      audit(c, "library_reservation", id, "reserve", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/library/reservations/:id/cancel", async (c: AppContext) => {
    permit(c, "library", "edit");
    const r = await resource(c, "library_reservations", c.req.param("id")!);
    assert(r.status === "waiting", 409, "Reservation is no longer waiting");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_library_reservations SET status='cancelled' WHERE id=? AND status='waiting'",
      ).bind(r.id),
      audit(c, "library_reservation", r.id, "cancel", null, null),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/portal/library/:student", async (c: AppContext) => {
    const a = c.get("actor"),
      s = await ownedStudent(c, c.req.param("student")!),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .parse(c.req.query("page") ?? 1),
      status = z
        .enum(["", "on_loan", "returned"])
        .parse(c.req.query("status") ?? ""),
      where =
        "r.org_id=? AND r.student_id=? AND (?='' OR (?='on_loan' AND r.returned_on IS NULL) OR (?='returned' AND r.returned_on IS NOT NULL))",
      args = [a.org_id, s.id, status, status, status];
    const count = await c.env.DB.prepare(
        "SELECT count(*) total FROM el_borrow_records r WHERE " + where,
      )
        .bind(...args)
        .first<{ total: number }>(),
      rows = await c.env.DB.prepare(
        "SELECT r.id,r.borrowed_on,r.due_on,r.returned_on,r.late_days,r.penalty_total,b.title,co.barcode FROM el_borrow_records r JOIN el_library_copies co ON co.id=r.copy_id AND co.org_id=r.org_id JOIN el_library_books b ON b.id=co.book_id AND b.org_id=co.org_id WHERE " +
          where +
          " ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?",
      )
        .bind(...args, (page - 1) * 20)
        .all();
    return c.json({
      data: rows.results,
      total: count?.total ?? 0,
      page,
      page_size: 20,
    });
  });
}
