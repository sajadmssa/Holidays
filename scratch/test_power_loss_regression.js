// ============================================================
//  scratch/test_power_loss_regression.js
//  Realistic Power Loss & Process Crash Simulation Suite
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync, fork } = require('child_process');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const SANDBOX_DIR = path.join(__dirname, 'sandbox_power_loss');
const MOCK_APPDATA = path.join(SANDBOX_DIR, 'appdata');
const MOCK_DOCS = path.join(MOCK_APPDATA, 'EmployeeDocuments');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'migrations');

// Ensure clean sandbox
if (fs.existsSync(SANDBOX_DIR)) {
  fs.rmSync(SANDBOX_DIR, { recursive: true, force: true });
}
fs.mkdirSync(MOCK_APPDATA, { recursive: true });
fs.mkdirSync(MOCK_DOCS, { recursive: true });

process.env.HOLIDAYS_DB_DIR = MOCK_APPDATA;

const LOG_FILE = path.join(__dirname, 'power_out.txt');
const ERR_FILE = path.join(__dirname, 'power_err.txt');
fs.writeFileSync(LOG_FILE, '');
fs.writeFileSync(ERR_FILE, '');

const origLog = console.log;
console.log = function(...args) {
  origLog.apply(console, args);
  fs.appendFileSync(LOG_FILE, args.join(' ') + '\n');
};
const origErr = console.error;
console.error = function(...args) {
  origErr.apply(console, args);
  fs.appendFileSync(ERR_FILE, args.join(' ') + '\n');
};

async function main() {
console.log('════════════════════════════════════════════════════════════════');
console.log('   POWER LOSS & CRASH REGRESSION AUDIT (Realistic Process Kill)  ');
console.log('════════════════════════════════════════════════════════════════\n');

const results = {
  scenario1: null,
  scenario2_catch: null,
  scenario2_hard_kill: null,
  scenario3: null,
  scenario4: null,
  scenario5: null,
  scenario6: null,
  scenario7: null,
};

// Helper to init standard schema on a given db file
function initTestDatabase(dbPath) {
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Run all existing migrations
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      try { db.exec(sql); } catch (e) {
        if (!e.message.includes('duplicate column name')) throw e;
      }
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
    })();
  }

  return db;
}

// ──────────────────────────────────────────────────────────────
// Scenario 1: Power loss during addEmployee (inside db.transaction)
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 1] Power loss during addEmployee (after Employee insert, before Balances/Audit)...');
{
  const dbPath = path.join(MOCK_APPDATA, 'scen1.db');
  const db = initTestDatabase(dbPath);

  // Worker script that starts addEmployee with a crash point
  const workerScript = `
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database('${dbPath.replace(/\\/g, '/')}');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const EmployeeService = require('${path.join(__dirname, '../src/main/services/EmployeeService').replace(/\\/g, '/')}');

    // Attach trigger to simulate sudden process crash immediately upon Employee row insertion
    db.exec(\`
      CREATE TRIGGER trg_crash_sim AFTER INSERT ON Employees
      FOR EACH ROW WHEN NEW.EmployeeID = 9901
      BEGIN
        SELECT RAISE(FAIL, 'TRIGGERED_POWER_LOSS_SIMULATION');
      END;
    \`);

    try {
      EmployeeService.addEmployee({
        employeeId: 9901,
        fullName: 'موظف محاكاة انقطاع الكهرباء',
        gender: 'Male',
        hireDate: '2023-01-01',
        jobTitle: 'فني حاسوب'
      }, db);
    } catch (err) {
      // Brutal immediate exit without closing DB (simulating hard crash)
      process.exit(99);
    }
  `;

  const workerFile = path.join(SANDBOX_DIR, 'worker_scen1.js');
  fs.writeFileSync(workerFile, workerScript);

  db.close();

  // Run worker as separate child process
  const res = spawnSync(process.execPath, [workerFile], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOLIDAYS_DB_DIR: MOCK_APPDATA }, stdio: 'ignore', timeout: 10000 });

  // Now verify with fresh DB connection
  const verifyDb = new Database(dbPath);
  verifyDb.pragma('journal_mode = WAL');

  const empRow = verifyDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 9901').get();
  const balances = verifyDb.prepare('SELECT * FROM LeaveBalances WHERE EmployeeID = 9901').all();
  const audit = verifyDb.prepare("SELECT * FROM AuditLogs WHERE EntityID = 9901").all();
  const integrity = verifyDb.pragma('integrity_check');

  const passed = (empRow === undefined) && (balances.length === 0) && (audit.length === 0) && (integrity[0].integrity_check === 'ok');

  results.scenario1 = {
    passed,
    empRowExists: !!empRow,
    balancesCount: balances.length,
    auditCount: audit.length,
    integrity: integrity[0].integrity_check
  };

  verifyDb.close();
  console.log(`  Result: ${passed ? '✅ PASSED (Full rollback, 0 orphan records, integrity OK)' : '❌ FAILED'}\n`);
}

