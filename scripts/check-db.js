const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
console.log('DB Path:', dbPath, 'Exists:', fs.existsSync(dbPath));

if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath);
  console.log('=== MIGRATIONS ===');
  console.log(JSON.stringify(db.prepare('SELECT * FROM _Migrations').all(), null, 2));
  
  console.log('=== EMPLOYEES ===');
  console.log(JSON.stringify(db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive FROM Employees').all(), null, 2));
  
  console.log('=== LEAVE TYPES ===');
  console.log(JSON.stringify(db.prepare('SELECT * FROM LeaveTypes').all(), null, 2));
  
  console.log('=== LEAVES ===');
  console.log(JSON.stringify(db.prepare('SELECT l.*, lt.Name as LeaveTypeName, e.FullName FROM Leaves l JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID JOIN Employees e ON e.EmployeeID = l.EmployeeID').all(), null, 2));
  
  db.close();
}
