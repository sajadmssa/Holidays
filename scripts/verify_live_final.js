const path = require('path');
const Database = require('better-sqlite3');

const liveDbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
const db = new Database(liveDbPath);

console.log('=== FINAL LIVE DATABASE INTEGRITY REPORT ===\n');

// 1. All Employees
const employees = db.prepare('SELECT EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive FROM Employees ORDER BY EmployeeID').all();
console.log('1. Employees in Database:');
employees.forEach(e => {
  console.log(`   - [ID ${e.EmployeeID}] ${e.FullName} | ${e.JobTitle} | Active: ${e.IsActive === 1 ? 'نعم (1)' : 'لا (0)'}`);
});

// 2. _AppSettings check
const settings = db.prepare('SELECT * FROM _AppSettings').all();
console.log('\n2. System Settings in _AppSettings:');
if (settings.length === 0) {
  console.log('   (Empty - No test department name present. Clean for user input.)');
} else {
  settings.forEach(s => console.log(`   - ${s.Key} = "${s.Value}"`));
}

// 3. Audit Logs check
const logs = db.prepare('SELECT * FROM AuditLogs ORDER BY LogID DESC LIMIT 5').all();
console.log('\n3. Latest Audit Logs:');
logs.forEach(l => {
  console.log(`   - [#${l.LogID}] [${l.ActionType}] ${l.EntityType} #${l.EntityID || '-'} (${l.Timestamp}): ${l.Details}`);
});

console.log('\n============================================');
