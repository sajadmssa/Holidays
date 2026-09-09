const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const liveDbPath = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'leave-management-system', 'leave_management.db');
console.log('Targeting real live database at:', liveDbPath);

if (!fs.existsSync(liveDbPath)) {
  console.error('Error: Live database not found at', liveDbPath);
  process.exit(1);
}

const db = new Database(liveDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Check migrations in live DB and apply any pending (e.g. 008)
const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
db.exec(`
  CREATE TABLE IF NOT EXISTS _Migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

const executed = new Set(
  db.prepare('SELECT name FROM _Migrations').all().map(r => r.name)
);

const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of migrationFiles) {
  if (!executed.has(file)) {
    console.log(`[DB] Applying pending migration to live DB: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
  }
}

// 2. Investigate Employee 1 (كرار موسى)
console.log('\n--- 1. Investigating Employee 1 (كرار موسى) ---');
const emp1 = db.prepare('SELECT * FROM Employees WHERE EmployeeID = 1').get();
console.log('Employee 1 Current Record:', emp1);

// Check AuditLog (old schema table) and AuditLogs (new schema table)
const oldAudit = db.prepare("SELECT * FROM AuditLog ORDER BY LogID DESC LIMIT 20").all().catch ? [] : db.prepare("SELECT * FROM AuditLog ORDER BY LogID DESC LIMIT 20").all();
console.log(`\nAuditLog (old table) entries count: ${oldAudit.length}`);
oldAudit.forEach(a => console.log(`  [AuditLog #${a.LogID}] ${a.ActionType} (${a.Timestamp}): ${a.Details}`));

const newAudit = db.prepare("SELECT * FROM AuditLogs ORDER BY LogID DESC LIMIT 20").all();
console.log(`\nAuditLogs (new table) entries count: ${newAudit.length}`);
newAudit.forEach(a => console.log(`  [AuditLogs #${a.LogID}] ${a.ActionType} on ${a.EntityType} #${a.EntityID} (${a.Timestamp}): ${a.Details}`));

// 3. Fix Employee 1 if IsActive == 0
if (emp1 && emp1.IsActive === 0) {
  console.log('\n--- 2. Restoring Employee 1 to Active (IsActive = 1) ---');
  db.prepare('UPDATE Employees SET IsActive = 1 WHERE EmployeeID = 1').run();
  
  // Log this restoration in AuditLogs
  const AuditService = require('../src/main/services/AuditService');
  AuditService.logAction(db, {
    actionType: 'STATUS_CHANGE',
    entityType: 'Employee',
    entityID: 1,
    oldValue: { IsActive: 0 },
    newValue: { IsActive: 1 },
    details: 'إلغاء التجميد وإعادة التفعيل للموظف كرار موسى (تصحيح الحالة بعد انتهاء الاختبارات)'
  });
  console.log('✓ Successfully restored Employee 1 (كرار موسى) to IsActive = 1 and logged correction in AuditLogs.');
} else {
  console.log('\nEmployee 1 is already Active (IsActive = 1). No change needed.');
}

// Verify employee 1 after fix
const emp1After = db.prepare('SELECT * FROM Employees WHERE EmployeeID = 1').get();
console.log('Employee 1 Record After Fix:', emp1After);

// 4. Check & Clear department_name in _AppSettings
console.log('\n--- 3. Checking & Clearing department_name in _AppSettings ---');
const currentDeptSetting = db.prepare("SELECT * FROM _AppSettings WHERE Key = 'department_name'").get();
console.log('Current department_name setting in live DB:', currentDeptSetting);

if (currentDeptSetting) {
  console.log(`Clearing department_name setting (was: "${currentDeptSetting.Value}") so it remains clean and empty for user entry.`);
  db.prepare("DELETE FROM _AppSettings WHERE Key = 'department_name'").run();
  
  const AuditService = require('../src/main/services/AuditService');
  AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'System',
    entityID: null,
    oldValue: { department_name: currentDeptSetting.Value },
    newValue: null,
    details: 'مسح القيمة التجريبية لاسم الدائرة وترك الحقل فارغاً لإدخال المستخدم الرسمي'
  });
  console.log('✓ Successfully deleted department_name from _AppSettings and logged action.');
} else {
  console.log('✓ department_name is already empty/unset in _AppSettings.');
}

// Verify all 4 real employees final state
console.log('\n--- 4. Final Verification of All 4 Real Employees ---');
const realEmps = db.prepare('SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, IsActive FROM Employees WHERE EmployeeID IN (1, 2, 3, 22) ORDER BY EmployeeID').all();
realEmps.forEach(e => {
  console.log(`  [ID: ${e.EmployeeID}] ${e.FullName} | ${e.JobTitle} | Card: ${e.LeaveCardNumber || '-'} | Status: ${e.IsActive === 1 ? 'نشط (Active ✅)' : 'مجمّد (Inactive ⚠️)'}`);
});

console.log('\n--- Investigation and Fix Complete! ---');
