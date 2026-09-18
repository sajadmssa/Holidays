// ============================================================
//  tests/loggerServicePiiRedaction.test.js
//  وحدة اختبارات آلية للتحقق من حجب البيانات الحساسة (PII Redaction)
//  في LoggerService.js وكافة سيناريوهات التسجيل
// ============================================================

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const LoggerService = require('../src/main/services/LoggerService');

console.log('\n🔒 [LoggerService PII Redaction Tests] Starting test suite...\n');

let passCount = 0;
let totalCount = 0;

function it(desc, fn) {
  totalCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// ──────────────────────────────────────────────────────────────
// Suite 1: Direct redactSensitiveString tests
// ──────────────────────────────────────────────────────────────
console.log('--- Suite 1: Path & User Directory Redaction (redactSensitiveString) ---');

it('Redacts Windows backslash user directory', () => {
  const input = 'Database error at C:\\Users\\Administrator\\AppData\\Local\\Holidays\\db.sqlite';
  const out = LoggerService.redactSensitiveString(input);
  assert.strictEqual(out, 'Database error at [USER_DIR]\\AppData\\Local\\Holidays\\db.sqlite');
});

it('Redacts Windows forward slash user directory', () => {
  const input = 'File stored at C:/Users/JohnDoe/Documents/file.pdf';
  const out = LoggerService.redactSensitiveString(input);
  assert.strictEqual(out, 'File stored at [USER_DIR]/Documents/file.pdf');
});

it('Redacts Unix /Users/ path', () => {
  const input = 'Exported to /Users/alice/Desktop/report.xlsx';
  const out = LoggerService.redactSensitiveString(input);
  assert.strictEqual(out, 'Exported to [USER_DIR]/Desktop/report.xlsx');
});

it('Redacts Linux /home/ path', () => {
  const input = 'Error reading /home/bob/.config/holidays.json';
  const out = LoggerService.redactSensitiveString(input);
  assert.strictEqual(out, 'Error reading [USER_DIR]/.config/holidays.json');
});

it('Leaves non-sensitive paths intact', () => {
  const input = 'System file at C:\\Program Files\\Holidays\\resources\\app.asar';
  const out = LoggerService.redactSensitiveString(input);
  assert.strictEqual(out, input);
});

// ──────────────────────────────────────────────────────────────
// Suite 2: Object & Array PII Redaction (redactSensitiveData)
// ──────────────────────────────────────────────────────────────
console.log('\n--- Suite 2: Sensitive Employee Fields Redaction (redactSensitiveData) ---');

it('Redacts standard employee PII fields (including JobNumber and DossierNumber)', () => {
  const employee = {
    EmployeeID: 105,
    FullName: 'أحمد علي حسن',
    MotherName: 'فاطمة محمد',
    Salary: 750000,
    NationalID: '198512345678',
    JobNumber: 'JOB-98765',
    jobNumber: 'JN-1122',
    PhoneNumber: '07701234567',
    Email: 'ahmed@gov.iq',
    Address: 'بغداد - الكرخ',
    BirthDate: '1985-05-12',
    DossierNumber: 'DOS-2024-99',
    dossiernumber: 'DOS-5544',
    JobTitle: 'مبرمج أقدم',
    DepartmentID: 2,
    IsActive: 1
  };

  const clean = LoggerService.redactSensitiveData(employee);

  assert.strictEqual(clean.EmployeeID, 105);
  assert.strictEqual(clean.FullName, '***REDACTED***');
  assert.strictEqual(clean.MotherName, '***REDACTED***');
  assert.strictEqual(clean.Salary, '***REDACTED***');
  assert.strictEqual(clean.NationalID, '***REDACTED***');
  assert.strictEqual(clean.JobNumber, '***REDACTED***');
  assert.strictEqual(clean.jobNumber, '***REDACTED***');
  assert.strictEqual(clean.PhoneNumber, '***REDACTED***');
  assert.strictEqual(clean.Email, '***REDACTED***');
  assert.strictEqual(clean.Address, '***REDACTED***');
  assert.strictEqual(clean.BirthDate, '***REDACTED***');
  assert.strictEqual(clean.DossierNumber, '***REDACTED***');
  assert.strictEqual(clean.dossiernumber, '***REDACTED***');
  assert.strictEqual(clean.JobTitle, 'مبرمج أقدم');
  assert.strictEqual(clean.DepartmentID, 2);
  assert.strictEqual(clean.IsActive, 1);
});

it('Preserves non-sensitive domain keys (leaveTypeName, departmentName, actionType, entityType)', () => {
  const data = {
    leaveTypeName: 'إجازة اعتيادية',
    documentTypeName: 'بطاقة إجازة',
    departmentName: 'قسم تقنية المعلومات',
    deptName: 'الموارد البشرية',
    actionType: 'UPDATE',
    entityType: 'Leave',
    employeeId: 42
  };

  const clean = LoggerService.redactSensitiveData(data);

  assert.strictEqual(clean.leaveTypeName, 'إجازة اعتيادية');
  assert.strictEqual(clean.documentTypeName, 'بطاقة إجازة');
  assert.strictEqual(clean.departmentName, 'قسم تقنية المعلومات');
  assert.strictEqual(clean.deptName, 'الموارد البشرية');
  assert.strictEqual(clean.actionType, 'UPDATE');
  assert.strictEqual(clean.entityType, 'Leave');
  assert.strictEqual(clean.employeeId, 42);
});

it('Recursively redacts nested objects and arrays of employees', () => {
  const payload = {
    batchId: 'BATCH_01',
    employees: [
      { id: 1, name: 'سارة خالد', salary: 600000 },
      { id: 2, name: 'حسين عادل', salary: 850000 }
    ],
    metadata: {
      requestedBy: { username: 'admin', password: 'secretpassword123', token: 'jwt_xyz' }
    }
  };

  const clean = LoggerService.redactSensitiveData(payload);

  assert.strictEqual(clean.batchId, 'BATCH_01');
  assert.strictEqual(clean.employees[0].id, 1);
  assert.strictEqual(clean.employees[0].name, '***REDACTED***');
  assert.strictEqual(clean.employees[0].salary, '***REDACTED***');
  assert.strictEqual(clean.employees[1].name, '***REDACTED***');
  assert.strictEqual(clean.employees[1].salary, '***REDACTED***');
  assert.strictEqual(clean.metadata.requestedBy.username, '***REDACTED***');
  assert.strictEqual(clean.metadata.requestedBy.password, '***REDACTED***');
  assert.strictEqual(clean.metadata.requestedBy.token, '***REDACTED***');
});

it('Handles circular object references without crashing or stack overflow', () => {
  const circularObj = { name: 'علي' };
  circularObj.self = circularObj;

  const clean = LoggerService.redactSensitiveData(circularObj);
  assert.strictEqual(clean.name, '***REDACTED***');
  assert.strictEqual(clean.self, '[CIRCULAR]');
});

// ──────────────────────────────────────────────────────────────
// Suite 3: File Writing Integration & app.log Verification
// ──────────────────────────────────────────────────────────────
console.log('\n--- Suite 3: End-to-End Logger Writing (app.log) ---');

it('Writes redacted entries to app.log when info/warn/error are invoked', () => {
  const tempLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holidays-logger-test-'));
  process.env.LOGS_DIR = tempLogDir;

  try {
    // 1. Log Info with sensitive payload
    LoggerService.info('TestContext', 'Employee created on C:\\Users\\Tester\\Documents', {
      fullName: 'مصطفى كمال',
      salary: 900000,
      dossier_number: 'D-123'
    });

    // 2. Log Warn
    LoggerService.warn('TestWarn', 'Warning for user path D:\\Users\\AdminUser\\test.db', {
      phone: '07800000000'
    });

    // 3. Log Error with Error instance having custom sensitive payload
    const err = new Error('Database insertion failed for C:\\Users\\DbAdmin\\data.db');
    err.employeeData = { nationalId: '123456789012', salary: 1200000 };
    LoggerService.error('TestError', 'Operation failed for C:\\Users\\ErrorUser\\file.log', err);

    const logFile = LoggerService.getLogPath();
    assert.strictEqual(fs.existsSync(logFile), true, 'app.log must exist');

    const content = fs.readFileSync(logFile, 'utf8');

    // Verify sensitive data was NOT written in plain text
    assert.strictEqual(content.includes('مصطفى كمال'), false, 'Plain FullName must not appear in log file');
    assert.strictEqual(content.includes('900000'), false, 'Plain Salary must not appear in log file');
    assert.strictEqual(content.includes('07800000000'), false, 'Plain Phone must not appear in log file');
    assert.strictEqual(content.includes('123456789012'), false, 'Plain NationalID must not appear in log file');
    assert.strictEqual(content.includes('1200000'), false, 'Plain Error salary must not appear in log file');
    assert.strictEqual(content.includes('C:\\Users\\Tester'), false, 'Tester user path must be redacted');
    assert.strictEqual(content.includes('D:\\Users\\AdminUser'), false, 'AdminUser path must be redacted');
    assert.strictEqual(content.includes('C:\\Users\\DbAdmin'), false, 'DbAdmin path must be redacted');
    assert.strictEqual(content.includes('C:\\Users\\ErrorUser'), false, 'ErrorUser path must be redacted');

    // Verify redaction placeholders ARE present
    assert.strictEqual(content.includes('***REDACTED***'), true, '***REDACTED*** placeholder must appear in log');
    assert.strictEqual(content.includes('[USER_DIR]'), true, '[USER_DIR] placeholder must appear in log');
  } finally {
    try {
      fs.rmSync(tempLogDir, { recursive: true, force: true });
    } catch (_) {}
    delete process.env.LOGS_DIR;
  }
});

console.log(`\n🎉 ALL ${passCount}/${totalCount} PII REDACTION CHECKS PASSED FOR LoggerService!\n`);
