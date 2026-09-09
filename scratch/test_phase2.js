'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DocumentService = require('../src/main/services/DocumentService');
const EmployeeService = require('../src/main/services/EmployeeService');
const AuditService = require('../src/main/services/AuditService');

const TEST_DIR = path.join(__dirname, 'phase2_sandbox');
const TEST_DB_PATH = path.join(TEST_DIR, 'phase2_test.db');
const TEST_STORAGE_ROOT = path.join(TEST_DIR, 'EmployeeDocuments');
const TEST_SOURCE_DIR = path.join(TEST_DIR, 'sources');

// Setup sandbox environment
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_SOURCE_DIR, { recursive: true });
fs.mkdirSync(TEST_STORAGE_ROOT, { recursive: true });

// Create a valid dummy PDF file (with %PDF- header)
const samplePdfPath = path.join(TEST_SOURCE_DIR, 'sample_leave_card.pdf');
const pdfBuffer = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1/Root 1 0 R>>\nstartxref\n99\n%%EOF\n');
fs.writeFileSync(samplePdfPath, pdfBuffer);

// Helper to initialize clean test schema
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'migrations');
function initTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    db.transaction(() => {
      try { db.exec(sql); } catch (e) {
        if (!e.message.includes('duplicate column name')) throw e;
      }
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(f);
    })();
  }

  // Set custom storage path to our test sandbox
  db.prepare(`
    INSERT INTO _AppSettings (Key, Value, UpdatedAt)
    VALUES ('employee_documents_storage_path', ?, datetime('now', 'localtime'))
  `).run(TEST_STORAGE_ROOT);

  return db;
}

console.log('====================================================');
console.log('  TEST SUITE: Phase 2 — Atomicity & Cleanup Tests   ');
console.log('====================================================\n');

let testsPassed = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    testsPassed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

const db = initTestDb();

// Setup test employee
const TEST_EMP_ID = 8801;
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
  VALUES (?, 'موظف تجريبي ذرية', 'Male', '2021-01-01', 'مختبر أمان')
