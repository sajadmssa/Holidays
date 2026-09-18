// ============================================================
//  services/LeaveTypeService.js  –  Leave Types Business Logic
//  طبقة منطق الأعمال لإدارة أنواع الإجازات (Leave Types Business Logic)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • إدارة أنواع الإجازات (عرض، إضافة، تعديل، حذف).
//    • التحقق الصارم من أسماء الأنواع ومنع التكرار.
//    • الحماية الصارمة للأنواع الأساسية ("إجازة اعتيادية" و"إجازة مرضية"):
//      منع إعادة تسميتها أو حذفها برمجياً لحماية محركات الحساب والتقارير.
//    • معالجة قيد الحذف المقيد (ON DELETE RESTRICT): التقاط أي رفض من قاعدة
//      البيانات وتحويله لرسالة عربية واضحة للمستخدم.
//    • توثيق العمليات في سجل التدقيق AuditLog.
// ============================================================

'use strict';

const AuditService = require('./AuditService');

const MAX_NAME_LENGTH = 100;

/**
 * الأنواع الأساسية المحمية من التعديل والحذف بارتباطها بمنطق الحساب الحرفي
 */
const PROTECTED_LEAVE_TYPES = new Set(['إجازة اعتيادية', 'إجازة مرضية']);

/**
 * استرجاع جميع أنواع الإجازات مع عدد مرات استخدام كل نوع في سجلات الإجازات
 * @param {import('better-sqlite3').Database} db
 * @returns {Array<{LeaveTypeID: number, Name: string, MaxDaysPerInstance: number, RequiresOrderRef: number, GenderRestriction: string|null, UsageCount: number, IsProtected: boolean}>}
 */
function getAllLeaveTypes(db) {
  const query = `
    SELECT 
      lt.LeaveTypeID,
      lt.Name,
      lt.MaxDaysPerInstance,
      lt.RequiresOrderRef,
      lt.GenderRestriction,
      (
        SELECT COUNT(*) 
        FROM Leaves l 
        WHERE l.LeaveTypeID = lt.LeaveTypeID
      ) AS UsageCount
    FROM LeaveTypes lt
    ORDER BY lt.LeaveTypeID ASC
  `;
  const rows = db.prepare(query).all();
  return rows.map(r => ({
    ...r,
    IsProtected: PROTECTED_LEAVE_TYPES.has(r.Name)
  }));
}

/**
 * استرجاع نوع إجازة محدد بواسطة المعرف
 * @param {number} id
 * @param {import('better-sqlite3').Database} db
 */
function getLeaveTypeById(id, db) {
  const typeId = parseInt(id, 10);
  if (!Number.isInteger(typeId) || typeId <= 0) {
    throw new Error('معرف نوع الإجازة غير صالح.');
  }
  const row = db.prepare('SELECT * FROM LeaveTypes WHERE LeaveTypeID = ?').get(typeId);
  if (!row) return null;
  return {
    ...row,
    IsProtected: PROTECTED_LEAVE_TYPES.has(row.Name)
  };
}

/**
 * إضافة نوع إجازة جديد
 * @param {{ name: string, maxDaysPerInstance?: number, requiresOrderRef?: number, genderRestriction?: string|null } | string} data
 * @param {import('better-sqlite3').Database} db
 */
