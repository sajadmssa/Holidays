// ============================================================
//  tests/dossierNumberDbConstraint.test.js
//  Automated Tests for ADR-032:
//  قيد تفرد رقم الإضبارة على مستوى قاعدة البيانات (Defense-in-Depth)
// ============================================================

'use strict';

// Transparent ABI bridge: if run via external Node.js, re-exec via Electron's embedded Node (ABI 110)
if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { translateSqliteError, translateError } = require('../src/main/utils/errorTranslator');

console.log('🧪 [DossierNumber DB Constraint Tests] Starting ADR-032 test suite...\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    process.exit(1);
  }
  passedTests++;
  console.log(`  ✅ PASS: ${message}`);
}

function assertThrowsSqliteConstraint(fn, message) {
  totalTests++;
  try {
    fn();
    console.error(`  ❌ FAIL: Expected SQLITE_CONSTRAINT error was NOT thrown: ${message}`);
    process.exit(1);
  } catch (err) {
    const isConstraint = err.code === 'SQLITE_CONSTRAINT' || String(err.message).includes('UNIQUE constraint failed');
    if (!isConstraint) {
      console.error(`  ❌ FAIL: Error was not SQLITE_CONSTRAINT. Got: "${err.message}": ${message}`);
      process.exit(1);
    }
    passedTests++;
    console.log(`  ✅ PASS: ${message} (Caught: "${err.message}")`);
    return err;
  }
}

function createMigratedDb() {
  const db = new Database(':memory:');
  const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    try {
      db.exec(sql);
    } catch (e) {
      if (!e.message.includes('duplicate column')) throw e;
    }
  }

  // Ensure AppCounters table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS AppCounters (
      CounterKey TEXT PRIMARY KEY,
      CounterValue INTEGER NOT NULL,
      UpdatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  return db;
}

// ──────────────────────────────────────────────────────────────
//  Suite 1: Direct SQL Insertions (Bypassing Application Layer)
// ──────────────────────────────────────────────────────────────
console.log('--- Suite 1: Direct SQL Insertions (Bypassing Service Layer) ---');
const db = createMigratedDb();

// Test 1: Insert first active employee with DossierNumber DOS-777
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (1, 'حيدر علي', 'Male', '2022-01-01', 'مهندس', 'DOS-777', 1, 0)
`).run();
assert(true, 'Direct SQL insert of first active employee with DOS-777 succeeded');

// Test 2: Direct SQL insert of second active employee with same DOS-777 -> MUST fail with SQLITE_CONSTRAINT
const err1 = assertThrowsSqliteConstraint(() => {
  db.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
    VALUES (2, 'زينب حسن', 'Female', '2022-02-01', 'محاسبة', 'DOS-777', 1, 0)
  `).run();
}, 'Direct SQL insert of second active employee with identical DossierNumber is blocked by DB unique index');

// Test 3: Verify error translation for the caught SQLite constraint error
const translatedMsg = translateSqliteError(err1);
assert(
  translatedMsg === 'رقم الإضبارة مستخدم من قبل موظف نشط آخر.',
  `translateSqliteError returns exact Arabic message: "${translatedMsg}"`
);
const translatedUnified = translateError(err1);
assert(
  translatedUnified === 'رقم الإضبارة مستخدم من قبل موظف نشط آخر.',
  `translateError returns exact Arabic message: "${translatedUnified}"`
);

// ──────────────────────────────────────────────────────────────
//  Suite 2: Permitted Non-Violating Scenarios (Transferred, Inactive, Null, Empty)
// ──────────────────────────────────────────────────────────────
console.log('\n--- Suite 2: Permitted Non-Violating Scenarios (Transferred / Inactive / Null / Empty) ---');

// Test 4: Direct SQL insert of transferred employee with same DOS-777 -> Allowed
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (3, 'سنان طارق', 'Male', '2021-05-01', 'مبرمج', 'DOS-777', 1, 1)
`).run();
assert(true, 'Direct SQL insert of transferred employee (IsTransferred=1) with DOS-777 succeeded');

// Test 5: Direct SQL insert of second transferred employee with same DOS-777 -> Allowed
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (4, 'عمر فاروق', 'Male', '2020-03-01', 'إداري', 'DOS-777', 1, 1)
`).run();
assert(true, 'Direct SQL insert of second transferred employee with same DOS-777 succeeded');

