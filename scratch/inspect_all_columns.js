const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const p = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
const temp = path.join(__dirname, 'temp_col_check.db');
fs.copyFileSync(p, temp);

const db = new Database(temp, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log(`\nTABLE [${t.name}]:`);
  cols.forEach(c => {
    console.log(`  - ${c.name} (${c.type}) ${c.notnull ? 'NOT NULL' : 'NULL'} [default: ${c.dflt_value}]`);
  });
}

db.close();
fs.unlinkSync(temp);
