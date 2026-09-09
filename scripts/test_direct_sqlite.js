const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.env.APPDATA, 'leave-management-system', 'leave_management.db');
console.log('Testing direct Database open on:', dbPath);

try {
  const db = new Database(dbPath, { readonly: false });
  console.log('Opened DB. Readonly?', db.readonly);
  
  // Test write to _AppSettings
  const info = db.prepare("INSERT INTO _AppSettings (Key, Value, UpdatedAt) VALUES ('test_key', 'test_val', datetime('now')) ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value").run();
  console.log('Write to _AppSettings succeeded:', info);

  // Read back
  const row = db.prepare("SELECT * FROM _AppSettings WHERE Key = 'test_key'").get();
  console.log('Read back:', row);

  // Delete
  db.prepare("DELETE FROM _AppSettings WHERE Key = 'test_key'").run();
  console.log('Delete succeeded.');

  db.close();
} catch (e) {
  console.error('Error details:', e);
}
