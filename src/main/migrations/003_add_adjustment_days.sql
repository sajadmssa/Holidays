-- ============================================================
--  migrations/003_add_adjustment_days.sql
--  Adds AdjustmentDays column to Employees table for legacy databases.
-- ============================================================

ALTER TABLE Employees ADD COLUMN AdjustmentDays INTEGER NOT NULL DEFAULT 0;
