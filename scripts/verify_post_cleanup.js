const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
const liveDbPath = path.join(appData, 'leave_management.db');

console.log('===============================================================');
console.log('  FULL VERIFICATION REPORT POST-CLEANUP');
console.log('===============================================================');

const db = new Database(liveDbPath, { readonly: true });

// 1. Check Employees
console.log('\n[1] ALL EMPLOYEES IN DATABASE:');
const emps = db.prepare('SELECT EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive, WorkLocation, LeaveCardNumber, LeaveApprover, AdjustmentDays FROM Employees ORDER BY EmployeeID ASC').all();
console.table(emps);
console.log(`Total count: ${emps.length}`);

// 2. Check for leaked employee
const checkLeaked = db.prepare("SELECT * FROM Employees WHERE EmployeeID = 223452354 OR FullName LIKE '%يس%'").all();
console.log(`\n[2] Search for leaked employee (223452354 / يسيب): found = ${checkLeaked.length}`, checkLeaked);

// 3. Check for balances of leaked employee
const checkBalances = db.prepare("SELECT * FROM LeaveBalances WHERE EmployeeID = 223452354").all();
console.log(`\n[3] Search for leaked employee balances: found = ${checkBalances.length}`, checkBalances);

// 4. Check for leaves of leaked employee
const checkLeaves = db.prepare("SELECT * FROM Leaves WHERE EmployeeID = 223452354").all();
console.log(`\n[4] Search for leaked employee leaves: found = ${checkLeaves.length}`, checkLeaves);

// 5. Check All Leaves in Database
console.log('\n[5] ALL LEAVES IN DATABASE:');
const allLeaves = db.prepare('SELECT LeaveID, EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, LeaveApprover FROM Leaves ORDER BY LeaveID ASC').all();
console.table(allLeaves);

// 6. Check All AuditLogs
console.log('\n[6] AUDITLOGS (NEW TABLE):');
const allAudit = db.prepare('SELECT LogID, Timestamp, ActionType, EntityType, EntityID, Details FROM AuditLogs ORDER BY LogID ASC').all();
console.table(allAudit);

// 7. Full Details of LogID 4 (The Administrative Correction)
console.log('\n[7] DETAILS OF CORRECTION AUDIT LOG (LogID = 4):');
const correctionLog = db.prepare('SELECT * FROM AuditLogs WHERE LogID = 4').get();
console.log(JSON.stringify(correctionLog, null, 2));

// 8. Integrity Check
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('\n[8] DATABASE INTEGRITY CHECK:', integrity.integrity_check);

db.close();
console.log('\n===============================================================');
console.log('  VERIFICATION COMPLETE');
console.log('===============================================================');