`).run(TEST_EMP_ID);

// ─────────────────────────────────────────────────────────────
// PART 1: DocumentService Atomicity & Orphan Cleanup
// ─────────────────────────────────────────────────────────────
console.log('--- TEST PART 1: DocumentService Atomicity ---');

runTest('1.1: DocumentService normal addDocument succeeds and creates file + record', () => {
  const result = DocumentService.addDocument({
    employeeId: TEST_EMP_ID,
    documentType: 'LEAVE_CARD',
    sourceFilePath: samplePdfPath,
    notes: 'مستند تجريبي سليم'
  }, db);

  assert.ok(result.success, 'Expected success = true');
  assert.ok(fs.existsSync(result.document.absolutePath), 'Physical file was not created!');

  const row = db.prepare('SELECT * FROM EmployeeDocuments WHERE DocumentID = ?').get(result.document.DocumentID);
  assert.ok(row, 'Database row not found!');
  assert.strictEqual(row.EmployeeID, TEST_EMP_ID);
});

runTest('1.2: DocumentService deletes physical file when DB insertion fails (No Orphan)', () => {
  // Create a trigger that forces EmployeeDocuments INSERT to fail
  db.exec(`
    CREATE TRIGGER trg_test_simulate_failure
    BEFORE INSERT ON EmployeeDocuments
    FOR EACH ROW
    WHEN NEW.Notes = 'TRIGGER_CRASH'
    BEGIN
      SELECT RAISE(ABORT, 'SIMULATED_DB_CRASH_DURING_INSERT');
    END;
  `);

  let targetCopiedPath = null;
  // Spy on fs.copyFileSync to record the copied destination path before DB failure
  const originalCopy = fs.copyFileSync;
  fs.copyFileSync = function (src, dest) {
    targetCopiedPath = dest;
    return originalCopy.apply(this, arguments);
  };

  let threwError = false;
  try {
    DocumentService.addDocument({
      employeeId: TEST_EMP_ID,
      documentType: 'LEAVE_CARD',
      sourceFilePath: samplePdfPath,
      notes: 'TRIGGER_CRASH'
    }, db);
  } catch (err) {
    threwError = true;
    assert.ok(err.message.includes('SIMULATED_DB_CRASH_DURING_INSERT'), `Unexpected error: ${err.message}`);
  } finally {
    fs.copyFileSync = originalCopy;
  }

  assert.ok(threwError, 'addDocument should have thrown an error!');
  assert.ok(targetCopiedPath, 'Target copied path was not intercepted');
  
  // CRITICAL ASSERTION: The file was created on disk, but must be UNLINKED immediately
  const fileStillExists = fs.existsSync(targetCopiedPath);
  assert.strictEqual(fileStillExists, false, `CRITICAL: Orphaned file was left on disk at ${targetCopiedPath}`);

  // Also verify no phantom DB row was inserted
  const phantomRow = db.prepare("SELECT * FROM EmployeeDocuments WHERE Notes = 'TRIGGER_CRASH'").get();
  assert.strictEqual(phantomRow, undefined, 'Phantom record was found in DB!');

  // Cleanup trigger
  db.exec('DROP TRIGGER trg_test_simulate_failure;');
});

// ─────────────────────────────────────────────────────────────
// PART 2: EmployeeService Transactional Atomicity
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST PART 2: EmployeeService Atomic Transaction ---');

runTest('2.1: EmployeeService.addEmployee creates employee, balances, and audit log', () => {
  const newEmpId = 8802;
  const insertId = EmployeeService.addEmployee({
    employeeId: newEmpId,
    fullName: 'موظف تجريبي جديد',
    gender: 'Male',
    hireDate: '2022-05-10',
    jobTitle: 'مبرمج نظم'
  }, db);

  assert.strictEqual(insertId, newEmpId);

  // Check employee
  const emp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(newEmpId);
  assert.ok(emp, 'Employee was not created');

  // Check sick balances (28 at 100%, 45 at 50%)
  const balances = db.prepare('SELECT * FROM LeaveBalances WHERE EmployeeID = ?').all(newEmpId);
  assert.strictEqual(balances.length, 2, `Expected 2 sick leave balances, found ${balances.length}`);

  // Check audit log
  const audit = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ?").get(newEmpId);
  assert.ok(audit, 'Audit log entry was not created');
});

runTest('2.2: EmployeeService rolls back completely if default balances or audit fails', () => {
  const crashEmpId = 8803;

  // Simulate failure during LeaveBalances insertion
  db.exec(`
    CREATE TRIGGER trg_test_simulate_balance_failure
    BEFORE INSERT ON LeaveBalances
    FOR EACH ROW
    WHEN NEW.EmployeeID = 8803
    BEGIN
      SELECT RAISE(ABORT, 'SIMULATED_BALANCE_FAILURE');
    END;
  `);

  let threw = false;
  try {
    EmployeeService.addEmployee({
      employeeId: crashEmpId,
      fullName: 'موظف فشل جزئي',
      gender: 'Female',
      hireDate: '2023-01-01',
      jobTitle: 'مراجع تدقيق'
    }, db);
  } catch (err) {
    threw = true;
    assert.ok(err.message.includes('SIMULATED_BALANCE_FAILURE'), `Unexpected error: ${err.message}`);
  }

  assert.ok(threw, 'addEmployee should have failed and thrown');

  // CRITICAL ATOMICITY CHECK: The employee insert MUST be rolled back!
  const orphanEmp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(crashEmpId);
  assert.strictEqual(orphanEmp, undefined, 'CRITICAL: Employee was NOT rolled back and exists without balances!');

  // Verify no audit log entry exists for this rolled-back employee
  const orphanAudit = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ?").get(crashEmpId);
  assert.strictEqual(orphanAudit, undefined, 'Audit log exists for rolled back employee!');

  // Cleanup trigger
  db.exec('DROP TRIGGER trg_test_simulate_balance_failure;');
});

db.close();

// Cleanup sandbox
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}

console.log(`\n====================================================`);
console.log(`  RESULT: ${testsPassed} of ${totalTests} tests passed successfully!`);
console.log(`====================================================\n`);
