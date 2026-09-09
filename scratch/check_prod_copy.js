const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'prod_copy.db');
const db = new Database(dbPath, { readonly: true });

console.log('--- LEAVE TYPES ---');
const leaveTypes = db.prepare('SELECT LeaveTypeID, Name, GenderRestriction FROM LeaveTypes').all();
console.log(leaveTypes);

console.log('--- MIGRATIONS ---');
const migrations = db.prepare('SELECT id, name, executedAt FROM _Migrations ORDER BY id').all();
console.log(migrations);

db.close();
