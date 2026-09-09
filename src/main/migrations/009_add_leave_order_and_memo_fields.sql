-- ============================================================
--  migrations/009_add_leave_order_and_memo_fields.sql
--  Adds RequestDate, MemoNumber, MemoDate, OrderNumber, and OrderDate
--  to the Leaves table for comprehensive administrative documentation.
-- ============================================================

ALTER TABLE Leaves ADD COLUMN RequestDate TEXT DEFAULT NULL;
ALTER TABLE Leaves ADD COLUMN MemoNumber TEXT DEFAULT NULL;
ALTER TABLE Leaves ADD COLUMN MemoDate TEXT DEFAULT NULL;
ALTER TABLE Leaves ADD COLUMN OrderNumber TEXT DEFAULT NULL;
ALTER TABLE Leaves ADD COLUMN OrderDate TEXT DEFAULT NULL;
