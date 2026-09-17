// ============================================================
//  tests/freshInstall.test.js  –  اختبار التثبيت من الصفر
//  يتحقق من أن جميع migrations 001-021 تعمل على قاعدة بيانات فارغة
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

console.log('\n=== Fresh Install Test: migrations 001→021 on empty DB ===\n');
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
