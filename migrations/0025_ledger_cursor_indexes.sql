CREATE INDEX IF NOT EXISTS el_journals_cursor ON el_journals(org_id,status,date DESC,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS el_journals_branch_cursor ON el_journals(org_id,status,branch_id,date DESC,created_at DESC,id DESC);
