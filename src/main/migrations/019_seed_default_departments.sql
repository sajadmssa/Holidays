-- ============================================================
--  migrations/019_seed_default_departments.sql
--  Seeds the two approved default core departments:
--  - قسم الشؤون الإدارية
--  - قسم التشغيل
--  Removes any other unreferenced default seed departments.
-- ============================================================

DELETE FROM Departments 
WHERE Name NOT IN ('قسم الشؤون الإدارية', 'قسم التشغيل')
  AND DepartmentID NOT IN (SELECT DISTINCT DepartmentID FROM Employees WHERE DepartmentID IS NOT NULL);

INSERT OR IGNORE INTO Departments (Name) VALUES
    ('قسم الشؤون الإدارية'),
    ('قسم التشغيل');