function addLeaveType(data, db) {
  const rawName = typeof data === 'string'
    ? data
    : (data && typeof data.name === 'string' ? data.name : '');

  const name = (rawName || '').trim();
  if (name.length === 0) {
    throw new Error('اسم نوع الإجازة مطلوب ولا يمكن تركه فارغاً.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`اسم نوع الإجازة يجب ألا يتجاوز ${MAX_NAME_LENGTH} حرفاً.`);
  }

  // Check unique
  const existing = db.prepare('SELECT LeaveTypeID FROM LeaveTypes WHERE LOWER(TRIM(Name)) = LOWER(?)').get(name);
  if (existing) {
    throw new Error(`نوع الإجازة "${name}" مسجل مسبقاً في النظام.`);
  }

  const maxDays = (typeof data === 'object' && Number.isInteger(data.maxDaysPerInstance) && data.maxDaysPerInstance > 0 && data.maxDaysPerInstance <= 730)
    ? data.maxDaysPerInstance
    : 365;

  const requiresOrderRef = (typeof data === 'object' && (data.requiresOrderRef === 1 || data.requiresOrderRef === true))
    ? 1
    : 0;

  const genderRestriction = (typeof data === 'object' && data.genderRestriction === 'Female')
    ? 'Female'
    : null;

  const stmt = db.prepare(`
    INSERT INTO LeaveTypes (Name, MaxDaysPerInstance, RequiresOrderRef, GenderRestriction)
    VALUES (?, ?, ?, ?)
  `);
  const info = stmt.run(name, maxDays, requiresOrderRef, genderRestriction);
  const newId = Number(info.lastInsertRowid);

  AuditService.logAction(db, {
    actionType: 'INSERT',
    entityType: 'LeaveType',
    entityID: newId,
    oldValue: null,
    newValue: {
      LeaveTypeID: newId,
      Name: name,
      MaxDaysPerInstance: maxDays,
      RequiresOrderRef: requiresOrderRef,
      GenderRestriction: genderRestriction
    },
    details: `إضافة نوع إجازة جديد: ${name}`,
  });

  return {
    LeaveTypeID: newId,
    Name: name,
    MaxDaysPerInstance: maxDays,
    RequiresOrderRef: requiresOrderRef,
    GenderRestriction: genderRestriction,
    IsProtected: false
  };
}

/**
 * تعديل اسم نوع إجازة
 * @param {{ id: number, name: string } | number} data
 * @param {import('better-sqlite3').Database | string} dbOrName
 * @param {import('better-sqlite3').Database} [maybeDb]
 */
function updateLeaveType(data, dbOrName, maybeDb) {
  let id = null;
  let rawName = '';
  let db = null;

  if (data && typeof data === 'object') {
    id = parseInt(data.id, 10);
    rawName = typeof data.name === 'string' ? data.name : '';
    db = dbOrName;
  } else {
    id = parseInt(data, 10);
    rawName = typeof dbOrName === 'string' ? dbOrName : '';
    db = maybeDb;
  }

  if (!id || !Number.isInteger(id) || id <= 0) {
    throw new Error('معرف نوع الإجازة غير صالح.');
  }

  if (!rawName || typeof rawName !== 'string') {
    throw new Error('يرجى إدخال اسم نوع الإجازة الجديد.');
  }

  const name = rawName.trim();
  if (name.length === 0) {
    throw new Error('اسم نوع الإجازة لا يمكن أن يكون فارغاً.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`اسم نوع الإجازة يجب ألا يتجاوز ${MAX_NAME_LENGTH} حرفاً.`);
  }

  const current = db.prepare('SELECT * FROM LeaveTypes WHERE LeaveTypeID = ?').get(id);
  if (!current) {
    throw new Error('نوع الإجازة المطلوب تعديله غير موجود.');
  }

  // ── Protection Guard: Prevent renaming core protected types ─
  if (PROTECTED_LEAVE_TYPES.has(current.Name)) {
    throw new Error(`لا يمكن تعديل اسم هذا النوع من الإجازات ("${current.Name}") لأنه نوع أساسي محمي مرتبط بمنظومة حسابات النظام.`);
  }

  // Check unique against others
  const duplicate = db.prepare(
    'SELECT LeaveTypeID FROM LeaveTypes WHERE LOWER(TRIM(Name)) = LOWER(?) AND LeaveTypeID != ?'
  ).get(name, id);
  if (duplicate) {
    throw new Error(`يوجد نوع إجازة آخر يحمل نفس الاسم "${name}".`);
  }

  db.prepare('UPDATE LeaveTypes SET Name = ? WHERE LeaveTypeID = ?').run(name, id);

  AuditService.logAction(db, {
    actionType: 'UPDATE',
    entityType: 'LeaveType',
    entityID: id,
    oldValue: { Name: current.Name },
    newValue: { Name: name },
    details: `تعديل اسم نوع الإجازة من "${current.Name}" إلى "${name}"`,
  });

  return {
    ...current,
    LeaveTypeID: id,
    Name: name,
    IsProtected: false
  };
}

/**
 * حذف نوع إجازة مع التحقق الصارم من الحماية وسياسة الحذف المقيد (ON DELETE RESTRICT)
 * @param {number} id
 * @param {import('better-sqlite3').Database} db
 */
function deleteLeaveType(id, db) {
  const typeId = parseInt(id, 10);
  if (!Number.isInteger(typeId) || typeId <= 0) {
    throw new Error('معرف نوع الإجازة غير صالح.');
  }

  const current = db.prepare('SELECT * FROM LeaveTypes WHERE LeaveTypeID = ?').get(typeId);
  if (!current) {
    throw new Error('نوع الإجازة المطلوب حذفه غير موجود.');
  }

  // ── Protection Guard: Prevent deleting core protected types ─
  if (PROTECTED_LEAVE_TYPES.has(current.Name)) {
    throw new Error(`لا يمكن حذف هذا النوع من الإجازات ("${current.Name}") لأنه نوع أساسي محمي مرتبط بمنظومة حسابات النظام.`);
  }

  // ── Usage check & RESTRICT protection ────────────────────────
  const usage = db.prepare('SELECT COUNT(*) as count FROM Leaves WHERE LeaveTypeID = ?').get(typeId);
  if (usage && usage.count > 0) {
    throw new Error(
      `لا يمكن حذف هذا النوع لأنه مستخدم بسجلات إجازات موجودة (${usage.count} سجل).`
    );
  }

  try {
    db.prepare('DELETE FROM LeaveTypes WHERE LeaveTypeID = ?').run(typeId);
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT' || String(err.message).includes('FOREIGN KEY constraint failed'))) {
      throw new Error(`لا يمكن حذف هذا النوع لأنه مستخدم بسجلات إجازات موجودة.`);
    }
    throw err;
  }

  AuditService.logAction(db, {
    actionType: 'DELETE',
    entityType: 'LeaveType',
    entityID: typeId,
    oldValue: { LeaveTypeID: typeId, Name: current.Name },
    newValue: null,
    details: `حذف نوع إجازة: ${current.Name}`,
  });

  return { success: true, LeaveTypeID: typeId };
}

module.exports = {
  PROTECTED_LEAVE_TYPES,
  getAllLeaveTypes,
  getLeaveTypeById,
  addLeaveType,
  updateLeaveType,
  deleteLeaveType,
};
