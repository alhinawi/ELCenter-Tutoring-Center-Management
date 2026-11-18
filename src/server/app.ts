import { registerProfilePhotos } from "./profile-photos";
import { registerAccountStatement } from "./account-statement";
import { registerReceiptNumbering } from "./receipt-numbering";
import { registerInvoiceNumbering } from "./invoice-numbering";
import { registerInvoicePrint } from "./invoice-print";
import { registerCoursePackages } from "./course-packages";
import { registerCoursePrerequisites } from "./course-prerequisites";
import { registerAttendanceCorrections } from "./attendance-corrections";
import { registerOrganizationProfile } from "./organization-profile";
import { registerCustomFields } from "./custom-fields";
import { registerMfa, verifyMfa } from "./mfa";
import { registerSystem } from "./system";
import { registerResourceDemo } from "./demo-resources";
import { registerReports } from "./reports";
import { registerInventory } from "./inventory";
import { registerLibrary } from "./library";
import { registerDocuments } from "./documents";
import { registerSupport } from "./support";
import { registerPortalDemo } from "./demo-portals";
import { registerLms } from "./lms";
import { registerPortals } from "./portals";
import { registerStaffPayroll } from "./staff-payroll";
import { registerOperationsDemo } from "./demo-operations";
import { registerOperations } from "./operations";
import { registerNotifications } from "./notifications";
import { registerFinancePlans } from "./finance-plans";
import { registerPayroll } from "./payroll";
import { registerZeroPayroll } from "./zero-payroll";
import { registerFinance } from "./finance";
import { registerScheduling } from "./scheduling";
import { registerAssessment } from "./assessment";
import { registerAcademic } from "./academic";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env, Database, Statement } from "./db";
import { uid, now, searchPattern } from "./db";
import {
  assert,
  hashPassword,
  checkPassword,
  digest,
  roleNames,
  roleKey,
  defaultPermissions,
  resources,
  actions,
} from "./security";
export type Actor = {
  user_id: string;
  name: string;
  email: string;
  org_id: string;
  membership_id: string;
  role_id: string;
  role_name: string;
  system_key: string;
  branch_id: string | null;
  csrf: string;
  permissions: string[];
};
type Vars = { actor: Actor };
export type AppContext = Context<{ Bindings: Env; Variables: Vars }>;
export const app = new Hono<{ Bindings: Env; Variables: Vars }>();
app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return c.json(
      {
        error: e.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("; "),
      },
      400,
    );
  if (
    /Group is full|Room unavailable|Teacher not assigned|Course not assigned|Student and active group|Transfer is no longer pending|Schedule conflict|Published exam questions|Journal must|Journal already|Posted journal|Financial period|Payment exceeds|Refund exceeds|Invoice is not issued|Refund receipts|Finalized expense|Expense approver|Invalid payroll|Payroll approver|Payroll payment|Calculated payroll|Teacher allocations|Invoice allocations|Assignment is|Submitted work|Submission score|Employee shift|Employee payroll|Coupon is|Hired application|Visitor check|Leave decision|Approved leave|Converted lead|Settlement exceeds|Installments must|Installment date|Issued installment|Finalized invoices|Voided invoice|Reconciliations|Settlements are/.test(
      String(e),
    )
  )
    return c.json(
      {
        error: (e as Error).message.replace(
          /^.*?(?=Group is full|Room unavailable|Teacher not assigned|Course not assigned|Student and active group|Transfer is no longer pending|Schedule conflict|Published exam questions|Journal must|Journal already|Posted journal|Financial period|Payment exceeds|Refund exceeds|Invoice is not issued|Refund receipts|Finalized expense|Expense approver|Invalid payroll|Payroll approver|Payroll payment|Calculated payroll|Teacher allocations|Invoice allocations|Assignment is|Submitted work|Submission score|Employee shift|Employee payroll|Coupon is|Hired application|Visitor check|Leave decision|Approved leave|Converted lead|Settlement exceeds|Installments must|Installment date|Issued installment|Finalized invoices|Voided invoice|Reconciliations|Settlements are)/,
          "",
        ),
      },
      409,
    );
  if (
    /Custom field (?:limit reached|is archived|type and identity are immutable)/.test(
      String(e),
    )
  )
    return c.json(
      { error: "Custom field definition changed. Reload before saving." },
      409,
    );
  if (/Attendance correction/.test(String(e)))
    return c.json(
      {
        error:
          "Attendance changes require an independent approved correction. Reload the record if it changed.",
      },
      409,
    );
  if (/Course prerequisite/.test(String(e)))
    return c.json(
      {
        error:
          "Course prerequisite rule failed: completion required, inactive course, cycle or limit.",
      },
      409,
    );
  if (/Course package/.test(String(e)))
    return c.json(
      {
        error:
          "Course package could not be saved. Check current courses, branch and immutable package terms.",
      },
      409,
    );
  if (/Receipt sequence/.test(String(e)))
    return c.json(
      {
        error:
          "Receipt numbering changed or is exhausted. Refresh settings or ask headquarters. No receipt was recorded.",
      },
      409,
    );
  if (String(e).includes("FOREIGN KEY constraint"))
    return c.json({ error: "A related record is unavailable" }, 409);
  if (
    /7500|D1.*(?:quota|limit)|daily.*(?:reads|read limit|quota)|rows read.*(?:limit|exceed)/i.test(
      String(e),
    )
  ) {
    const ar =
      c.req.header("x-el-locale") === "ar" ||
      (!c.req.header("x-el-locale") &&
        (c.req.header("accept-language") ?? "").toLowerCase().startsWith("ar"));
    c.header("Retry-After", "300");
    return c.json(
      {
        error: ar
          ? "الخدمة مضغوطة مؤقتًا. جرّب تاني بعد شوية."
          : "Service is temporarily busy. Please try again later.",
        code: "SERVICE_BUSY",
      },
      503,
    );
  }
  if (
    /Document store capacity|Document version capacity|Library copy is reserved|Stock sale|Stock movements|Stock transfer requires|Purchase order transition|Library copy or borrower|Library return|Support ticket identity|Document versions|CHECK constraint failed: quantity/.test(
      String(e),
    )
  )
    return c.json(
      {
        error:
          "The record changed or available stock/loan rules prevent this operation",
      },
      409,
    );
  if (String(e).includes("UNIQUE constraint"))
    return c.json({ error: "This record already exists" }, 409);
  console.error(
    "ELCenter request failed",
    e instanceof Error ? e.name : "Error",
  );
  return c.json({ error: "Could not complete this operation" }, 500);
});
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin)
      return c.json({ error: "Origin not allowed" }, 403);
    if (!c.req.header("content-type")?.includes("application/json"))
      return c.json({ error: "JSON required" }, 415);
  }
  await next();
});
const str = z.string().trim().min(1).max(160);
const email = z.email().toLowerCase().max(254);
const password = z.string().min(12).max(128);
const signup = z.object({ name: str, email, password, organization: str });
export function audit(
  c: AppContext,
  entity: string,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
): Statement {
  const a = c.get("actor");
  return c.env.DB.prepare(
    "INSERT INTO el_audit(id,org_id,branch_id,user_id,action,entity,entity_id,before_json,after_json,ip) VALUES(?,?,?,?,?,?,?,?,?,?)",
  ).bind(
    uid(),
    a.org_id,
    a.branch_id,
    a.user_id,
    action,
    entity,
    id,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    c.req.header("cf-connecting-ip") ?? null,
  );
}
async function rate(c: AppContext, scope: string, limit = 10) {
  const key = await digest(
    `${scope}:${c.req.header("cf-connecting-ip") ?? "local"}`,
  );
  const t = now();
  await c.env.DB.prepare(
    "INSERT INTO el_login_limits(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END",
  )
    .bind(key, t + 900, t, t, t + 900)
    .run();
  const row = await c.env.DB.prepare(
    "SELECT attempts FROM el_login_limits WHERE key=?",
  )
    .bind(key)
    .first<{ attempts: number }>();
  assert(
    row && row.attempts <= limit,
    429,
    "Too many attempts. Try again in 15 minutes.",
  );
}
async function createSession(
  c: AppContext,
  userId: string,
  membershipId: string,
) {
  const token = uid() + uid();
  const csrf = uid();
  const statement = c.env.DB.prepare(
    "INSERT INTO el_sessions(id,user_id,membership_id,csrf,expires_at,user_agent) VALUES(?,?,?,?,?,?)",
  ).bind(
    await digest(token),
    userId,
    membershipId,
    csrf,
    now() + 60 * 60 * 12,
    (c.req.header("user-agent") ?? "").slice(0, 300),
  );
  await c.env.DB.batch([
    statement,
    c.env.DB.prepare(
      "INSERT INTO el_login_history(id,org_id,user_id,branch_id,user_agent,ip,created_at) SELECT ?,org_id,user_id,branch_id,?,?,? FROM el_memberships WHERE id=? AND user_id=?",
    ).bind(
      uid(),
      (c.req.header("user-agent") ?? "").slice(0, 300),
      (c.req.header("cf-connecting-ip") ?? "").slice(0, 100),
      now(),
      membershipId,
      userId,
    ),
  ]);
  setCookie(c, "elcenter_session", token, {
    httpOnly: true,
    secure:
      c.env.ENVIRONMENT !== "test" && new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 43200,
  });
  return csrf;
}
export async function initializeOrganization(
  db: Database,
  data: { name: string; email: string; password: string; organization: string },
  demo = false,
) {
  const org = uid(),
    user = uid(),
    member = uid(),
    branch = uid(),
    demoBranches = [branch];
  const permissionRows: unknown[][] = [],
    roleRows: unknown[][] = [];
  const statements: Statement[] = [
    db
      .prepare("INSERT INTO el_organizations(id,name) VALUES(?,?)")
      .bind(org, data.organization),
    db
      .prepare(
        "INSERT INTO el_users(id,name,email,password_hash) VALUES(?,?,?,?)",
      )
      .bind(user, data.name, data.email, await hashPassword(data.password)),
    db
      .prepare(
        "INSERT INTO el_branches(id,org_id,name,code,address,capacity) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        branch,
        org,
        demo ? "Mansoura Learning Hub" : "Headquarters",
        "HQ",
        demo ? "Fictional campus · Mansoura" : "",
        120,
      ),
  ];
  let owner = "";
  for (const name of roleNames) {
    const id = uid();
    if (name === "Business Owner") owner = id;
    roleRows.push([id, org, name, roleKey(name)]);
    for (const permission of defaultPermissions(name)) {
      const [r, a] = permission.split(":");
      permissionRows.push([id, r, a]);
    }
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO el_roles(id,org_id,name,system_key) VALUES " +
          roleRows.map(() => "(?,?,?,?)").join(","),
      )
      .bind(...roleRows.flat()),
  );
  statements.push(
    db
      .prepare(
        "INSERT INTO el_memberships(id,org_id,user_id,role_id) VALUES(?,?,?,?)",
      )
      .bind(member, org, user, owner),
  );
  if (demo)
    for (const [name, code, address, cap] of [
      ["Cairo Discovery Campus", "CAI", "Fictional campus · New Cairo", 180],
      ["Alexandria Study House", "ALX", "Fictional campus · Alexandria", 90],
    ] as const) {
      const id = uid();
      demoBranches.push(id);
      statements.push(
        db
          .prepare(
            "INSERT INTO el_branches(id,org_id,name,code,address,capacity) VALUES(?,?,?,?,?,?)",
          )
          .bind(id, org, name, code, address, cap),
      );
    }
  for (let i = 0; i < permissionRows.length; i += 30) {
    const rows = permissionRows.slice(i, i + 30);
    statements.push(
      db
        .prepare(
          "INSERT INTO el_role_permissions(role_id,resource,action) VALUES " +
            rows.map(() => "(?,?,?)").join(","),
        )
        .bind(...rows.flat()),
    );
  }
  await db.batch(statements);
  return { org, user, member, branch, demoBranches };
}
app.get("/api/health", (c) =>
  c.json({ ok: true, product: "ELCenter", phase: 3 }),
);
app.post("/api/auth/register", async (c) => {
  await rate(c, "register", 4);
  const d = signup.parse(await c.req.json());
  const x = await initializeOrganization(c.env.DB, d);
  await createSession(c, x.user, x.member);
  return c.json({ ok: true }, 201);
});
app.post("/api/auth/demo", async (c) => {
  await rate(c, "demo", 8);
  const id = uid();
  const x = await initializeOrganization(
    c.env.DB,
    {
      name: "Demo Director",
      email: `demo-${id}@example.invalid`,
      password: uid() + uid(),
      organization: "Bright Path Learning · Demo",
    },
    true,
  );
  const cols = await c.env.DB.prepare("PRAGMA table_info(el_branches)").all<{
    name: string;
  }>();
  if (cols.results.some((col) => col.name === "is_demo"))
    await c.env.DB.prepare(
      "UPDATE el_branches SET is_demo=1 WHERE org_id=? AND id IN (" +
        x.demoBranches.map(() => "?").join(",") +
        ")",
    )
      .bind(x.org, ...x.demoBranches)
      .run();
  await createSession(c, x.user, x.member);
  return c.json({ ok: true }, 201);
});
app.post("/api/auth/login", async (c) => {
  await rate(c, "login");
  const d = z
    .object({
      email,
      password: z.string().min(1).max(128),
      otp: z.string().trim().max(32).default(""),
    })
    .parse(await c.req.json());
  const u = await c.env.DB.prepare(
    "SELECT u.id,u.password_hash,m.id membership_id FROM el_users u JOIN el_memberships m ON m.user_id=u.id WHERE u.email=? AND m.status='active' ORDER BY m.created_at LIMIT 1",
  )
    .bind(d.email)
    .first<{ id: string; password_hash: string; membership_id: string }>();
  const fake =
    "pbkdf2:100000:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000";
  const valid = await checkPassword(d.password, u?.password_hash ?? fake);
  assert(u && valid, 401, "Email or password is incorrect");
  assert(
    await verifyMfa(c.env, u.id, d.otp),
    401,
    "Authenticator or recovery code is required or invalid",
  );
  await createSession(c, u.id, u.membership_id);
  return c.json({ ok: true });
});
app.use("/api/*", async (c, next) => {
  const token = getCookie(c, "elcenter_session");
  assert(token, 401, "Sign in to continue");
  const actor = await c.env.DB.prepare(
    "SELECT u.id user_id,u.name,u.email,m.id membership_id,m.org_id,m.role_id,m.branch_id,r.name role_name,r.system_key,s.csrf FROM el_sessions s JOIN el_users u ON u.id=s.user_id JOIN el_memberships m ON m.id=s.membership_id JOIN el_roles r ON r.id=m.role_id WHERE s.id=? AND s.expires_at>? AND m.status='active'",
  )
    .bind(await digest(token), now())
    .first<Omit<Actor, "permissions">>();
  assert(actor, 401, "Session expired");
  const p = await c.env.DB.prepare(
    "SELECT resource,action FROM el_role_permissions WHERE role_id=?",
  )
    .bind(actor.role_id)
    .all<{ resource: string; action: string }>();
  c.set("actor", {
    ...actor,
    permissions: p.results.map((x) => `${x.resource}:${x.action}`),
  });
  if (!["GET", "HEAD"].includes(c.req.method))
    assert(
      c.req.header("x-csrf-token") === actor.csrf,
      403,
      "Session verification failed",
    );
  if (["student", "parent_guardian", "teacher"].includes(actor.system_key)) {
    const path = c.req.path;
    assert(
      path === "/api/me" ||
        path === "/api/auth/logout" ||
        path.startsWith("/api/security/") ||
        path === "/api/portal" ||
        path.startsWith("/api/portal/") ||
        path.startsWith("/api/lms/") ||
        path === "/api/notifications" ||
        path.startsWith("/api/notifications/"),
      403,
      "Use your dedicated learning portal",
    );
  }
  await next();
});
export function permit(c: AppContext, resource: string, action = "view") {
  assert(
    c.get("actor").permissions.includes(`${resource}:${action}`),
    403,
    "You do not have permission for this action",
  );
}
export function scope(c: AppContext, branch?: string | null) {
  const a = c.get("actor");
  if (a.branch_id)
    assert(
      a.branch_id === branch,
      403,
      "This branch is outside your workspace",
    );
}
app.get("/api/me", async (c) => {
  const a = c.get("actor");
  const org = await c.env.DB.prepare(
    "SELECT * FROM el_organizations WHERE id=?",
  )
    .bind(a.org_id)
    .first();
  const profile = await c.env.DB.prepare(
    "SELECT display_name,tagline FROM el_organization_profiles WHERE org_id=?",
  )
    .bind(a.org_id)
    .first<{ display_name: string; tagline: string }>();
  return c.json({
    user: a,
    organization: {
      ...(org as Record<string, unknown>),
      display_name: profile?.display_name ?? "",
      tagline: profile?.tagline ?? "",
    },
  });
});
app.post("/api/auth/logout", async (c) => {
  const t = getCookie(c, "elcenter_session")!;
  await c.env.DB.prepare("DELETE FROM el_sessions WHERE id=?")
    .bind(await digest(t))
    .run();
  deleteCookie(c, "elcenter_session", { path: "/" });
  return c.json({ ok: true });
});
app.get("/api/dashboard", async (c) => {
  permit(c, "branches");
  const a = c.get("actor");
  const b = await c.env.DB.prepare(
    "SELECT id,name,code,address,capacity,status FROM el_branches WHERE org_id=? AND (? IS NULL OR id=?) ORDER BY name",
  )
    .bind(a.org_id, a.branch_id, a.branch_id)
    .all();
  const members = await c.env.DB.prepare(
    "SELECT count(*) value FROM el_memberships WHERE org_id=? AND (? IS NULL OR branch_id=?) AND status=?",
  )
    .bind(a.org_id, a.branch_id, a.branch_id, "active")
    .first<{ value: number }>();
  const activity = a.permissions.includes("audit:view")
    ? (
        await c.env.DB.prepare(
          "SELECT a.id,a.action,a.entity,a.created_at,u.name actor FROM el_audit a JOIN el_users u ON u.id=a.user_id WHERE a.org_id=? AND (? IS NULL OR a.branch_id=?) ORDER BY a.created_at DESC LIMIT 8",
        )
          .bind(a.org_id, a.branch_id, a.branch_id)
          .all()
      ).results
    : [];
  const roles = await c.env.DB.prepare(
    "SELECT count(*) value FROM el_roles WHERE org_id=?",
  )
    .bind(a.org_id)
    .first<{ value: number }>();
  return c.json({
    branches: b.results,
    members: members?.value ?? 0,
    roles: roles?.value ?? 0,
    activity,
  });
});
app.put("/api/organization", async (c) => {
  permit(c, "organization", "edit");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const d = z
    .object({
      name: str,
      currency: z.enum(["EGP", "USD", "EUR", "SAR", "AED"]),
      timezone: z.enum(["Africa/Cairo", "UTC", "Asia/Riyadh", "Asia/Dubai"]),
      academic_year: z.string().regex(/^\d{4}\/\d{4}$/),
    })
    .parse(await c.req.json());
  const before = await c.env.DB.prepare(
    "SELECT * FROM el_organizations WHERE id=?",
  )
    .bind(a.org_id)
    .first();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE el_organizations SET name=?,currency=?,timezone=?,academic_year=? WHERE id=?",
    ).bind(d.name, d.currency, d.timezone, d.academic_year, a.org_id),
    audit(c, "organization", a.org_id, "update", before, d),
  ]);
  return c.json({ ok: true });
});
const branchSchema = z.object({
  name: str,
  code: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .regex(/^[A-Za-z0-9_-]+$/),
  address: z.string().trim().max(500).default(""),
  phone: z.string().trim().max(30).default(""),
  email: z.union([email, z.literal("")]).default(""),
  manager: z.string().trim().max(160).default(""),
  opening_hours: z.string().trim().max(100).default("09:00 - 21:00"),
  capacity: z.number().int().min(1).max(100000),
  status: z.enum(["active", "inactive"]).default("active"),
});
app.get("/api/branches", async (c) => {
  permit(c, "branches");
  const a = c.get("actor");
  const q = (c.req.query("q") ?? "").slice(0, 100);
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const order = c.req.query("sort") === "capacity" ? "capacity" : "name";
  const dir = c.req.query("direction") === "desc" ? "DESC" : "ASC";
  const where =
    "org_id=? AND (? IS NULL OR id=?) AND (name LIKE ? OR code LIKE ?)";
  const vals = [
    a.org_id,
    a.branch_id,
    a.branch_id,
    searchPattern(q),
    searchPattern(q),
  ];
  const count = await c.env.DB.prepare(
    `SELECT count(*) total FROM el_branches WHERE ${where}`,
  )
    .bind(...vals)
    .first<{ total: number }>();
  const data = await c.env.DB.prepare(
    `SELECT * FROM el_branches WHERE ${where} ORDER BY ${order} ${dir},id LIMIT 12 OFFSET ?`,
  )
    .bind(...vals, (page - 1) * 12)
    .all();
  return c.json({ data: data.results, total: count?.total ?? 0, page });
});
app.post("/api/branches", async (c) => {
  permit(c, "branches", "create");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const d = branchSchema.parse(await c.req.json());
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO el_branches(id,org_id,name,code,address,phone,email,manager,opening_hours,capacity,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      a.org_id,
      d.name,
      d.code,
      d.address,
      d.phone,
      d.email,
      d.manager,
      d.opening_hours,
      d.capacity,
      d.status,
    ),
    audit(c, "branch", id, "create", null, d),
  ]);
  return c.json({ id }, 201);
});
app.put("/api/branches/:id", async (c) => {
  permit(c, "branches", "edit");
  const a = c.get("actor"),
    id = c.req.param("id");
  scope(c, id);
  const d = branchSchema.parse(await c.req.json());
  const before = await c.env.DB.prepare(
    "SELECT * FROM el_branches WHERE id=? AND org_id=?",
  )
    .bind(id, a.org_id)
    .first();
  assert(before, 404, "Branch not found");
  if (d.status === "inactive") {
    const active = await c.env.DB.prepare(
      "SELECT count(*) count FROM el_branches WHERE org_id=? AND id<>? AND status='active'",
    )
      .bind(a.org_id, id)
      .first<{ count: number }>();
    assert(active && active.count > 0, 409, "Keep at least one active branch");
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE el_branches SET name=?,code=?,address=?,phone=?,email=?,manager=?,opening_hours=?,capacity=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND org_id=?",
    ).bind(
      d.name,
      d.code,
      d.address,
      d.phone,
      d.email,
      d.manager,
      d.opening_hours,
      d.capacity,
      d.status,
      id,
      a.org_id,
    ),
    audit(c, "branch", id, "update", before, d),
  ]);
  return c.json({ ok: true });
});
app.get("/api/roles", async (c) => {
  permit(c, "roles");
  const a = c.get("actor");
  const roles = await c.env.DB.prepare(
    "SELECT * FROM el_roles WHERE org_id=? ORDER BY name",
  )
    .bind(a.org_id)
    .all();
  const perms = await c.env.DB.prepare(
    "SELECT p.* FROM el_role_permissions p JOIN el_roles r ON r.id=p.role_id WHERE r.org_id=?",
  )
    .bind(a.org_id)
    .all();
  return c.json({
    data: roles.results,
    permissions: perms.results,
    resources,
    actions,
  });
});
const roleSchema = z.object({
  name: str,
  permissions: z.array(z.string()).max(500),
});
function validPermissions(p: string[]) {
  return p.every((s) => {
    const [r, a] = s.split(":");
    return (
      (resources as readonly string[]).includes(r) &&
      (actions as readonly string[]).includes(a)
    );
  });
}
app.post("/api/roles", async (c) => {
  permit(c, "roles", "create");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const d = roleSchema.parse(await c.req.json());
  assert(validPermissions(d.permissions), 400, "Invalid permissions");
  assert(
    ["business_owner", "super_admin"].includes(a.system_key) ||
      d.permissions.every((p) => a.permissions.includes(p)),
    403,
    "Cannot grant permissions you do not have",
  );
  const id = uid();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO el_roles(id,org_id,name) VALUES(?,?,?)").bind(
      id,
      a.org_id,
      d.name,
    ),
    ...Array.from(new Set(d.permissions)).map((p) => {
      const [r, action] = p.split(":");
      return c.env.DB.prepare(
        "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,?,?)",
      ).bind(id, r, action);
    }),
    audit(c, "role", id, "create", null, d),
  ]);
  return c.json({ id }, 201);
});
app.put("/api/roles/:id", async (c) => {
  permit(c, "roles", "edit");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const d = roleSchema.parse(await c.req.json());
  assert(validPermissions(d.permissions), 400, "Invalid permissions");
  assert(
    ["business_owner", "super_admin"].includes(a.system_key) ||
      d.permissions.every((p) => a.permissions.includes(p)),
    403,
    "Cannot grant permissions you do not have",
  );
  const id = c.req.param("id");
  const before = await c.env.DB.prepare(
    "SELECT * FROM el_roles WHERE id=? AND org_id=?",
  )
    .bind(id, a.org_id)
    .first<{ system_key: string }>();
  assert(before, 404, "Role not found");
  assert(
    !["business_owner", "super_admin"].includes(before.system_key),
    403,
    "Owner and super-admin roles are protected",
  );
  assert(a.role_id !== id, 403, "You cannot change your own active role");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE el_roles SET name=? WHERE id=? AND org_id=?").bind(
      d.name,
      id,
      a.org_id,
    ),
    c.env.DB.prepare("DELETE FROM el_role_permissions WHERE role_id=?").bind(
      id,
    ),
    ...Array.from(new Set(d.permissions)).map((p) => {
      const [r, action] = p.split(":");
      return c.env.DB.prepare(
        "INSERT INTO el_role_permissions(role_id,resource,action) VALUES(?,?,?)",
      ).bind(id, r, action);
    }),
    audit(c, "role", id, "update", before, d),
  ]);
  return c.json({ ok: true });
});
app.get("/api/users", async (c) => {
  permit(c, "users");
  const a = c.get("actor");
  const data = await c.env.DB.prepare(
    "SELECT m.id,m.user_id,u.name,u.email,m.role_id,r.name role_name,m.branch_id,b.name branch_name,m.status FROM el_memberships m JOIN el_users u ON u.id=m.user_id JOIN el_roles r ON r.id=m.role_id LEFT JOIN el_branches b ON b.id=m.branch_id WHERE m.org_id=? ORDER BY u.name",
  )
    .bind(a.org_id)
    .all();
  return c.json({ data: data.results });
});
const userSchema = z.object({
  name: str,
  email,
  role_id: z.uuid(),
  branch_id: z.uuid().nullable(),
  password,
});
app.post("/api/users", async (c) => {
  permit(c, "users", "create");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const d = userSchema.parse(await c.req.json());
  const role = await c.env.DB.prepare(
    "SELECT system_key FROM el_roles WHERE id=? AND org_id=?",
  )
    .bind(d.role_id, a.org_id)
    .first<{ system_key: string }>();
  assert(role, 400, "Invalid role");
  assert(
    !["super_admin", "business_owner"].includes(role.system_key) ||
      ["super_admin", "business_owner"].includes(a.system_key),
    403,
    "Owner permission required",
  );
  if (!["business_owner", "super_admin"].includes(a.system_key)) {
    const desired = (
      await c.env.DB.prepare(
        "SELECT resource,action FROM el_role_permissions WHERE role_id=?",
      )
        .bind(d.role_id)
        .all<{ resource: string; action: string }>()
    ).results;
    assert(
      desired.every((p) => a.permissions.includes(`${p.resource}:${p.action}`)),
      403,
      "Cannot assign a role with permissions you do not have",
    );
  }
  if (d.branch_id)
    assert(
      await c.env.DB.prepare(
        "SELECT id FROM el_branches WHERE id=? AND org_id=?",
      )
        .bind(d.branch_id, a.org_id)
        .first(),
      400,
      "Invalid branch",
    );
  const user = uid(),
    id = uid();
  const { password: secret, ...safe } = d;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO el_users(id,name,email,password_hash) VALUES(?,?,?,?)",
    ).bind(user, d.name, d.email, await hashPassword(secret)),
    c.env.DB.prepare(
      "INSERT INTO el_memberships(id,org_id,user_id,role_id,branch_id) VALUES(?,?,?,?,?)",
    ).bind(id, a.org_id, user, d.role_id, d.branch_id),
    audit(c, "user", id, "create", null, safe),
  ]);
  return c.json({ id }, 201);
});
app.patch("/api/users/:id/status", async (c) => {
  permit(c, "users", "edit");
  const a = c.get("actor");
  assert(!a.branch_id, 403, "Organization-wide permission required");
  const id = c.req.param("id");
  const d = z
    .object({ status: z.enum(["active", "suspended"]) })
    .parse(await c.req.json());
  assert(id !== a.membership_id, 403, "You cannot suspend yourself");
  const before = await c.env.DB.prepare(
    "SELECT m.id,m.status,r.system_key FROM el_memberships m JOIN el_roles r ON r.id=m.role_id WHERE m.id=? AND m.org_id=?",
  )
    .bind(id, a.org_id)
    .first<{ status: string; system_key: string }>();
  assert(before, 404, "User not found");
  assert(
    !["super_admin", "business_owner"].includes(before.system_key),
    403,
    "Owner accounts are protected",
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE el_memberships SET status=? WHERE id=? AND org_id=?",
    ).bind(d.status, id, a.org_id),
    c.env.DB.prepare("DELETE FROM el_sessions WHERE membership_id=?").bind(id),
    audit(c, "user", id, "status", before, d),
  ]);
  return c.json({ ok: true });
});
app.get("/api/audit", async (c) => {
  permit(c, "audit");
  const a = c.get("actor");
  const data = await c.env.DB.prepare(
    "SELECT a.*,u.name actor FROM el_audit a JOIN el_users u ON u.id=a.user_id WHERE a.org_id=? AND (? IS NULL OR a.branch_id=?) ORDER BY a.created_at DESC LIMIT 100",
  )
    .bind(a.org_id, a.branch_id, a.branch_id)
    .all();
  return c.json({ data: data.results });
});
registerAcademic(app);
registerScheduling(app);
registerAssessment(app);
registerFinance(app);
registerInvoicePrint(app);
registerInvoiceNumbering(app);
registerReceiptNumbering(app);
registerAccountStatement(app);
registerFinancePlans(app);
registerOperations(app);
registerPortals(app);
registerSupport(app);
registerInventory(app);
registerLibrary(app);
registerReports(app);
registerSystem(app);
registerCoursePackages(app);
registerCoursePrerequisites(app);
registerAttendanceCorrections(app);
registerCustomFields(app);
registerOrganizationProfile(app);
registerMfa(app);
registerDocuments(app);
registerProfilePhotos(app);
registerLms(app);
registerPortalDemo(app);
registerResourceDemo(app);
registerStaffPayroll(app);
registerOperationsDemo(app);
registerNotifications(app);
registerPayroll(app);
registerZeroPayroll(app);
app.notFound((c) => c.json({ error: "Endpoint not found" }, 404));
export default app;
