ALTER TABLE el_automation_settings ADD COLUMN low_attendance INTEGER NOT NULL DEFAULT 0 CHECK(low_attendance IN (0,1));
ALTER TABLE el_automation_settings ADD COLUMN attendance_days INTEGER NOT NULL DEFAULT 30 CHECK(attendance_days BETWEEN 7 AND 90);
ALTER TABLE el_automation_settings ADD COLUMN attendance_threshold INTEGER NOT NULL DEFAULT 75 CHECK(attendance_threshold BETWEEN 1 AND 100);
ALTER TABLE el_automation_settings ADD COLUMN attendance_minimum INTEGER NOT NULL DEFAULT 5 CHECK(attendance_minimum BETWEEN 1 AND 50);
