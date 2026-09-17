//  tests/freshInstall.test.js  –  اختبار التثبيت من الصفر
//  يتحقق من أن جميع migrations 001-022 تعمل على قاعدة بيانات فارغة
//  ويتأكد من وجود idx_employees_leave_card_number و idx_employees_dossier_number
// ============================================================

'use strict';

// Transparent ABI bridge: if run via external Node.js, re-exec via Electron's embedded Node
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
const path = require('path');
const fs = require('fs');
const os = require('os');

const MIGRATIONS_DIR = path.join(__dirname, '../src/main/migrations');
const tmpDb = path.join(os.tmpdir(), `fresh_install_test_${Date.now()}.db`);

let errors = 0;

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function pass(msg) { process.stdout.write(`  ✅ ${msg}\n`); }
function fail(msg) { process.stderr.write(`  ❌ FAIL: ${msg}\n`); errors++; }

console.log('\n=== Fresh Install Test: migrations 001→022 on empty DB ===\n');
log(`Temp DB: ${tmpDb}`);

const db = new Database(tmpDb);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// Create _Migrations table
db.exec(`
  CREATE TABLE IF NOT EXISTS _Migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

log(`Found ${files.length} migration files.\n`);

// Mirror of the production stripDuplicateAlterTableAdd helper in database.js
function stripAlterIfColExists(sql, file) {
  const alterPattern = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)[^;]*;/gi;
  return sql.replace(alterPattern, (match, tableName, colName) => {
    const tableInfo = db.pragma(`table_info(${tableName})`);
    if (tableInfo.length === 0) return match;
    const colExists = tableInfo.some(row => row.name === colName);
    if (colExists) {
      log(`  [stripped] ${tableName}.${colName} already exists in ${file}`);
      return '-- [stripped] ' + match.replace(/\n/g, ' ');
    }
    return match;
  });
}

for (const file of files) {
  const rawSql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const sql = stripAlterIfColExists(rawSql, file);
      if (sql.trim().length > 0) {
        db.exec(sql);
      }
      const fkViolations = db.pragma('foreign_key_check');
      if (fkViolations && fkViolations.length > 0) {
        throw new Error(`FK check failed in ${file}: ` + JSON.stringify(fkViolations));
      }
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
    })();
    pass(`${file}`);
  } catch (err) {
    fail(`${file}: ${err.message}`);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

console.log('\n--- Verifying schema after all migrations ---\n');

// Check all expected columns exist in Employees
const cols = db.pragma('table_info(Employees)').map(r => r.name);
log(`Employees columns (${cols.length}): ${cols.join(', ')}\n`);

const requiredCols = [
  'EmployeeID', 'FullName', 'Gender', 'HireDate', 'JobTitle',
  'WorkLocation', 'LeaveCardNumber', 'LeaveApprover', 'IsActive',
  'AdjustmentDays', 'DepartmentID', 'SequenceNumber', 'JobNumber',
  'WorkShiftType'
];
if (files.includes('021_add_dossier_number_to_employees.sql')) {
  requiredCols.push('DossierNumber');
}
for (const col of requiredCols) {
  if (cols.includes(col)) {
    pass(`Column Employees.${col} exists`);
  } else {
    fail(`Column Employees.${col} MISSING`);
  }
}

// Check indexes exist
const indexes = db.pragma('index_list(Employees)').map(r => r.name);
log(`\nEmployees indexes: ${indexes.join(', ')}\n`);

if (indexes.includes('idx_employees_leave_card_number')) {
  pass('idx_employees_leave_card_number exists (N2 fixed ✔)');
} else {
  fail('idx_employees_leave_card_number MISSING — N2 NOT fixed!');
}

if (files.includes('021_add_dossier_number_to_employees.sql')) {
  if (indexes.includes('idx_employees_dossier_number')) {
    pass('idx_employees_dossier_number exists (migration 021 ✔)');
  } else {
    fail('idx_employees_dossier_number MISSING');
  }
}

// Integrity check
const integrity = db.pragma('integrity_check');
if (integrity[0].integrity_check === 'ok') {
  pass('PRAGMA integrity_check: ok');
} else {
  fail('PRAGMA integrity_check: ' + JSON.stringify(integrity));
}

// _Migrations count
const migCount = db.prepare('SELECT COUNT(*) as c FROM _Migrations').get();
log(`\n_Migrations rows: ${migCount.c} (expected ${files.length})`);
if (migCount.c === files.length) {
  pass(`All ${files.length} migrations recorded in _Migrations`);
} else {
  fail(`Only ${migCount.c}/${files.length} migrations recorded`);
}

// Check AppCounters table and initial counter
console.log('\n--- Verifying AppCounters and Employee Insertion ---\n');
const appCountersExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='AppCounters'").get();
if (appCountersExists) {
  pass('Table AppCounters exists (migration 022 ✔)');
} else {
  fail('Table AppCounters MISSING');
}

const initialCounter = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
if (initialCounter && Number(initialCounter.CounterValue) === 1) {
  pass('AppCounters.next_employee_id initialized to 1');
} else {
  fail(`AppCounters.next_employee_id expected 1, got ${initialCounter?.CounterValue}`);
}

// Test adding employees on this fresh database
const EmployeeService = require('../src/main/services/EmployeeService');
try {
  const emp1Id = EmployeeService.addEmployee({
    fullName: 'موظف تجريبي أول',
    gender: 'Male',
    hireDate: '2024-01-01',
    jobTitle: 'مهندس برمجيات',
    jobNumber: '1001',
  }, db);
  if (emp1Id === 1) {
    pass(`First employee added successfully with EmployeeID = ${emp1Id}`);
  } else {
    fail(`First employee EmployeeID expected 1, got ${emp1Id}`);
  }

  const counterAfter1 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
  if (counterAfter1 && Number(counterAfter1.CounterValue) === 2) {
    pass(`AppCounters.next_employee_id correctly advanced to 2`);
  } else {
    fail(`AppCounters.next_employee_id expected 2, got ${counterAfter1?.CounterValue}`);
  }

  // Add second employee
  const emp2Id = EmployeeService.addEmployee({
    fullName: 'موظفة تجريبية ثانية',
    gender: 'Female',
    hireDate: '2024-02-01',
    jobTitle: 'محاسبة مالية',
    jobNumber: '1002',
  }, db);
  if (emp2Id === 2) {
    pass(`Second employee added successfully with EmployeeID = ${emp2Id}`);
  } else {
    fail(`Second employee EmployeeID expected 2, got ${emp2Id}`);
  }

  const counterAfter2 = db.prepare("SELECT CounterValue FROM AppCounters WHERE CounterKey = 'next_employee_id'").get();
  if (counterAfter2 && Number(counterAfter2.CounterValue) === 3) {
    pass(`AppCounters.next_employee_id correctly advanced to 3`);
  } else {
    fail(`AppCounters.next_employee_id expected 3, got ${counterAfter2?.CounterValue}`);
  }

  // Verify employee balances were initialized in LeaveBalances
  const balances = db.prepare('SELECT COUNT(*) as c FROM LeaveBalances WHERE EmployeeID = 1').get();
  if (balances.c > 0) {
    pass(`LeaveBalances successfully initialized (${balances.c} records for Employee 1)`);
  } else {
    fail(`LeaveBalances was not initialized for Employee 1`);
  }
} catch (empErr) {
  fail(`Failed to add employee on fresh database: ${empErr.message}`);
}

db.close();

// Cleanup temp file
try { fs.unlinkSync(tmpDb); } catch (_) {}
try { fs.unlinkSync(tmpDb + '-wal'); } catch (_) {}
try { fs.unlinkSync(tmpDb + '-shm'); } catch (_) {}

console.log('\n' + '─'.repeat(60));
if (errors === 0) {
  console.log('✅  ALL CHECKS PASSED — fresh install path is clean.\n');
  process.exit(0);
} else {
  console.error(`❌  ${errors} CHECK(S) FAILED.\n`);
  process.exit(1);
}
