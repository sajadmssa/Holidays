const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

try {
  const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
  fs.writeFileSync(path.join(__dirname, 'log.txt'), 'Starting with dbPath: ' + dbPath + '\n');
  const db = new Database(dbPath, { readonly: true });

  const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
  
  const tableData = {};
  for (const t of tables) {
    const tableName = t.name;
    try {
      const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
      const rows = db.prepare(`SELECT * FROM ${tableName}`).all();
      tableData[tableName] = {
        columns: info,
        count: rows.length,
        rows: rows
      };
    } catch (err) {
      tableData[tableName] = { error: err.message };
    }
  }

  const result = {
    dbPath,
    tableNames: tables.map(t => t.name),
    tableData
  };

  fs.writeFileSync(path.join(__dirname, 'inspect_result.json'), JSON.stringify(result, null, 2));
  fs.appendFileSync(path.join(__dirname, 'log.txt'), 'Successfully wrote inspect_result.json\n');
} catch (err) {
  fs.writeFileSync(path.join(__dirname, 'log.txt'), 'Error: ' + err.stack + '\n');
}