// Test 6: Direct SQL insert of inactive employee with same DOS-777 -> Allowed
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (5, 'رنا سلام', 'Female', '2019-10-01', 'باحثة', 'DOS-777', 0, 0)
`).run();
assert(true, 'Direct SQL insert of inactive employee (IsActive=0) with DOS-777 succeeded');

// Test 7: Direct SQL insert of multiple employees with NULL DossierNumber -> Allowed
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (6, 'مروة كريم', 'Female', '2023-01-01', 'مدققة', NULL, 1, 0)
`).run();
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (7, 'ليث سامي', 'Male', '2023-02-01', 'ملاحظ', NULL, 1, 0)
`).run();
assert(true, 'Direct SQL insert of multiple active employees with NULL DossierNumber succeeded');

// Test 8: Direct SQL insert of multiple employees with empty string or whitespace -> Allowed
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (8, 'ماهر جميل', 'Male', '2023-03-01', 'كاتب', '', 1, 0)
`).run();
db.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (9, 'هدى خالد', 'Female', '2023-04-01', 'كاتبة', '   ', 1, 0)
`).run();
assert(true, 'Direct SQL insert of multiple active employees with empty/whitespace DossierNumber succeeded');

// ──────────────────────────────────────────────────────────────
//  Suite 3: Direct SQL Updates
// ──────────────────────────────────────────────────────────────
console.log('\n--- Suite 3: Direct SQL Updates ---');

// Test 9: Update active employee to conflict with another active employee -> MUST fail with SQLITE_CONSTRAINT
assertThrowsSqliteConstraint(() => {
  db.prepare(`
    UPDATE Employees SET DossierNumber = 'DOS-777' WHERE EmployeeID = 6
  `).run();
}, 'Direct SQL update of active employee to a taken active DossierNumber fails');

// Test 10: Update active employee preserving their own DossierNumber -> Allowed
db.prepare(`
  UPDATE Employees SET FullName = 'حيدر علي عبد الحسين' WHERE EmployeeID = 1
`).run();
assert(true, 'Direct SQL update preserving existing DossierNumber succeeds without self-conflict');

// Test 11: Update transferred employee to active when DossierNumber conflicts -> MUST fail with SQLITE_CONSTRAINT
assertThrowsSqliteConstraint(() => {
  db.prepare(`
    UPDATE Employees SET IsTransferred = 0 WHERE EmployeeID = 3
  `).run();
}, 'Direct SQL transfer cancellation (IsTransferred=0) fails when DossierNumber conflicts with active employee');

// ──────────────────────────────────────────────────────────────
//  Suite 4: Migration Preflight Check & Idempotency
// ──────────────────────────────────────────────────────────────
console.log('\n--- Suite 4: Migration Preflight Check & Idempotency ---');

// Test 12: Migration 025 fails with Arabic error if existing DB contains active duplicates
const dirtyDb = new Database(':memory:');
const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
const filesBefore025 = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql') && f < '025_add_dossier_number_unique_constraint.sql')
  .sort();

for (const f of filesBefore025) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
  try {
    dirtyDb.exec(sql);
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
}

// Insert duplicate active employees into dirty DB
dirtyDb.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (101, 'موظف أ', 'Male', '2020-01-01', 'وظيفة أ', 'DOS-DUP-1', 1, 0)
`).run();
dirtyDb.prepare(`
  INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, DossierNumber, IsActive, IsTransferred)
  VALUES (102, 'موظف ب', 'Male', '2020-01-01', 'وظيفة ب', 'DOS-DUP-1', 1, 0)
`).run();

const migration025Sql = fs.readFileSync(path.join(migrationsDir, '025_add_dossier_number_unique_constraint.sql'), 'utf8');

totalTests++;
try {
  dirtyDb.exec(migration025Sql);
  console.error('  ❌ FAIL: Migration 025 was expected to fail on dirty DB with duplicates');
  process.exit(1);
} catch (err) {
  if (err.message.includes('فشل الترحيل 025')) {
    passedTests++;
    console.log(`  ✅ PASS: Migration 025 aborts with clear Arabic error when duplicates exist: "${err.message}"`);
  } else {
    console.error(`  ❌ FAIL: Migration 025 failed with unexpected message: "${err.message}"`);
    process.exit(1);
  }
}

// Test 13: Running migration 025 twice is idempotent on clean DB
const cleanDb = createMigratedDb();
cleanDb.exec(migration025Sql);
assert(true, 'Running migration 025 SQL twice is idempotent and succeeds without error');

console.log(`\n🎉 [DossierNumber DB Constraint Tests] ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!\n`);
