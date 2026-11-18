ALTER TABLE el_automation_settings ADD COLUMN upcoming_exams INTEGER NOT NULL DEFAULT 0 CHECK(upcoming_exams IN (0,1));
ALTER TABLE el_automation_settings ADD COLUMN exam_days INTEGER NOT NULL DEFAULT 7 CHECK(exam_days BETWEEN 1 AND 14);
CREATE INDEX IF NOT EXISTS el_exams_upcoming_reminders ON el_exams(org_id,status,scheduled_at,group_id);
