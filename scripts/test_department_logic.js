const fs = require('fs');
const path = require('path');
const db = require('../src/main/database');

console.log('=== TEST DEPARTMENT LOGIC DIRECTLY ===');
db.initialize();
const rawDb = db.getDb();

// Test the exact SQL and Audit logging done in systemHandlers.js
console.log('1. Testing save department_name:');
const key = 'department_name';
const value = 'دائرة توزيع كهرباء الجنوب - قسم الموارد البشرية';

const cleanKey = String(key).trim();
const cleanVal = value != null ? String(value).trim() : '';

const oldRow = rawDb.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get(cleanKey);
console.log('Old row before save:', oldRow);

rawDb.prepare(`
  INSERT INTO _AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now', 'localtime'))
  ON CONFLICT(Key) DO UPDATE SET
    Value = excluded.Value,
    UpdatedAt = excluded.UpdatedAt
`).run(cleanKey, cleanVal);

const AuditService = require('../src/main/services/AuditService');
const logId = AuditService.logAction(rawDb, {
  actionType: 'UPDATE',
  entityType: 'System',
  entityID: null,
  oldValue: oldRow ? { [cleanKey]: oldRow.Value } : null,
  newValue: { [cleanKey]: cleanVal },
  details: `تحديث إعداد النظام [${cleanKey}]: "${cleanVal}"`,
});
console.log('Audit log inserted, LogID:', logId);

const updatedRow = rawDb.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get(cleanKey);
console.log('Updated row in DB:', updatedRow);

// Test saving empty string:
console.log('\n2. Testing saving empty string:');
rawDb.prepare(`
  INSERT INTO _AppSettings (Key, Value, UpdatedAt)
  VALUES (?, ?, datetime('now', 'localtime'))
  ON CONFLICT(Key) DO UPDATE SET
    Value = excluded.Value,
    UpdatedAt = excluded.UpdatedAt
`).run(cleanKey, '');

const emptyRow = rawDb.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get(cleanKey);
console.log('Row with empty string:', emptyRow);

// Reset / clean up
rawDb.prepare("DELETE FROM _AppSettings WHERE Key = 'department_name'").run();
console.log('Deleted test setting. All direct tests succeeded.');
