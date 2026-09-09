const path = require('path');
const Database = require('better-sqlite3');

const appDataDir = process.env.APPDATA || 'C:\\Users\\3D\\AppData\\Roaming';
const liveDbPath = path.join(appDataDir, 'leave-management-system', 'leave_management.db');

const db = new Database(liveDbPath, { readonly: true });
console.log('Employees:', db.prepare('SELECT EmployeeID, FullName, IsActive FROM Employees').all());
console.log('Leaves count:', db.prepare('SELECT COUNT(*) as c FROM Leaves').get());
db.close();