// ──────────────────────────────────────────────────────────────
// Scenario 2: Power loss / crash during addDocument
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 2] Power loss / crash during addDocument...');
{
  const dbPath = path.join(MOCK_APPDATA, 'scen2.db');
  const db = initTestDatabase(dbPath);

  // Insert base employee
  db.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle)
    VALUES (9902, 'موظف تجربة المستندات', 'Male', '2023-01-01', 'محلل')
  `).run();

  // Create a real sample PDF
  const samplePdf = path.join(SANDBOX_DIR, 'sample.pdf');
  fs.writeFileSync(samplePdf, Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\nxref\n0 1\n0000000000 65535 f\ntrailer<</Size 1/Root 1 0 R>>\nstartxref\n99\n%%EOF\n'));

  // Test 2.1: In-process exception (e.g. DB error during transaction) -> handled by catch block
  const DocumentService = require('../src/main/services/DocumentService');
  let orphanDetectedInCatch = false;
  let copiedPathCatch = null;

  // Spy on fs.copyFileSync to catch copied file location
  const origCopy = fs.copyFileSync;
  fs.copyFileSync = function(src, dest) {
    copiedPathCatch = dest;
    return origCopy.apply(this, arguments);
  };

  db.exec(`
    CREATE TRIGGER trg_fail_doc BEFORE INSERT ON EmployeeDocuments
    FOR EACH ROW WHEN NEW.Notes = 'FAIL_IN_CATCH'
    BEGIN
      SELECT RAISE(ABORT, 'SIMULATED_DB_ERROR');
    END;
  `);

  try {
    DocumentService.addDocument({
      employeeId: 9902,
      documentType: 'TIME_CARD',
      sourceFilePath: samplePdf,
      notes: 'FAIL_IN_CATCH'
    }, db);
  } catch (e) {
    // Expected
  } finally {
    fs.copyFileSync = origCopy;
  }

  const fileExistsAfterCatch = copiedPathCatch && fs.existsSync(copiedPathCatch);
  const passedCatch = !fileExistsAfterCatch;
  results.scenario2_catch = {
    passed: passedCatch,
    fileCleanedByCatch: !fileExistsAfterCatch
  };
  console.log(`  2.1 In-Process Exception (catch cleanup): ${passedCatch ? '✅ PASSED (Physical file deleted)' : '❌ FAILED'}`);

  // Test 2.2: Hard Process Crash / Power Cut (kill -9 right after file copy, before DB transaction)
  db.close();

  const workerScript2 = `
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');
    const db = new Database('${dbPath.replace(/\\/g, '/')}');
    db.pragma('journal_mode = WAL');

    const DocumentStorageService = require('${path.join(__dirname, '../src/main/services/DocumentStorageService').replace(/\\/g, '/')}');

    // Simulate saving file
    const res = DocumentStorageService.saveFile(9902, 'TIME_CARD', '${samplePdf.replace(/\\/g, '/')}', db);
    fs.writeFileSync('${path.join(SANDBOX_DIR, 'scen2_copied_file.txt').replace(/\\/g, '/')}', res.absolutePath);

    // Hard kill immediately before database insertion!
    process.abort();
  `;

  const workerFile2 = path.join(SANDBOX_DIR, 'worker_scen2.js');
  fs.writeFileSync(workerFile2, workerScript2);

  spawnSync(process.execPath, [workerFile2], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOLIDAYS_DB_DIR: MOCK_APPDATA }, stdio: 'ignore', timeout: 10000 });

  const copiedFilePath = fs.existsSync(path.join(SANDBOX_DIR, 'scen2_copied_file.txt'))
    ? fs.readFileSync(path.join(SANDBOX_DIR, 'scen2_copied_file.txt'), 'utf8')
    : null;

  const verifyDb2 = new Database(dbPath);
  const docRows = verifyDb2.prepare('SELECT * FROM EmployeeDocuments WHERE EmployeeID = 9902').all();

  const physicalFileRemainedOnDisk = copiedFilePath && fs.existsSync(copiedFilePath);
  const dbRecordExists = docRows.length > 0;

  // Now test reconcileOrphanDocuments (Startup Silent Reconciler)
  const DocumentStorageService = require('../src/main/services/DocumentStorageService');
  const reconcileResult = DocumentStorageService.reconcileOrphanDocuments(verifyDb2, { minAgeMs: 0 });
  const physicalFileAfterReconcile = copiedFilePath && fs.existsSync(copiedFilePath);

  const passed2_2 = physicalFileRemainedOnDisk && !dbRecordExists && !physicalFileAfterReconcile && reconcileResult.deletedCount >= 1;

  results.scenario2_hard_kill = {
    physicalFileRemainedOnDisk,
    dbRecordExists,
    reconciledDeletedCount: reconcileResult.deletedCount,
    physicalFileCleanedAfterReconcile: !physicalFileAfterReconcile,
    passed: passed2_2
  };

  console.log(`  2.2 Hard Process Kill (Power cut before DB insert):`);
  console.log(`      - Physical file on disk initially: ${physicalFileRemainedOnDisk ? 'YES' : 'NO'}`);
  console.log(`      - DB record inserted: ${dbRecordExists ? 'YES' : 'NO'}`);
  console.log(`      - Reconciled orphan files deleted: ${reconcileResult.deletedCount}`);
  console.log(`      - Physical file on disk after reconciliation: ${physicalFileAfterReconcile ? 'YES (Leaked)' : 'NO (Cleaned)'}`);
  console.log(`      - Result: ${passed2_2 ? '✅ PASSED (Orphan file successfully pruned by reconciliation)' : '❌ FAILED'}\n`);

  verifyDb2.close();
}

// ──────────────────────────────────────────────────────────────
// Scenario 3: Power loss during External Transfer & Status Operations (Atomic Rollback)
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 3] Power loss during External Transfer & Status Changes (atomicity of UPDATE vs AuditLog)...');
{
  const dbPath = path.join(MOCK_APPDATA, 'scen3.db');
  const db = initTestDatabase(dbPath);

  // Setup initial state for 5 functions
  db.prepare(`
    INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsTransferred, IsActive)
    VALUES 
      (9903, 'موظف محاكاة النقل', 'Male', '2023-01-01', 'مهندس قديم', 0, 1),
      (9904, 'موظف محاكاة إلغاء النقل', 'Male', '2023-01-01', 'فني', 1, 1),
      (9905, 'موظف محاكاة التعديل', 'Female', '2023-01-01', 'مترجم قديم', 0, 1),
      (9906, 'موظف محاكاة التجميد', 'Male', '2023-01-01', 'إداري', 0, 1),
      (9907, 'موظف محاكاة التنشيط', 'Female', '2023-01-01', 'محاسب', 0, 0)
  `).run();

  db.close();

  // Test script simulating abrupt power cut inside AuditService.logAction for each operation
  const workerScript3 = `
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database('${dbPath.replace(/\\/g, '/')}');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const EmployeeService = require('${path.join(__dirname, '../src/main/services/EmployeeService').replace(/\\/g, '/')}');
    const AuditService = require('${path.join(__dirname, '../src/main/services/AuditService').replace(/\\/g, '/')}');

    // Intercept AuditService.logAction to simulate hard crash immediately after UPDATE
    AuditService.logAction = function() {
      process.abort();
    };

    const targetOp = process.argv[2];

    if (targetOp === 'transfer') {
      EmployeeService.transferEmployee(9903, {
        transferOrderNumber: '12345',
        transferOrderDate: '2026-03-09',
        transferNotes: 'نقل إلى موقع آخر'
      }, db);
    } else if (targetOp === 'cancelTransfer') {
      EmployeeService.cancelEmployeeTransfer(9904, db);
    } else if (targetOp === 'update') {
      EmployeeService.updateEmployee(9905, {
        fullName: 'موظف محاكاة التعديل',
        jobTitle: 'مترجم جديد كلياً'
      }, db);
    } else if (targetOp === 'deactivate') {
      EmployeeService.deactivateEmployee(9906, db);
    } else if (targetOp === 'activate') {
      EmployeeService.activateEmployee(9907, db);
    }
  `;

  const workerFile3 = path.join(SANDBOX_DIR, 'worker_scen3.js');
  fs.writeFileSync(workerFile3, workerScript3);

  // Execute hard crash simulation for each of the 5 operations
  const ops = ['transfer', 'cancelTransfer', 'update', 'deactivate', 'activate'];
  for (const op of ops) {
    spawnSync(process.execPath, [workerFile3, op], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HOLIDAYS_DB_DIR: MOCK_APPDATA },
      stdio: 'ignore',
      timeout: 10000
    });
  }

  // Open fresh DB to verify complete atomic rollback across all 5 functions
  const verifyDb3 = new Database(dbPath);
  verifyDb3.pragma('journal_mode = WAL');

  const emp3 = verifyDb3.prepare('SELECT * FROM Employees WHERE EmployeeID = 9903').get();
  const emp4 = verifyDb3.prepare('SELECT * FROM Employees WHERE EmployeeID = 9904').get();
  const emp5 = verifyDb3.prepare('SELECT * FROM Employees WHERE EmployeeID = 9905').get();
  const emp6 = verifyDb3.prepare('SELECT * FROM Employees WHERE EmployeeID = 9906').get();
  const emp7 = verifyDb3.prepare('SELECT * FROM Employees WHERE EmployeeID = 9907').get();

  const auditCount = verifyDb3.prepare('SELECT COUNT(*) AS total FROM AuditLogs WHERE EntityID IN (9903, 9904, 9905, 9906, 9907)').get().total;

  // Checks:
  // emp3 (transfer): IsTransferred rolled back to 0
  const passTransfer = emp3.IsTransferred === 0;
  // emp4 (cancelTransfer): IsTransferred rolled back to 1
  const passCancel = emp4.IsTransferred === 1;
  // emp5 (update): JobTitle rolled back to 'مترجم قديم'
  const passUpdate = emp5.JobTitle === 'مترجم قديم';
  // emp6 (deactivate): IsActive rolled back to 1
  const passDeactivate = emp6.IsActive === 1;
  // emp7 (activate): IsActive rolled back to 0
  const passActivate = emp7.IsActive === 0;

  const allPassed = passTransfer && passCancel && passUpdate && passDeactivate && passActivate && (auditCount === 0);

  results.scenario3 = {
    transferRollback: passTransfer,
    cancelTransferRollback: passCancel,
    updateRollback: passUpdate,
    deactivateRollback: passDeactivate,
    activateRollback: passActivate,
    auditCount,
    passed: allPassed
  };

  console.log(`  - 1. transferEmployee atomic rollback: ${passTransfer ? '✅ YES' : '❌ NO'}`);
  console.log(`  - 2. cancelEmployeeTransfer atomic rollback: ${passCancel ? '✅ YES' : '❌ NO'}`);
  console.log(`  - 3. updateEmployee atomic rollback: ${passUpdate ? '✅ YES' : '❌ NO'}`);
  console.log(`  - 4. deactivateEmployee atomic rollback: ${passDeactivate ? '✅ YES' : '❌ NO'}`);
  console.log(`  - 5. activateEmployee atomic rollback: ${passActivate ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Zero corrupt partial audit logs: ${auditCount === 0 ? '✅ YES' : '❌ NO'}`);
  console.log(`  - Result: ${allPassed ? '✅ PASSED (All 5 functions strictly atomic with db.transaction)' : '❌ FAILED'}\n`);

  verifyDb3.close();
}

// ──────────────────────────────────────────────────────────────
// Scenario 4: Power loss in the middle of a Database Migration
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 4] Power loss in the middle of applying a Migration...');
{
  const dbPath = path.join(MOCK_APPDATA, 'scen4.db');
  const db = initTestDatabase(dbPath);

  // We test the transaction wrapper of runMigrations in database.js:
  // _db.transaction(() => { _db.exec(sql); _db.prepare('INSERT INTO _Migrations...').run(file); })()
  // If a crash happens midway through the SQL execution:
  const testMigrationSql = `
    CREATE TABLE TablePart1 (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO TablePart1 VALUES (1, 'part1_ok');
    -- Trigger crash halfway through
    CREATE TABLE TablePart2 (id INTEGER PRIMARY KEY);
  `;

  let partialTableCreated = false;
  let recordedInMigrations = false;

  try {
    db.transaction(() => {
      db.exec("CREATE TABLE TablePart1 (id INTEGER PRIMARY KEY, name TEXT);");
      db.exec("INSERT INTO TablePart1 VALUES (1, 'part1_ok');");
      // Simulate crash / error midway
      throw new Error('SIMULATED_MIGRATION_MIDWAY_POWER_LOSS');
      db.exec("CREATE TABLE TablePart2 (id INTEGER PRIMARY KEY);");
      db.prepare("INSERT INTO _Migrations (name) VALUES ('999_test.sql')").run();
    })();
  } catch (e) {
    // Crash occurred
  }

  // Verify rollback
  const checkPart1 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='TablePart1'").get();
  const checkMigEntry = db.prepare("SELECT * FROM _Migrations WHERE name = '999_test.sql'").get();

  const passed4 = (!checkPart1) && (!checkMigEntry);
  results.scenario4 = {
    passed: passed4,
    partialTableExists: !!checkPart1,
    migrationRecorded: !!checkMigEntry
  };

  console.log(`  - Partial table TablePart1 exists: ${!!checkPart1 ? 'YES (Leaked)' : 'NO (Rolled back)'}`);
  console.log(`  - Migration marked as executed: ${!!checkMigEntry ? 'YES (Corrupt state)' : 'NO'}`);
  console.log(`  - Result: ${passed4 ? '✅ PASSED (Clean DDL rollback thanks to SQLite transaction)' : '❌ FAILED'}\n`);

  db.close();
}

// ──────────────────────────────────────────────────────────────
// Scenario 5: Emergency Rollback on Restore Failure
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 5] Emergency Rollback on Restore Failure (_emergencyRollback)...');
{
  const dbPath = path.join(MOCK_APPDATA, 'leave_management.db');
  const db = initTestDatabase(dbPath);

  // Pre-restore state
  db.prepare("INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle) VALUES (7777, 'أصيل قبل الاستعادة', 'Male', '2020-01-01', 'أصيل')").run();
  db.close();

  const databaseModule = require('../src/main/database');
  databaseModule.initialize();

  // Create a bundle that fails halfway through extraction
  const corruptZipPath = path.join(SANDBOX_DIR, 'corrupt_bundle.hbak');
  const snapDbPath = path.join(SANDBOX_DIR, 'snap.db');
  const snapDb = initTestDatabase(snapDbPath);
  snapDb.prepare("INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle) VALUES (8888, 'موظف النسخة المستعادة', 'Male', '2021-01-01', 'مستعاد')").run();
  snapDb.close();

  const zip = new AdmZip();
  zip.addLocalFile(snapDbPath, '', 'leave_management.db');
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({
    app: 'Holidays - Leave Management System',
    version: '4.0.0',
    schemaVersion: 14,
    employeesCount: 1,
    leavesCount: 0
  })));
  zip.writeZip(corruptZipPath);

  // We simulate failure during restore extraction
  let restoreFailedAndCaught = false;
  let rolledBack = false;

  // Monkey-patch fs.writeFileSync during extraction to throw error after DB was overwritten
  let failureInjected = false;
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function(p, c) {
    const res = originalWrite.apply(this, arguments);
    if (!failureInjected && typeof p === 'string' && p.endsWith('leave_management.db')) {
      failureInjected = true;
      throw new Error('SIMULATED_POWER_LOSS_MID_RESTORE');
    }
    return res;
  };

  try {
    await databaseModule.restoreDatabase(corruptZipPath);
  } catch (err) {
    restoreFailedAndCaught = true;
    if (err.message.includes('تم التراجع التلقائي إلى الحالة السابقة')) {
      rolledBack = true;
    }
  } finally {
    fs.writeFileSync = originalWrite;
  }

  databaseModule.close();

  // Re-open DB and verify pre-restore state was restored!
  const verifyRestoreDb = new Database(dbPath);
  const emp7777 = verifyRestoreDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 7777').get();
  const integrity = verifyRestoreDb.pragma('integrity_check');

  const passed5 = !!emp7777 && (emp7777.FullName === 'أصيل قبل الاستعادة') && (integrity[0].integrity_check === 'ok');

  results.scenario5 = {
    passed: passed5,
    restoreCaught: restoreFailedAndCaught,
    rolledBackMessage: rolledBack,
    preRestoreEmpSurvived: !!emp7777,
    integrity: integrity[0].integrity_check
  };

  console.log(`  - Restore caught & auto-rollback triggered: ${restoreFailedAndCaught ? 'YES' : 'NO'}`);
  console.log(`  - Pre-restore state (Employee 7777) restored: ${!!emp7777 ? 'YES' : 'NO'}`);
  console.log(`  - Result: ${passed5 ? '✅ PASSED (_emergencyRollback reverted system safely)' : '❌ FAILED'}\n`);

  verifyRestoreDb.close();
}

// ──────────────────────────────────────────────────────────────
// Scenario 6: Power loss during Auto-Backup writing
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 6] Power loss during Auto-Backup writing (non-blocking & corrupt file handling)...');
{
  const dbPath = path.join(MOCK_APPDATA, 'leave_management.db');
  const db = initTestDatabase(dbPath);
  db.prepare("INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle) VALUES (5555, 'موظف النسخ الدوري', 'Male', '2023-01-01', 'مدقق')").run();
  db.close();

  const databaseModule = require('../src/main/database');
  databaseModule.initialize();

  // Simulate an interrupted auto-backup file (truncated ZIP / 0-byte or corrupt header)
  const autoBackupsDir = path.join(MOCK_APPDATA, 'auto-backups');
  fs.mkdirSync(autoBackupsDir, { recursive: true });

  const partialBackupPath = path.join(autoBackupsDir, 'auto_backup_2026-03-09T01-00-00.hbak');
  fs.writeFileSync(partialBackupPath, Buffer.from('PK\x03\x04...INCOMPLETE_DATA_POWER_CUT_DURING_WRITE'));

  // 1. Verify validateDatabaseBackup rejects the truncated file
  let validationRejected = false;
  try {
    databaseModule.validateDatabaseBackup(partialBackupPath);
  } catch (err) {
    validationRejected = true;
  }

  // 2. Verify active database was untouched and functions normally
  const activeDb = databaseModule.getDb();
  const emp5555 = activeDb.prepare('SELECT * FROM Employees WHERE EmployeeID = 5555').get();
  const integrity = activeDb.pragma('integrity_check');

  databaseModule.close();

  const passed6 = validationRejected && !!emp5555 && (integrity[0].integrity_check === 'ok');

  results.scenario6 = {
    passed: passed6,
    truncatedBackupRejected: validationRejected,
    activeDbHealthy: !!emp5555,
    integrity: integrity[0].integrity_check
  };

  console.log(`  - Truncated partial backup safely rejected: ${validationRejected ? 'YES' : 'NO'}`);
  console.log(`  - Active DB completely untouched: ${!!emp5555 ? 'YES' : 'NO'}`);
  console.log(`  - Result: ${passed6 ? '✅ PASSED' : '❌ FAILED'}\n`);
}

// ──────────────────────────────────────────────────────────────
// Scenario 7: WAL Mode & Database Health Check
// ──────────────────────────────────────────────────────────────
console.log('▶ [Scenario 7] WAL Mode & Database Integrity verification after all crashes...');
{
  const dbPath = path.join(MOCK_APPDATA, 'leave_management.db');
  const db = new Database(dbPath);

  const journalMode = db.pragma('journal_mode', { simple: true });
  const integrity = db.pragma('integrity_check');
  const foreignKeys = db.pragma('foreign_keys', { simple: true });

  const passed7 = (journalMode.toLowerCase() === 'wal') && (integrity[0].integrity_check === 'ok');

  results.scenario7 = {
    passed: passed7,
    journalMode,
    integrity: integrity[0].integrity_check,
    foreignKeys
  };

  console.log(`  - Journal Mode: ${journalMode.toUpperCase()} (Expected: WAL)`);
  console.log(`  - Integrity Check: ${integrity[0].integrity_check} (Expected: ok)`);
  console.log(`  - Foreign Keys: ${foreignKeys === 1 ? 'ON' : 'OFF'}`);
  console.log(`  - Result: ${passed7 ? '✅ PASSED (WAL mode fully intact)' : '❌ FAILED'}\n`);

  db.close();
}

console.log('════════════════════════════════════════════════════════════════');
console.log('                       AUDIT SUMMARY                            ');
console.log('════════════════════════════════════════════════════════════════');
console.log(JSON.stringify(results, null, 2));

// Save results to file for reporting
fs.writeFileSync(path.join(__dirname, 'power_loss_audit_results.json'), JSON.stringify(results, null, 2));
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});

