const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const appData = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system');
const liveDbPath = path.join(appData, 'leave_management.db');
const db = new Database(liveDbPath);

console.log('=== Checking EVERY table in live database for 223452354 or يسبيب ===');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();

for (const t of tables) {
  const tableName = t.name;
  const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name);
  
  // Search for 223452354 in numeric or text columns
  const whereClauses = cols.map(c => `"${c}" = 223452354 OR CAST("${c}" AS TEXT) LIKE '%223452354%' OR CAST("${c}" AS TEXT) LIKE '%يسبيب%'`).join(' OR ');
  try {
    const matches = db.prepare(`SELECT * FROM "${tableName}" WHERE ${whereClauses}`).all();
    console.log(`Table [${tableName}]: ${matches.length} matching rows.`);
    if (matches.length > 0) {
      console.log(JSON.stringify(matches, null, 2));
    }
  } catch (e) {
    console.log(`Table [${tableName}] query error: ${e.message}`);
  }
}

db.close();
