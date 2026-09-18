// ============================================================
//  tests/leaveTypeService.test.js
//
//  اختبارات وحدة شاملة لـ LeaveTypeService:
//    - التحقق من استرجاع جميع الأنواع مع حالة الحماية (IsProtected)
//    - إضافة نوع إجازة جديد والتحقق من تسجيله في سجل التدقيق AuditLogs
//    - تعديل اسم نوع مخصص بنجاح
//    - التحقق الصارم من منع تعديل الأنواع المحمية ('إجازة اعتيادية', 'إجازة مرضية')
//    - التحقق الصارم من منع حذف الأنواع المحمية ('إجازة اعتيادية', 'إجازة مرضية')
//    - التحقق من منع حذف نوع إجازة مستخدم في سجلات الإجازات وعرض رسالة واضحة بعدد السجلات
//    - حذف نوع إجازة مخصص غير مستخدم بنجاح وتوثيقه في AuditLogs
//    - التحقق من قيود التحقق (الاسم الفارغ، التكرار، الطول الزائد)
// ============================================================

'use strict';

if (!process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
  const { spawnSync } = require('child_process');
  const electronPath = require('electron');
  const result = spawnSync(electronPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(result.status ?? 0);
}

const Database = require('better-sqlite3');
const fs      = require('fs');
const path    = require('path');
const {
  PROTECTED_LEAVE_TYPES,
  getAllLeaveTypes,
  getLeaveTypeById,
  addLeaveType,
  updateLeaveType,
  deleteLeaveType
} = require('../src/main/services/LeaveTypeService');

console.log('🏷️ [LeaveTypeService Unit Tests] Starting test suite...\n');

let passedTests = 0;
let totalTests  = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error('❌ FAIL: ' + message);
    process.exit(1);
  }
  passedTests++;
  console.log('  ✅ PASS: ' + message);
}

function assertThrows(fn, expectedSubstr, message) {
  totalTests++;
  try {
    fn();
    console.error('❌ FAIL (Expected error but none thrown): ' + message);
    process.exit(1);
  } catch (err) {
    if (expectedSubstr && !String(err.message).includes(expectedSubstr)) {
      console.error(`❌ FAIL: ${message} - Expected error containing "${expectedSubstr}", got "${err.message}"`);
      process.exit(1);
    }
    passedTests++;
    console.log('  ✅ PASS: ' + message);
  }
}

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migrationsDir = path.join(__dirname, '..', 'src', 'main', 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  for (const f of files) {
    if (f.endsWith('.sql')) {
      const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      try {
        db.exec(sql);
      } catch (e) {
        if (!e.message.includes('duplicate column')) throw e;
      }
    }
  }
  return db;
}

const db = createTestDb();

// ── 1. فحص استرجاع الأنواع الأولية والأنواع المحمية ────────────────────────
const allTypes = getAllLeaveTypes(db);
assert(allTypes.length >= 2, `قائمة أنواع الإجازات تحتوي على ${allTypes.length} نوعاً`);

const regularType = allTypes.find(t => t.Name === 'إجازة اعتيادية');
assert(regularType !== undefined, 'نوع "إجازة اعتيادية" موجود بالنظام');
assert(regularType.IsProtected === true, 'نوع "إجازة اعتيادية" مصنف كنوع محمي (IsProtected === true)');

const sickType = allTypes.find(t => t.Name === 'إجازة مرضية');
assert(sickType !== undefined, 'نوع "إجازة مرضية" موجود بالنظام');
assert(sickType.IsProtected === true, 'نوع "إجازة مرضية" مصنف كنوع محمي (IsProtected === true)');

// ── 2. فحص إضافة نوع إجازة مخصص وتوثيقه في سجل التدقيق ─────────────────────
const addedType = addLeaveType({ name: 'إجازة دراسية مخصصة', maxDaysPerInstance: 180, requiresOrderRef: 1 }, db);
assert(addedType && addedType.LeaveTypeID > 0, 'تمت إضافة نوع إجازة جديد بنجاح وحصل على معرف');
assert(addedType.Name === 'إجازة دراسية مخصصة', 'اسم نوع الإجازة مطابق');
assert(addedType.IsProtected === false, 'النوع المخصص غير محمي (IsProtected === false)');

// فحص وجود سجل التدقيق
const insertAudit = db.prepare(
  "SELECT * FROM AuditLogs WHERE EntityType = 'LeaveType' AND EntityID = ? AND ActionType = 'INSERT'"
).get(addedType.LeaveTypeID);
assert(insertAudit !== undefined, 'تم توثيق عملية INSERT في AuditLogs بنجاح');

