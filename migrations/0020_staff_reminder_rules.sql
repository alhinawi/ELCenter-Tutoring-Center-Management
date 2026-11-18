CREATE INDEX IF NOT EXISTS el_leads_followup_reminders ON el_leads(org_id,follow_up_on,assigned_to);
CREATE INDEX IF NOT EXISTS el_contracts_expiry_reminders ON el_contracts(org_id,ends_on,branch_id);
CREATE INDEX IF NOT EXISTS el_stock_balances_org_branch ON el_stock_balances(org_id,branch_id,item_id,quantity);
ALTER TABLE el_automation_settings ADD COLUMN lead_followups INTEGER NOT NULL DEFAULT 0 CHECK(lead_followups IN (0,1));
ALTER TABLE el_automation_settings ADD COLUMN contract_expiry INTEGER NOT NULL DEFAULT 0 CHECK(contract_expiry IN (0,1));
ALTER TABLE el_automation_settings ADD COLUMN low_stock INTEGER NOT NULL DEFAULT 0 CHECK(low_stock IN (0,1));
ALTER TABLE el_automation_settings ADD COLUMN contract_days INTEGER NOT NULL DEFAULT 30 CHECK(contract_days BETWEEN 1 AND 90);
