// ============================================================
//  database.js  –  Database Service (Main Process ONLY)
//  خدمة إدارة وتنسيق قاعدة البيانات المركزية (SQLite عبر better-sqlite3)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • Open better-sqlite3 with WAL mode + foreign keys
//      (فتح وإدارة اتصال SQLite بوضع WAL وتفعيل القيود المرجعية)
//    • Run migrations on startup (idempotent)
//      (تنفيذ الترحيلات الهيكلية تلقائياً بترتيب زمني عند الإقلاع دون تكرار)
//    • Expose typed repository methods consumed by IPC handlers
//      (توفير دوال مستودع البيانات الصافية المستهلكة من معالجات IPC)
//    • Live backup & bundle compression (.hbak / .zip)
//      (إنشاء النسخ الاحتياطية المجمعة الحية مع المستندات والتحقق منها)
//    • Fail-safe restore with automatic pre-restore safety backup and emergency rollback
//      (استعادة آمنة للبيانات مع نسخة وقائية وتراجع فوري تلقائي عند أي انقطاع)
//    • Provide a clean `close()` with PRAGMA optimize for graceful shutdown
//      (إغلاق نظيف مع تحسين الجداول وتفريغ سجلات WAL وتحرير أقفال الملفات)
//
//  This file MUST NEVER be imported by the renderer or preload.
//  ممنوع نهائياً استيراد هذا الملف في Renderer أو Preload لأسباب أمنية وهيكلية.
// ============================================================

'use strict';

const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const LoggerService = require('./services/LoggerService');

// ──────────────────────────────────────────────────────────────
//  Database File Location
//  Stored in the OS user-data directory so it survives app updates.
//  On Windows: %APPDATA%\leave-management-system\leave_management.db
//  محدد مسار ملف قاعدة البيانات:
//  يُخزن في مجلد بيانات المستخدم لنظام التشغيل لضمان بقاء البيانات عند تحديث التطبيق.
// ──────────────────────────────────────────────────────────────
const DB_DIR = process.env.HOLIDAYS_DB_DIR
  ? process.env.HOLIDAYS_DB_DIR
  : ((app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(process.env.APPDATA || '.', 'leave-management-system'));
const DB_PATH = path.join(DB_DIR, 'leave_management.db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

// ──────────────────────────────────────────────────────────────
//  Internal Accessor  (throws if called before initialize())
//  الدالة الداخلية للوصول إلى كائن قاعدة البيانات:
//  تضمن عدم استدعاء أي استعلام قبل استدعاء initialize() وتهيئة الاتصال.
// ──────────────────────────────────────────────────────────────
function getDb() {
  if (!_db) throw new Error('Database has not been initialized. Call db.initialize() first.');
  return _db;
}

// ──────────────────────────────────────────────────────────────
//  initialize()
//  Opens (or creates) the SQLite file, applies PRAGMAs, and
//  runs all migration files in lexical order.
//  تهيئة وإقلاع قاعدة البيانات:
//  تنشئ المجلد إذا لم يكن موجوداً، تفتح ملف SQLite، تطبق إعدادات PRAGMA الحرجة،
//  وتشغل محرك الترحيلات الهيكلية.
// ──────────────────────────────────────────────────────────────
function initialize() {
  if (_db) return; // Already initialized / الاتصال مفتوح مسبقاً

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  LoggerService.info('DB', `Opening database at: ${DB_PATH}`);
  _db = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'development' ? (msg) => LoggerService.info('SQL', msg) : undefined });

  // ── Critical PRAGMAs / إعدادات الأداء والأمان الأساسية ──────
  _db.pragma('journal_mode = WAL');    // Write-Ahead Logging for concurrency + speed (تسجيل مسبق يتيح القراءة والكتابة المتزامنة بدون تعليق)
  _db.pragma('foreign_keys = ON');     // Enforce referential integrity (فرض قيود المفاتيح الأجنبية لمنع السجلات اليتيمة)
  _db.pragma('synchronous = NORMAL');  // Safe + fast with WAL (توازن مثالي بين سرعة الإدخال وضمان استقرار البيانات عند انقطاع الكهرباء)
  _db.pragma('cache_size = -16000');   // 16 MB page cache (حجز ذاكرة كاش بحجم 16 ميجابايت لتسريع استعلامات الجداول)
  _db.pragma('temp_store = MEMORY');   // Keep temp tables in RAM (حفظ الجداول والفرز المؤقت في الذاكرة العشوائية لتقليل إجهاد القرص)

  // ── Run Migrations / تشغيل الترحيلات الهيكلية ───────────────
  runMigrations();

  LoggerService.info('DB', 'Database ready.');
}