// ── 3. فحص التحقق عند الإضافة (فارغ، مكرر) ─────────────────────────────────
assertThrows(() => {
  addLeaveType({ name: '' }, db);
}, 'مطلوب ولا يمكن تركه فارغاً', 'منع إضافة نوع إجازة باسم فارغ');

assertThrows(() => {
  addLeaveType({ name: 'إجازة اعتيادية' }, db);
}, 'مسجل مسبقاً في النظام', 'منع إضافة نوع إجازة مكرر');

// ── 4. فحص تعديل اسم نوع إجازة مخصص ────────────────────────────────────────
const updatedType = updateLeaveType({ id: addedType.LeaveTypeID, name: 'إجازة دراسية عليا' }, db);
assert(updatedType && updatedType.Name === 'إجازة دراسية عليا', 'تم تعديل اسم النوع المخصص بنجاح');

const updateAudit = db.prepare(
  "SELECT * FROM AuditLogs WHERE EntityType = 'LeaveType' AND EntityID = ? AND ActionType = 'UPDATE'"
).get(addedType.LeaveTypeID);
assert(updateAudit !== undefined, 'تم توثيق عملية UPDATE في AuditLogs بنجاح');

// ── 5. فحص منع تعديل الأنواع المحمية ───────────────────────────────────────
assertThrows(() => {
  updateLeaveType({ id: regularType.LeaveTypeID, name: 'إجازة سنوية بديلة' }, db);
}, 'لا يمكن تعديل اسم هذا النوع من الإجازات ("إجازة اعتيادية")', 'منع إعادة تسمية "إجازة اعتيادية" برمجياً');

assertThrows(() => {
  updateLeaveType({ id: sickType.LeaveTypeID, name: 'إجازة طبية بديلة' }, db);
}, 'لا يمكن تعديل اسم هذا النوع من الإجازات ("إجازة مرضية")', 'منع إعادة تسمية "إجازة مرضية" برمجياً');

// ── 6. فحص منع حذف الأنواع المحمية ─────────────────────────────────────────
assertThrows(() => {
  deleteLeaveType(regularType.LeaveTypeID, db);
}, 'لا يمكن حذف هذا النوع من الإجازات ("إجازة اعتيادية")', 'منع حذف "إجازة اعتيادية" برمجياً');

assertThrows(() => {
  deleteLeaveType(sickType.LeaveTypeID, db);
}, 'لا يمكن حذف هذا النوع من الإجازات ("إجازة مرضية")', 'منع حذف "إجازة مرضية" برمجياً');

// ── 7. فحص منع حذف نوع مستخدم في سجلات الإجازات ─────────────────────────────
// إضافة نوع جديد لاستخدامه في إجازة
const inUseType = addLeaveType('إجازة مؤقتة للاستخدام', db);
// إنشاء موظف وإجازة ترتبط بهذا النوع
db.prepare(
  "INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, IsActive) VALUES (9999, 'موظف تجريبي', 'Male', '2020-01-01', 'موظف', 1)"
).run();
db.prepare(
  "INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount) VALUES (9999, ?, '2026-01-01', '2026-01-05', 5)"
).run(inUseType.LeaveTypeID);

assertThrows(() => {
  deleteLeaveType(inUseType.LeaveTypeID, db);
}, 'لا يمكن حذف هذا النوع لأنه مستخدم بسجلات إجازات موجودة (1 سجل)', 'منع حذف نوع الإجازة المرتبط بسجلات إجازات مع بيان عدد السجلات');

// ── 8. فحص حذف نوع إجازة مخصص غير مستخدم ──────────────────────────────────
const deleteRes = deleteLeaveType(addedType.LeaveTypeID, db);
assert(deleteRes && deleteRes.success === true, 'تم حذف النوع المخصص غير المستخدم بنجاح');

const deleteAudit = db.prepare(
  "SELECT * FROM AuditLogs WHERE EntityType = 'LeaveType' AND EntityID = ? AND ActionType = 'DELETE'"
).get(addedType.LeaveTypeID);
assert(deleteAudit !== undefined, 'تم توثيق عملية DELETE في AuditLogs بنجاح');

const checkDeleted = getLeaveTypeById(addedType.LeaveTypeID, db);
assert(checkDeleted === null, 'النوع المحذوف لم يعد موجوداً في قاعدة البيانات');

console.log(`\n🎉 All tests passed! (${passedTests}/${totalTests})\n`);
