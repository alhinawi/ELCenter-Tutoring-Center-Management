import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, type AppContext } from "./app";
import { record } from "./academic";
import { operationRecord } from "./operations";
import { uid, now } from "./db";
import { assert } from "./security";
const entity = z.enum([
  "students",
  "guardians",
  "teachers",
  "courses",
  "groups",
  "classrooms",
  "employees",
]);
const definition = z
  .object({
    entity,
    field_key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    label: z.string().trim().min(1).max(120),
    type: z.enum(["text", "number", "date", "select", "boolean"]),
    options: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    required: z.boolean().default(false),
  })
  .superRefine((d, c) => {
    if (
      (d.type === "select" &&
        (!d.options.length || new Set(d.options).size !== d.options.length)) ||
      (d.type !== "select" && d.options.length)
    )
      c.addIssue({
        code: "custom",
        message:
          "Select fields need unique options; other types have no options",
      });
  });
const validDate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
export function registerCustomFields(app: Hono<any>) {
  app.get("/api/custom-fields", async (c: AppContext) => {
    permit(c, "organization");
    const a = c.get("actor");
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT * FROM el_custom_fields WHERE org_id=? ORDER BY entity,created_at,id LIMIT 200",
        )
          .bind(a.org_id)
          .all()
      ).results,
    });
  });
  app.post("/api/custom-fields", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = definition.parse(await c.req.json()),
      id = uid();
    const n = await c.env.DB.prepare(
      "SELECT count(*) n FROM el_custom_fields WHERE org_id=?",
    )
      .bind(a.org_id)
      .first<{ n: number }>();
    assert(
      (n?.n ?? 0) < 200,
      409,
      "At most 200 field definitions including archived fields",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_custom_fields(id,org_id,entity,field_key,label,type,options_json,required,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        d.entity,
        d.field_key,
        d.label,
        d.type,
        JSON.stringify(d.options),
        Number(d.required),
        now(),
      ),
      audit(c, "custom_field", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/custom-fields/:id", async (c: AppContext) => {
    permit(c, "organization", "manage");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = z
      .object({
        label: z.string().trim().min(1).max(120),
        required: z.boolean(),
        status: z.enum(["active", "archived"]),
      })
      .parse(await c.req.json());
    const before = await c.env.DB.prepare(
      "SELECT * FROM el_custom_fields WHERE id=? AND org_id=?",
    )
      .bind(c.req.param("id"), a.org_id)
      .first();
    assert(before, 404, "Field not found");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_custom_fields SET label=?,required=?,status=? WHERE id=? AND org_id=?",
      ).bind(
        d.label,
        Number(d.required),
        d.status,
        c.req.param("id"),
        a.org_id,
      ),
      audit(c, "custom_field", c.req.param("id")!, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/record-fields/:entity/:id", async (c: AppContext) => {
    const e = entity.parse(c.req.param("entity"));
    permit(c, e === "employees" ? "hr" : e);
    if (e === "employees") await operationRecord(c, e, c.req.param("id")!);
    else await record(c, e, c.req.param("id")!);
    const a = c.get("actor");
    const rows = (
      await c.env.DB.prepare(
        "SELECT f.*,v.value_json FROM el_custom_fields f LEFT JOIN el_custom_values v ON v.org_id=f.org_id AND v.field_id=f.id AND v.record_id=? WHERE f.org_id=? AND f.entity=? ORDER BY f.created_at,f.id LIMIT 200",
      )
        .bind(c.req.param("id"), a.org_id, e)
        .all<Record<string, any>>()
    ).results;
    return c.json({
      data: rows.map((r) => ({
        ...r,
        value: r.value_json === null ? null : JSON.parse(r.value_json),
        value_json: undefined,
        options: JSON.parse(r.options_json),
      })),
    });
  });
  app.put("/api/record-fields/:entity/:id", async (c: AppContext) => {
    const e = entity.parse(c.req.param("entity"));
    permit(c, e === "employees" ? "hr" : e, "edit");
    if (e === "employees") await operationRecord(c, e, c.req.param("id")!);
    else await record(c, e, c.req.param("id")!);
    const a = c.get("actor"),
      d = z
        .object({
          values: z.record(
            z.string(),
            z.union([
              z.string().max(2000),
              z.number().finite(),
              z.boolean(),
              z.null(),
            ]),
          ),
        })
        .parse(await c.req.json());
    const fields = (
      await c.env.DB.prepare(
        "SELECT * FROM el_custom_fields WHERE org_id=? AND entity=? AND status='active' ORDER BY id LIMIT 200",
      )
        .bind(a.org_id, e)
        .all<Record<string, any>>()
    ).results;
    assert(
      Object.keys(d.values).every((k) => fields.some((f) => f.id === k)),
      400,
      "Unknown or archived field",
    );
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const v = d.values[f.id] ?? null,
        empty = v === null || v === "";
      assert(
        !f.required || !empty,
        400,
        f.label + ": required when saving custom fields",
      );
      if (!empty) {
        const ok =
          f.type === "text"
            ? typeof v === "string"
            : f.type === "number"
              ? typeof v === "number" && Math.abs(v) <= 1e12
              : f.type === "boolean"
                ? typeof v === "boolean"
                : f.type === "date"
                  ? typeof v === "string" && validDate(v)
                  : typeof v === "string" &&
                    JSON.parse(f.options_json).includes(v);
        assert(ok, 400, f.label + ": invalid value");
      }
      values[f.id] = empty ? null : v;
    }
    const before = (
      await c.env.DB.prepare(
        "SELECT field_id,value_json FROM el_custom_values WHERE org_id=? AND record_id=?",
      )
        .bind(a.org_id, c.req.param("id"))
        .all()
    ).results;
    // One atomic batch. Definitions are never hard-deleted or retyped.
    await c.env.DB.batch([
      ...fields.map((f) =>
        c.env.DB.prepare(
          "INSERT INTO el_custom_values(org_id,field_id,record_id,value_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(org_id,field_id,record_id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
        ).bind(
          a.org_id,
          f.id,
          c.req.param("id"),
          JSON.stringify(values[f.id]),
          now(),
        ),
      ),
      audit(c, e, c.req.param("id")!, "custom_fields", before, values),
    ]);
    return c.json({ ok: true });
  });
}
