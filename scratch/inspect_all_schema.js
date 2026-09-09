const Database = require('better-sqlite3');
const path = require('path');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const dbPath = path.join(appData, 'leave-management-system', 'leave_management.db');
const db = new Database(dbPath, { readonly: true });

console.log('--- ALL TABLES AND COLUMNS ---');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
tables.forEach(t => {
    const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
    console.log(`Table: ${t.name}`);
    console.log(cols.map(c => `  - ${c.name} (${c.type})`).join('\n'));
});

console.log('\n--- ALL EMPLOYEES ---');
const emps = db.prepare("SELECT EmployeeID, FullName, IsActive, JobTitle FROM Employees").all();
console.log(emps);

db.close();
