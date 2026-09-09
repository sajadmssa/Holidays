const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
console.log('Files in AppData dir:', fs.readdirSync(appData));

const liveDbPath = path.join(appData, 'leave_management.db');
const db = new Database(liveDbPath);

console.log('\n--- _Migrations in Live DB ---');
console.table(db.prepare('SELECT * FROM _Migrations').all());

console.log('\n--- Employees in Live DB ---');
console.table(db.prepare('SELECT * FROM Employees').all());

console.log('\n--- Leaves in Live DB ---');
console.table(db.prepare('SELECT * FROM Leaves').all());

console.log('\n--- LeaveBalances in Live DB for 223452354 ---');
console.table(db.prepare('SELECT * FROM LeaveBalances WHERE EmployeeID = 223452354').all());

// Check other backup databases to see when 223452354 appeared
const appDataFiles = fs.readdirSync(appData).filter(f => f.endsWith('.db'));
for (const f of appDataFiles) {
  try {
    const bdb = new Database(path.join(appData, f), { readonly: true });
    const bEmp = bdb.prepare('SELECT EmployeeID, FullName FROM Employees WHERE EmployeeID = 223452354').get();
    console.log(`Checking backup [${f}]: found 223452354?`, bEmp ? `YES: ${JSON.stringify(bEmp)}` : 'NO');
    bdb.close();
  } catch (e) {
    console.log(`Checking backup [${f}]: error ${e.message}`);
  }
}

// Check workspace backups
const wsBackup = path.join(__dirname, '..', 'leave_management_backup_2026-09-02.db');
if (fs.existsSync(wsBackup)) {
  try {
    const wbdb = new Database(wsBackup, { readonly: true });
    const bEmp = wbdb.prepare('SELECT EmployeeID, FullName FROM Employees WHERE EmployeeID = 223452354').get();
    console.log(`Checking workspace backup [leave_management_backup_2026-09-02.db]: found 223452354?`, bEmp ? `YES: ${JSON.stringify(bEmp)}` : 'NO');
    wbdb.close();
  } catch (e) {
    console.log('Checking ws backup error:', e.message);
  }
}

db.close();
