// ============================================================
//  scripts/verify_quality_and_fixes.js
//  Runs via Electron in Node mode to test all quality fixes.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const LoggerService = require('../src/main/services/LoggerService');
const AuditService = require('../src/main/services/AuditService');
const AutoBackupService = require('../src/main/services/AutoBackupService');
const LeaveService = require('../src/main/services/LeaveService');
const EmployeeService = require('../src/main/services/EmployeeService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function runTests() {
  // ──────────────────────────────────────────────────────────────
  //  Setup isolated test database
  // ──────────────────────────────────────────────────────────────
  const testDbDir = path.join(__dirname, '../data/test-suite');
  if (!fs.existsSync(testDbDir)) {
    fs.mkdirSync(testDbDir, { recursive: true });
  }
  const testDbPath = path.join(testDbDir, `test_quality_${Date.now()}.db`);
  const db = new Database(testDbPath);
  db.pragma('foreign_keys = ON');

  // Apply schema migrations with _Migrations tracking
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

  const migrationsDir = path.join(__dirname, '../src/main/migrations');
  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    if (!executed.has(file)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        db.exec(sql);
      } catch (err) {
        if (!err.message.includes('duplicate column name')) {
          throw err;
        }
      }
      db.prepare('INSERT OR IGNORE INTO _Migrations (name) VALUES (?)').run(file);
    }
  }

  // Seed basic LeaveTypes
  db.prepare("INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction) VALUES (1, 'إجازة اعتيادية', 30, 0, NULL)").run();
  db.prepare("INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction) VALUES (2, 'إجازة مرضية', 73, 0, NULL)").run();
  db.prepare("INSERT OR IGNORE INTO LeaveTypes (LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction) VALUES (3, 'إجازة بدون راتب', 365, 0, NULL)").run();

  console.log('════════════════════════════════════════════════════════════');
  console.log('  🧪 STARTING COMPREHENSIVE QUALITY & FIXES VERIFICATION');
  console.log('════════════════════════════════════════════════════════════\n');

  // ── Test 1: Department Name & System Settings ─────────────────
  console.log('▶ [Test Suite 1]: Department Name & Polymorphic System Settings');
  {
    // Test saving department name with object payload
    const key1 = 'department_name';
    const val1 = '  المديرية العامة لتوزيع كهرباء الجنوب  ';
    
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES (?, ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run(key1.trim(), val1.trim());

    const auditRes1 = AuditService.logAction(db, {
      actionType: 'UPDATE',
      entityType: 'System',
      entityID: null,
      oldValue: null,
      newValue: { [key1]: val1.trim() },
      details: `تحديث إعداد النظام [${key1}]: "${val1.trim()}"`,
    });

    assert(auditRes1.success === true, 'Audit log created successfully for system setting update');

    const readRow = db.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get('department_name');
    assert(readRow && readRow.Value === 'المديرية العامة لتوزيع كهرباء الجنوب', 'Department name correctly saved and trimmed');

    // Verify AuditLogs record
    const logRow = db.prepare('SELECT * FROM AuditLogs WHERE ActionType = ? ORDER BY LogID DESC LIMIT 1').get('UPDATE');
    assert(logRow && logRow.EntityType === 'System' && logRow.Details.includes('department_name'), 'AuditLogs correctly records System UPDATE');
  }

  // ── Test 2: LoggerService Operations ──────────────────────────
  console.log('\n▶ [Test Suite 2]: LoggerService Technical Internal Logging');
  {
    LoggerService.info('TestContext', 'Info message for verification', { testId: 101 });
    LoggerService.warn('TestContext', 'Warning message for verification');
    LoggerService.error('TestContext', 'Error message for verification', new Error('Simulated internal stack trace'));

    const logPath = LoggerService.getLogPath();
    assert(fs.existsSync(logPath), `Log file exists at ${logPath}`);
    
    const logContent = fs.readFileSync(logPath, 'utf8');
    assert(logContent.includes('[TestContext] Info message for verification'), 'LoggerService wrote INFO entry');
    assert(logContent.includes('[TestContext] Error message for verification'), 'LoggerService wrote ERROR entry with stack trace');
  }

  // ── Test 3: AuditService Failure Handling & Resilience ────────
  console.log('\n▶ [Test Suite 3]: AuditService Isolated Failure Handling');
  {
    // Test with null db
    const failRes1 = AuditService.logAction(null, {
      actionType: 'UPDATE',
      entityType: 'Employee',
      entityID: 999
    });
    assert(failRes1.success === false && failRes1.logId === null, 'AuditService safely returns failure without throwing when DB is null');

    // Test with invalid table or closed DB
    const tempClosedDb = new Database(':memory:');
    tempClosedDb.close();
    const failRes2 = AuditService.logAction(tempClosedDb, {
      actionType: 'INSERT',
      entityType: 'Leave',
      entityID: 10
    });
    assert(failRes2.success === false && failRes2.error !== undefined, 'AuditService safely catches closed DB error and returns { success: false }');
  }

  // ── Test 4: AutoBackupService Failure & Recovery Lifecycle ───
  console.log('\n▶ [Test Suite 4]: AutoBackupService 15-Day Scheduling & Error Persistence');
  {
    // 1. Simulate failure by providing an unreachable directory
    const backupFailResult = await AutoBackupService.checkAndRunAutoBackup(db, { force: true, baseDir: 'Z:\\invalid_path_unreachable_987654321' });
    assert(backupFailResult.performed === false && backupFailResult.error !== undefined, 'AutoBackupService returns { performed: false, error } on failure');

    // Verify failure is recorded in _AppSettings
    const errorSetting = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'last_auto_backup_error'").get();
    assert(errorSetting && errorSetting.Value && errorSetting.Value.includes('error'), 'AutoBackupService persisted error info to _AppSettings for UI notification');

    // 2. Perform successful auto backup
    const backupSuccessResult = await AutoBackupService.checkAndRunAutoBackup(db, { force: true, baseDir: testDbDir });
    assert(backupSuccessResult.performed === true && fs.existsSync(backupSuccessResult.backupPath), 'AutoBackupService succeeded and created backup file');

    // Verify error setting is cleared
    const clearedErrorSetting = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'last_auto_backup_error'").get();
    assert(clearedErrorSetting && clearedErrorSetting.Value === '', 'AutoBackupService cleared last_auto_backup_error on successful backup');

    const dateSetting = db.prepare("SELECT Value FROM _AppSettings WHERE Key = 'last_auto_backup_date'").get();
    assert(dateSetting && dateSetting.Value !== '', 'AutoBackupService updated last_auto_backup_date');
  }

  // ── Test 5: Service Arabic Error Strings & No Lingering "d" ───
  console.log('\n▶ [Test Suite 5]: Arabic Validation Messages & No Lingering English Units');
  {
    // Test EmployeeService validation messages
    let empErr = '';
    try {
      EmployeeService.addEmployee({ employeeId: -5 }, db);
    } catch (err) {
      empErr = err.message;
    }
    assert(empErr.includes('الرقم الوظيفي مطلوب'), `EmployeeService throws friendly Arabic for invalid ID: "${empErr}"`);

    // Test LeaveService calculation with future hire date
    let leaveErr = '';
    try {
      db.prepare("INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive) VALUES (999, 'موظف تجريبي', 'Male', '2099-01-01', 'مهندس', 1)").run();
      LeaveService.calculateRegularLeaveBalance(999, db);
    } catch (err) {
      leaveErr = err.message;
    }
    assert(leaveErr.includes('في المستقبل'), `LeaveService throws friendly Arabic for future hire date: "${leaveErr}"`);
  }

  // ── Test 6: Verify Live Production DB Employees ───────────────
  console.log('\n▶ [Test Suite 6]: Verify Real Database Employees (IDs 1, 2, 3, 22)');
  {
    const appDataDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'leave-management-system') : null;
    const candidatePaths = [
      path.join(__dirname, '../data/leave_management.db'),
      path.join(__dirname, '../leave_management_backup_2026-09-02.db'),
      appDataDir ? path.join(appDataDir, 'leave_management.db') : null
    ].filter(Boolean);

    let foundDb = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        foundDb = p;
        break;
      }
    }

    if (foundDb) {
      console.log(`  Checking database at: ${foundDb}`);
      const liveDb = new Database(foundDb, { readonly: true });
      const employees = liveDb.prepare('SELECT EmployeeID, FullName, IsActive FROM Employees WHERE EmployeeID IN (1, 2, 3, 22)').all();
      
      assert(employees.length === 4, `Found all 4 production employees (found ${employees.length})`);
      
      const allActive = employees.every(e => e.IsActive === 1);
      assert(allActive === true, `All 4 employees (IDs 1, 2, 3, 22) are IsActive = 1 (Active)`);
      
      for (const emp of employees) {
        console.log(`     • [ID: ${emp.EmployeeID}] ${emp.FullName} | IsActive = ${emp.IsActive}`);
      }
      liveDb.close();
    } else {
      console.log('  ℹ️ Production DB not found at candidate paths');
    }
  }

  // Cleanup isolated test db
  db.close();
  try {
    fs.rmSync(testDbDir, { recursive: true, force: true });
  } catch (_e) {}

  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`  🎯 SUMMARY: ${passedTests}/${totalTests} Tests Passed successfully!`);
  console.log('════════════════════════════════════════════════════════════\n');

  process.exit(passedTests === totalTests ? 0 : 1);
}

runTests().catch(err => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
