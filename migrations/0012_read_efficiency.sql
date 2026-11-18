-- Additive indexes only. Existing primary/unique indexes already cover email,
-- session tokens, role permissions, org/id lookups and payment idempotency.
-- Account session management and first active membership ordered by creation.
CREATE INDEX IF NOT EXISTS el_sessions_user_expiry ON el_sessions(user_id,expires_at);
CREATE INDEX IF NOT EXISTS el_memberships_login_order ON el_memberships(user_id,status,created_at);
CREATE INDEX IF NOT EXISTS el_memberships_status_counts ON el_memberships(org_id,status,branch_id);
-- Reverse guardian ownership and correlated student performance queries.
CREATE INDEX IF NOT EXISTS el_guardian_students_reverse ON el_student_guardians(org_id,guardian_id,student_id);
CREATE INDEX IF NOT EXISTS el_attendance_student_rollup ON el_attendance(student_id,session_id,status);
CREATE INDEX IF NOT EXISTS el_results_student_rollup ON el_exam_results(student_id,status,exam_id,score);
CREATE INDEX IF NOT EXISTS el_results_exam_ranking ON el_exam_results(exam_id,score DESC,student_id);
-- Group workload and teacher/classroom overlap checks.
CREATE INDEX IF NOT EXISTS el_sessions_group_window ON el_class_sessions(group_id,starts_at,status);
CREATE INDEX IF NOT EXISTS el_sessions_teacher_window ON el_class_sessions(teacher_id,starts_at,ends_at,status);
CREATE INDEX IF NOT EXISTS el_sessions_room_window ON el_class_sessions(classroom_id,starts_at,ends_at,status);
-- Family invoice history and headquarters newest-first invoice pages.
CREATE INDEX IF NOT EXISTS el_invoices_student_history ON el_invoices(org_id,student_id,date DESC,status);
CREATE INDEX IF NOT EXISTS el_invoices_recent ON el_invoices(org_id,created_at DESC,id);
-- Inbox ordering without the unread/read gap in the existing composite index.
CREATE INDEX IF NOT EXISTS el_notifications_recent ON el_notifications(org_id,user_id,created_at DESC,id);
-- Branch finance report range totals.
CREATE INDEX IF NOT EXISTS el_payments_branch_range ON el_payments(branch_id,date,kind,amount);
CREATE INDEX IF NOT EXISTS el_expenses_branch_range ON el_expenses(branch_id,status,date,amount);
-- Membership disable/revoke must not scan every account session.
CREATE INDEX IF NOT EXISTS el_sessions_membership ON el_sessions(membership_id);
-- Correlated finance receivables and headquarters expense pages.
CREATE INDEX IF NOT EXISTS el_invoices_branch_receivables ON el_invoices(branch_id,status,date,total);
CREATE INDEX IF NOT EXISTS el_expenses_recent ON el_expenses(org_id,created_at DESC);
-- Group report subqueries omit org_id but use globally unique group IDs.
CREATE INDEX IF NOT EXISTS el_exams_group_range ON el_exams(group_id,scheduled_at);
CREATE INDEX IF NOT EXISTS el_lessons_group_published ON el_lessons(group_id,status,id);
