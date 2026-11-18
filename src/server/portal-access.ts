import { assert } from "./security";
import { permit, scope, type AppContext } from "./app";
export const portalRoles = ["student", "parent_guardian", "teacher"];
export async function identity(c: AppContext): Promise<Record<string, any>> {
  const a = c.get("actor"),
    link = await c.env.DB.prepare(
      "SELECT * FROM el_portal_links WHERE org_id=? AND user_id=?",
    )
      .bind(a.org_id, a.user_id)
      .first<Record<string, any>>();
  const expected =
    a.system_key === "parent_guardian" ? "guardian" : a.system_key;
  assert(
    link && link.kind === expected,
    403,
    "An administrator must link this login to your own profile",
  );
  const table =
      link.kind === "guardian"
        ? "guardians"
        : link.kind === "student"
          ? "students"
          : "teachers",
    id = link[link.kind + "_id"];
  const profile = await c.env.DB.prepare(
    `SELECT id,name,branch_id,status FROM el_${table} WHERE id=? AND org_id=?`,
  )
    .bind(id, a.org_id)
    .first<Record<string, any>>();
  assert(
    profile &&
      profile.status !== "inactive" &&
      profile.status !== "suspended" &&
      profile.status !== "withdrawn",
    403,
    "Linked profile is unavailable",
  );
  scope(c, profile.branch_id);
  return { ...link, profile };
}
export async function ownedStudent(c: AppContext, id: string) {
  const a = c.get("actor");
  if (!portalRoles.includes(a.system_key)) {
    permit(c, "students");
    const student = await c.env.DB.prepare(
      "SELECT id,name,branch_id FROM el_students WHERE id=? AND org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
    assert(student, 404, "Student not found");
    scope(c, student.branch_id);
    return student;
  }
  const link = await identity(c);
  assert(link.kind !== "teacher", 403, "Student self-service access required");
  const student = await c.env.DB.prepare(
    `SELECT s.id,s.name,s.code,s.branch_id,s.school,s.grade,s.stage,s.phone,s.email,s.birth_date,s.address FROM el_students s WHERE s.id=? AND s.org_id=? AND ${link.kind === "student" ? "s.id=?" : "EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.student_id=s.id AND sg.org_id=s.org_id AND sg.guardian_id=?)"}`,
  )
    .bind(
      id,
      a.org_id,
      link.kind === "student" ? link.student_id : link.guardian_id,
    )
    .first<Record<string, any>>();
  assert(student, 404, "Student not found in your family");
  scope(c, student.branch_id);
  return student;
}
export async function groupAccess(c: AppContext, id: string, write = false) {
  const a = c.get("actor"),
    group = await c.env.DB.prepare(
      "SELECT g.*,co.name course_name,t.name teacher_name,b.name branch_name FROM el_groups g JOIN el_courses co ON co.id=g.course_id JOIN el_teachers t ON t.id=g.teacher_id JOIN el_branches b ON b.id=g.branch_id WHERE g.id=? AND g.org_id=?",
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
  assert(group, 404, "Group not found");
  scope(c, group.branch_id);
  if (!portalRoles.includes(a.system_key)) {
    permit(c, "lms", write ? "edit" : "view");
    scope(c, group.branch_id);
    return group;
  }
  const link = await identity(c);
  if (link.kind === "teacher") {
    permit(c, "lms", write ? "edit" : "view");
    assert(
      group.teacher_id === link.teacher_id,
      403,
      "This class is not assigned to you",
    );
    return group;
  }
  assert(!write, 403, "Only teachers can change learning content");
  const enrollment = await c.env.DB.prepare(
    `SELECT en.id FROM el_enrollments en WHERE en.group_id=? AND en.org_id=? AND en.status IN ('active','completed') AND ${link.kind === "student" ? "en.student_id=?" : "EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.org_id=en.org_id AND sg.student_id=en.student_id AND sg.guardian_id=?)"} LIMIT 1`,
  )
    .bind(
      group.id,
      a.org_id,
      link.kind === "student" ? link.student_id : link.guardian_id,
    )
    .first();
  assert(enrollment, 403, "This class is not in your learning workspace");
  return group;
}
export async function actingStudent(c: AppContext, groupId: string) {
  const link = await identity(c);
  assert(
    link.kind === "student",
    403,
    "Only a linked student can submit coursework",
  );
  await groupAccess(c, groupId);
  assert(
    await c.env.DB.prepare(
      "SELECT id FROM el_enrollments WHERE org_id=? AND group_id=? AND student_id=? AND status='active'",
    )
      .bind(c.get("actor").org_id, groupId, link.student_id)
      .first(),
    403,
    "Active class enrollment required",
  );
  return link.student_id as string;
}
