import type { Hono } from "hono";
import { z } from "zod";
import { uid, now } from "./db";
import { assert } from "./security";
import { audit, permit, type AppContext } from "./app";
import {
  identity,
  portalRoles,
  groupAccess,
  actingStudent,
  ownedStudent,
} from "./portal-access";
import { readAttendance, writeAttendance } from "./scheduling";
import {
  gradeAnswer,
  gradeExamResult,
  createExam,
  updateExam,
  createExamQuestion,
} from "./assessment";
const title = z.string().trim().min(1).max(160),
  text = z.string().trim().max(20000).default(""),
  url = z
    .union([z.url().max(2000), z.literal("")])
    .default("")
    .refine((x) => {
      if (!x) return true;
      try {
        const u = new URL(x);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    }, "Use an HTTPS link without credentials");
async function content(
  c: AppContext,
  table: "lessons" | "assignments",
  id: string,
  write = false,
) {
  const a = c.get("actor"),
    row = await c.env.DB.prepare(
      `SELECT * FROM el_${table} WHERE id=? AND org_id=?`,
    )
      .bind(id, a.org_id)
      .first<Record<string, any>>();
  assert(row, 404, "Learning record not found");
  await groupAccess(c, row.group_id, write);
  if (["student", "parent_guardian"].includes(a.system_key))
    assert(
      row.status !== "draft" &&
        (table !== "lessons" || row.status === "published"),
      404,
      "Learning record is not published",
    );
  return row;
}
export function registerLms(app: Hono<any>) {
  app.get("/api/lms/groups", async (c: AppContext) => {
    const a = c.get("actor");
    let condition = "",
      bind: unknown[] = [a.org_id];
    if (portalRoles.includes(a.system_key)) {
      const link = await identity(c);
      if (link.kind === "teacher") {
        permit(c, "lms");
        condition = " AND g.teacher_id=?";
        bind.push(link.teacher_id);
      } else {
        condition = ` AND EXISTS(SELECT 1 FROM el_enrollments en WHERE en.group_id=g.id AND en.status IN ('active','completed') AND ${link.kind === "student" ? "en.student_id=?" : "EXISTS(SELECT 1 FROM el_student_guardians sg WHERE sg.org_id=en.org_id AND sg.student_id=en.student_id AND sg.guardian_id=?)"})`;
        bind.push(link.kind === "student" ? link.student_id : link.guardian_id);
      }
    } else {
      permit(c, "lms");
      condition = " AND (? IS NULL OR g.branch_id=?)";
      bind.push(a.branch_id, a.branch_id);
    }
    if (portalRoles.includes(a.system_key)) {
      condition += " AND (? IS NULL OR g.branch_id=?)";
      bind.push(a.branch_id, a.branch_id);
    }
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT g.id,g.name,g.code,g.status,co.name course_name,t.name teacher_name FROM el_groups g JOIN el_courses co ON co.id=g.course_id JOIN el_teachers t ON t.id=g.teacher_id WHERE g.org_id=?" +
            condition +
            " ORDER BY g.name LIMIT 200",
        )
          .bind(...bind)
          .all()
      ).results,
    });
  });
  app.get("/api/lms/groups/:id", async (c: AppContext) => {
    const group = await groupAccess(c, c.req.param("id")!),
      a = c.get("actor"),
      learner = ["student", "parent_guardian"].includes(a.system_key),
      link = learner ? await identity(c) : null;
    const lessons = (
      await c.env.DB.prepare(
        `SELECT id,title,description,kind,position,status FROM el_lessons WHERE org_id=? AND group_id=? ${learner ? "AND status='published'" : ""} ORDER BY position,created_at LIMIT 200`,
      )
        .bind(a.org_id, group.id)
        .all()
    ).results;
    const assignments = (
      await c.env.DB.prepare(
        `SELECT id,title,instructions,due_at,max_score,status FROM el_assignments WHERE org_id=? AND group_id=? ${learner ? "AND status<>'draft'" : ""} ORDER BY due_at LIMIT 200`,
      )
        .bind(a.org_id, group.id)
        .all()
    ).results;
    const discussions = (
      await c.env.DB.prepare(
        `SELECT d.id,d.body,d.created_at,d.status,u.name author FROM el_discussions d JOIN el_users u ON u.id=d.user_id WHERE d.org_id=? AND d.group_id=? ${learner ? "AND d.status='visible'" : ""} ORDER BY d.created_at DESC,d.id LIMIT 100`,
      )
        .bind(a.org_id, group.id)
        .all()
    ).results;
    let progressStudent = link?.kind === "student" ? link.student_id : "";
    if (link?.kind === "guardian" && c.req.query("student_id")) {
      const child = await ownedStudent(c, c.req.query("student_id")!);
      const enrolled = await c.env.DB.prepare(
        "SELECT id FROM el_enrollments WHERE org_id=? AND group_id=? AND student_id=? AND status IN ('active','completed')",
      )
        .bind(a.org_id, group.id, child.id)
        .first();
      assert(enrolled, 403, "Selected child is not enrolled in this class");
      progressStudent = child.id;
    }
    const progress = progressStudent
      ? (
          await c.env.DB.prepare(
            "SELECT lesson_id,completed_at FROM el_lesson_progress WHERE org_id=? AND student_id=? AND lesson_id IN (SELECT id FROM el_lessons WHERE group_id=? AND status='published')",
          )
            .bind(a.org_id, progressStudent, group.id)
            .all()
        ).results
      : [];
    const quizzes = (
      await c.env.DB.prepare(
        `SELECT id,name,scheduled_at,max_score,pass_score,status FROM el_exams WHERE org_id=? AND group_id=? ${learner ? "AND status<>'draft'" : ""} ORDER BY scheduled_at DESC LIMIT 100`,
      )
        .bind(a.org_id, group.id)
        .all()
    ).results;
    return c.json({
      group,
      lessons,
      assignments,
      discussions,
      progress,
      quizzes,
      announcements: (
        await c.env.DB.prepare(
          "SELECT id,title,body,created_at FROM el_announcements WHERE org_id=? AND group_id=? ORDER BY created_at DESC LIMIT 50",
        )
          .bind(a.org_id, group.id)
          .all()
      ).results,
      can_teach: !learner && a.permissions.includes("lms:edit"),
      can_submit: a.system_key === "student",
    });
  });
  const lessonSchema = z
    .object({
      group_id: z.uuid(),
      title,
      description: z.string().trim().max(2000).default(""),
      kind: z.enum(["article", "video", "live", "material"]),
      content: text,
      url,
      position: z.number().int().min(0).max(10000).default(0),
      status: z.enum(["draft", "published", "archived"]).default("draft"),
    })
    .refine((x) => (x.kind === "article" ? !!x.content : !!x.url), {
      message:
        "Articles need text; video, live and material records need a link",
    });
  app.post("/api/lms/lessons", async (c: AppContext) => {
    const d = lessonSchema.parse(await c.req.json()),
      g = await groupAccess(c, d.group_id, true),
      a = c.get("actor"),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_lessons(id,org_id,branch_id,group_id,title,description,kind,content,url,position,status,published_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        g.branch_id,
        g.id,
        d.title,
        d.description,
        d.kind,
        d.content,
        d.url,
        d.position,
        d.status,
        d.status === "published" ? now() : null,
        a.user_id,
      ),
      audit(c, "lesson", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.get("/api/lms/lessons/:id", async (c: AppContext) => {
    const row = await content(c, "lessons", c.req.param("id")!);
    return c.json({
      data: {
        id: row.id,
        group_id: row.group_id,
        title: row.title,
        description: row.description,
        kind: row.kind,
        content: row.content,
        url: row.url,
        status: row.status,
        position: row.position,
      },
    });
  });
  app.put("/api/lms/lessons/:id", async (c: AppContext) => {
    const before = await content(c, "lessons", c.req.param("id")!, true),
      d = lessonSchema.parse(await c.req.json());
    assert(
      before.group_id === d.group_id,
      400,
      "Cannot move a lesson between classes",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_lessons SET title=?,description=?,kind=?,content=?,url=?,position=?,status=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,unixepoch()) ELSE published_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(
        d.title,
        d.description,
        d.kind,
        d.content,
        d.url,
        d.position,
        d.status,
        d.status,
        before.id,
      ),
      audit(c, "lesson", before.id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/lms/lessons/:id/complete", async (c: AppContext) => {
    const lesson = await content(c, "lessons", c.req.param("id")!),
      student = await actingStudent(c, lesson.group_id),
      a = c.get("actor");
    assert(
      lesson.status === "published",
      409,
      "Only published lessons can be completed",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_lesson_progress(org_id,lesson_id,student_id,completed_at) VALUES(?,?,?,?) ON CONFLICT(lesson_id,student_id) DO NOTHING",
      ).bind(a.org_id, lesson.id, student, now()),
      audit(c, "lesson", lesson.id, "mark_complete", null, {
        student_id: student,
      }),
    ]);
    return c.json({ ok: true });
  });
  const assignmentSchema = z.object({
    group_id: z.uuid(),
    title,
    instructions: z.string().trim().min(1).max(10000),
    due_at: z.number().int().positive(),
    max_score: z.number().int().positive().max(10000),
    status: z.enum(["draft", "published", "closed"]).default("draft"),
  });
  app.post("/api/lms/assignments", async (c: AppContext) => {
    const d = assignmentSchema.parse(await c.req.json()),
      g = await groupAccess(c, d.group_id, true),
      a = c.get("actor"),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_assignments(id,org_id,branch_id,group_id,title,instructions,due_at,max_score,status,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        id,
        a.org_id,
        g.branch_id,
        g.id,
        d.title,
        d.instructions,
        d.due_at,
        d.max_score,
        d.status,
        a.user_id,
      ),
      audit(c, "assignment", id, "create", null, d),
    ]);
    return c.json({ id }, 201);
  });
  app.put("/api/lms/assignments/:id", async (c: AppContext) => {
    const before = await content(c, "assignments", c.req.param("id")!, true),
      d = assignmentSchema.parse(await c.req.json());
    assert(
      before.group_id === d.group_id,
      400,
      "Cannot move an assignment between classes",
    );
    const used = await c.env.DB.prepare(
      "SELECT id FROM el_submissions WHERE assignment_id=? LIMIT 1",
    )
      .bind(before.id)
      .first();
    assert(
      !used ||
        (d.max_score === before.max_score &&
          d.instructions === before.instructions &&
          d.title === before.title &&
          d.status !== "draft"),
      409,
      "Submitted assignments lock title, instructions and maximum score",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_assignments SET title=?,instructions=?,due_at=?,max_score=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).bind(
        d.title,
        d.instructions,
        d.due_at,
        d.max_score,
        d.status,
        before.id,
      ),
      audit(c, "assignment", before.id, "update", before, d),
    ]);
    return c.json({ ok: true });
  });
  app.get("/api/lms/assignments/:id", async (c: AppContext) => {
    const assignment = await content(c, "assignments", c.req.param("id")!),
      a = c.get("actor"),
      learner = ["student", "parent_guardian"].includes(a.system_key);
    let student = "";
    if (learner) {
      const link = await identity(c);
      student =
        link.kind === "student"
          ? link.student_id
          : (c.req.query("student_id") ?? "");
      assert(student, 400, "Choose your child");
      await ownedStudent(c, student);
    }
    const submissions = (
      await c.env.DB.prepare(
        `SELECT su.id,su.student_id,s.name student_name,su.body,su.url,su.score,su.feedback,su.submitted_at,su.graded_at FROM el_submissions su JOIN el_students s ON s.id=su.student_id WHERE su.org_id=? AND su.assignment_id=? ${learner ? "AND su.student_id=?" : ""} ORDER BY s.name LIMIT 500`,
      )
        .bind(a.org_id, assignment.id, ...(learner ? [student] : []))
        .all()
    ).results;
    return c.json({
      data: assignment,
      submissions,
      can_grade: !learner && a.permissions.includes("lms:edit"),
      can_submit:
        a.system_key === "student" &&
        assignment.status === "published" &&
        assignment.due_at >= now(),
    });
  });
  app.post("/api/lms/assignments/:id/submit", async (c: AppContext) => {
    const assignment = await content(c, "assignments", c.req.param("id")!),
      student = await actingStudent(c, assignment.group_id),
      a = c.get("actor"),
      d = z
        .object({ body: z.string().trim().min(1).max(20000), url })
        .parse(await c.req.json());
    assert(
      assignment.status === "published" && assignment.due_at >= now(),
      409,
      "Assignment is closed or overdue",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_submissions(id,org_id,assignment_id,student_id,body,url,submitted_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(id, a.org_id, assignment.id, student, d.body, d.url, now()),
      audit(c, "submission", id, "submit", null, {
        assignment_id: assignment.id,
        student_id: student,
      }),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/lms/submissions/:id/grade", async (c: AppContext) => {
    const a = c.get("actor"),
      s = await c.env.DB.prepare(
        "SELECT * FROM el_submissions WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(s, 404, "Submission not found");
    const assignment = await content(c, "assignments", s.assignment_id, true),
      d = z
        .object({
          score: z.number().int().min(0).max(10000),
          feedback: z.string().trim().max(5000).default(""),
        })
        .parse(await c.req.json());
    assert(
      d.score <= assignment.max_score,
      400,
      "Score exceeds assignment maximum",
    );
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE el_submissions SET score=?,feedback=?,graded_by=?,graded_at=? WHERE id=?",
      ).bind(d.score, d.feedback, a.user_id, now(), s.id),
      audit(c, "submission", s.id, "grade", s, d),
    ]);
    return c.json({ ok: true });
  });
  app.post("/api/lms/groups/:id/announcements", async (c: AppContext) => {
    const g = await groupAccess(c, c.req.param("id")!, true),
      a = c.get("actor"),
      d = z
        .object({ title, body: z.string().trim().min(1).max(4000) })
        .parse(await c.req.json());
    const audience = (
      await c.env.DB.prepare(
        "SELECT DISTINCT l.user_id FROM el_portal_links l JOIN el_memberships m ON m.org_id=l.org_id AND m.user_id=l.user_id LEFT JOIN el_notification_preferences p ON p.org_id=l.org_id AND p.user_id=l.user_id WHERE l.org_id=? AND m.status='active' AND (m.branch_id IS NULL OR m.branch_id=?) AND COALESCE(p.in_app,1)=1 AND (EXISTS(SELECT 1 FROM el_enrollments en WHERE en.org_id=l.org_id AND en.group_id=? AND en.student_id=l.student_id AND en.status='active') OR EXISTS(SELECT 1 FROM el_student_guardians sg JOIN el_enrollments en ON en.org_id=sg.org_id AND en.student_id=sg.student_id WHERE sg.org_id=l.org_id AND sg.guardian_id=l.guardian_id AND en.group_id=? AND en.status='active')) LIMIT 501",
      )
        .bind(a.org_id, g.branch_id, g.id, g.id)
        .all<{ user_id: string }>()
    ).results;
    assert(
      audience.length <= 500,
      409,
      "Class audience exceeds safe batch size",
    );
    const id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_announcements(id,org_id,branch_id,group_id,title,body,created_by) VALUES(?,?,?,?,?,?,?)",
      ).bind(id, a.org_id, g.branch_id, g.id, d.title, d.body, a.user_id),
      ...audience.map((u) =>
        c.env.DB.prepare(
          "INSERT INTO el_notifications(id,org_id,user_id,announcement_id,title,body) VALUES(?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, u.user_id, id, d.title, d.body),
      ),
      ...audience.map((u) =>
        c.env.DB.prepare(
          "INSERT INTO el_delivery_logs(id,org_id,announcement_id,user_id,channel,status,detail) VALUES(?,?,?,?,'in_app','stored','Stored in linked class inbox')",
        ).bind(uid(), a.org_id, id, u.user_id),
      ),
      audit(c, "class_announcement", id, "store", null, {
        group_id: g.id,
        stored: audience.length,
      }),
    ]);
    return c.json({ id, stored: audience.length }, 201);
  });
  app.post("/api/lms/groups/:id/discussions", async (c: AppContext) => {
    const g = await groupAccess(c, c.req.param("id")!),
      a = c.get("actor");
    if (a.system_key === "parent_guardian")
      assert(
        false,
        403,
        "Guardian accounts are read-only in class discussions",
      );
    if (a.system_key === "student") await actingStudent(c, g.id);
    else await groupAccess(c, g.id, true);
    const d = z
        .object({ body: z.string().trim().min(1).max(4000) })
        .parse(await c.req.json()),
      id = uid();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO el_discussions(id,org_id,branch_id,group_id,user_id,body) VALUES(?,?,?,?,?,?)",
      ).bind(id, a.org_id, g.branch_id, g.id, a.user_id, d.body),
      audit(c, "discussion", id, "post", null, { group_id: g.id }),
    ]);
    return c.json({ id }, 201);
  });
  app.post("/api/lms/discussions/:id/moderate", async (c: AppContext) => {
    const a = c.get("actor"),
      before = await c.env.DB.prepare(
        "SELECT * FROM el_discussions WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(before, 404, "Discussion not found");
    await groupAccess(c, before.group_id, true);
    const d = z
      .object({ status: z.enum(["visible", "hidden"]) })
      .parse(await c.req.json());
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE el_discussions SET status=? WHERE id=?").bind(
        d.status,
        before.id,
      ),
      audit(c, "discussion", before.id, "moderate", before, d),
    ]);
    return c.json({ ok: true });
  });
  for (const [method, handler] of [
    ["get", readAttendance],
    ["post", writeAttendance],
  ] as const)
    app[method]("/api/lms/sessions/:id/attendance", async (c: AppContext) => {
      const s = await c.env.DB.prepare(
        "SELECT group_id,teacher_id,branch_id FROM el_class_sessions WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, c.get("actor").org_id)
        .first<{ group_id: string; teacher_id: string; branch_id: string }>();
      assert(s, 404, "Session not found");
      const a = c.get("actor");
      if (
        a.system_key === "teacher" &&
        (await identity(c)).teacher_id === s.teacher_id
      ) {
        if (a.branch_id)
          assert(a.branch_id === s.branch_id, 403, "Branch access denied");
      } else await groupAccess(c, s.group_id, true);
      return handler(c);
    });
  app.get("/api/lms/groups/:id/roster", async (c: AppContext) => {
    const g = await groupAccess(c, c.req.param("id")!, true);
    return c.json({
      data: (
        await c.env.DB.prepare(
          "SELECT s.id,s.name,s.code,en.status,(SELECT round(avg(r.score*100.0/e.max_score)) FROM el_exam_results r JOIN el_exams e ON e.id=r.exam_id WHERE r.student_id=s.id AND e.group_id=en.group_id AND r.status='final') average_percent,(SELECT round(100.0*sum(CASE WHEN at.status IN ('present','late','left_early') THEN 1 ELSE 0 END)/nullif(count(*),0)) FROM el_attendance at JOIN el_class_sessions se ON se.id=at.session_id WHERE at.student_id=s.id AND se.group_id=en.group_id AND se.status<>'cancelled') attendance_percent FROM el_enrollments en JOIN el_students s ON s.id=en.student_id WHERE en.org_id=? AND en.group_id=? AND en.status IN ('active','completed') ORDER BY s.name LIMIT 500",
        )
          .bind(c.get("actor").org_id, g.id)
          .all()
      ).results,
    });
  });
  app.post("/api/lms/exams/:id/results", async (c: AppContext) => {
    const exam = await c.env.DB.prepare(
      "SELECT group_id FROM el_exams WHERE id=? AND org_id=?",
    )
      .bind(c.req.param("id")!, c.get("actor").org_id)
      .first<{ group_id: string }>();
    assert(exam, 404, "Exam not found");
    await groupAccess(c, exam.group_id, true);
    return gradeExamResult(c);
  });
  app.post("/api/lms/exams", async (c: AppContext) => {
    const d = await c.req.json();
    await groupAccess(c, z.uuid().parse(d.group_id), true);
    return createExam(c);
  });
  app.put("/api/lms/exams/:id", async (c: AppContext) => {
    const a = c.get("actor"),
      before = await c.env.DB.prepare(
        "SELECT group_id FROM el_exams WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<{ group_id: string }>();
    assert(before, 404, "Exam not found");
    await groupAccess(c, before.group_id, true);
    const d = await c.req.json();
    await groupAccess(c, z.uuid().parse(d.group_id), true);
    return updateExam(c);
  });
  app.post("/api/lms/exams/:id/questions", async (c: AppContext) => {
    const before = await c.env.DB.prepare(
      "SELECT group_id FROM el_exams WHERE id=? AND org_id=?",
    )
      .bind(c.req.param("id")!, c.get("actor").org_id)
      .first<{ group_id: string }>();
    assert(before, 404, "Exam not found");
    await groupAccess(c, before.group_id, true);
    return createExamQuestion(c);
  });
  app.get("/api/lms/exams/:id", async (c: AppContext) => {
    const a = c.get("actor"),
      exam = await c.env.DB.prepare(
        "SELECT * FROM el_exams WHERE id=? AND org_id=?",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(exam, 404, "Exam not found");
    await groupAccess(c, exam.group_id);
    const learner = ["student", "parent_guardian"].includes(a.system_key);
    assert(!learner || exam.status !== "draft", 404, "Exam not published");
    if (learner)
      assert(exam.scheduled_at <= now(), 409, "Exam has not started");
    const questions = (
      await c.env.DB.prepare(
        `SELECT id,type,prompt,options_json,points,position${learner ? "" : ",correct_answer"} FROM el_questions WHERE exam_id=? AND org_id=? ORDER BY position,id LIMIT 40`,
      )
        .bind(exam.id, a.org_id)
        .all()
    ).results;
    let result = null;
    if (learner) {
      const link = await identity(c),
        student =
          link.kind === "student" ? link.student_id : c.req.query("student_id");
      assert(student, 400, "Choose your child");
      await ownedStudent(c, student);
      result = await c.env.DB.prepare(
        "SELECT score,feedback,status FROM el_exam_results WHERE exam_id=? AND student_id=? AND org_id=?",
      )
        .bind(exam.id, student, a.org_id)
        .first();
      if (result && (result as any).status !== "final")
        result = { status: "pending_review" };
    }
    const results = learner
      ? []
      : (
          await c.env.DB.prepare(
            "SELECT r.id,r.student_id,s.name student_name,r.score,r.feedback,r.status,r.grading_source FROM el_exam_results r JOIN el_students s ON s.id=r.student_id WHERE r.org_id=? AND r.exam_id=? ORDER BY s.name LIMIT 500",
          )
            .bind(a.org_id, exam.id)
            .all()
        ).results;
    const answers = learner
      ? []
      : (
          await c.env.DB.prepare(
            "SELECT a.student_id,s.name student_name,a.question_id,a.answer,a.score FROM el_exam_answers a JOIN el_students s ON s.id=a.student_id WHERE a.org_id=? AND a.exam_id=? ORDER BY s.name,a.question_id LIMIT 2000",
          )
            .bind(a.org_id, exam.id)
            .all()
        ).results;
    return c.json({
      data: exam,
      questions,
      results,
      answers,
      students: learner
        ? []
        : (
            await c.env.DB.prepare(
              "SELECT s.id,s.name FROM el_enrollments en JOIN el_students s ON s.id=en.student_id WHERE en.org_id=? AND en.group_id=? AND en.status IN ('active','completed') ORDER BY s.name LIMIT 500",
            )
              .bind(a.org_id, exam.group_id)
              .all()
          ).results,
      result,
      can_submit:
        a.system_key === "student" && exam.status === "published" && !result,
    });
  });
  app.post("/api/lms/exams/:id/submit", async (c: AppContext) => {
    const a = c.get("actor"),
      exam = await c.env.DB.prepare(
        "SELECT * FROM el_exams WHERE id=? AND org_id=? AND status='published'",
      )
        .bind(c.req.param("id")!, a.org_id)
        .first<Record<string, any>>();
    assert(exam && exam.scheduled_at <= now(), 409, "Exam is not open");
    const student = await actingStudent(c, exam.group_id),
      d = z
        .object({
          answers: z
            .array(
              z.object({
                question_id: z.uuid(),
                answer: z.string().max(10000),
              }),
            )
            .max(40),
        })
        .parse(await c.req.json()),
      questions = (
        await c.env.DB.prepare(
          "SELECT * FROM el_questions WHERE exam_id=? AND org_id=? ORDER BY position LIMIT 41",
        )
          .bind(exam.id, a.org_id)
          .all<Record<string, any>>()
      ).results;
    assert(
      questions.length > 0 && questions.length <= 40,
      400,
      "Quiz needs 1–40 questions",
    );
    assert(
      new Set(d.answers.map((x) => x.question_id)).size === d.answers.length &&
        d.answers.every((x) => questions.some((q) => q.id === x.question_id)),
      400,
      "Invalid question or duplicate answer",
    );
    assert(
      !(await c.env.DB.prepare(
        "SELECT id FROM el_exam_results WHERE exam_id=? AND student_id=?",
      )
        .bind(exam.id, student)
        .first()),
      409,
      "This exam already has a saved result",
    );
    let score = 0,
      pending = false;
    const statements = [
      c.env.DB.prepare(
        "INSERT INTO el_quiz_attempts(org_id,exam_id,student_id,submitted_at) VALUES(?,?,?,?)",
      ).bind(a.org_id, exam.id, student, now()),
    ];
    for (const q of questions) {
      const answer =
          d.answers.find((x) => x.question_id === q.id)?.answer ?? "",
        correct = gradeAnswer(q.type, answer, q.correct_answer),
        points = correct === true ? q.points : 0;
      score += points;
      if (correct === null) pending = true;
      statements.push(
        c.env.DB.prepare(
          "INSERT INTO el_exam_answers(id,org_id,exam_id,student_id,question_id,answer,score) VALUES(?,?,?,?,?,?,?)",
        ).bind(uid(), a.org_id, exam.id, student, q.id, answer, points),
      );
    }
    assert(
      score <= exam.max_score,
      409,
      "Question points exceed exam maximum; teacher review required",
    );
    await c.env.DB.batch([
      ...statements,
      c.env.DB.prepare(
        "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,status,graded_by,grading_source,submitted_by) VALUES(?,?,?,?,?,?,?,'automatic',?)",
      ).bind(
        uid(),
        a.org_id,
        exam.id,
        student,
        score,
        pending ? "pending_review" : "final",
        a.user_id,
        a.user_id,
      ),
      audit(c, "quiz", exam.id, "submit_once", null, {
        student_id: student,
        needs_review: pending,
      }),
    ]);
    return c.json({ ok: true, status: pending ? "pending_review" : "final" });
  });
}
