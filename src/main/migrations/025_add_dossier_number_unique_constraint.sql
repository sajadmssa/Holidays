-- ============================================================
--  migrations/025_add_dossier_number_unique_constraint.sql
--  ADR-032: Enforce DossierNumber uniqueness at DB level (Defense-in-Depth)
--  for active, non-transferred employees using a Unique Partial Index.
--
--  Design notes:
--  • DossierNumber remains NULLABLE — optional user-entered field.
--  • Preserves existing idx_employees_dossier_number for general search.
--  • Adds idx_employees_dossier_number_unique for active employee uniqueness.
--  • Includes preflight validation to fail cleanly if duplicates already exist.
-- ============================================================

-- ── 1. Preflight Validation: Fail cleanly if active duplicates exist ──
CREATE TEMP TABLE IF NOT EXISTS _MigrationDossierCheck (
    DossierNumber TEXT
);

CREATE TEMP TRIGGER IF NOT EXISTS trg_check_dossier_unique_preflight
BEFORE INSERT ON _MigrationDossierCheck
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'فشل الترحيل 025: يوجد تعارض في أرقام الإضابير (DossierNumber) لموظفين نشطين غير منقولين في قاعدة البيانات. يرجى تصحيح التكرار قبل تطبيق قيد التفرد.');
END;

INSERT INTO _MigrationDossierCheck (DossierNumber)
SELECT DossierNumber
FROM Employees
WHERE DossierNumber IS NOT NULL
  AND TRIM(DossierNumber) != ''
  AND IsActive = 1
  AND IsTransferred = 0
GROUP BY TRIM(DossierNumber)
HAVING COUNT(*) > 1;

DROP TABLE IF EXISTS _MigrationDossierCheck;

-- ── 2. Create Unique Partial Index ──────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_dossier_number_unique
ON Employees(DossierNumber)
WHERE DossierNumber IS NOT NULL
  AND TRIM(DossierNumber) != ''
  AND IsActive = 1
  AND IsTransferred = 0;
