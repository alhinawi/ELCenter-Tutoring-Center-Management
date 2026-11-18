CREATE TABLE el_receipt_number_sequences(org_id TEXT PRIMARY KEY REFERENCES el_organizations(id),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),prefix TEXT NOT NULL DEFAULT 'RCPT-' CHECK(length(prefix) BETWEEN 1 AND 16),next_number INTEGER NOT NULL DEFAULT 1 CHECK(typeof(next_number)='integer' AND next_number BETWEEN 1 AND 999999999),updated_at INTEGER NOT NULL);
CREATE TRIGGER el_receipt_sequence_monotonic BEFORE UPDATE OF next_number ON el_receipt_number_sequences WHEN NEW.next_number<OLD.next_number BEGIN SELECT RAISE(ABORT,'Receipt sequence cannot move backwards'); END;
CREATE TRIGGER el_receipt_sequence_no_delete BEFORE DELETE ON el_receipt_number_sequences BEGIN SELECT RAISE(ABORT,'Receipt sequence cannot be deleted'); END;
CREATE TABLE el_receipt_numbers(org_id TEXT NOT NULL,payment_id TEXT NOT NULL,number TEXT NOT NULL,PRIMARY KEY(org_id,payment_id),UNIQUE(org_id,number),FOREIGN KEY(org_id,payment_id) REFERENCES el_payments(org_id,id));
CREATE TRIGGER el_receipt_number_assign AFTER INSERT ON el_payments WHEN NEW.kind='receipt' AND NEW.is_demo=0 AND EXISTS(SELECT 1 FROM el_receipt_number_sequences WHERE org_id=NEW.org_id AND enabled=1) BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM el_receipt_number_sequences WHERE org_id=NEW.org_id AND next_number>=999999999) THEN RAISE(ABORT,'Receipt sequence is exhausted; ask headquarters') END;
 UPDATE el_receipt_number_sequences SET next_number=next_number+1 WHERE org_id=NEW.org_id;
 INSERT INTO el_receipt_numbers(org_id,payment_id,number) SELECT NEW.org_id,NEW.id,prefix||printf('%06d',next_number-1) FROM el_receipt_number_sequences WHERE org_id=NEW.org_id;
END;
CREATE TRIGGER el_receipt_number_guard BEFORE INSERT ON el_receipt_numbers WHEN NOT EXISTS(SELECT 1 FROM el_payments WHERE org_id=NEW.org_id AND id=NEW.payment_id AND kind='receipt' AND is_demo=0) OR NOT EXISTS(SELECT 1 FROM el_receipt_number_sequences WHERE org_id=NEW.org_id AND enabled=1 AND NEW.number=prefix||printf('%06d',next_number-1)) BEGIN SELECT RAISE(ABORT,'Receipt number requires a real recorded receipt'); END;
CREATE TRIGGER el_receipt_number_immutable BEFORE UPDATE ON el_receipt_numbers BEGIN SELECT RAISE(ABORT,'Receipt numbers are immutable'); END;
CREATE TRIGGER el_receipt_number_no_delete BEFORE DELETE ON el_receipt_numbers BEGIN SELECT RAISE(ABORT,'Receipt numbers cannot be deleted'); END;
