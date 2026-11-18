import type { AppContext } from "./app";
import { audit } from "./app";
import { uid } from "./db";
import { assert } from "./security";
export async function seedAcademicDemo(c: AppContext) {
  const a = c.get("actor"),
    db = c.env.DB;
  const count = await db
    .prepare("SELECT count(*) n FROM el_students WHERE org_id=? AND is_demo=1")
    .bind(a.org_id)
    .first<{ n: number }>();
  if (count?.n) return;
  const branches = (
    await db
      .prepare(
        "SELECT id FROM el_branches WHERE org_id=? AND status='active' AND is_demo=1 ORDER BY name",
      )
      .bind(a.org_id)
      .all<{ id: string }>()
  ).results;
  const b = branches[0]?.id ?? uid(),
    t = uid(),
    room = uid(),
    course = uid(),
    group = uid();
  const statements = [
    ...(branches.length
      ? []
      : [
          db
            .prepare(
              "INSERT INTO el_branches(id,org_id,name,code,address,capacity,is_demo) VALUES(?,?,?,?,?,?,1)",
            )
            .bind(
              b,
              a.org_id,
              "Discovery Demo Campus",
              "DEMO-" + b.slice(0, 6),
              "Fictional educational campus",
              120,
            ),
        ]),
    db
      .prepare("UPDATE el_organizations SET demo_enabled=1 WHERE id=?")
      .bind(a.org_id),
    db
      .prepare(
        "INSERT INTO el_teachers(id,org_id,branch_id,name,code,specialization,qualification,experience,is_demo) VALUES(?,?,?,?,?,?,?,?,1)",
      )
      .bind(
        t,
        a.org_id,
        b,
        "Nour Hassan",
        "T-101",
        "English language",
        "BA Education",
        7,
      ),
    db
      .prepare(
        "INSERT INTO el_classrooms(id,org_id,branch_id,name,code,capacity,equipment,floor,is_demo) VALUES(?,?,?,?,?,?,?,?,1)",
      )
      .bind(
        room,
        a.org_id,
        b,
        "Discovery Room",
        "R-01",
        24,
        "Projector, whiteboard",
        "1",
      ),
    db
      .prepare(
        "INSERT INTO el_courses(id,org_id,branch_id,name,code,subject,description,price,capacity,is_demo) VALUES(?,?,?,?,?,?,?,?,?,1)",
      )
      .bind(
        course,
        a.org_id,
        b,
        "English Foundations",
        "ENG-101",
        "English",
        "A fictional beginner language course.",
        900,
        24,
      ),
    db
      .prepare(
        "INSERT INTO el_groups(id,org_id,branch_id,name,code,course_id,teacher_id,classroom_id,capacity,start_date,end_date,price,is_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)",
      )
      .bind(
        group,
        a.org_id,
        b,
        "English · Evening A",
        "ENG-EVE",
        course,
        t,
        room,
        20,
        "2026-11-01",
        "2027-02-28",
        900,
      ),
  ];
  const names = [
    "Mariam Adel",
    "Omar Khaled",
    "Youssef Tarek",
    "Salma Ahmed",
    "Adam Mostafa",
    "Farah Samir",
  ];
  for (let i = 0; i < names.length; i++) {
    const student = uid(),
      guardian = uid();
    statements.push(
      db
        .prepare(
          "INSERT INTO el_students(id,org_id,branch_id,name,code,grade,school,phone,is_demo) VALUES(?,?,?,?,?,?,?,?,1)",
        )
        .bind(
          student,
          a.org_id,
          b,
          names[i],
          `ST-${101 + i}`,
          "Grade 10",
          "Fictional Modern School",
          `0100000010${i}`,
        ),
      db
        .prepare(
          "INSERT INTO el_guardians(id,org_id,branch_id,name,phone,email,is_demo) VALUES(?,?,?,?,?,?,1)",
        )
        .bind(
          guardian,
          a.org_id,
          b,
          `Guardian ${i + 1}`,
          `0100000020${i}`,
          `guardian${i + 1}@example.invalid`,
        ),
      db
        .prepare(
          "INSERT INTO el_student_guardians(org_id,student_id,guardian_id,relationship,is_demo) VALUES(?,?,?,?,1)",
        )
        .bind(a.org_id, student, guardian, "guardian"),
      db
        .prepare(
          "INSERT INTO el_enrollments(id,org_id,student_id,group_id,is_demo,created_at) VALUES(?,?,?,?,1,datetime('now','-60 days'))",
        )
        .bind(uid(), a.org_id, student, group),
    );
  }
  await db.batch([
    ...statements,
    audit(c, "demo", a.org_id, "seed_academic", null, { fictional: true }),
  ]);
}
export async function seedLearningDemo(c: AppContext) {
  const db = c.env.DB,
    a = c.get("actor");
  const columns = await db
    .prepare("PRAGMA table_info(el_class_sessions)")
    .all<{ name: string }>();
  if (!columns.results.length) return;
  const org = await db
    .prepare("SELECT demo_enabled FROM el_organizations WHERE id=?")
    .bind(a.org_id)
    .first<{ demo_enabled: number }>();
  assert(org?.demo_enabled, 409, "Enable demo mode first");
  const exists = await db
    .prepare(
      "SELECT id FROM el_class_sessions WHERE org_id=? AND is_demo=1 LIMIT 1",
    )
    .bind(a.org_id)
    .first();
  if (exists) return;
  const g = await db
    .prepare("SELECT * FROM el_groups WHERE org_id=? AND is_demo=1 LIMIT 1")
    .bind(a.org_id)
    .first<Record<string, any>>();
  assert(g, 409, "Populate academic demo records first");
  const students = (
    await db
      .prepare(
        "SELECT id FROM el_students WHERE org_id=? AND is_demo=1 AND branch_id=? ORDER BY name",
      )
      .bind(a.org_id, g.branch_id)
      .all<{ id: string }>()
  ).results;
  const base = Math.floor(Date.now() / 86400000) * 86400 + 7 * 3600,
    session = uid(),
    exam = uid();
  const statements = [
    db
      .prepare(
        "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,'completed',1)",
      )
      .bind(
        session,
        a.org_id,
        g.branch_id,
        g.id,
        g.teacher_id,
        g.classroom_id,
        base,
        base + 5400,
        "Conversation practice",
      ),
    db
      .prepare(
        "INSERT INTO el_class_sessions(id,org_id,branch_id,group_id,teacher_id,classroom_id,starts_at,ends_at,topic,status,is_demo) VALUES(?,?,?,?,?,?,?,?,?,'scheduled',1)",
      )
      .bind(
        uid(),
        a.org_id,
        g.branch_id,
        g.id,
        g.teacher_id,
        g.classroom_id,
        base + 86400,
        base + 91800,
        "Everyday expressions",
      ),
    db
      .prepare(
        "INSERT INTO el_exams(id,org_id,branch_id,group_id,name,scheduled_at,max_score,pass_score,status,is_demo) VALUES(?,?,?,?,?,?,100,50,'draft',1)",
      )
      .bind(
        exam,
        a.org_id,
        g.branch_id,
        g.id,
        "English · First progress check",
        base,
      ),
  ];
  statements.push(
    db
      .prepare(
        "INSERT INTO el_questions(id,org_id,exam_id,type,prompt,options_json,correct_answer,points,is_demo) VALUES(?,?,?,'multiple_choice','Choose the correct greeting.','[\"Hello\",\"Goodbye\"]','Hello',100,1)",
      )
      .bind(uid(), a.org_id, exam),
    db.prepare("UPDATE el_exams SET status='published' WHERE id=?").bind(exam),
  );
  for (let i = 0; i < students.length; i++)
    statements.push(
      db
        .prepare(
          "INSERT INTO el_attendance(id,org_id,session_id,student_id,status,recorded_by,is_demo) VALUES(?,?,?,?,?,?,1)",
        )
        .bind(
          uid(),
          a.org_id,
          session,
          students[i].id,
          i === 0 ? "absent" : "present",
          a.user_id,
        ),
      db
        .prepare(
          "INSERT INTO el_exam_results(id,org_id,exam_id,student_id,score,feedback,graded_by,is_demo) VALUES(?,?,?,?,?,?,?,1)",
        )
        .bind(
          uid(),
          a.org_id,
          exam,
          students[i].id,
          65 + i * 5,
          "Fictional demonstration result",
          a.user_id,
        ),
    );
  await db.batch([
    ...statements,
    audit(c, "demo", a.org_id, "seed_learning", null, { fictional: true }),
  ]);
}
