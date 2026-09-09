-- ============================================================
--  migrations/007_cleanup_leave_types.sql
--  Clean up duplicated English LeaveTypes and re-assign any
--  existing leaves referencing legacy IDs to standard Arabic types.
-- ============================================================

-- 1. Re-link legacy Sick Leave to Arabic 'إجازة مرضية'
UPDATE Leaves
SET LeaveTypeID = (
    SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية' LIMIT 1
)
WHERE LeaveTypeID IN (
    SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'Sick Leave'
);

-- 2. Clean up legacy LeaveBalances referencing English types
DELETE FROM LeaveBalances
WHERE LeaveTypeID IN (
    SELECT LeaveTypeID FROM LeaveTypes
    WHERE Name IN (
        'Sick Leave',
        'Emergency Leave',
        'Study Leave',
        'Hajj Leave',
        'Maternity Leave',
        'Widowhood Leave',
        'Nursing Leave'
    )
);

-- 3. Delete redundant English leave types
DELETE FROM LeaveTypes
WHERE Name IN (
    'Sick Leave',
    'Emergency Leave',
    'Study Leave',
    'Hajj Leave',
    'Maternity Leave',
    'Widowhood Leave',
    'Nursing Leave'
);

