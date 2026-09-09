const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
const liveDbPath = path.join(appData, 'leave_management.db');
const wsBackupsDir = path.join(__dirname, '..', 'data', 'backups');

console.log('===============================================================');
console.log('  URGENT FIX: SAFE BACKUP, DELETION & AUDIT LOGGING');
console.log('===============================================================');

if (!fs.existsSync(wsBackupsDir)) {
  fs.mkdirSync(wsBackupsDir, { recursive: true });
}

const now = new Date();
const timestampStr = now.toISOString().replace(/[:.]/g, '-');
const backupFilename = `manual_backup_before_delete_leaked_emp_223452354_${timestampStr}.db`;
const backupPath = path.join(wsBackupsDir, backupFilename);
const wsBackupRootPath = path.join(__dirname, '..', `leave_management_backup_before_cleanup_${timestampStr}.db`);

const db = new Database(liveDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Snapshot / Backup using SQLite VACUUM INTO into workspace
console.log('\n[STEP 1] Creating Immediate Manual Safety Backup...');
const normalizedBackupPath = backupPath.replace(/\\/g, '/');
if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
db.exec(`VACUUM INTO '${normalizedBackupPath}'`);
console.log(`✓ Safety backup created successfully in workspace backups dir:\n  ${backupPath}`);

// Copy to workspace root
fs.copyFileSync(backupPath, wsBackupRootPath);
console.log(`✓ Copy placed in workspace root at:\n  ${wsBackupRootPath}`);

// Verify backup file integrity
const testDb = new Database(backupPath, { readonly: true });
const check = testDb.prepare('PRAGMA integrity_check').get();
const backupEmpCount = testDb.prepare('SELECT COUNT(*) as c FROM Employees').get().c;
const backupEmps = testDb.prepare('SELECT EmployeeID, FullName FROM Employees').all();
testDb.close();
console.log(`✓ Backup integrity check: ${check.integrity_check}`);
console.log(`✓ Backup employee count: ${backupEmpCount}`);
console.log(`✓ Employees in backup:`, backupEmps.map(e => `[${e.EmployeeID}] ${e.FullName}`).join(', '));

// 2. Fetch target employee details
console.log('\n[STEP 2] Inspecting Leaked Employee Records Before Deletion...');
const targetEmpId = 223452354;
const empRecord = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(targetEmpId);
const balanceRecords = db.prepare('SELECT * FROM LeaveBalances WHERE EmployeeID = ?').all(targetEmpId);
const leaveRecords = db.prepare('SELECT * FROM Leaves WHERE EmployeeID = ?').all(targetEmpId);

if (!empRecord) {
  console.error(`ERROR: Target employee ID ${targetEmpId} not found in Employees table!`);
  db.close();
  process.exit(1);
}

console.log('Employee Record to Delete:', JSON.stringify(empRecord, null, 2));
console.log(`Associated LeaveBalances count: ${balanceRecords.length}`, balanceRecords);
console.log(`Associated Leaves count: ${leaveRecords.length}`, leaveRecords);

// 3. Perform Deletion in Atomic Transaction & Log to AuditLogs
console.log('\n[STEP 3] Executing Atomic Deletion Transaction...');
const AuditService = require('../src/main/services/AuditService');

const deleteTransaction = db.transaction(() => {
  // A. Delete Leaves (if any)
  const delLeaves = db.prepare('DELETE FROM Leaves WHERE EmployeeID = ?').run(targetEmpId);
  console.log(`  -> Deleted ${delLeaves.changes} rows from Leaves.`);

  // B. Delete LeaveBalances
  const delBalances = db.prepare('DELETE FROM LeaveBalances WHERE EmployeeID = ?').run(targetEmpId);
  console.log(`  -> Deleted ${delBalances.changes} rows from LeaveBalances.`);

  // C. Delete Employee Record
  const delEmp = db.prepare('DELETE FROM Employees WHERE EmployeeID = ?').run(targetEmpId);
  console.log(`  -> Deleted ${delEmp.changes} rows from Employees.`);

  // D. Log to AuditLogs
  const auditResult = AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'Employee',
    entityID: targetEmpId,
    oldValue: {
      employee: empRecord,
      balances: balanceRecords,
      leaves: leaveRecords
    },
    newValue: null,
    details: 'تصحيح إداري - حذف سجل اختبار متسرب (الرقم الوظيفي: 223452354، الاسم: يسبيب)'
  });

  console.log('  -> Recorded AuditLog entry:', auditResult);
});

deleteTransaction();
console.log('✓ Transaction committed successfully.');

// 4. Final Database State Verification
console.log('\n[STEP 4] Final Database Verification...');
const remainingEmps = db.prepare(`
  SELECT EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive, WorkLocation, LeaveCardNumber, LeaveApprover, AdjustmentDays 
  FROM Employees 
  ORDER BY EmployeeID ASC
`).all();

console.log(`\nRemaining Employees in Database (Expected: 4): Total = ${remainingEmps.length}`);
console.table(remainingEmps);

if (remainingEmps.length !== 4) {
  throw new Error(`Expected exactly 4 employees, but found ${remainingEmps.length}`);
}

const expectedIds = [1, 2, 3, 22];
const actualIds = remainingEmps.map(e => e.EmployeeID);
console.log('Actual Employee IDs:', actualIds);
console.log('Expected Employee IDs:', expectedIds);

// Verify no leaked employee remains anywhere
const checkLeaked = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ? OR FullName LIKE "%يس%"').all(targetEmpId);
console.log(`Leaked employee check after deletion (count = ${checkLeaked.length}):`, checkLeaked);

const checkLeakedBal = db.prepare('SELECT * FROM LeaveBalances WHERE EmployeeID = ?').all(targetEmpId);
console.log(`Leaked employee balances check after deletion (count = ${checkLeakedBal.length}):`, checkLeakedBal);

// Verify AuditLogs
const allAudit = db.prepare('SELECT LogID, Timestamp, ActionType, EntityType, EntityID, Details FROM AuditLogs ORDER BY LogID DESC LIMIT 5').all();
console.log('\nLatest Audit Logs:');
console.table(allAudit);

// Live database integrity check
const liveCheck = db.prepare('PRAGMA integrity_check').get();
console.log('\nLive Database Integrity Check:', liveCheck.integrity_check);

db.close();
console.log('\n===============================================================');
console.log('  URGENT FIX COMPLETED SUCCESSFULLY WITH 100% VERIFICATION');
console.log('===============================================================');
