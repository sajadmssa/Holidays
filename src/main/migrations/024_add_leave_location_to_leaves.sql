-- ============================================================
--  migrations/024_add_leave_location_to_leaves.sql
--  Add LeaveLocation column to Leaves table
-- ============================================================

ALTER TABLE Leaves ADD COLUMN LeaveLocation TEXT NULL
  CHECK(LeaveLocation IS NULL OR LeaveLocation IN ('داخل العراق', 'خارج العراق'));
