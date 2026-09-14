// ============================================================
//  ipc/departmentHandlers.js  –  Department IPC Handlers
//  معالجات قنوات الاتصال الداخلي (IPC) للأقسام الإدارية
// ============================================================

'use strict';

const {
  getAllDepartments,
  addDepartment,
  updateDepartment,
  deleteDepartment,
} = require('../services/DepartmentService');
const { createSafeHandler } = require('../utils/ipcHandlerHelper');
const { safeHandleAsync: safeHandle } = createSafeHandler('DepartmentHandlers');

/**
 * تسجيل قنوات IPC الخاصة بإدارة الأقسام
 * @param {Electron.IpcMain} ipcMain
 * @param {import('better-sqlite3').Database} db
 */
function registerDepartmentHandlers(ipcMain, db) {
  // استرجاع جميع الأقسام
  ipcMain.handle(
    'department:getAll',
    safeHandle(async () => {
      return getAllDepartments(db);
    })
  );

  // إضافة قسم جديد
  ipcMain.handle(
    'department:add',
    safeHandle(async (data) => {
      return addDepartment(data, db);
    })
  );

  // تعديل اسم قسم
  ipcMain.handle(
    'department:update',
    safeHandle(async (data, nameArg) => {
      if (nameArg !== undefined && typeof data !== 'object') {
        return updateDepartment({ id: data, name: nameArg }, db);
      }
      return updateDepartment(data, db);
    })
  );

  // حذف قسم مع الحماية الصارمة
  ipcMain.handle(
    'department:delete',
    safeHandle(async (id) => {
      return deleteDepartment(id, db);
    })
  );
}

module.exports = { registerDepartmentHandlers };
