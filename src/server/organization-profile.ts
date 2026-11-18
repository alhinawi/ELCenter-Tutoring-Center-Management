import type { Hono } from "hono";
import { z } from "zod";
import { audit, permit, type AppContext } from "./app";
import { now } from "./db";
import { assert } from "./security";
export const profileDefaults = {
  display_name: "",
  tagline: "",
  contact_email: "",
  contact_phone: "",
  address: "",
  website: "",
  default_language: "en",
  financial_year_start_month: 1,
};
const schema = z.object({
  display_name: z.string().trim().max(160),
  tagline: z.string().trim().max(200),
  contact_email: z.union([z.email().max(254), z.literal("")]),
  contact_phone: z.string().trim().max(60),
  address: z.string().trim().max(500),
  website: z.union([
    z
      .url()
      .max(300)
      .refine(
        (s) =>
          new URL(s).protocol === "https:" &&
          !new URL(s).username &&
          !new URL(s).password,
        "Use an HTTPS website without credentials",
      ),
    z.literal(""),
  ]),
  default_language: z.enum(["en", "ar"]),
  financial_year_start_month: z.number().int().min(1).max(12),
});
export function registerOrganizationProfile(app: Hono<any>) {
  app.get("/api/organization/profile", async (c: AppContext) => {
    permit(c, "organization");
    return c.json({
      data:
        (await c.env.DB.prepare(
          "SELECT * FROM el_organization_profiles WHERE org_id=?",
        )
          .bind(c.get("actor").org_id)
          .first()) ?? profileDefaults,
    });
  });
  app.put("/api/organization/profile", async (c: AppContext) => {
    permit(c, "organization", "edit");
    const a = c.get("actor");
    assert(!a.branch_id, 403, "Headquarters only");
    const d = schema.parse(await c.req.json()),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_organization_profiles WHERE org_id=?",
      )
        .bind(a.org_id)
        .first();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_organization_profiles(org_id,display_name,tagline,contact_email,contact_phone,address,website,default_language,financial_year_start_month,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(org_id) DO UPDATE SET display_name=excluded.display_name,tagline=excluded.tagline,contact_email=excluded.contact_email,contact_phone=excluded.contact_phone,address=excluded.address,website=excluded.website,default_language=excluded.default_language,financial_year_start_month=excluded.financial_year_start_month,updated_at=excluded.updated_at",
      ).bind(
        a.org_id,
        d.display_name,
        d.tagline,
        d.contact_email,
        d.contact_phone,
        d.address,
        d.website,
        d.default_language,
        d.financial_year_start_month,
        now(),
      ),
      audit(c, "organization", a.org_id, "profile_settings", before, d),
    ]);
    return c.json({ ok: true });
  });
}