// ──────────────────────────────────────────────────────────────
//  runMigrations()
//  Reads every .sql file from the migrations directory in order
//  and executes it. Uses `CREATE TABLE IF NOT EXISTS` and
//  `INSERT OR IGNORE` so re-runs are safe (idempotent).
//
//  محرك ترحيل بنية قاعدة البيانات:
//  يقرأ ملفات .sql بالترتيب الهجائي/الرقمي الصارم (001_ ثم 002_ وهكذا)،
//  وينفذ كل ملف داخل Transaction مستقلة مع توثيق اسم الترحيل في جدول _Migrations.
//  يتميز بكونه Idempotent (آمن ضد التكرار) ويتجاهل أخطاء الأعمدة المكررة بمرونة.
// ──────────────────────────────────────────────────────────────
function runMigrations() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const executed = new Set(
    _db.prepare('SELECT name FROM _Migrations').all().map(r => r.name)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexical sort ensures 001_ runs before 002_ etc. / فرز هجائي يضمن ترتيب الترحيل

  for (const file of files) {
    if (!executed.has(file)) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      LoggerService.info('DB', `Applying migration: ${file}`);
      // SQLite requires PRAGMA foreign_keys = OFF to be set OUTSIDE an active transaction
      // so table rebuilds/drops/renames work seamlessly without FK triggers blocking DROP TABLE.
      _db.pragma('foreign_keys = OFF');
      try {
        _db.transaction(() => {
          try {
            _db.exec(sql);
          } catch (err) {
            if (err.message.includes('duplicate column name')) {
              LoggerService.info('DB', `[DB Migration Notice] Column already exists in ${file}: ${err.message}`);
            } else {
              throw err;
            }
          }

          // Verify referential integrity before committing transaction
          const fkViolations = _db.pragma('foreign_key_check');
          if (fkViolations && fkViolations.length > 0) {
            throw new Error(`FOREIGN KEY constraint check failed in migration ${file}: ` + JSON.stringify(fkViolations));
          }

          _db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
        })();
      } finally {
        // Always re-enable foreign keys after each migration
        _db.pragma('foreign_keys = ON');
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  close()
//  Call on app exit to flush WAL and release the file lock.
//  إغلاق اتصال قاعدة البيانات:
//  يُستدعى عند خروج التطبيق. ينفذ PRAGMA optimize لتحديث إحصائيات الاستعلامات
//  وتنظيف الفهارس، ثم يحرر قفل الملف ويفرغ سجلات WAL.
// ──────────────────────────────────────────────────────────────
function close() {
  if (_db) {
    try {
      // Execute PRAGMA optimize to update query statistics and keep DB compact
      // تحسين الجداول وتحديث إحصائيات منسق الاستعلامات لقاعدة البيانات
      _db.pragma('optimize');
    } catch (optErr) {
      LoggerService.warn('DB', '[DB Close Warning] PRAGMA optimize failed: ' + optErr.message);
    }
    _db.close();
    _db = null;
    LoggerService.info('DB', 'Database closed.');
  }
}

// ══════════════════════════════════════════════════════════════
//  ── REPOSITORY METHODS / دوال مستودع البيانات الصافية ────────
//  All methods are synchronous (better-sqlite3 is sync-only).
//  Each method is a pure data-access function with no business logic.
//  جميع الدوال تزامنية لأن better-sqlite3 يعتمد التنفيذ المباشر عالي السرعة.
//  تختص هذه الدوال بعمليات الوصول الصافية للبيانات دون تطبيق منطق الأعمال المعقد.
// ══════════════════════════════════════════════════════════════


// ──────────────────────────────────────────────────────────────
//  Leave Types / جدول أنواع الإجازات الرسمية
// ──────────────────────────────────────────────────────────────

/**
 * جلب كافة أنواع الإجازات المعرفة بالنظام مرتبة هجائياً.
 * @returns {LeaveType[]}
 */
function getAllLeaveTypes() {
  return getDb()
    .prepare('SELECT * FROM LeaveTypes ORDER BY Name ASC')
    .all();
}

// ──────────────────────────────────────────────────────────────
//  Leave Balances / أرصدة الإجازات
// ──────────────────────────────────────────────────────────────


/**
 * إضافة رصيد إجازة أو تحديثه في حال وجوده مسبقاً (Upsert عبر ON CONFLICT).
 * INSERT or REPLACE a balance entry.
 * @param {{ employeeId:number, leaveTypeId:number, totalBalance:number, payPercentage:100|50|25 }} payload
 */
function upsertLeaveBalance({ employeeId, leaveTypeId, totalBalance, payPercentage }) {
  const result = getDb()
    .prepare(`
      INSERT INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(EmployeeID, LeaveTypeID, PayPercentage) DO UPDATE SET
        TotalBalance  = excluded.TotalBalance,
        PayPercentage = excluded.PayPercentage
    `)
    .run(employeeId, leaveTypeId, totalBalance, payPercentage);

  return { changes: result.changes };
}


/**
 * إنشاء نسخة احتياطية حية وآمنة لقاعدة بيانات SQLite وأرشيف مستندات الموظفين.
 * في حال كان الامتداد المطلوب .hbak أو .zip (الوضع الافتراضي المعتمد):
 * تُنشأ حزمة مضغوطة تشمل لقطة قاعدة البيانات الحية، مجلد المستندات EmployeeDocuments، وملف البيانات الوصفية manifest.json.
 * وفي حال كان الامتداد .db، تُنفذ عملية نسخ احتياطي مباشرة وأصلية عبر better-sqlite3 backup().
 * Safely creates a live backup of the SQLite database and EmployeeDocuments.
 * If destinationPath is .hbak or .zip (or default), bundles DB + EmployeeDocuments + manifest.json.
 * If destinationPath is .db, creates native direct SQLite backup.
 *
 * @param {string} destinationPath
 * @returns {Promise<{ filePath: string, isBundle: boolean }>}
 */
async function backupDatabase(destinationPath) {
  if (!destinationPath || typeof destinationPath !== 'string') {
    throw new Error('backupDatabase: destinationPath must be a non-empty string.');
  }

  const destExt = path.extname(destinationPath).toLowerCase();
  const isBundle = destExt === '.hbak' || destExt === '.zip' || destExt !== '.db';

  if (!isBundle) {
    await getDb().backup(destinationPath);
    return { filePath: destinationPath, isBundle: false };
  }

  // Ensure parent directory exists / التأكد من وجود المجلد الأب للمسار
  const parentDir = path.dirname(destinationPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // 1. Create temporary SQLite snapshot / 1. إنشاء لقطة لحظية مؤقتة لقاعدة البيانات بدون إيقاف النظام
  const tempDbName = `temp_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`;
  const tempDbPath = path.join(DB_DIR, tempDbName);

  try {
    await getDb().backup(tempDbPath);

    // 2. Build ZIP archive / 2. بناء الأرشيف المضغوط المجمع
    const zip = new AdmZip();

    // Add SQLite DB snapshot as leave_management.db / إضافة لقطة القاعدة بالاسم القياسي المعتمد
    zip.addLocalFile(tempDbPath, '', 'leave_management.db');

    // Add EmployeeDocuments directory if present / إضافة مجلد مستندات الموظفين إن وُجد
    let docStoragePath = null;
    try {
      const DocumentStorageService = require('./services/DocumentStorageService');
      docStoragePath = DocumentStorageService.getStorageRoot(_db);
    } catch (_) {
      docStoragePath = path.join(DB_DIR, 'EmployeeDocuments');
    }

    let documentsCount = 0;
    if (docStoragePath && fs.existsSync(docStoragePath)) {
      const files = fs.readdirSync(docStoragePath);
      if (files.length > 0) {
        zip.addLocalFolder(docStoragePath, 'EmployeeDocuments');
      }
    }

    try {
      const docRow = _db.prepare("SELECT COUNT(*) as cnt FROM EmployeeDocuments WHERE IsDeleted = 0").get();
      documentsCount = docRow ? Number(docRow.cnt) : 0;
    } catch (_) {}

    const employeesCount = _db.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
    const leavesCount = _db.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;

    // 3. Add manifest.json metadata / 3. تضمين ملف البيان والبيانات الوصفية للنسخة (الإصدار، التوقيت، أعداد السجلات)
    const manifest = {
      app: 'Holidays - Leave Management System',
      version: '4.0.0',
      schemaVersion: 14,
      createdAt: new Date().toISOString(),
      employeesCount,
      leavesCount,
      documentsCount,
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    // 4. Write zip bundle to destination / 4. كتابة الحزمة المضغوطة بالكامل إلى المسار النهائي
    zip.writeZip(destinationPath);

    return { filePath: destinationPath, isBundle: true };
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  }
}

/**
 * فحص وتدقيق سلامة ملف النسخة الاحتياطية قبل المباشرة بالاستعادة.
 * يدعم كلاً من حزم HBAK/ZIP المجمعة الحديثة وملفات SQLite (.db) القديمة.
 * يتضمن: فحص التوقيع السحري Magic Bytes، فحص السلامة الهيكلية PRAGMA integrity_check،
 * والتحقق من وجود الجداول الإلزامية ومقارنة أحدث المستندات لتحذير المستخدم.
 * Validates a potential backup file before restoring.
 * Handles both ZIP/HBAK bundle files and legacy .db SQLite files.
 * @param {string} backupPath
 * @param {import('better-sqlite3').Database} [activeDbInstance]
 * @returns {{ valid: boolean, isBundle: boolean, employeesCount: number, leavesCount: number, documentsCount?: number, warning: string | null }}
 */
function validateDatabaseBackup(backupPath, activeDbInstance = _db) {
  if (!backupPath || typeof backupPath !== 'string' || !fs.existsSync(backupPath)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود أو المسار غير صالح.');
  }

  const stats = fs.statSync(backupPath);
  if (stats.size < 64) {
    throw new Error('حجم الملف صغير جداً ولا يمثل نسخة احتياطية صحيحة.');
  }

  // Check if file is a ZIP/HBAK (PK\x03\x04 = 0x50, 0x4B, 0x03, 0x04)
  const fd = fs.openSync(backupPath, 'r');
  const headerBuf = Buffer.alloc(16);
  fs.readSync(fd, headerBuf, 0, 16, 0);
  fs.closeSync(fd);

  const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4B && headerBuf[2] === 0x03 && headerBuf[3] === 0x04;

  if (isZip) {
    // ── Bundle Validation (.hbak / .zip) / فحص حزم النسخ الاحتياطي المجمعة ──
    let zip = null;
    try {
      zip = new AdmZip(backupPath);
    } catch (zipErr) {
      throw new Error(`تعذر قراءة حزمة الأرشيف المضغوطة: ${zipErr.message}`);
    }

    const entries = zip.getEntries();
    const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));

    if (!dbEntry) {
      throw new Error('حزمة النسخة الاحتياطية غير صالحة؛ ملف قاعدة البيانات (.db) غير موجود بداخلها.');
    }

    // Extract DB to temp location for validation / استخراج مؤقت لقاعدة البيانات لإجراء الفحص الهيكلي
    const tempValidateDbPath = path.join(DB_DIR, `temp_val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);

    let tempDb = null;
    try {
      const dbBuffer = zip.readFile(dbEntry);
      if (!dbBuffer || dbBuffer.length < 512) {
        throw new Error('ملف قاعدة البيانات داخل الحزمة تالف أو فارغ.');
      }
      fs.writeFileSync(tempValidateDbPath, dbBuffer);

      // Verify SQLite header magic bytes on extracted DB
      const dbHeader = dbBuffer.toString('utf8', 0, 15);
      if (dbHeader !== 'SQLite format 3') {
        throw new Error('الملف الداخلي ليس قاعدة بيانات SQLite صالحة.');
      }

      tempDb = new Database(tempValidateDbPath, { readonly: true, fileMustExist: true });
      const check = tempDb.prepare('PRAGMA integrity_check').get();
      if (!check || check.integrity_check !== 'ok') {
        throw new Error('فحص السلامة الهيكلية لقاعدة البيانات داخل الحزمة أظهر تلفاً (Integrity Check Failed).');
      }

      const requiredTables = ['Employees', 'Leaves', 'LeaveTypes', '_Migrations'];
      const existingTables = new Set(
        tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
      );

      for (const table of requiredTables) {
        if (!existingTables.has(table)) {
          throw new Error(`قاعدة البيانات داخل الحزمة غير متوافقة؛ الجدول الأساسي (${table}) غير موجود.`);
        }
      }

      const employeesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
      const leavesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;
      let documentsCount = 0;
      if (existingTables.has('EmployeeDocuments')) {
        documentsCount = tempDb.prepare('SELECT COUNT(*) as c FROM EmployeeDocuments WHERE IsDeleted = 0').get()?.c ?? 0;
      }

      // Comparison check against active DB / فحص مقارن مع قاعدة البيانات النشطة للتحذير من فقدان مستندات أحدث
      let warning = null;
      const currentActiveDb = activeDbInstance || _db;
      if (currentActiveDb) {
        try {
          const activeTables = new Set(
            currentActiveDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
          );

          if (activeTables.has('EmployeeDocuments')) {
            const activeDocInfo = currentActiveDb.prepare(
              'SELECT COUNT(*) as cnt, MAX(CreatedAt) as latestCreated FROM EmployeeDocuments WHERE IsDeleted = 0'
            ).get();

            if (activeDocInfo && activeDocInfo.cnt > 0) {
              if (existingTables.has('EmployeeDocuments')) {
                const backupDocInfo = tempDb.prepare(
                  'SELECT COUNT(*) as cnt, MAX(CreatedAt) as latestCreated FROM EmployeeDocuments WHERE IsDeleted = 0'
                ).get();

                const backupLatest = backupDocInfo?.latestCreated || '';
                const activeLatest = activeDocInfo.latestCreated || '';

                if (!backupLatest || activeLatest > backupLatest || activeDocInfo.cnt > (backupDocInfo?.cnt || 0)) {
                  warning = 'تحذير: قد تحتوي قاعدة البيانات الحالية على مستندات (كروت) أُضيفت بعد تاريخ هذه النسخة، وسيتم استبدال البيانات بالكامل.';
                }
              }
            }
          }
        } catch (checkErr) {
          console.warn('[DB Restore Warning Check Error]', checkErr.message);
        }
      }

      return { valid: true, isBundle: true, employeesCount, leavesCount, documentsCount, warning };
    } finally {
      if (tempDb) {
        try { tempDb.close(); } catch (_) {}
      }
      if (fs.existsSync(tempValidateDbPath)) {
        try { fs.unlinkSync(tempValidateDbPath); } catch (_) {}
      }
    }
  }

  // ── Legacy .db SQLite file validation / فحص ملفات SQLite القديمة (.db) ──
  const headerStr = headerBuf.toString('utf8', 0, 15);
  if (headerStr !== 'SQLite format 3') {
    throw new Error('الملف المختار ليس ملف قاعدة بيانات SQLite أو حزمة HBAK صالحة.');
  }

  let tempDb = null;
  try {
    tempDb = new Database(backupPath, { readonly: true, fileMustExist: true });

    const check = tempDb.prepare('PRAGMA integrity_check').get();
    if (!check || check.integrity_check !== 'ok') {
      throw new Error('فحص السلامة الهيكلية أظهر تلفاً في ملف قاعدة البيانات (Integrity Check Failed).');
    }

    const requiredTables = ['Employees', 'Leaves', 'LeaveTypes', '_Migrations'];
    const existingTables = new Set(
      tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
    );

    for (const table of requiredTables) {
      if (!existingTables.has(table)) {
        throw new Error(`قاعدة البيانات المختارة غير متوافقة؛ الجدول الأساسي (${table}) غير موجود.`);
      }
    }

    const employeesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
    const leavesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;

    let warning = 'ملاحظة: هذه نسخة قديمة بصيغة قاعدة بيانات فقط (.db) ولا تتضمن أرشيف المستندات المجمعة.';

    return { valid: true, isBundle: false, employeesCount, leavesCount, documentsCount: 0, warning };
  } finally {
    if (tempDb) {
      try { tempDb.close(); } catch (_) {}
    }
  }
}

/**
 * إنشاء نسخة احتياطية وقائية تلقائية لكافة بيانات ومستندات النظام الحالية قبيل إجراء الاستعادة.
 * تُعد صمام الأمان الحرج الذي يعتمد عليه نظام التراجع التلقائي (_emergencyRollback) في حال فشل الاستعادة.
 * Creates an automatic pre-restore safety backup bundle of active DB and documents.
 * @returns {Promise<string>} Path of the safety backup file
 */
async function createSafetyBackup() {
  const backupsDir = path.join(DB_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `pre_restore_safety_backup_${timestamp}.hbak`);

  await backupDatabase(safetyBackupPath);
  return safetyBackupPath;
}

/**
 * استعادة قاعدة البيانات ومستندات الموظفين من ملف نسخة احتياطية تم تدقيقه مسبقاً (.hbak / .zip أو .db).
 * آلية العمل المقاومة للأعطال:
 * 1. التدقيق الصارم لسلامة وتوافق النسخة.
 * 2. أخذ نسخة وقائية شاملة للحالة الحالية قبل البدء.
 * 3. تفريغ سجلات WAL TRUNCATE وإغلاق الاتصال وتحرير أقفال الملفات.
 * 4. استخراج واستبدال ملفات قاعدة البيانات والمستندات.
 * 5. فحص مسار المستندات المخصص وترحيله تلقائياً للمسار الافتراضي إذا كان المسار السابق غير متاح على هذا الجهاز.
 * 6. التراجع التلقائي والفوري (_emergencyRollback) للنسخة الوقائية عند حدوث أي خطأ لضمان عدم تلف النظام.
 * Restores active database and documents from a validated backup file (.hbak / .zip or .db).
 * Automatically takes a safety backup first, closes connection, and restores files.
 * Handles custom storage paths intelligently and rolls back if interrupted.
 *
 * @param {string} backupPath
 * @returns {Promise<{ success: boolean, safetyBackupPath: string, pathMigrated?: boolean, pathMessage?: string|null, targetDocPath?: string }>}
 */
async function restoreDatabase(backupPath) {
  // Ensure database is initialized before safety backup
  if (!_db && fs.existsSync(DB_PATH)) {
    initialize();
  }

  // 1. Strict Validation / 1. التدقيق الصارم لملف النسخة
  const validation = validateDatabaseBackup(backupPath);

  // 2. Pre-restore Safety Backup / 2. أخذ نسخة وقائية تلقائية قبل التعديل
  const safetyBackupPath = await createSafetyBackup();

  // 3. Checkpoint WAL and close connection / 3. تفريغ سجلات WAL وإغلاق الاتصال
  if (_db) {
    try { _db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  }
  close();

  // 4. Remove WAL/SHM auxiliary files if present / 4. تنظيف ملفات الذاكرة المشتركة الملحقة
  const walPath = `${DB_PATH}-wal`;
  const shmPath = `${DB_PATH}-shm`;
  if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch (_) {}
  if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch (_) {}

  // 5. Restore Database & Documents (with automatic rollback on error) / 5. استخراج البيانات مع التراجع التلقائي
  let pathMigrated = false;
  let pathMessage = null;
  let activeTargetDocPath = null;

  try {
    if (validation.isBundle) {
      const zip = new AdmZip(backupPath);
      const entries = zip.getEntries();

      // Extract leave_management.db / استخراج ملف قاعدة البيانات الأساسي
      const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));
      if (!dbEntry) {
        throw new Error('تعذر استخراج ملف قاعدة البيانات من الحزمة.');
      }
      const dbData = zip.readFile(dbEntry);
      fs.writeFileSync(DB_PATH, dbData);

      // Determine the target storage directory from the restored DB itself / قراءة مسار التخزين المعتمد من القاعدة المستعادة
      const DocumentStorageService = require('./services/DocumentStorageService');
      const defaultDocPath = DocumentStorageService.getDefaultStorageRoot();
      let customStoragePath = null;
      let tempRestoredDb = null;

      try {
        tempRestoredDb = new Database(DB_PATH);
        const settingRow = tempRestoredDb.prepare("SELECT Value FROM _AppSettings WHERE Key = 'employee_documents_storage_path'").get();
        if (settingRow && settingRow.Value && typeof settingRow.Value === 'string' && settingRow.Value.trim().length > 0) {
          customStoragePath = path.resolve(settingRow.Value.trim());
        }

        if (customStoragePath) {
          try {
            DocumentStorageService.testStoragePath(customStoragePath);
            activeTargetDocPath = customStoragePath;
          } catch (pathTestErr) {
            // Path unavailable on current machine -> fallback to default and update setting in restored DB
            // المسار غير متاح على الجهاز الحالي -> ترحيل تلقائي إلى المسار الافتراضي وتحديث الإعداد في القاعدة
            activeTargetDocPath = defaultDocPath;
            pathMigrated = true;
            pathMessage = `تم تعديل مسار تخزين المستندات تلقائياً إلى المسار الافتراضي (${defaultDocPath}) لتعذر الوصول إلى المسار السابق (${customStoragePath}).`;
            console.warn(`[DB Restore Notice] Custom path unavailable: ${customStoragePath}. Migrated to: ${defaultDocPath}`);

            tempRestoredDb.prepare(`
              INSERT INTO _AppSettings (Key, Value, UpdatedAt)
              VALUES ('employee_documents_storage_path', '', datetime('now', 'localtime'))
              ON CONFLICT(Key) DO UPDATE SET Value = '', UpdatedAt = excluded.UpdatedAt
            `).run();
          }
        } else {
          activeTargetDocPath = defaultDocPath;
        }
      } catch (readErr) {
        activeTargetDocPath = defaultDocPath;
      } finally {
        if (tempRestoredDb) {
          try { tempRestoredDb.close(); } catch (_) {}
        }
      }

      if (!fs.existsSync(activeTargetDocPath)) {
        fs.mkdirSync(activeTargetDocPath, { recursive: true });
      }

      // Extract all entries under EmployeeDocuments/ to activeTargetDocPath / فك ضغط المستندات لمجلد التخزين المعتمد
      for (const entry of entries) {
        if (entry.entryName.startsWith('EmployeeDocuments/') && !entry.isDirectory) {
          const relativeInsideDoc = entry.entryName.replace(/^EmployeeDocuments\//, '');
          const targetPath = path.join(activeTargetDocPath, relativeInsideDoc);
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          const content = zip.readFile(entry);
          fs.writeFileSync(targetPath, content);
        }
      }
    } else {
      // Legacy .db file / استعادة ملف SQLite مباشر
      fs.copyFileSync(backupPath, DB_PATH);
    }
  } catch (restoreErr) {
    // CRITICAL: Interrupted or failed extraction -> Emergency Auto-Rollback to safety backup
    // حرج: في حال انقطاع الكهرباء أو فشل الاستخراج، تفعيل التراجع الطارئ للنسخة الوقائية تلقائياً
    LoggerService.error('DB', '[DB Restore Failed] Rolling back to pre-restore safety backup: ' + restoreErr.message);
    try {
      await _emergencyRollback(safetyBackupPath);
      LoggerService.info('DB', '[DB Rollback Succeeded] System reverted to safety backup state.');
    } catch (rollbackErr) {
      LoggerService.error('DB', '[DB Rollback Failed] Could not restore safety backup: ' + rollbackErr.message);
    }
    throw new Error(`فشلت عملية الاستعادة: ${restoreErr.message}. تم التراجع التلقائي إلى الحالة السابقة للنسخ الاحتياطي.`);
  }

  return {
    success: true,
    safetyBackupPath,
    pathMigrated,
    pathMessage,
    targetDocPath: activeTargetDocPath
  };
}

/**
 * محرك التراجع الطارئ عند فشل الاستعادة:
 * يعيد كتابة ملف قاعدة البيانات واستخراج المستندات مباشرة من النسخة الوقائية السابقة
 * لإرجاع النظام بدقة 100% إلى وضعه المستقر السابق دون أي فقدان للبيانات.
 * Emergency rollback helper: Reverts DB and documents to the pre-restore safety backup.
 * @param {string} safetyBackupPath
 */
async function _emergencyRollback(safetyBackupPath) {
  if (!safetyBackupPath || !fs.existsSync(safetyBackupPath)) {
    throw new Error('ملف النسخة الاحتياطية الوقائية غير موجود لإجراء التراجع.');
  }

  const zip = new AdmZip(safetyBackupPath);
  const entries = zip.getEntries();

  // Restore DB / استعادة ملف قاعدة البيانات
  const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));
  if (dbEntry) {
    fs.writeFileSync(DB_PATH, zip.readFile(dbEntry));
  }

  // Restore documents to the pre-restore location / استعادة المستندات للمسار السابق للاستعادة
  let preRestoreDocPath = null;
  let rollbackDb = null;
  try {
    const DocumentStorageService = require('./services/DocumentStorageService');
    rollbackDb = new Database(DB_PATH, { readonly: true });
    preRestoreDocPath = DocumentStorageService.getStorageRoot(rollbackDb);
  } catch (_) {
    preRestoreDocPath = path.join(DB_DIR, 'EmployeeDocuments');
  } finally {
    if (rollbackDb) {
      try { rollbackDb.close(); } catch (_) {}
    }
  }

  if (preRestoreDocPath) {
    if (!fs.existsSync(preRestoreDocPath)) {
      fs.mkdirSync(preRestoreDocPath, { recursive: true });
    }
    for (const entry of entries) {
      if (entry.entryName.startsWith('EmployeeDocuments/') && !entry.isDirectory) {
        const relative = entry.entryName.replace(/^EmployeeDocuments\//, '');
        const target = path.join(preRestoreDocPath, relative);
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(target, zip.readFile(entry));
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────────────────────
module.exports = {
  initialize,
  close,
  getDb,
  // Leave Types
  getAllLeaveTypes,
  // Leave Balances
  upsertLeaveBalance,
  // System / Backup / Restore
  backupDatabase,
  validateDatabaseBackup,
  createSafetyBackup,
  restoreDatabase,
};
