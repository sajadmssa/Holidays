'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'migrations');
const CLEAN_DB_PATH = path.join(__dirname, 'clean_install_test.db');
const PROD_COPY_SRC = path.join(__dirname, 'prod_copy.db');
const PROD_TEST_PATH = path.join(__dirname, 'prod_test.db');

// Helper to run migrations identically to database.js
function runAllMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const executed = new Set(
    db.prepare('SELECT name FROM _Migrations').all().map(r => r.name)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (!executed.has(file)) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      db.transaction(() => {
        try {
          db.exec(sql);
        } catch (err) {
          if (err.message.includes('duplicate column name')) {
            // column already exists
          } else {
            throw err;
          }
        }
        db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
      })();
    }
  }
}

console.log('====================================================');
console.log('  TEST SUITE: Phase 1 — Migration 007 Verification  ');
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

// ─────────────────────────────────────────────────────────────
// PART 1: Clean Install Test
// ─────────────────────────────────────────────────────────────
console.log('--- TEST PART 1: Clean Installation from Scratch ---');

if (fs.existsSync(CLEAN_DB_PATH)) fs.unlinkSync(CLEAN_DB_PATH);
const cleanDb = new Database(CLEAN_DB_PATH);
cleanDb.pragma('journal_mode = WAL');
cleanDb.pragma('foreign_keys = ON');
cleanDb.pragma('synchronous = NORMAL');

runTest('1.1: Run all migrations on empty DB', () => {
  runAllMigrations(cleanDb);
  const executed = cleanDb.prepare('SELECT name FROM _Migrations ORDER BY id').all();
  const expectedCount = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).length;
  assert.strictEqual(executed.length, expectedCount, `Expected ${expectedCount} migrations, found ${executed.length}`);
});

const EXPECTED_ARABIC_TYPES = [
  { name: 'إجازة اعتيادية', gender: null },
  { name: 'إجازة مرضية', gender: null },
  { name: 'إجازة طارئة', gender: null },
  { name: 'إجازة بدون راتب', gender: null },
  { name: 'إجازة دراسية', gender: null },
  { name: 'إجازة حجة', gender: null },
  { name: 'إجازة الأمومة', gender: 'Female' },
  { name: 'إجازة العدة', gender: 'Female' },
  { name: 'إجازة الرضاعة', gender: 'Female' },
  { name: 'دورة تدريبية', gender: null },
  { name: 'سبب آخر', gender: null }
];

runTest('1.2: Verify all 11 Arabic LeaveTypes exist in clean install', () => {
  const leaveTypes = cleanDb.prepare('SELECT LeaveTypeID, Name, GenderRestriction FROM LeaveTypes ORDER BY LeaveTypeID').all();
  assert.strictEqual(leaveTypes.length, 11, `Expected 11 leave types, found ${leaveTypes.length}`);
  
  for (const expected of EXPECTED_ARABIC_TYPES) {
    const found = leaveTypes.find(t => t.Name === expected.name);
    assert.ok(found, `Missing expected leave type: ${expected.name}`);
    assert.strictEqual(found.GenderRestriction, expected.gender, `Mismatch gender restriction for ${expected.name}`);
  }
});

runTest('1.3: Verify Female leaves (الأمومة، العدة، الرضاعة) are preserved with IDs 7, 8, 9', () => {
  const maternity = cleanDb.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('إجازة الأمومة');
  const widowhood = cleanDb.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('إجازة العدة');
  const nursing = cleanDb.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('إجازة الرضاعة');

  assert.ok(maternity, 'Maternity leave missing!');
  assert.strictEqual(maternity.LeaveTypeID, 7);
  assert.strictEqual(maternity.GenderRestriction, 'Female');

  assert.ok(widowhood, 'Widowhood leave missing!');
  assert.strictEqual(widowhood.LeaveTypeID, 8);
  assert.strictEqual(widowhood.GenderRestriction, 'Female');

  assert.ok(nursing, 'Nursing leave missing!');
  assert.strictEqual(nursing.LeaveTypeID, 9);
  assert.strictEqual(nursing.GenderRestriction, 'Female');
});

