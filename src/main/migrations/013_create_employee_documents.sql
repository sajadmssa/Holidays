-- ============================================================
--  migrations/013_create_employee_documents.sql
--  Creates the EmployeeDocuments table for managing TIME_CARD
--  and LEAVE_CARD files with relative storage paths and audit.
-- ============================================================

CREATE TABLE IF NOT EXISTS EmployeeDocuments (
    DocumentID    INTEGER PRIMARY KEY AUTOINCREMENT,
    EmployeeID    INTEGER NOT NULL REFERENCES Employees(EmployeeID) ON DELETE CASCADE,
    DocumentType  TEXT    NOT NULL CHECK(DocumentType IN ('TIME_CARD', 'LEAVE_CARD')),
    DocumentYear  INTEGER NOT NULL CHECK(DocumentYear >= 1950 AND DocumentYear <= 2100),
    OriginalName  TEXT    NOT NULL,
    FileName      TEXT    NOT NULL,
    RelativePath  TEXT    NOT NULL UNIQUE,
    FileExtension TEXT    NOT NULL,
    FileSize      INTEGER NOT NULL CHECK(FileSize > 0),
    MimeType      TEXT    DEFAULT NULL,
    Notes         TEXT    DEFAULT NULL,
    IsDeleted     INTEGER NOT NULL DEFAULT 0 CHECK(IsDeleted IN (0, 1)),
    CreatedAt     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    DeletedAt     TEXT    DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_emp_docs_lookup
ON EmployeeDocuments(EmployeeID, DocumentType, IsDeleted, DocumentYear DESC);

CREATE INDEX IF NOT EXISTS idx_emp_docs_type_year
ON EmployeeDocuments(DocumentType, DocumentYear);
