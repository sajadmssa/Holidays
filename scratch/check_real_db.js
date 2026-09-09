const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
const dbPath = path.join(appData, 'leave-management-system', 'leave_management.db');

console.log('Checking database at:', dbPath);
if (fs.existsSync(dbPath)) {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const employees = db.prepare('SELECT EmployeeID, FullName, JobTitle, Department, WorkLocation, IsActive FROM Employees').all();
    console.log(`Found ${employees.length} employees:`);
    employees.forEach(e => console.log(`  - [ID: ${e.EmployeeID}] ${e.FullName} (${e.JobTitle || 'بدون مسمى'}) - نشط: ${e.IsActive}`));
    
    const leaves = db.prepare('SELECT LeaveID, EmployeeID, StartDate, EndDate FROM Leaves').all();
    console.log(`Found ${leaves.length} leaves in production database.`);
    db.close();
} else {
    console.log('Database file does not exist at path yet.');
}
