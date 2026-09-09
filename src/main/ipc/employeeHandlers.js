// ============================================================
//  ipc/employeeHandlers.js  –  Employee IPC Handlers (Phase 6)
//  Responsibilities:
//    • Register the `employee:add` IPC channel
//    • Enforce the uniform { success, data|error } response envelope
//    • Delegate all business logic to EmployeeService
//
//  This module is stateless. The live `db` instance is injected
//  at startup so the service stays testable without Electron running.
// ============================================================

'use strict';

const { dialog } = require('electron');
const {
  addEmployee,
  searchEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  transferEmployee,
  cancelEmployeeTransfer,
  getEmployeesPaginated,
} = require('../services/EmployeeService');
const { exportAllEmployees } = require('../services/ReportService');
const LoggerService = require('../services/LoggerService');
const { translateFileError } = require('../utils/fileErrorTranslator');
const { translateSqliteError } = require('../utils/sqliteErrorTranslator');

// ──────────────────────────────────────────────────────────────
//  Internal: uniform response wrapper
//  Same pattern used in leaveHandlers.js for consistency.
// ──────────────────────────────────────────────────────────────
function safeHandle(fn) {
  return async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error('EmployeeHandlers', 'IPC Error', err);
      return { success: false, error: translateFileError(err) || translateSqliteError(err) || err.message };
    }
  };
}

// ──────────────────────────────────────────────────────────────
//  registerEmployeeHandlers(ipcMain, db)
//
//  Call this ONCE after db.initialize() in main.js.
//
//  @param {Electron.IpcMain} ipcMain
//  @param {import('better-sqlite3').Database} db
// ──────────────────────────────────────────────────────────────
function registerEmployeeHandlers(ipcMain, db) {

  // ── employee:add ─────────────────────────────────────────────
  //
  //  Creates a new active employee record after rigorous validation.
  //
  //  Renderer payload:
  //    { fullName: string, gender: 'Male'|'Female', hireDate: string, jobTitle: string }
  //  Response data:
  //    number  – the new EmployeeID (lastInsertRowid)
  // ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:add',
    safeHandle((payload) => {
      // Surface-level guard: payload must be an object
      if (!payload || typeof payload !== 'object') {
        throw new Error('employee:add: payload must be a non-null object.');
      }
      // All further validation (field types, lengths, date bounds,
      // gender enum) is delegated entirely to EmployeeService.
      return addEmployee(payload, db);
    })
  );

  // ── employee:search ───────────────────────────────────────────
  //
  //  Live name lookup for the Employee Search Modal (Phase 8).
  //  An empty keyword returns up to 50 active employees (show-all).
  //
  //  Renderer payload: { keyword: string }
  //  Response data:    { EmployeeID, FullName, JobTitle }[]
  // ────────────────────────────────────────────────────────
  ipcMain.handle(
    'employee:search',
    safeHandle((payload) => {
      const keyword = (payload && typeof payload.keyword === 'string')
        ? payload.keyword
        : '';
      return searchEmployees(keyword, db);
    })
  );

  // ── employee:getById ──────────────────────────────────────────
  ipcMain.handle(
    'employee:getById',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return getEmployeeById(id, db);
    })
  );

  // ── employee:getPaginated ─────────────────────────────────────
  ipcMain.handle(
    'employee:getPaginated',
    safeHandle((payload) => {
      const { page, pageSize, search } = payload ?? {};
      return getEmployeesPaginated({ page, pageSize, search }, db);
    })
  );

  // ── employee:exportAll ────────────────────────────────────────
  ipcMain.handle(
    'employee:exportAll',
    safeHandle(async (payload) => {
      const { search } = payload ?? {};
      const now = new Date();
      const defaultFilename = `قائمة_الموظفين_${now.toISOString().slice(0, 10)}.xlsx`;

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'تصدير قائمة الموظفين إلى ملف Excel',
        defaultPath: defaultFilename,
        filters: [{ name: 'Excel Workbook (*.xlsx)', extensions: ['xlsx'] }],
      });

      if (canceled || !filePath) {
        return { canceled: true };
      }

      await exportAllEmployees({ search }, filePath, db);
      return { canceled: false, filePath };
    })
  );

  // ── employee:update ───────────────────────────────────────────
  ipcMain.handle(
    'employee:update',
    safeHandle((payload) => {
      const {
        employeeId,
        fullName,
        jobTitle,
        workLocation,
        leaveCardNumber,
        leaveApprover,
        adjustmentDays
      } = payload ?? {};
      const id = Number(employeeId);
      return updateEmployee(id, {
        fullName,
        jobTitle,
        workLocation,
        leaveCardNumber,
        leaveApprover,
        adjustmentDays
      }, db);
    })
  );

  // ── employee:deactivate ───────────────────────────────────────
  ipcMain.handle(
    'employee:deactivate',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return deactivateEmployee(id, db);
    })
  );

  // ── employee:activate ─────────────────────────────────────────
  ipcMain.handle(
    'employee:activate',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return activateEmployee(id, db);
    })
  );

  // ── employee:transfer ─────────────────────────────────────────
  ipcMain.handle(
    'employee:transfer',
    safeHandle((firstArg, secondArg) => {
      let employeeId, transferOrderNumber, transferOrderDate, transferNotes;
      if (typeof firstArg === 'object' && firstArg !== null) {
        ({ employeeId, transferOrderNumber, transferOrderDate, transferNotes } = firstArg);
      } else {
        employeeId = firstArg;
        ({ transferOrderNumber, transferOrderDate, transferNotes } = secondArg ?? {});
      }
      const id = Number(employeeId);
      return transferEmployee(id, {
        transferOrderNumber,
        transferOrderDate,
        transferNotes,
      }, db);
    })
  );

  // ── employee:cancelTransfer ───────────────────────────────────
  ipcMain.handle(
    'employee:cancelTransfer',
    safeHandle((payload) => {
      const id = Number(payload?.employeeId ?? payload);
      return cancelEmployeeTransfer(id, db);
    })
  );

  console.log('[EmployeeHandlers] Registered: employee:add, employee:search, employee:getById, employee:getPaginated, employee:exportAll, employee:update, employee:deactivate, employee:activate, employee:transfer, employee:cancelTransfer');
}

module.exports = { registerEmployeeHandlers };
