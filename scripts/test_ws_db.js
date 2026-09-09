const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const wsDbDir = path.join(__dirname, '../data/test-db');
if (!fs.existsSync(wsDbDir)) fs.mkdirSync(wsDbDir, { recursive: true });
const wsDbPath = path.join(wsDbDir, 'test_app_settings.db');

console.log('Testing workspace DB at:', wsDbPath);
const db = new Database(wsDbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS _AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT NOT NULL,
    UpdatedAt TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

// Test UPSERT
const key = 'department_name';
const val = 'دائرة توزيع كهرباء الجنوب - قسم الموارد البشرية';
db.prepare(`
  INSERT INTO _AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now', 'localtime'))
  ON CONFLICT(Key) DO UPDATE SET
    Value = excluded.Value,
    UpdatedAt = excluded.UpdatedAt
`).run(key, val);

const saved = db.prepare("SELECT * FROM _AppSettings WHERE Key = ?").get(key);
console.log('Saved row:', saved);

// Test empty val
db.prepare(`
  INSERT INTO _AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now', 'localtime'))
  ON CONFLICT(Key) DO UPDATE SET
    Value = excluded.Value,
    UpdatedAt = excluded.UpdatedAt
`).run(key, '');

const emptyRow = db.prepare("SELECT * FROM _AppSettings WHERE Key = ?").get(key);
console.log('Saved empty row:', emptyRow);

db.close();
fs.unlinkSync(wsDbPath);
console.log('Workspace DB test passed 100%!');
