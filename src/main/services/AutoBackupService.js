// ============================================================
//  services/AutoBackupService.js  –  Automated 15-Day Backup Engine
//  محرك النسخ الاحتياطي الآلي الدوري (كل 15 يوماً)
//  Main Process ONLY - يعمل حصرياً داخل العملية الرئيسية (Electron Main Process)
//
//  المسؤوليات الرئيسية:
//    • الفحص التلقائي عند إقلاع التطبيق (Startup Check) للتأكد من مرور 15 يوماً على آخر نسخة.
//    • إنشاء حزمة نسخ احتياطي مشفرة ومضغوطة بصيغة (.hbak) تشمل قاعدة البيانات والوثائق.
//    • دعم المسار المخصص مع آلية التراجع التلقائي الذكي (Fallback) للمسار الافتراضي.
//    • إدارة تدوير النسخ (Backup Rotation) بالاحتفاظ بآخر 10 نسخ وحذف القديم تلقائياً.
//    • توثيق عمليات النسخ وحالات الفشل والتحذيرات بجدول _AppSettings وسجل التدقيق.
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const AuditService = require('./AuditService');
const LoggerService = require('./LoggerService');

// إعدادات المحرك الثابتة
const BACKUP_INTERVAL_DAYS = 15; // الفاصل الزمني بالأيام بين كل عمليتي نسخ تلقائي
const MS_PER_DAY = 86_400_000;    // عدد المللي ثانية في اليوم الواحد للحسابات الزمنية الدقيقة
const MAX_BACKUPS_RETAINED = 10;  // الحد الأقصى لعدد النسخ الاحتياطية المحفوظة قبل التدوير والحذف

/**
 * تحديد مسار مجلد بيانات التطبيق بأمان وفقاً لبيئة التشغيل
 * Resolves the application data directory.
 * @returns {string} مسار المجلد المطلق
 */
function getDbDir() {
  return process.env.HOLIDAYS_DB_DIR
    ? process.env.HOLIDAYS_DB_DIR
    : ((app && typeof app.getPath === 'function')
        ? app.getPath('userData')
        : path.join(process.env.APPDATA || '.', 'leave-management-system'));
}

/**
 * التأكد من وجود المجلد المطلوب وإنشاؤه تسلسلياً (recursive) إذا كان مفقوداً
 * Ensures the auto-backups directory exists.
 * @param {string} dirPath المسار المستهدف
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * تدوير وحذف النسخ الاحتياطية القديمة للحفاظ على أحدث N ملفات فقط منعاً لاستهلاك القرص
 * Rotates the auto-backups directory to keep only the newest N files.
 * @param {string} dirPath مسار مجلد النسخ
 * @param {number} maxFiles الحد الأقصى لعدد الملفات المحتفظ بها (افتراضياً 10)
 */
function rotateBackups(dirPath, maxFiles = MAX_BACKUPS_RETAINED) {
  try {
    ensureDir(dirPath);
    // قراءة كافة الملفات التي تطابق النمط auto_backup_*.hbak أو zip أو db
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => /^auto_backup_.*\.(hbak|zip|db)$/i.test(file))
      .map((file) => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);
        return { file, fullPath, mtime: stats.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // الترتيب من الأحدث إلى الأقدم استناداً إلى وقت التعديل

    // إذا زاد عدد الملفات عن الحد المسموح، نحذف الأقدم (من الفهرس maxFiles فما بعد)
    if (files.length > maxFiles) {
      const filesToDelete = files.slice(maxFiles);
      for (const item of filesToDelete) {
        try {
          fs.unlinkSync(item.fullPath);
          LoggerService.info('AutoBackupService', `Rotated and removed old backup: ${item.file}`);
        } catch (delErr) {
          LoggerService.error('AutoBackupService', `Failed to delete old backup ${item.file}`, delErr);
        }
      }
    }
  } catch (err) {
    LoggerService.error('AutoBackupService', 'Rotation error', err);
  }
}

/**
 * فحص استحقاق النسخ الاحتياطي الدوري (كل 15 يوماً) وتنفيذه تلقائياً عند الحاجة
 * Checks if 15 days have passed since the last automated backup and runs a new backup if due.
 *
 * @param {import('better-sqlite3').Database} db اتصال قاعدة البيانات النشط
 * @param {{ force?: boolean, baseDir?: string }} options خيارات التشغيل (force للإجبار)
 * @returns {Promise<{ performed: boolean, backupPath?: string, message?: string, error?: string }>}
 */
