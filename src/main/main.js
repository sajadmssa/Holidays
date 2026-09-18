// ============================================================
//  main.js  –  Electron Main Process (Entry Point)
//  نقطة الإدخال الرئيسية للتطبيق (العملية الأساسية Main Process)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • إدارة دورة حياة التطبيق والنوافذ (BrowserWindow Lifecycle).
//    • فرض تشغيل نسخة واحدة فقط (Single Instance Lock) لمنع التضارب في ملفات قاعدة البيانات.
//    • إقلاع وتهيئة قاعدة البيانات المركزية وتشغيل ترحيل الجداول التلقائي (Migrations).
//    • تسجيل كافة قنوات ومعالجات الاتصال الداخلي (IPC Handlers) بين الواجهة والنظام.
//    • فرض معايير الأمان الصارمة: nodeIntegration=false, contextIsolation=true, sandbox=true.
//    • تشغيل المهام المجدولة في الخلفية (تنبيهات الإجازات، النسخ التلقائي كل 15 يوماً، تنظيف الملفات اليتيمة).
//    • الإغلاق النظيف (Graceful Shutdown) وتفريغ سجلات WAL وتحسين الجداول عبر PRAGMA optimize.
// ============================================================

'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db   = require('./database');
const { registerLeaveHandlers }    = require('./ipc/leaveHandlers');
const { registerEmployeeHandlers } = require('./ipc/employeeHandlers');
const { registerReportHandlers }   = require('./ipc/reportHandlers');
const { registerSystemHandlers }   = require('./ipc/systemHandlers');
const { registerAuditHandlers }    = require('./ipc/auditHandlers');
const { registerDocumentHandlers } = require('./ipc/documentHandlers');
const { registerDepartmentHandlers } = require('./ipc/departmentHandlers');
const { registerLeaveTypeHandlers }  = require('./ipc/leaveTypeHandlers');
const notificationService          = require('./services/NotificationService');
const autoBackupService            = require('./services/AutoBackupService');
const LoggerService                = require('./services/LoggerService');

// ──────────────────────────────────────────────────────────────
//  Window Factory / مصنع نافذة التطبيق الرئيسية
// ──────────────────────────────────────────────────────────────
let mainWindow = null;

