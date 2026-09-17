-- ============================================================
--  migrations/021_add_dossier_number_to_employees.sql
--  ADR-027: Add DossierNumber (رقم الإضبارة) column to Employees
--
--  Design notes:
--  • DossierNumber is NULLABLE — many existing employees may not
--    have a dossier number, and the field should not be required.
--  • No UNIQUE constraint — multiple employees may share the same
--    dossier folder reference in government contexts.
--  • TEXT type allows free-form government reference numbers
--    (e.g. "2024/450" or "م.ع/1234").
--  • CREATE INDEX improves search-by-dossier-number performance.
-- ============================================================

ALTER TABLE Employees ADD COLUMN DossierNumber TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_dossier_number
ON Employees(DossierNumber)
WHERE DossierNumber IS NOT NULL AND TRIM(DossierNumber) != '';
