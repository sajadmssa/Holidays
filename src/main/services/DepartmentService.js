// ============================================================
//  services/DepartmentService.js  –  Department Business Logic
//  طبقة منطق الأعمال لإدارة الأقسام (Departments Business Logic)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • إدارة الأقسام الإدارية (عرض، إضافة، تعديل، حذف).
//    • التحقق الصارم من أسماء الأقسام ومنع التكرار.
//    • تطبيق سياسة الحماية الصارمة ON DELETE RESTRICT: منع حذف أي قسم
//      مرتبط بموظفين حالياً مع إظهار رسالة تنبيه واضحة تطالب بنقلهم أولاً.
//    • توثيق العمليات في سجل التدقيق AuditLog.
// ============================================================

'use strict';

const AuditService = require('./AuditService');

const MAX_NAME_LENGTH = 100;

/**
 * استرجاع جميع الأقسام مع عدد الموظفين المرتبطين بكل قسم
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{DepartmentID: number, Name: string, CreatedAt: string, EmployeeCount: number}>}
 */
function getAllDepartments(db) {
  const query = `
    SELECT 
      d.DepartmentID,
      d.Name,
      d.CreatedAt,
      (
        SELECT COUNT(*) 
        FROM Employees e 
        WHERE e.DepartmentID = d.DepartmentID 
          AND e.IsActive = 1
      ) AS EmployeeCount
    FROM Departments d
    ORDER BY d.DepartmentID ASC
  `;
  return db.prepare(query).all();
}

/**
 * استرجاع قسم محدد بواسطة المعرف
 * @param {number} id
 * @param {import('better-sqlite3').Database} db
 */
function getDepartmentById(id, db) {
  const deptId = parseInt(id, 10);
  if (!Number.isInteger(deptId) || deptId <= 0) {
    throw new Error('معرف القسم غير صالح.');
  }
  return db.prepare('SELECT * FROM Departments WHERE DepartmentID = ?').get(deptId) || null;
}

/**
 * إضافة قسم إداري جديد
 * @param {{ name: string }} data
 * @param {import('better-sqlite3').Database} db
 */
function addDepartment(data, db) {
  if (!data || typeof data.name !== 'string') {
    throw new Error('يرجى إدخال اسم القسم بشكل صحيح.');
  }

  const name = data.name.trim();
  if (name.length === 0) {
    throw new Error('اسم القسم مطلوب ولا يمكن تركه فارغاً.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`اسم القسم يجب ألا يتجاوز ${MAX_NAME_LENGTH} حرفاً.`);
  }

  // Check unique
  const existing = db.prepare('SELECT DepartmentID FROM Departments WHERE LOWER(TRIM(Name)) = LOWER(?)').get(name);
  if (existing) {
    throw new Error(`القسم "${name}" مسجل مسبقاً في النظام.`);
  }

  const stmt = db.prepare('INSERT INTO Departments (Name) VALUES (?)');
  const info = stmt.run(name);

  AuditService.logAction(db, {
    actionType: 'INSERT',
    entityType: 'Department',
    entityID: Number(info.lastInsertRowid),
    oldValue: null,
    newValue: { DepartmentID: Number(info.lastInsertRowid), Name: name },
    details: `إضافة قسم جديد: ${name}`,
  });

  return {
    DepartmentID: Number(info.lastInsertRowid),
    Name: name
  };
}

/**
 * تعديل اسم قسم إداري
 * @param {{ id: number, name: string }} data
 * @param {import('better-sqlite3').Database} db
 */
function updateDepartment(data, db) {
  if (!data) throw new Error('بيانات التعديل غير مكتملة.');

  const id = parseInt(data.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('معرف القسم غير صالح.');
  }

  if (typeof data.name !== 'string') {
    throw new Error('يرجى إدخال اسم القسم الجديد.');
  }

  const name = data.name.trim();
  if (name.length === 0) {
    throw new Error('اسم القسم لا يمكن أن يكون فارغاً.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`اسم القسم يجب ألا يتجاوز ${MAX_NAME_LENGTH} حرفاً.`);
  }

  const current = db.prepare('SELECT * FROM Departments WHERE DepartmentID = ?').get(id);
  if (!current) {
    throw new Error('القسم المطلوب تعديله غير موجود.');
  }

  // Check unique against others
  const duplicate = db.prepare(
    'SELECT DepartmentID FROM Departments WHERE LOWER(TRIM(Name)) = LOWER(?) AND DepartmentID != ?'
  ).get(name, id);
  if (duplicate) {
    throw new Error(`يوجد قسم آخر يحمل نفس الاسم "${name}".`);
  }

  db.prepare('UPDATE Departments SET Name = ? WHERE DepartmentID = ?').run(name, id);

  AuditService.logAction(db, {
    actionType: 'UPDATE',
    entityType: 'Department',
    entityID: id,
    oldValue: { Name: current.Name },
    newValue: { Name: name },
    details: `تعديل اسم القسم من "${current.Name}" إلى "${name}"`,
  });

  return { DepartmentID: id, Name: name };
}

/**
 * حذف قسم مع التحقق الصارم من سياسة الحماية (ON DELETE RESTRICT)
 * يمنع حذف أي قسم مرتبط بموظفين ويطلب نقلهم أولاً.
 * @param {number} id
 * @param {import('better-sqlite3').Database} db
 */
function deleteDepartment(id, db) {
  const deptId = parseInt(id, 10);
  if (!Number.isInteger(deptId) || deptId <= 0) {
    throw new Error('معرف القسم غير صالح.');
  }

  const current = db.prepare('SELECT * FROM Departments WHERE DepartmentID = ?').get(deptId);
  if (!current) {
    throw new Error('القسم المطلوب حذفه غير موجود.');
  }

  // Check for any linked employees (active or inactive to protect foreign key integrity)
  const linked = db.prepare('SELECT COUNT(*) as count FROM Employees WHERE DepartmentID = ?').get(deptId);
  if (linked && linked.count > 0) {
    throw new Error(
      `لا يمكن حذف هذا القسم لأنه مرتبط بـ (${linked.count}) موظف. يرجى نقل الموظفين إلى قسم آخر أولاً قبل إتمام الحذف.`
    );
  }

  db.prepare('DELETE FROM Departments WHERE DepartmentID = ?').run(deptId);

  AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'Department',
    entityID: deptId,
    oldValue: { DepartmentID: deptId, Name: current.Name },
    newValue: null,
    details: `حذف قسم: ${current.Name}`,
  });

  return { success: true, DepartmentID: deptId };
}

module.exports = {
  getAllDepartments,
  getDepartmentById,
  addDepartment,
  updateDepartment,
  deleteDepartment,
};
