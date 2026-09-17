// ============================================================
//  ipc/systemHandlers.js  –  System Level IPC Handlers
//  معالجات قنوات الاتصال على مستوى النظام (System IPC Channels)
//  Main Process ONLY - معالجات النظام والنسخ الاحتياطي والاستعادة والإعدادات
//
//  المسؤوليات الرئيسية:
//    • إدارة عمليات النسخ الاحتياطي اليدوي والمجمع (system:backup) وحفظ ملفات .hbak.
//    • اختيار المجلدات المخصصة للنسخ الاحتياطي التلقائي (system:selectDirectory).
//    • استعادة البيانات الآمنة مع الفحص المسبق والتحذير وإعادة الإقلاع (system:restore).
//    • قراءة وحفظ إعدادات النظام العامة في جدول _AppSettings (system:getSetting / system:setSetting).
//    • فتح الملفات والمستندات المصدرة بالتطبيقات الافتراضية للويندوز عبر shell (system:openPath).
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog, app, shell } = require('electron');
const db = require('../database');
const LoggerService = require('../services/LoggerService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync } = createSafeHandler('SystemHandlers');

/**
 * تسجيل كافة قنوات IPC الخاصة بإدارة النظام
 * Registers system-level IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
function registerSystemHandlers(ipcMain) {

  // ── system:backup ───────────────────────────────────────────
  //  فتح نافذة الحفظ لاختيار مسار النسخة الاحتياطية وتوليد الحزمة المجمعة (.hbak)
  //  Prompts user with native Save dialog and executes native DB + Documents backup bundle.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:backup',
    safeHandleAsync(async () => {
      const win = BrowserWindow.getFocusedWindow();
      const dateStr = new Date().toISOString().slice(0, 10);
      const result = await dialog.showSaveDialog(win, {
        title: 'حفظ نسخة احتياطية مجمعة من النظام',
        defaultPath: `Holidays_Backup_${dateStr}.hbak`,
        filters: [
          { name: 'حزمة النسخ الاحتياطي المجمعة (*.hbak, *.zip)', extensions: ['hbak', 'zip'] },
          { name: 'قاعدة بيانات SQLite فقط (*.db)', extensions: ['db', 'sqlite'] },
          { name: 'جميع الملفات', extensions: ['*'] },
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });

      // إذا تراجع المستخدم وأغلق نافذة الحفظ
      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      // تفويض تنفيذ النسخ المتكامل لقاعدة البيانات والمستندات
      await db.backupDatabase(result.filePath);

      return { filePath: result.filePath };
    })
  );

  // ── system:selectDirectory ──────────────────────────────────
  //  فتح نافذة اختيار مجلد لحفظ النسخ الاحتياطية التلقائية فيه
  //  Prompts user with native Open dialog for directory selection.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:selectDirectory',
    safeHandleAsync(async (defaultPath) => {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win, {
        title: 'اختيار مجلد النسخ الاحتياطي المخصص',
        defaultPath: (typeof defaultPath === 'string' && defaultPath.trim()) ? defaultPath.trim() : undefined,
        buttonLabel: 'اختيار هذا المجلد',
        properties: ['openDirectory', 'createDirectory'],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }

      return { canceled: false, selectedPath: result.filePaths[0] };
    })
  );

  // ── system:restore ──────────────────────────────────────────
  //  استعادة نسخة احتياطية: فحص سلامة الحزمة، وعرض شاشة تأكيد تحذيرية،
  //  وأخذ نسخة أمان احتياطية تلقائياً قبل الاستبدال، ثم إعادة تشغيل البرنامج
  //  Prompts user with native Open dialog, validates the backup file,
  //  shows a strong warning confirmation, performs auto safety backup,
  //  restores the database and documents, and relaunches the app.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:restore',
    safeHandleAsync(async () => {
      const win = BrowserWindow.getFocusedWindow();

      // 1. فتح نافذة اختيار ملف النسخة الاحتياطية
      const openResult = await dialog.showOpenDialog(win, {
        title: 'اختيار ملف النسخة الاحتياطية للاستعادة',
        buttonLabel: 'فحص واستعادة',
        filters: [
          { name: 'حزم النسخ الاحتياطي للنظام (*.hbak, *.zip, *.db)', extensions: ['hbak', 'zip', 'db', 'sqlite'] },
          { name: 'حزم الأرشيف المجمعة (*.hbak, *.zip)', extensions: ['hbak', 'zip'] },
          { name: 'ملفات SQLite Database (*.db)', extensions: ['db', 'sqlite'] },
          { name: 'جميع الملفات', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (openResult.canceled || !openResult.filePaths || openResult.filePaths.length === 0) {
        return { canceled: true };
      }

      const selectedFile = openResult.filePaths[0];

      // 2. الفحص المسبق وسلامة الملف (Pre-flight Validation) وقراءة الإحصائيات
      const validation = db.validateDatabaseBackup(selectedFile);

      // 3. بناء نص التحذير وتأكيد المستخدم قبل بدء الاستبدال
      let confirmDetail = `النسخة المختارة تحتوي على:\n• عدد الموظفين: ${validation.employeesCount}\n• عدد الإجازات: ${validation.leavesCount}\n`;
      if (validation.isBundle) {
        confirmDetail += `• عدد المستندات والكروت: ${validation.documentsCount ?? 0}\n• نوع الحزمة: مجمعة (قاعدة بيانات ومستندات)\n\n`;
      } else {
        confirmDetail += `• نوع الحزمة: قاعدة بيانات فقط (.db)\n\n`;
      }

      if (validation.warning) {
        confirmDetail += `⚠️ ${validation.warning}\n\n`;
      }
      confirmDetail += `سيقوم النظام بأخذ نسخة أمان احتياطية تلقائياً قبل الاستبدال ثم إعادة تشغيل البرنامج فوراً.\n\nهل أنت متأكد من رغبتك بالاستبدال؟`;

      const confirmResult = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['استعادة وإعادة تشغيل التطبيق', 'إلغاء'],
        defaultId: 1,
        cancelId: 1,
        title: 'تأكيد استعادة النسخة الاحتياطية',
        message: 'تحذير: سيتم استبدال جميع البيانات الحالية بالكامل!',
        detail: confirmDetail,
        noLink: true,
      });

      // إذا اختار المستخدم إلغاء العملية
      if (confirmResult.response !== 0) {
        return { canceled: true };
      }

      // 4. تنفيذ الاستعادة (تنشئ تلقائياً نسخة أمان للوضع الحالي قبل الكتابة فوقه)
      const restoreResult = await db.restoreDatabase(selectedFile);

      // 5. إعادة تشغيل التطبيق والخروج النظيف لتهيئة البيئة من جديد
      app.relaunch();
      app.exit(0);

      return { success: true, safetyBackupPath: restoreResult.safetyBackupPath };
    })
  );

  // ── system:getSetting ───────────────────────────────────────
  //  قراءة قيمة إعداد معين من جدول إعدادات النظام _AppSettings
  //  Reads a setting value from the _AppSettings table.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:getSetting',
    safeHandleAsync(async (key) => {
      if (!key || typeof key !== 'string') {
        throw new Error('يجب تحديد مفتاح الإعداد بشكل صحيح.');
      }
      const rawDb = db.getDb();
      const row = rawDb.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get(key.trim());
      return row ? row.Value : null;
    })
  );

  // ── system:setSetting ───────────────────────────────────────
  //  حفظ أو تحديث إعداد في جدول _AppSettings مع التوثيق في سجل التدقيق
  //  Upserts a setting key-value pair in _AppSettings.
  //  Supports both { key, value } payload object and (key, value) direct arguments.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:setSetting',
    safeHandleAsync(async (arg1, arg2) => {
      let key, value;
      // دعم كلا الأسلوبين: كائن { key, value } أو وسيطين منفصلين (key, value)
      if (arg1 && typeof arg1 === 'object' && arg1.key !== undefined) {
        key = arg1.key;
        value = arg1.value;
      } else {
        key = arg1;
        value = arg2;
      }

      if (!key || typeof key !== 'string') {
        throw new Error('يرجى تحديد مفتاح الإعداد المراد حفظه.');
      }

      const rawDb = db.getDb();
      const cleanKey = String(key).trim();
      const cleanVal = value != null ? String(value).trim() : '';

      const oldRow = rawDb.prepare('SELECT Value FROM _AppSettings WHERE Key = ?').get(cleanKey);

      // الحفظ أو التحديث عند التعارض (Upsert via ON CONFLICT)
      rawDb.prepare(`
        INSERT INTO _AppSettings (Key, Value, UpdatedAt)
        VALUES (?, ?, datetime('now', 'localtime'))
        ON CONFLICT(Key) DO UPDATE SET
          Value = excluded.Value,
          UpdatedAt = excluded.UpdatedAt
      `).run(cleanKey, cleanVal);

      // توثيق تعديل الإعداد في سجل التدقيق الأمني الشامل
      const AuditService = require('../services/AuditService');
      const auditResult = AuditService.logAction(rawDb, {
        actionType: 'UPDATE',
        entityType: 'System',
        entityID: null,
        oldValue: oldRow ? { [cleanKey]: oldRow.Value } : null,
        newValue: { [cleanKey]: cleanVal },
        details: `تحديث إعداد النظام [${cleanKey}]: "${cleanVal}"`,
      });

      const response = { success: true, key: cleanKey, value: cleanVal };
      if (auditResult && !auditResult.success) {
        response.warning = 'تم حفظ الإعداد بنجاح ولكن تعذر توثيقه في سجل التدقيق.';
      }

      return response;
    })
  );

  // ── system:openPath ─────────────────────────────────────────
  //  فتح مسار ملف في التطبيق الافتراضي لنظام التشغيل (مقيد بالامتدادات المصرح بها)
  //  Opens an existing file with OS default app, strictly restricted to safe document extensions.
  // ─────────────────────────────────────────────────────────────
  const ALLOWED_OPEN_EXTENSIONS = new Set(['.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.webp']);

  ipcMain.handle(
    'system:openPath',
    safeHandleAsync(async (filePath) => {
      // 1. التحقق أن filePath نص غير فارغ
      if (!filePath || typeof filePath !== 'string' || filePath.trim().length === 0) {
        throw new Error('مسار الملف غير صالح أو فارغ.');
      }

      const trimmedPath = filePath.trim();

      // 2. التحقق من وجود الملف فعلياً على القرص وأنه ملف وليس مجلداً
      if (!fs.existsSync(trimmedPath)) {
        throw new Error(`الملف غير موجود في المسار المحدد: "${trimmedPath}".`);
      }

      let stat;
      try {
        stat = fs.statSync(trimmedPath);
      } catch (err) {
        throw new Error(`تعذر قراءة بيانات الملف: ${err.message}`);
      }

      if (!stat.isFile()) {
        throw new Error('المسار المحدد ليس ملفاً صالحاً للفتح.');
      }

      // 3. فحص الامتداد ضمن القائمة المسموحة
      const ext = path.extname(trimmedPath).toLowerCase();
      if (!ALLOWED_OPEN_EXTENSIONS.has(ext)) {
        throw new Error(`امتداد الملف (${ext || 'بدون امتداد'}) غير مصرح بفتحه عبر هذا المسار. الامتدادات المسموحة: (${Array.from(ALLOWED_OPEN_EXTENSIONS).join(', ')}).`);
      }

      const err = shell && typeof shell.openPath === 'function' ? await shell.openPath(trimmedPath) : null;
      if (err) {
        throw new Error(`تعذر فتح الملف بالبرنامج الافتراضي: ${err}`);
      }
      return { opened: true, filePath: trimmedPath };
    })
  );

  LoggerService.info('SystemHandlers', 'Registered system IPC handlers');
}

module.exports = { registerSystemHandlers };