/**
 * إنشاء وتهيئة نافذة التطبيق الرئيسية وضبط إعدادات الأمان
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false, // show after 'ready-to-show' to avoid flash (تأخير العرض حتى اكتمال التحميل لمنع الوميض الأبيض)
    title: 'نظام إدارة الإجازات',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      // ── SECURITY / إعدادات الأمان الصارمة ───────────────────
      nodeIntegration: false,      // MUST remain false (منع وصول الواجهة المباشر لـ Node.js)
      contextIsolation: true,      // MUST remain true (عزل سياق تنفيذ سكربتات الواجهة)
      sandbox: true,               // extra renderer sandboxing (تفعيل بيئة الرمل الإضافية لمتصفح Chromium)
      // ── Preload / سكربت الجسر الآمن ────────────────────────
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ──────────────────────────────────────────────────────────────
//  Single Instance Lock / قفل النسخة الواحدة
//  يمنع تشغيل أكثر من نسخة واحدة من التطبيق في نفس الوقت لحماية ملفات SQLite
// ──────────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // If another instance is already running, quit immediately
  // إذا كانت هناك نسخة تعمل بالفعل، يتم الخروج فوراً
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, focus our main window
    // في حال حاول المستخدم تشغيل نسخة ثانية، نكتفي بإبراز النافذة المفتوحة مسبقاً
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  App Lifecycle / دورة حياة التطبيق عند الجاهزية
  // ──────────────────────────────────────────────────────────────
  app.whenReady().then(() => {
    // Initialize the database (runs migrations on first launch)
    // تهيئة قاعدة البيانات وتشغيل الترحيلات الهيكلية Idempotent Migrations
    try {
      db.initialize();
    } catch (err) {
      LoggerService.error('Main', 'Failed to initialize database on startup', err);
      const isNetError = err && err.message && (err.message.includes('شبكي') || err.message.includes('UNC') || err.message.includes('Network Share'));
      dialog.showErrorBox(
        isNetError ? 'مسار شبكي غير مدعوم لقاعدة البيانات' : 'خطأ في تشغيل قاعدة البيانات',
        isNetError
          ? `${err.message}\n\nيرجى نقل ملف قاعدة البيانات إلى مجلد محلي على القرص الصلب للجهاز.`
          : 'تعذر فتح أو تهيئة ملف قاعدة البيانات الخاص بالنظام.\n\nيرجى التأكد من صلاحيات المجلد أو إعادة تشغيل البرنامج.'
      );
      app.quit();
      return;
    }

    // تسجيل كافة قنوات IPC وبناء النافذة الرئيسية
    registerIpcHandlers();
    createWindow();

    // Start the background notification service for 11:00 AM alert
    // تشغيل مجدول إشعارات الإجازات التلقائي اليومي عند الساعة 11:00 صباحاً
    notificationService.startNotificationScheduler(mainWindow, db.getDb());

    // Check and run 15-day silent automated backup
    // فحص وتشغيل النسخ الاحتياطي التلقائي الصامت كل 15 يوماً
    autoBackupService.checkAndRunAutoBackup(db.getDb()).catch((err) => {
      LoggerService.error('Main', 'Auto-backup check failed on startup', err);
    });

    // Silent background reconciliation of unindexed/orphan documents left from power cuts
    // فحص وتنظيف صامت في الخلفية للملفات اليتيمة الناتجة عن أي انقطاع كهربائي مفاجئ سابق
    setTimeout(() => {
      try {
        const DocumentStorageService = require('./services/DocumentStorageService');
        DocumentStorageService.reconcileOrphanDocuments(db.getDb());
      } catch (reconcileErr) {
        LoggerService.warn('Main', 'Silent document reconciliation encountered an issue', reconcileErr);
      }
    }, 2500);

    // macOS: re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    notificationService.stopNotificationScheduler();
    if (process.platform !== 'darwin') {
      db.close(); // gracefully close WAL before exit (إغلاق آمن لقاعدة البيانات وتفريغ سجلات WAL)
      app.quit();
    }
  });
}

// ──────────────────────────────────────────────────────────────
//  IPC Handler Registration / تسجيل قنوات الاتصال الداخلي
//  All channel names follow the pattern: `entity:action`
//  Every handler returns { success: true, data } or { success: false, error }
// ──────────────────────────────────────────────────────────────
/**
 * تسجيل كافة معالجات قنوات الاتصال الداخلي (IPC) بين الواجهة والعملية الرئيسية
 */
function registerIpcHandlers() {

  // ── LEAVE ENGINE & BALANCES ────────────────────────────────
  //  تفويض قنوات الإجازات وأنواعها وأرصدتها إلى leaveHandlers
  registerLeaveHandlers(ipcMain, db.getDb());

  // ── EMPLOYEE ONBOARDING (Phase 6) ──────────────────────────
  //  تفويض قنوات الموظفين وإدارتهم ونقلهم إلى employeeHandlers
  registerEmployeeHandlers(ipcMain, db.getDb());

  // ── REPORTING ENGINE (Phase 7) ────────────────────────────
  //  تفويض قنوات التقارير وتصدير Excel إلى reportHandlers
  registerReportHandlers(ipcMain, db.getDb());

  // ── SYSTEM ADMINISTRATION (Phase 11) ──────────────────────
  //  تفويض قنوات النسخ الاحتياطي والاستعادة والإعدادات إلى systemHandlers
  registerSystemHandlers(ipcMain);

  // ── AUDIT LOGS ─────────────────────────────────────────────
  //  تفويض قنوات استعراض سجل التدقيق والأمان إلى auditHandlers
  registerAuditHandlers(ipcMain, db.getDb());

  // ── EMPLOYEE DOCUMENTS ─────────────────────────────────────
  //  تفويض قنوات كروت وأرشيف مستندات الموظفين إلى documentHandlers
  registerDocumentHandlers(ipcMain, db.getDb());

  // ── DEPARTMENTS (Phase 13) ─────────────────────────────────
  //  تفويض قنوات إدارة الأقسام إلى departmentHandlers
  registerDepartmentHandlers(ipcMain, db.getDb());

  // ── LEAVE TYPES MANAGEMENT ─────────────────────────────────
  //  تفويض قنوات إدارة أنواع الإجازات إلى leaveTypeHandlers
  registerLeaveTypeHandlers(ipcMain, db.getDb());
}
