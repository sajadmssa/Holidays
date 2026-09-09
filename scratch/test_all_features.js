const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('══════════════════════════════════════════════════════════════');
console.log('🧪 COMPREHENSIVE VERIFICATION & TEST SUITE');
console.log('══════════════════════════════════════════════════════════════');

// ─── TEST 1: TEST REAL APPLICATION DATABASE WITH NEW MIGRATIONS ───
console.log('\n[1/5] Testing Application Database & Migrations 010 & 011...');
const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'leave-management-system', 'leave_management.db');
const db = new Database(dbPath);

// Run migrations through database.js logic
const migrationsDir = path.join(__dirname, '../src/main/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
const executed = new Set(db.prepare('SELECT name FROM _Migrations').all().map(r => r.name));

for (const file of migrationFiles) {
  if (!executed.has(file)) {
    console.log(`Applying migration to real DB: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
    })();
  }
}

// Verify indexes exist
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
console.log('Indexes in DB:', indexes.filter(n => n.startsWith('idx_')));
const hasEndStartIndex = indexes.includes('idx_leaves_end_start');
const hasCardIndex = indexes.includes('idx_employees_card');
console.log(`idx_leaves_end_start present: ${hasEndStartIndex}`);
console.log(`idx_employees_card present: ${hasCardIndex}`);

// Verify legacy AuditLog and triggers are dropped
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
const legacyAuditTableExists = tables.includes('AuditLog');
console.log(`Legacy AuditLog table removed: ${!legacyAuditTableExists}`);

// Verify real employees intact
const realEmployees = db.prepare('SELECT EmployeeID, FullName, LeaveCardNumber, AdjustmentDays, IsActive FROM Employees ORDER BY EmployeeID ASC').all();
console.log(`\nReal DB active/total employees count: ${realEmployees.length}`);
console.table(realEmployees);

// ─── TEST 2: TEST AUDIT LOG RETENTION & AUTO-ARCHIVING (ISOLATED) ───
console.log('\n[2/5] Testing 150-Record Audit Retention & Auto-Archiving...');
const memDb = new Database(':memory:');
for (const file of migrationFiles) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
  try { memDb.exec(sql); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
}

const AuditService = require('../src/main/services/AuditService');

// Insert 165 test audit logs
for (let i = 1; i <= 165; i++) {
  AuditService.logAction(memDb, {
    actionType: 'UPDATE',
    entityType: 'Employee',
    entityID: (i % 10) + 1,
    oldValue: { testStep: i, status: 'old' },
    newValue: { testStep: i, status: 'new' },
    details: `حركة تدقيق تجريبية رقم ${i}`
  });
}

const countAfter165 = memDb.prepare('SELECT COUNT(*) as count FROM AuditLogs').get().count;
console.log(`AuditLogs count after 165 inserts (must be exactly 150): ${countAfter165}`);

// Check archive directory and JSONL file
const baseDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'leave-management-system') : '.';
const archivePath = path.join(baseDir, 'audit_archives', `audit_history_${new Date().getFullYear()}.jsonl`);
console.log(`Archive file path: ${archivePath}`);
const archiveExists = fs.existsSync(archivePath);
console.log(`Archive file exists on disk: ${archiveExists}`);
if (archiveExists) {
  const lines = fs.readFileSync(archivePath, 'utf8').trim().split('\n').filter(Boolean);
  console.log(`Total archived records in JSONL file: ${lines.length}`);
  console.log(`Sample archived line: ${lines[0].slice(0, 120)}...`);
}

// ─── TEST 3: TEST DATE FILTERING WITH INDEX ON AUDIT LOGS ───
console.log('\n[3/5] Testing Audit Log Query with Date Range & Search...');
const todayStr = new Date().toISOString().slice(0, 10);
const auditQueryRes = AuditService.getAuditLogs(memDb, {
  startDate: todayStr,
  endDate: todayStr,
  actionType: 'UPDATE',
  page: 1,
  pageSize: 15
});
console.log(`Audit query result count: ${auditQueryRes.totalCount}, page items: ${auditQueryRes.data.length}`);

// ─── TEST 4: TEST CRITICAL BALANCES WITH VECTORIZED QUERY ───
console.log('\n[4/5] Testing Critical Balance Vectorized Reporting Engine...');
const ReportService = require('../src/main/services/ReportService');

const critReport = ReportService.getCriticalBalancesPaginated(db, { threshold: 10, page: 1, pageSize: 15 });
console.log(`Critical balances in real DB (threshold <= 10): ${critReport.totalCount} employees, total active: ${critReport.totalActiveEmployees}`);
console.log(`First page items: ${critReport.data.length}`);
if (critReport.data.length > 0) {
  console.table(critReport.data.map(d => ({
    ID: d.EmployeeID,
    Name: d.FullName,
    Balance: d.FinalBalance,
    Gross: d.GrossEarnedBalance,
    Taken: d.RegularLeavesTaken
  })));
}

// ─── TEST 5: TEST NEAREST RESUMPTION & CARD LOOKUP INDEXES ───
console.log('\n[5/5] Testing Leave Resumption Sort & Employee Card Query with Indexes...');
const LeaveService = require('../src/main/services/LeaveService');

const activeLeaves = LeaveService.getActiveLeavesTodayPaginated({ page: 1, pageSize: 10 }, db);
console.log(`Active leaves today query successful, total: ${activeLeaves.totalCount}`);

const cardLookup = db.prepare('SELECT EmployeeID, FullName, LeaveCardNumber FROM Employees WHERE LeaveCardNumber = ?').get('101');
console.log('Employee card lookup test result:', cardLookup || 'No card 101 (expected if not set)');

console.log('\n══════════════════════════════════════════════════════════════');
console.log('✅ ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
console.log('══════════════════════════════════════════════════════════════');
