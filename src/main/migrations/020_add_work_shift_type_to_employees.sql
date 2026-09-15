-- ============================================================
--  migrations/020_add_work_shift_type_to_employees.sql
--  ADR-026: Add WorkShiftType column to Employees table
-- ============================================================

ALTER TABLE Employees ADD COLUMN WorkShiftType TEXT NOT NULL DEFAULT 'دوام صباحي'
  CHECK(WorkShiftType IN ('دوام صباحي', 'مناوب', 'مناوب بنظام 400kv'));
