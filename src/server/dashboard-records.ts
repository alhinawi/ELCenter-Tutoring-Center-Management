import type { AppContext } from "./app";
import { now } from "./db";
const metrics = [
  ["students", "students"],
  ["teachers", "teachers"],
  ["courses", "courses"],
  ["groups", "groups"],
  ["employees", "hr"],
] as const;
export function canViewRecordCounts(permissions: string[]) {
  return metrics.some(([, resource]) =>
    permissions.includes(resource + ":view"),
  );
}
/** Fixed identifiers only. Absence means not authorized, never a zero substitute. */
export async function dashboardRecordCounts(c: AppContext) {
  const a = c.get("actor"),
    selected = metrics.filter(([, resource]) =>
      a.permissions.includes(resource + ":view"),
    );
  if (!selected.length) return {};
  const args: unknown[] = [];
  const fields = selected.map(([table]) => {
    args.push(a.org_id, a.branch_id, a.branch_id);
    return `(SELECT count(*) FROM el_${table} WHERE org_id=? AND (? IS NULL OR branch_id=?) AND status='active') ${table}`;
  });
  const counts = await c.env.DB.prepare("SELECT " + fields.join(","))
    .bind(...args)
    .first<Record<string, number>>();
  return {
    record_counts: {
      counts,
      generated_at: now(),
      branch_id: a.branch_id,
      includes_saved_demo: true,
      basis: "current_active_assigned_branch",
    },
  };
}
