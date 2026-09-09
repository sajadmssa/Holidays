const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const liveDbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
const tempCopy = path.join(__dirname, 'recon_live_copy.db');

// Copy live DB safely for 100% read-only isolated inspection
fs.copyFileSync(liveDbPath, tempCopy);

const db = new Database(tempCopy, { readonly: true });

console.log('=== EMPLOYEES TABLE INFO ===');
const empCols = db.prepare('PRAGMA table_info(Employees)').all();
console.log(empCols);

console.log('\n=== ALL TABLES IN DB ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log(tables.map(t => t.name));

db.close();
fs.unlinkSync(tempCopy);
