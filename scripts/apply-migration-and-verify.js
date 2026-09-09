const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
console.log('Database Path:', dbPath);

const db = new Database(dbPath);

// Ensure foreign keys are on
db.pragma('foreign_keys = ON');

// Check unapplied migrations
const executed = new Set(
  db.prepare('SELECT name FROM _Migrations').all().map(r => r.name)
);

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'main', 'migrations');
const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  if (!executed.has(file)) {
    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
    })();
    console.log(`Successfully applied: ${file}`);
  } else {
    console.log(`Already applied: ${file}`);
  }
}

console.log('\n=== POST-MIGRATION VERIFICATION ===');
const migrations = db.prepare('SELECT * FROM _Migrations ORDER BY id ASC').all();
console.log('Applied Migrations:', migrations);

const leaveTypes = db.prepare('SELECT LeaveTypeID, Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction FROM LeaveTypes ORDER BY LeaveTypeID ASC').all();
console.log('\nLeaveTypes Count:', leaveTypes.length);
console.log('LeaveTypes List:\n', JSON.stringify(leaveTypes, null, 2));

const leaves = db.prepare(`
  SELECT l.LeaveID, l.EmployeeID, e.FullName, l.LeaveTypeID, lt.Name AS LeaveTypeName, l.StartDate, l.EndDate, l.DaysCount, l.Notes
  FROM Leaves l
  JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
  JOIN Employees e ON e.EmployeeID = l.EmployeeID
  ORDER BY l.LeaveID ASC
`).all();
console.log('\nLeaves List:\n', JSON.stringify(leaves, null, 2));

const employees = db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive FROM Employees').all();
console.log('\nEmployees Count:', employees.length);
console.log('Employees List:\n', JSON.stringify(employees, null, 2));

db.close();
