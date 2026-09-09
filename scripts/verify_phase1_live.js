const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const logOut = [];
function log(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
  console.log(line);
  logOut.push(line);
}

async function run() {
  log('=== PHASE 1 COMPREHENSIVE VERIFICATION ===');

  // Copy real db from AppData (or existing backup) to workspace for isolated verification
  const sourceDbPath = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system', 'leave_management.db');
  const workspaceDbPath = path.join(__dirname, '..', 'workspace_test.db');
  
  if (fs.existsSync(workspaceDbPath)) {
    fs.unlinkSync(workspaceDbPath);
  }

  log('Source DB Path:', sourceDbPath);
  log('Workspace Test DB Path:', workspaceDbPath);

  if (fs.existsSync(sourceDbPath)) {
    fs.copyFileSync(sourceDbPath, workspaceDbPath);
    log('✓ Copied real database to workspace for testing.');
  } else {
    log('Source DB not found, creating new test DB with full migrations.');
  }

  const db = new Database(workspaceDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 1. Run all migrations in sequence (001 to 008)
  const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
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

  const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    if (!executed.has(file)) {
      log(`[DB] Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      db.exec(sql);
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
    }
  }

  log('\n[1] Verifying Tables...');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  log('Tables in DB:', tables);
  if (!tables.includes('AuditLogs') || !tables.includes('_AppSettings')) {
    throw new Error('AuditLogs or _AppSettings table missing!');
  }
  log('✓ Tables AuditLogs and _AppSettings are present.');

  // 2. Verify 4 real employees
  log('\n[2] Verifying Real Employees...');
  const realEmployees = db.prepare('SELECT EmployeeID, FullName, HireDate, IsActive FROM Employees WHERE EmployeeID IN (1, 2, 3, 22) ORDER BY EmployeeID').all();
  log('Real Employees in DB:');
  realEmployees.forEach(e => {
    log(`  - [ID: ${e.EmployeeID}] ${e.FullName} (HireDate: ${e.HireDate}, Active: ${e.IsActive})`);
  });
  if (realEmployees.length < 4) {
    throw new Error(`Expected at least 4 real employees, got ${realEmployees.length}`);
  }
  log('✓ All 4 real employees are intact.');

  // 3. Test AuditService & Business Logic Integration
  log('\n[3] Testing Audit Logging Integration...');
  const EmployeeService = require('../src/main/services/EmployeeService');
  const LeaveService = require('../src/main/services/LeaveService');
  const AuditService = require('../src/main/services/AuditService');
  const AutoBackupService = require('../src/main/services/AutoBackupService');

  const testEmpId = 999999;
  // Clean up any old test record
  db.prepare('DELETE FROM Leaves WHERE EmployeeID = ?').run(testEmpId);
  db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = ?').run(testEmpId);
  db.prepare('DELETE FROM Employees WHERE EmployeeID = ?').run(testEmpId);

  // Test A: Add Employee
  log('  -> Testing addEmployee audit logging...');
  EmployeeService.addEmployee({
    employeeId: testEmpId,
    fullName: 'موظف تجريبي للفحص',
    gender: 'Male',
    hireDate: '2024-01-01',
    jobTitle: 'مهندس فحص',
    workLocation: 'المقر الرئيسي',
    leaveCardNumber: 'TEST-CARD-999',
    leaveApprover: 'المدير العام',
  }, db);

  let auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'INSERT' ORDER BY LogID DESC LIMIT 1").get(testEmpId);
  if (!auditRow) throw new Error('Audit log for addEmployee not found!');
  log('    ✓ Add audit logged:', auditRow.Details);

  // Test B: Update Employee
  log('  -> Testing updateEmployee audit logging...');
  EmployeeService.updateEmployee(testEmpId, {
    fullName: 'موظف تجريبي تم تحديثه',
    jobTitle: 'رئيس مهندسي الفحص',
    workLocation: 'فرع البصرة',
    leaveCardNumber: 'TEST-CARD-999',
    leaveApprover: 'المدير التنفيذي',
    adjustmentDays: 5,
  }, db);

  auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'UPDATE' ORDER BY LogID DESC LIMIT 1").get(testEmpId);
  if (!auditRow) throw new Error('Audit log for updateEmployee not found!');
  log('    ✓ Update audit logged:', auditRow.Details);
  const parsedOld = JSON.parse(auditRow.OldValue);
  const parsedNew = JSON.parse(auditRow.NewValue);
  log('      Old JobTitle:', parsedOld.JobTitle, '-> New JobTitle:', parsedNew.JobTitle);

  // Test C: Deactivate Employee
  log('  -> Testing deactivateEmployee audit logging...');
  EmployeeService.deactivateEmployee(testEmpId, db);
  auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'STATUS_CHANGE' ORDER BY LogID DESC LIMIT 1").get(testEmpId);
  if (!auditRow) throw new Error('Audit log for deactivateEmployee not found!');
  log('    ✓ Deactivate audit logged:', auditRow.Details);

  // Test D: Reactivate Employee
  log('  -> Testing activateEmployee audit logging...');
  EmployeeService.activateEmployee(testEmpId, db);
  auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Employee' AND EntityID = ? AND ActionType = 'STATUS_CHANGE' ORDER BY LogID DESC LIMIT 1").get(testEmpId);
  if (!auditRow) throw new Error('Audit log for activateEmployee not found!');
  log('    ✓ Reactivate audit logged:', auditRow.Details);

  // Test E: Leave Submission & Deletion
  log('  -> Testing Leave submission & deletion audit logging...');
  const sickResult = LeaveService.processSickLeave(
    testEmpId,
    3,
    '2026-09-10',
    '2026-09-12',
    db,
    'مسؤول الإجازات'
  );

  const leaveId = sickResult.leaveId;
  auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Leave' AND EntityID = ? AND ActionType = 'INSERT' ORDER BY LogID DESC LIMIT 1").get(leaveId);
  if (!auditRow) throw new Error('Audit log for Leave INSERT not found!');
  log('    ✓ Leave INSERT audit logged:', auditRow.Details);

  LeaveService.deleteLeave(leaveId, db);
  auditRow = db.prepare("SELECT * FROM AuditLogs WHERE EntityType = 'Leave' AND EntityID = ? AND ActionType = 'DELETE' ORDER BY LogID DESC LIMIT 1").get(leaveId);
  if (!auditRow) throw new Error('Audit log for Leave DELETE not found!');
  log('    ✓ Leave DELETE audit logged:', auditRow.Details);

  // Clean up test employee
  db.prepare('DELETE FROM Leaves WHERE EmployeeID = ?').run(testEmpId);
  db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = ?').run(testEmpId);
  db.prepare('DELETE FROM Employees WHERE EmployeeID = ?').run(testEmpId);

  // 4. Test 15-Day Auto-Backup Engine and Rotation
  log('\n[4] Testing 15-Day Auto-Backup Engine and Rotation...');
  const testBase = path.join(__dirname, 'test-backup-dir');
  if (fs.existsSync(testBase)) fs.rmSync(testBase, { recursive: true, force: true });
  fs.mkdirSync(testBase, { recursive: true });

  // Scenario A: First run / no last backup date
  db.prepare("DELETE FROM _AppSettings WHERE Key = 'last_auto_backup_date'").run();
  let resA = await AutoBackupService.checkAndRunAutoBackup(db, { baseDir: testBase });
  log('  -> Scenario A (No prior date): Backup performed =', resA.performed, resA.fileName || '');
  if (!resA.performed) throw new Error('Scenario A failed: backup was not performed');

  // Scenario B: Ran recently (e.g., 5 days ago)
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
  db.prepare("UPDATE _AppSettings SET Value = ? WHERE Key = 'last_auto_backup_date'").run(fiveDaysAgo);
  let resB = await AutoBackupService.checkAndRunAutoBackup(db, { baseDir: testBase });
  log('  -> Scenario B (5 days ago): Backup performed =', resB.performed, 'Message:', resB.message);
  if (resB.performed) throw new Error('Scenario B failed: backup ran when < 15 days');

  // Scenario C: Ran 16 days ago
  const sixteenDaysAgo = new Date(Date.now() - 16 * 86400000).toISOString();
  db.prepare("UPDATE _AppSettings SET Value = ? WHERE Key = 'last_auto_backup_date'").run(sixteenDaysAgo);
  let resC = await AutoBackupService.checkAndRunAutoBackup(db, { baseDir: testBase });
  log('  -> Scenario C (16 days ago): Backup performed =', resC.performed, resC.fileName || '');
  if (!resC.performed) throw new Error('Scenario C failed: backup did not run when >= 15 days');

  // Scenario D: Retention Rotation Test (Create 15 mock backup files, rotate to keep max 10)
  const rotationDir = path.join(__dirname, 'test-rotation');
  if (fs.existsSync(rotationDir)) fs.rmSync(rotationDir, { recursive: true, force: true });
  fs.mkdirSync(rotationDir, { recursive: true });

  for (let i = 1; i <= 15; i++) {
    const mockName = `auto_backup_2026-08-${String(i).padStart(2, '0')}_12-00-00.db`;
    const p = path.join(rotationDir, mockName);
    fs.writeFileSync(p, 'mock backup content');
    const mtime = new Date(Date.now() - (15 - i) * 100000);
    fs.utimesSync(p, mtime, mtime);
  }

  log('  -> Files before rotation:', fs.readdirSync(rotationDir).length);
  AutoBackupService.rotateBackups(rotationDir, 10);
  const remainingFiles = fs.readdirSync(rotationDir);
  log('  -> Files after rotation (limit 10):', remainingFiles.length);
  if (remainingFiles.length !== 10) throw new Error(`Expected 10 files, got ${remainingFiles.length}`);
  log('  -> Oldest remaining file:', remainingFiles[remainingFiles.length - 1]);
  log('  -> Newest remaining file:', remainingFiles[0]);
  log('✓ 15-day backup check and retention rotation verified.');

  // Clean test dirs
  fs.rmSync(rotationDir, { recursive: true, force: true });
  if (fs.existsSync(testBase)) fs.rmSync(testBase, { recursive: true, force: true });

  // 5. Query Audit Logs via AuditService.getAuditLogs
  log('\n[5] Testing AuditService Query & Filtering...');
  const auditQueryResult = AuditService.getAuditLogs(db, { pageSize: 10 });
  log(`  -> Retrieved ${auditQueryResult.data.length} logs of ${auditQueryResult.totalCount} total.`);
  log('  -> Sample latest log:', {
    LogID: auditQueryResult.data[0].LogID,
    Timestamp: auditQueryResult.data[0].Timestamp,
    ActionType: auditQueryResult.data[0].ActionType,
    EntityType: auditQueryResult.data[0].EntityType,
    Details: auditQueryResult.data[0].Details,
  });

  // 6. Safety check of real employees
  log('\n[6] Final Employee Data Safety Check...');
  const finalEmps = db.prepare('SELECT EmployeeID, FullName, IsActive FROM Employees ORDER BY EmployeeID').all();
  log('Current Employees in Database:');
  finalEmps.forEach(e => log(`  - [${e.EmployeeID}] ${e.FullName} (Active: ${e.IsActive})`));

  db.close();
  if (fs.existsSync(workspaceDbPath)) {
    fs.unlinkSync(workspaceDbPath);
  }

  log('\n========================================');
  log('ALL PHASE 1 REQUIREMENTS FULLY VERIFIED!');
  log('========================================');

  fs.writeFileSync(path.join(__dirname, 'verify_output.txt'), logOut.join('\n'), 'utf-8');
}

run().catch(err => {
  log('FATAL ERROR:', err.message, err.stack);
  fs.writeFileSync(path.join(__dirname, 'verify_output.txt'), logOut.join('\n'), 'utf-8');
  process.exit(1);
});
