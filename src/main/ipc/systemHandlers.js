// ============================================================
//  ipc/systemHandlers.js  –  System Level IPC Handlers (Phase 11)
//  Responsibilities:
//    • Register system:backup IPC channel
//    • Open native Save Dialog for database backups
//    • Delegate database backup to database.js native backup()
// ============================================================

'use strict';

const { BrowserWindow, dialog, app } = require('electron');
const db = require('../database');
const LoggerService = require('../services/LoggerService');
const { translateFileError } = require('../utils/fileErrorTranslator');
const { translateSqliteError } = require('../utils/sqliteErrorTranslator');

// ──────────────────────────────────────────────────────────────
//  Internal: async uniform response wrapper
// ──────────────────────────────────────────────────────────────
function safeHandleAsync(fn) {
  return async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error('SystemHandlers', 'IPC Error', err);
      return { success: false, error: translateFileError(err) || translateSqliteError(err) || err.message };
    }
  };
}

/**
 * Registers system-level IPC handlers.
 * @param {Electron.IpcMain} ipcMain
 */
function registerSystemHandlers(ipcMain) {

  // ── system:backup ───────────────────────────────────────────
  //
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

      if (result.canceled || !result.filePath) {
        return { canceled: true };
      }

      await db.backupDatabase(result.filePath);

      return { filePath: result.filePath };
    })
  );

  // ── system:selectDirectory ──────────────────────────────────
  //
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
  //
  //  Prompts user with native Open dialog, validates the backup file,
  //  shows a strong warning confirmation, performs auto safety backup,
  //  restores the database and documents, and relaunches the app.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:restore',
    safeHandleAsync(async () => {
      const win = BrowserWindow.getFocusedWindow();

      // 1. Open File Dialog
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

      // 2. Pre-flight Validation
      const validation = db.validateDatabaseBackup(selectedFile);

      // 3. User Confirmation Dialog (Warning)
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

      if (confirmResult.response !== 0) {
        return { canceled: true };
      }

      // 4. Restore Database (which also creates safety backup)
      const restoreResult = await db.restoreDatabase(selectedFile);

      // 5. Relaunch and exit to cleanly reinitialize everything
      app.relaunch();
      app.exit(0);

      return { success: true, safetyBackupPath: restoreResult.safetyBackupPath };
    })
  );

  // ── system:getSetting ───────────────────────────────────────
  //
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
  //
  //  Upserts a setting key-value pair in _AppSettings.
  //  Supports both { key, value } payload object and (key, value) direct arguments.
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:setSetting',
    safeHandleAsync(async (arg1, arg2) => {
      let key, value;
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

      rawDb.prepare(`
        INSERT INTO _AppSettings (Key, Value, UpdatedAt)
        VALUES (?, ?, datetime('now', 'localtime'))
        ON CONFLICT(Key) DO UPDATE SET
          Value = excluded.Value,
          UpdatedAt = excluded.UpdatedAt
      `).run(cleanKey, cleanVal);

      // Log setting update
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
  //
  //  Opens a file at the given absolute path using the default OS application (e.g. Excel).
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'system:openPath',
    safeHandleAsync(async (filePath) => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('مسار الملف غير صالح.');
      }
      const { shell } = require('electron');
      const err = await shell.openPath(filePath);
      if (err) {
        throw new Error(`تعذر فتح الملف: ${err}`);
      }
      return { opened: true, filePath };
    })
  );

  LoggerService.info('SystemHandlers', 'Registered system IPC handlers');
}

module.exports = { registerSystemHandlers };
