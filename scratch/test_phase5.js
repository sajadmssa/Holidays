'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const SANDBOX = path.join(__dirname, 'phase5_sandbox');
const MOCK_LOGS = path.join(SANDBOX, 'logs');
const MOCK_DB_DIR = path.join(SANDBOX, 'mock_db');

process.env.LOGS_DIR = MOCK_LOGS;
process.env.HOLIDAYS_DB_DIR = MOCK_DB_DIR;

if (fs.existsSync(SANDBOX)) {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
}
fs.mkdirSync(MOCK_LOGS, { recursive: true });
fs.mkdirSync(MOCK_DB_DIR, { recursive: true });

const LoggerService = require('../src/main/services/LoggerService');
const database = require('../src/main/database');
const Database = require('better-sqlite3');

console.log('====================================================');
console.log('  TEST SUITE: Phase 5 — Log Redaction & Maintenance ');
console.log('====================================================\n');

let testsPassed = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    testsPassed++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// PART 1: Sensitive Data / PII Redaction in Logs
// ─────────────────────────────────────────────────────────────
console.log('--- TEST PART 1: Sensitive Data & PII Redaction ---');

runTest('1.1: Redact employee names, salaries, and national IDs from object payload', () => {
  const sensitivePayload = {
    employeeId: 4401,
    employeeName: 'حسين علي كاظم',
    fullName: 'حسين علي كاظم عبد الله',
    salary: 1250000,
    nationalId: '1987123456',
    department: 'قسم الموارد البشرية',
    role: 'مدقق'
  };

  const clean = LoggerService.redactSensitiveData(sensitivePayload);

  assert.strictEqual(clean.employeeId, 4401);
  assert.strictEqual(clean.employeeName, '***REDACTED***');
  assert.strictEqual(clean.fullName, '***REDACTED***');
  assert.strictEqual(clean.salary, '***REDACTED***');
  assert.strictEqual(clean.nationalId, '***REDACTED***');
  assert.strictEqual(clean.department, 'قسم الموارد البشرية');
  assert.strictEqual(clean.role, 'مدقق');
});

runTest('1.2: Redact user home paths in error stacks and strings', () => {
  const samplePathStr = 'Error accessing C:\\Users\\JohnDoe\\Documents\\Confidential\\card.pdf';
  const redactedStr = LoggerService.redactSensitiveString(samplePathStr);
  assert.ok(!redactedStr.includes('JohnDoe'), 'Username must not appear in redacted string');
  assert.ok(redactedStr.includes('[USER_DIR]'), 'Must replace with [USER_DIR]');
});

runTest('1.3: Verify written app.log contains NO plaintext PII or employee names', () => {
  LoggerService.error('PayrollModule', 'Failed processing salary for employee', {
    employeeName: 'أحمد محمود فحص',
    salary: 2500000,
    nationalId: '9988776655',
    reason: 'Insufficient balance'
  });

  const logFile = LoggerService.getLogPath();
  assert.ok(fs.existsSync(logFile), 'app.log must exist');

  const logContent = fs.readFileSync(logFile, 'utf8');

  // Verify plain PII values are NOT present
  assert.ok(!logContent.includes('أحمد محمود فحص'), 'Log must NOT contain raw employee name!');
  assert.ok(!logContent.includes('2500000'), 'Log must NOT contain raw salary!');
  assert.ok(!logContent.includes('9988776655'), 'Log must NOT contain raw national ID!');

  // Verify redaction marker and non-sensitive technical reason are present
  assert.ok(logContent.includes('***REDACTED***'), 'Log must contain ***REDACTED***');
  assert.ok(logContent.includes('Insufficient balance'), 'Technical reason should be preserved');
});

// ─────────────────────────────────────────────────────────────
// PART 2: Database PRAGMA optimize & Compaction on Close
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST PART 2: PRAGMA optimize on App Close ---');

runTest('2.1: database.close() executes PRAGMA optimize and closes cleanly', () => {
  // Initialize isolated DB
  database.initialize();
  const rawDb = database.getDb();
  assert.ok(rawDb, 'DB should be initialized');

  // Perform some inserts to generate query planner candidate activity
  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS TestOptimize (id INTEGER PRIMARY KEY, title TEXT);
    INSERT INTO TestOptimize (title) VALUES ('test1'), ('test2');
  `);

  // Verify close executes without throwing
  let closeError = null;
  try {
    database.close();
  } catch (err) {
    closeError = err;
  }
  assert.strictEqual(closeError, null, 'database.close() should execute cleanly');

  // Verify db accessor throws after close (as expected)
  assert.throws(() => {
    database.getDb();
  }, /Call db\.initialize\(\) first/);

  // Re-open SQLite file directly to verify database integrity
  const recheckDb = new Database(path.join(MOCK_DB_DIR, 'leave_management.db'), { readonly: true });
  const check = recheckDb.prepare('PRAGMA integrity_check').get();
  assert.strictEqual(check.integrity_check, 'ok');
  recheckDb.close();
});

// Cleanup sandbox
if (fs.existsSync(SANDBOX)) {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
}

console.log(`\n====================================================`);
console.log(`  RESULT: ${testsPassed} of ${totalTests} tests passed successfully!`);
console.log(`====================================================\n`);
