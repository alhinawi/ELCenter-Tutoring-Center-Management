CREATE INDEX IF NOT EXISTS el_corrections_requester_history ON el_attendance_corrections(org_id,requested_by,attendance_id,created_at DESC);
CREATE INDEX IF NOT EXISTS el_corrections_requester_rate ON el_attendance_corrections(org_id,requested_by,created_at);
CREATE TRIGGER el_correction_insert_snapshot BEFORE INSERT ON el_attendance_corrections BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM el_attendance a JOIN el_class_sessions s ON s.id=a.session_id WHERE a.id=NEW.attendance_id AND a.org_id=NEW.org_id AND s.branch_id=NEW.branch_id AND s.status<>'cancelled' AND a.revision=NEW.base_revision AND a.status=NEW.old_status) THEN RAISE(ABORT,'Attendance correction snapshot is stale') END;
 SELECT CASE WHEN (SELECT count(*) FROM el_attendance_corrections r WHERE r.org_id=NEW.org_id AND r.requested_by=NEW.requested_by AND r.created_at>=NEW.created_at-86400)>=100 THEN RAISE(ABORT,'Daily correction request limit reached') END;
END;
