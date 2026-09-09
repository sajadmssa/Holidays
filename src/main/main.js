// ============================================================
//  main.js  –  Electron Main Process (Entry Point)
//  Responsibilities:
//    • Create and manage the BrowserWindow
//    • Boot the database service
//    • Register ALL IPC handlers (the only place Node APIs are used)
//    • Enforce strict security: nodeIntegration=false, contextIsolation=true
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
const notificationService          = require('./services/NotificationService');
const autoBackupService            = require('./services/AutoBackupService');

// ──────────────────────────────────────────────────────────────
//  Window Factory
// ──────────────────────────────────────────────────────────────
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false, // show after 'ready-to-show' to avoid flash
    title: 'نظام إدارة الإجازات',
    webPreferences: {
      // ── SECURITY ──────────────────────────────────────────
      nodeIntegration: false,      // MUST remain false
      contextIsolation: true,      // MUST remain true
      sandbox: true,               // extra renderer sandboxing
      // ── Preload ───────────────────────────────────────────
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

const LoggerService = require('./services/LoggerService');

// ──────────────────────────────────────────────────────────────
//  Single Instance Lock
// ──────────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // If another instance is already running, quit immediately
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, focus our main window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // ──────────────────────────────────────────────────────────────
  //  App Lifecycle
  // ──────────────────────────────────────────────────────────────
  app.whenReady().then(() => {
  // Initialize the database (runs migrations on first launch)
  try {
    db.initialize();
  } catch (err) {
    LoggerService.error('Main', 'Failed to initialize database on startup', err);
    dialog.showErrorBox(
      'خطأ في تشغيل قاعدة البيانات',
      'تعذر فتح أو تهيئة ملف قاعدة البيانات الخاص بالنظام.\n\nيرجى التأكد من صلاحيات المجلد أو إعادة تشغيل البرنامج.'
    );
    app.quit();
    return;
  }

  registerIpcHandlers();
  createWindow();

  // Start the background notification service for 11:00 AM alert
  notificationService.startNotificationScheduler(mainWindow, db.getDb());

  // Check and run 15-day silent automated backup
  autoBackupService.checkAndRunAutoBackup(db.getDb()).catch((err) => {
    LoggerService.error('Main', 'Auto-backup check failed on startup', err);
  });

  // Silent background reconciliation of unindexed/orphan documents left from power cuts
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
    db.close(); // gracefully close WAL before exit
    app.quit();
  }
});
}

// ──────────────────────────────────────────────────────────────
//  IPC Handler Registration
//  All channel names follow the pattern: `entity:action`
//  Every handler returns { success: true, data } or { success: false, error }
// ──────────────────────────────────────────────────────────────
function registerIpcHandlers() {

  // ── HELPER ────────────────────────────────────────────────
  /**
   * Wraps a sync DB call in a try/catch and returns a uniform response object.
   * @param {Function} fn - A function that performs DB work and returns a value.
   */
  function safeHandle(fn) {
    return (_event, ...args) => {
      try {
        const data = fn(...args);
        return { success: true, data };
      } catch (err) {
        LoggerService.error('IPC', 'IPC handler error', err);
        return { success: false, error: err.message };
      }
    };
  }

  // ── EMPLOYEES ─────────────────────────────────────────────
  ipcMain.handle('employees:getAll', safeHandle(() =>
    db.getAllEmployees()
  ));

  ipcMain.handle('employees:getById', safeHandle((id) =>
    db.getEmployeeById(id)
  ));

  ipcMain.handle('employees:create', safeHandle((payload) =>
    db.createEmployee(payload)
  ));

  ipcMain.handle('employees:update', safeHandle((id, payload) =>
    db.updateEmployee(id, payload)
  ));

  ipcMain.handle('employees:deactivate', safeHandle((id) =>
    db.deactivateEmployee(id)
  ));

  // ── LEAVE TYPES ───────────────────────────────────────────
  ipcMain.handle('leaveTypes:getAll', safeHandle(() =>
    db.getAllLeaveTypes()
  ));

  // ── LEAVE BALANCES ────────────────────────────────────────
  ipcMain.handle('leaveBalances:getByEmployee', safeHandle((employeeId) =>
    db.getLeaveBalancesByEmployee(employeeId)
  ));

  ipcMain.handle('leaveBalances:upsert', safeHandle((payload) =>
    db.upsertLeaveBalance(payload)
  ));

  // ── LEAVES ────────────────────────────────────────────────
  ipcMain.handle('leaves:getByEmployee', safeHandle((employeeId) =>
    db.getLeavesByEmployee(employeeId)
  ));

  ipcMain.handle('leaves:getAll', safeHandle(() =>
    db.getAllLeaves()
  ));

  ipcMain.handle('leaves:create', safeHandle((payload) =>
    db.createLeave(payload)
  ));

  ipcMain.handle('leaves:delete', safeHandle((leaveId) =>
    db.deleteLeave(leaveId)
  ));

  // ── AUDIT LOG ─────────────────────────────────────────────
  ipcMain.handle('audit:getAll', safeHandle(() =>
    db.getAuditLog()
  ));

  // ── LEAVE ENGINE (Phase 3) ─────────────────────────────────────
  //  Delegates to leaveHandlers.js which owns its own safeHandle wrapper.
  registerLeaveHandlers(ipcMain, db.getDb());

  // ── EMPLOYEE ONBOARDING (Phase 6) ────────────────────────────
  //  Delegates to employeeHandlers.js for validated CRUD operations.
  registerEmployeeHandlers(ipcMain, db.getDb());

  // ── REPORTING ENGINE (Phase 7) ──────────────────────────────
  //  Delegates to reportHandlers.js; dialog runs in main process only.
  registerReportHandlers(ipcMain, db.getDb());

  // ── SYSTEM ADMINISTRATION (Phase 11) ──────────────────────
  //  Delegates to systemHandlers.js; handles live DB backups.
  registerSystemHandlers(ipcMain);

  // ── AUDIT LOGS ─────────────────────────────────────────────
  registerAuditHandlers(ipcMain, db.getDb());

  // ── EMPLOYEE DOCUMENTS ─────────────────────────────────────
  registerDocumentHandlers(ipcMain, db.getDb());
}
