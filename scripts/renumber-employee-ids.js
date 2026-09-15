// scripts/renumber-employee-ids.js
// يُشغَّل عبر: ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron.cmd scripts/renumber-employee-ids.js <db-path> <storage-root>

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const cleanArgs = process.argv.slice(2).filter(arg => arg !== '--');
const dbPath = cleanArgs[0];
const storageRoot = cleanArgs[1];

if (!dbPath || !storageRoot) {
  console.error('الاستخدام: renumber-employee-ids.js <مسار-قاعدة-البيانات> <مسار-مجلد-التخزين>');
  process.exit(1);
}

const db = new Database(dbPath);
console.log('DB:', dbPath, '| Storage:', storageRoot);

// (1) خريطة التحويل — مبنية ديناميكياً من SequenceNumber الحالي
const mapRows = db.prepare('SELECT EmployeeID AS OldID, SequenceNumber AS NewID FROM Employees ORDER BY SequenceNumber').all();
console.log('خريطة التحويل الفعلية وقت التشغيل:', mapRows);

// يجب تعطيل foreign_keys قبل بدء المعاملة لأن SQLite يتجاهل تغيير PRAGMA foreign_keys داخل المعاملة المفتوحة
db.pragma('foreign_keys = OFF');

const txn = db.transaction(() => {
  const OFFSET = 1000000;
  const tables = ['Employees', 'Leaves', 'LeaveBalances', 'EmployeeDocuments'];

  // المرحلة 1: إزاحة كل القيم لمدى آمن
  for (const t of tables) {
    db.prepare(`UPDATE ${t} SET EmployeeID = EmployeeID + ?`).run(OFFSET);
  }

  // المرحلة 2: تثبيت القيم النهائية عبر الخريطة
  for (const { OldID, NewID } of mapRows) {
    for (const t of tables) {
      db.prepare(`UPDATE ${t} SET EmployeeID = ? WHERE EmployeeID = ?`).run(NewID, OldID + OFFSET);
    }
  }

  // (2) تحديث RelativePath لأي وثائق متأثرة + تجهيز خريطة نقل المجلدات
  // نحدد الاستعلام بـ EmployeeID = NewID لتفادي التعارض المتسلسل (Cascade Overlap)
  const folderRenames = [];
  for (const { OldID, NewID } of mapRows) {
    if (OldID === NewID) continue;
    const oldPrefix = `EMP_${OldID}/`;
    const newPrefix = `EMP_${NewID}/`;
    const docs = db.prepare(`SELECT DocumentID, RelativePath FROM EmployeeDocuments WHERE EmployeeID = ? AND RelativePath LIKE ?`).all(NewID, oldPrefix + '%');
    for (const d of docs) {
      const newPath = d.RelativePath.replace(oldPrefix, newPrefix);
      db.prepare('UPDATE EmployeeDocuments SET RelativePath = ? WHERE DocumentID = ?').run(newPath, d.DocumentID);
      console.log(`  RelativePath: ${d.RelativePath} → ${newPath}`);
    }
    if (docs.length > 0) {
      folderRenames.push({ oldFolder: `EMP_${OldID}`, newFolder: `EMP_${NewID}` });
    }
  }

  // (3) إنشاء جدول AppCounters إن لم يكن موجوداً وتهيئة العداد الجديد للموظفين القادمين
  db.prepare(`
    CREATE TABLE IF NOT EXISTS AppCounters (
      CounterKey TEXT PRIMARY KEY,
      CounterValue INTEGER NOT NULL DEFAULT 1
    )
  `).run();

  const nextId = mapRows.length + 1;
  db.prepare(`
    INSERT INTO AppCounters (CounterKey, CounterValue) VALUES ('next_employee_id', ?)
    ON CONFLICT(CounterKey) DO UPDATE SET CounterValue = excluded.CounterValue
  `).run(nextId);
  console.log('AppCounters: next_employee_id مُهيَّأ على:', nextId);

  // تحديث أيضاً في _AppSettings للتوافق المشترك
  try {
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt) VALUES ('next_employee_id', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value, UpdatedAt = excluded.UpdatedAt
    `).run(String(nextId));
    console.log('_AppSettings: next_employee_id مُهيَّأ على:', nextId);
  } catch (err) {
    console.warn('تنبيه: تعذر التحديث في _AppSettings:', err.message);
  }

  return folderRenames;
});

const folderRenames = txn();

// إعادة تفعيل وفحص التكامل المرجعي بعد اكتمال المعاملة
db.pragma('foreign_keys = ON');
const fkErrors = db.pragma('foreign_key_check');
if (fkErrors.length > 0) {
  throw new Error('فشل فحص التكامل المرجعي بعد إعادة الترقيم: ' + JSON.stringify(fkErrors));
}

db.close();

// (4) نقل المجلدات الفعلية على القرص — بعد نجاح معاملة قاعدة البيانات بالكامل فقط
for (const { oldFolder, newFolder } of folderRenames) {
  const oldPath = path.join(storageRoot, oldFolder);
  const newPath = path.join(storageRoot, newFolder);
  if (!fs.existsSync(oldPath)) {
    console.warn(`تحذير: المجلد المصدر غير موجود فعلياً: ${oldPath} — تخطي`);
    continue;
  }
  if (fs.existsSync(newPath)) {
    const tempPath = path.join(storageRoot, `${newFolder}__MIGRATION_TEMP_${Date.now()}`);
    fs.renameSync(newPath, tempPath);
    console.warn(`تعارض اسم مجلد — تم نقل الموجود مؤقتاً إلى: ${tempPath} (يحتاج مراجعة يدوية)`);
  }
  fs.renameSync(oldPath, newPath);
  console.log(`مجلد: ${oldFolder} → ${newFolder}`);
}

console.log('اكتملت إعادة الترقيم بنجاح.');