runTest('1.4: Verify female leave trigger enforces restriction on clean DB', () => {
  cleanDb.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (901, 'موظف تجريبي ذكر', 'Male', '2020-01-01', 'مهندس')
  `).run();

  const maternity = cleanDb.prepare('SELECT LeaveTypeID FROM LeaveTypes WHERE Name = ?').get('إجازة الأمومة');

  assert.throws(() => {
    cleanDb.prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderRef)
      VALUES (901, ?, '2026-09-10', '2026-09-20', 10, 'ORDER-123')
    `).run(maternity.LeaveTypeID);
  }, /GENDER_RESTRICTION/, 'Male employee was able to book maternity leave!');

  cleanDb.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (902, 'موظفة تجريبية أنثى', 'Female', '2020-01-01', 'باحثة')
  `).run();

  // Female booking maternity leave should succeed
  const res = cleanDb.prepare(`
    INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderRef)
    VALUES (902, ?, '2026-09-10', '2026-09-20', 10, 'ORDER-456')
  `).run(maternity.LeaveTypeID);

  assert.ok(res.changes > 0, 'Female employee could not book maternity leave');
});

cleanDb.close();

// ─────────────────────────────────────────────────────────────
// PART 2: Production Copy Test (Backward Compatibility / Idempotence)
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST PART 2: Production Copy Idempotence Test ---');

if (fs.existsSync(PROD_TEST_PATH)) fs.unlinkSync(PROD_TEST_PATH);
const liveDbPath = path.join(process.env.APPDATA || '.', 'leave-management-system', 'leave_management.db');
if (fs.existsSync(PROD_COPY_SRC)) {
  fs.copyFileSync(PROD_COPY_SRC, PROD_TEST_PATH);
} else if (fs.existsSync(liveDbPath)) {
  fs.copyFileSync(liveDbPath, PROD_TEST_PATH);
}

const prodDb = new Database(PROD_TEST_PATH);
prodDb.pragma('journal_mode = WAL');
prodDb.pragma('foreign_keys = ON');

const beforeLeaveTypes = prodDb.prepare('SELECT LeaveTypeID, Name, GenderRestriction FROM LeaveTypes ORDER BY LeaveTypeID').all();
const beforeLeavesCount = prodDb.prepare('SELECT COUNT(*) as c FROM Leaves').get().c;
const beforeEmployeesCount = prodDb.prepare('SELECT COUNT(*) as c FROM Employees').get().c;

runTest('2.1: Run migration runner on production copy (idempotent check)', () => {
  runAllMigrations(prodDb);
  const afterLeaveTypes = prodDb.prepare('SELECT LeaveTypeID, Name, GenderRestriction FROM LeaveTypes ORDER BY LeaveTypeID').all();
  assert.deepStrictEqual(afterLeaveTypes, beforeLeaveTypes, 'Leave types changed after running migrations on prod copy!');
});

runTest('2.2: Re-run 007 SQL directly on production copy to ensure no destructive side-effects', () => {
  const sql007 = fs.readFileSync(path.join(MIGRATIONS_DIR, '007_cleanup_leave_types.sql'), 'utf8');
  prodDb.exec(sql007);

  const afterReRunLeaveTypes = prodDb.prepare('SELECT LeaveTypeID, Name, GenderRestriction FROM LeaveTypes ORDER BY LeaveTypeID').all();
  assert.deepStrictEqual(afterReRunLeaveTypes, beforeLeaveTypes, 'Re-executing 007 modified leave types on prod copy!');

  const afterLeavesCount = prodDb.prepare('SELECT COUNT(*) as c FROM Leaves').get().c;
  assert.strictEqual(afterLeavesCount, beforeLeavesCount, 'Leave count changed on prod copy!');

  const afterEmployeesCount = prodDb.prepare('SELECT COUNT(*) as c FROM Employees').get().c;
  assert.strictEqual(afterEmployeesCount, beforeEmployeesCount, 'Employee count changed on prod copy!');
});

prodDb.close();

// Cleanup temporary DBs
if (fs.existsSync(CLEAN_DB_PATH)) fs.unlinkSync(CLEAN_DB_PATH);
if (fs.existsSync(PROD_TEST_PATH)) fs.unlinkSync(PROD_TEST_PATH);

console.log(`\n====================================================`);
console.log(`  RESULT: ${testsPassed} of ${totalTests} tests passed successfully!`);
console.log(`====================================================\n`);