async function checkAndRunAutoBackup(db, { force = false, baseDir = null } = {}) {
  if (!db) {
    LoggerService.error('AutoBackupService', 'Database instance not provided.');
    return { performed: false, message: 'Database not provided.' };
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // 1. الاستعلام عن تاريخ آخر عملية نسخ احتياطي تلقائي مسجلة في جدول إعدادات النظام
  const settingRow = db
    .prepare("SELECT Value FROM _AppSettings WHERE Key = 'last_auto_backup_date'")
    .get();

  let isDue = false;

  // تحديد ما إذا كان النسخ مستحقاً الآن
  if (force || !settingRow || !settingRow.Value) {
    // إجبار يدوي، أو أول تشغيل على الإطلاق بدون سجل سابق
    isDue = true;
  } else {
    const lastBackupTime = new Date(settingRow.Value).getTime();
    if (isNaN(lastBackupTime)) {
      isDue = true;
    } else {
      const daysSinceLast = (now.getTime() - lastBackupTime) / MS_PER_DAY;
      // إذا مر 15 يوماً أو أكثر
      if (daysSinceLast >= BACKUP_INTERVAL_DAYS) {
        isDue = true;
      }
    }
  }

  // إذا لم يحن موعد النسخ بعد، ننهي العملية بسلام دون استهلاك موارد
  if (!isDue) {
    return { performed: false, message: 'Auto backup is not due yet.' };
  }

  try {
    const dbDir = baseDir || getDbDir();
    const defaultBackupsDir = path.join(dbDir, 'auto-backups');

    // فحص ما إذا كان المستخدم قد حدد مساراً مخصصاً (مثل فلاش USB أو قرص خارجي)
    const customSetting = db
      .prepare("SELECT Value FROM _AppSettings WHERE Key = 'auto_backup_custom_path'")
      .get();
    const customPath = customSetting && customSetting.Value ? customSetting.Value.trim() : '';

    let autoBackupsDir = defaultBackupsDir;
    let usedFallback = false;
    let fallbackWarning = '';

    // التحقق من صلاحية وجودة المسار المخصص وإمكانية الكتابة عليه
    if (customPath) {
      try {
        if (!fs.existsSync(customPath)) {
          fs.mkdirSync(customPath, { recursive: true });
        }
        // اختبار إذن الكتابة (W_OK)
        fs.accessSync(customPath, fs.constants.W_OK);
        autoBackupsDir = customPath;
      } catch (accessErr) {
        // إذا تعذر الوصول للمسار المخصص (مثلاً القرص الخارجي غير متصل)، نتراجع تلقائياً للمسار الافتراضي لضمان عدم ضياع البيانات
        usedFallback = true;
        fallbackWarning = `تعذر الوصول لمسار النسخ الاحتياطي المخصص (${customPath}): ${accessErr.message}. تم الرجوع للمسار الافتراضي.`;
        LoggerService.warn('AutoBackupService', fallbackWarning, accessErr);
        autoBackupsDir = defaultBackupsDir;
      }
    }

    ensureDir(autoBackupsDir);

    // 2. إنشاء اسم الملف وبدء عملية النسخ الاحتياطي الآمن الكامل (.hbak)
    const timestampStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFileName = `auto_backup_${timestampStr}.hbak`;
    const backupFilePath = path.join(autoBackupsDir, backupFileName);

    LoggerService.info('AutoBackupService', `Running 15-day automated bundle backup to: ${backupFilePath} (custom: ${!!customPath}, fallback: ${usedFallback})`);
    const dbModule = require('../database');
    await dbModule.backupDatabase(backupFilePath);

    // 3. تحديث جدول إعدادات النظام وتصفير أي أخطاء سابقة وتسجيل التحذيرات إن وجدت
    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_date', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run(nowIso);

    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_error', '', datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run();

    db.prepare(`
      INSERT INTO _AppSettings (Key, Value, UpdatedAt)
      VALUES ('last_auto_backup_warning', ?, datetime('now', 'localtime'))
      ON CONFLICT(Key) DO UPDATE SET
        Value = excluded.Value,
        UpdatedAt = excluded.UpdatedAt
    `).run(usedFallback ? JSON.stringify({ warning: fallbackWarning, date: nowIso }) : '');

    // 4. توثيق عملية النسخ في سجل التدقيق الأمني الشامل
    const auditDetails = usedFallback
      ? `نسخة احتياطية تلقائية دورية (مسار بديل آمن نظراً لتعذر المسار المخصص): ${backupFileName}`
      : (customPath
          ? `نسخة احتياطية تلقائية دورية (المسار المخصص): ${backupFileName}`
          : `نسخة احتياطية تلقائية دورية (كل 15 يوماً): ${backupFileName}`);

    AuditService.logAction(db, {
      actionType: 'BACKUP',
      entityType: 'System',
      entityID: null,
      oldValue: settingRow ? settingRow.Value : null,
      newValue: { fileName: backupFileName, path: backupFilePath, timestamp: nowIso, usedFallback },
      details: auditDetails,
    });

    // 5. تدوير النسخ القديمة والاحتفاظ بآخر 10 نسخ فقط
    rotateBackups(autoBackupsDir, MAX_BACKUPS_RETAINED);

    return {
      performed: true,
      backupPath: backupFilePath,
      fileName: backupFileName,
      usedFallback,
      fallbackWarning,
    };
  } catch (err) {
    LoggerService.error('AutoBackupService', 'Failed to execute auto-backup', err);
    try {
      // حفظ رسالة الخطأ في إعدادات النظام ليتم عرضها لاحقاً في لوحة التحكم
      db.prepare(`
        INSERT INTO _AppSettings (Key, Value, UpdatedAt)
        VALUES ('last_auto_backup_error', ?, datetime('now', 'localtime'))
        ON CONFLICT(Key) DO UPDATE SET
          Value = excluded.Value,
          UpdatedAt = excluded.UpdatedAt
      `).run(JSON.stringify({ error: err.message, date: nowIso }));
    } catch (_saveErr) {}
    return { performed: false, error: err.message };
  }
}

module.exports = {
  checkAndRunAutoBackup,
  rotateBackups,
  BACKUP_INTERVAL_DAYS,
  MAX_BACKUPS_RETAINED,
};

