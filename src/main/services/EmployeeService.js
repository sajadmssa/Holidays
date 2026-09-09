// ============================================================
//  services/EmployeeService.js  –  Employee Business Logic
//  طبقة منطق الأعمال للموظفين (Business Logic Layer)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • إضافة موظف جديد مع التحقق الصارم من الحقول والرقم الوظيفي الفريد.
//    • تهيئة أرصدة الإجازات المرضية الافتراضية تلقائياً عند إنشاء الموظف.
//    • البحث الفوري عن الموظفين بالاسم أو رقم الكرت أو الرقم الوظيفي.
//    • استرجاع بيانات الموظف مع حساب رصيد الإجازات الاعتيادية والمرضية آنياً.
//    • تحديث بيانات الموظف مع حماية تاريخ التعيين والجنس لمنع تشويه السجلات التراكمية.
//    • التجميد والتفعيل الآمن (Soft Delete) للموظف دون كسر القيود المرجعية.
//    • إدارة النقل الخارجي وإلغاء النقل مع الحفاظ على بقاء الموظف نشطاً.
//    • الاستعلام الموزع للصفحات (Server-side Pagination) بكفاءة عالية ومنع مشاكل N+1.
//
//  CONTRACT / ميثاق الخدمة:
//    • Receives a plain `db` (better-sqlite3 instance) as last arg.
//      (تستقبل كائن الاتصال بقاعدة البيانات `db` كوسيط أخير).
//    • Throws a descriptive Error on any validation failure so the
//      IPC handler's safeHandle wrapper surfaces it cleanly.
//      (ترمي استثناءً صريحاً ومفصلاً عند أي خطأ في التحقق ليتولى غلاف safeHandle تحويله لرسالة مفهومة للمستخدم).
//    • All SQL is parameterised — zero string concatenation (SQL-Injection Safe).
//      (كافة الاستعلامات تعتمد وسائط مجهولة ? بالكامل وتمنع دمج النصوص منعاً قاطعاً لحماية النظام من ثغرات الحقن).
// ============================================================

'use strict';

const AuditService = require('./AuditService');
const { validateOrderNumber } = require('../utils/orderNumberValidator');

// ──────────────────────────────────────────────────────────────
//  Field constraints  (kept here so they stay in sync with the
//  DB CHECK constraints in 001_initial_schema.sql)
//  قيود الحقول وحدود الأطوال:
//  متطابقة تماماً مع قيود CHECK في مخطط قاعدة البيانات لضمان عدم حدوث تعارض.
// ──────────────────────────────────────────────────────────────
const VALID_GENDERS   = new Set(['Male', 'Female']);
const MAX_NAME_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_LOCATION_LENGTH = 200;
const MAX_CARD_LENGTH = 100;
const MAX_APPROVER_LENGTH = 200;

/**
 * فحص صارم لصحة تاريخ ISO-8601:
 * يتحقق من البنية الشكلية (YYYY-MM-DD) والصحة التقويمية الفعلية
 * (مثال: يرفض تواريخ غير حقيقية مثل 30 فبراير '2024-02-30').
 *
 * Strict ISO-8601 date: structure + calendrical reality check (rejects '2024-02-30').
 * @param {string} s
 * @returns {boolean}
 */
function isValidIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(s)) {
    return false;
  }
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

// ══════════════════════════════════════════════════════════════
//  addEmployee
//
//  التحقق من صحة البيانات وإدراج موظف جديد:
//  1. التأكد من هيكل البيانات والرقم الوظيفي وعدم تكراره.
//  2. التحقق من الاسم، الجنس، وتاريخ التعيين الواقعي (ليس بالمستقبل ولا قبل 1900).
//  3. التحقق من المسمى الوظيفي وموقع العمل ورقم كرت الإجازة واسم المسؤول.
//  4. تنفيذ العملية في حركة ذرية (db.transaction) لضمان:
//     - إدخال سجل الموظف في جدول Employees.
//     - تهيئة أرصدة الإجازة المرضية الافتراضية (28 يوماً براتب كامل 100% و 45 يوماً بنصف راتب 50%).
//     - توثيق العملية في سجل التدقيق والأمان AuditLog.
//
//  Validates and inserts a new employee record.
//
//  @param {{
//    employeeId:       number,
//    fullName:         string,
//    gender:          'Male' | 'Female',
//    hireDate:         string,   // YYYY-MM-DD
//    jobTitle:         string,
//    workLocation?:    string,
//    leaveCardNumber?: string,
//    leaveApprover?:   string
//  }} employeeData
//  @param {import('better-sqlite3').Database} db
//  @returns {number}  The new EmployeeID (lastInsertRowid)
// ══════════════════════════════════════════════════════════════
function addEmployee(employeeData, db) {

  // ── Step 1: Structural guard / التحقق الهيكلي من الكائن ───────
  if (!employeeData || typeof employeeData !== 'object') {
    throw new Error('بيانات الموظف غير صالحة أو غير مكتملة.');
  }

  const {
    employeeId,
    fullName,
    gender,
    hireDate,
    jobTitle,
    workLocation,
    leaveCardNumber,
    leaveApprover,
  } = employeeData;

  // ── Step 1b: EmployeeID Validation / التحقق من الرقم الوظيفي ───
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي مطلوب ويجب أن يكون رقماً صحيحاً موجباً.');
  }

  // Check for duplicate EmployeeID / التحقق من عدم تكرار الرقم الوظيفي في النظام
  const existing = db
    .prepare('SELECT EmployeeID FROM Employees WHERE EmployeeID = ?')
    .get(employeeId);
  if (existing) {
    throw new Error(`الرقم الوظيفي (${employeeId}) مسجل مسبقاً لموظف آخر في النظام.`);
  }

  // ── Step 2: FullName / التحقق من الاسم الكامل ─────────────────
  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    throw new Error('يرجى إدخال الاسم الكامل للموظف.');
  }
  if (fullName.trim().length > MAX_NAME_LENGTH) {
    throw new Error(
      `اسم الموظف طويل جداً (الحد الأقصى المسموح به ${MAX_NAME_LENGTH} حرف).`
    );
  }

  // ── Step 3: Gender / التحقق من نوع الجنس ───────────────────────
  if (!VALID_GENDERS.has(gender)) {
    throw new Error('يرجى اختيار جنس الموظف (ذكر / أنثى).');
  }

  // ── Step 4: HireDate / التحقق من تاريخ التعيين ─────────────────
  if (!isValidIsoDate(hireDate)) {
    throw new Error('يرجى تحديد تاريخ تعيين صالح للموظف بصيغة (YYYY-MM-DD).');
  }

  // Sensible bounds: not before 1900, not in the future / قيود منطقية: بعد عام 1900 وليس في المستقبل
  const hireDateObj = new Date(hireDate);
  const today       = new Date();
  today.setHours(23, 59, 59, 999); // allow today as a valid hire date
  if (hireDateObj.getFullYear() < 1900) {
    throw new Error('تاريخ التعيين قديم جداً (يجب أن يكون بعد عام 1900).');
  }
  if (hireDateObj > today) {
    throw new Error('لا يمكن أن يكون تاريخ التعيين في المستقبل.');
  }

  // ── Step 5: JobTitle / التحقق من المسمى الوظيفي ───────────────
  if (typeof jobTitle !== 'string' || jobTitle.trim().length === 0) {
    throw new Error('يرجى إدخال المسمى الوظيفي للموظف.');
  }
  if (jobTitle.trim().length > MAX_TITLE_LENGTH) {
    throw new Error(
      `المسمى الوظيفي طويل جداً (الحد الأقصى المسموح به ${MAX_TITLE_LENGTH} حرف).`
    );
  }

  // ── Step 5b: New Fields Validation / التحقق من الحقول الإضافية ─
  const cleanLocation = typeof workLocation === 'string' && workLocation.trim().length > 0
    ? workLocation.trim()
    : null;
  if (cleanLocation && cleanLocation.length > MAX_LOCATION_LENGTH) {
    throw new Error(`موقع العمل طويل جداً (الحد الأقصى المسموح به ${MAX_LOCATION_LENGTH} حرف).`);
  }

  const cleanCardNumber = typeof leaveCardNumber === 'string' && leaveCardNumber.trim().length > 0
    ? leaveCardNumber.trim()
    : (typeof leaveCardNumber === 'number' ? String(leaveCardNumber).trim() : null);
  if (cleanCardNumber) {
    if (cleanCardNumber.length > MAX_CARD_LENGTH) {
      throw new Error(`رقم كرت الإجازة طويل جداً (الحد الأقصى المسموح به ${MAX_CARD_LENGTH} حرف).`);
    }
    // Enforce uniqueness / منع تكرار رقم كرت الإجازة مع موظف آخر
    const existingCard = db
      .prepare('SELECT EmployeeID FROM Employees WHERE LeaveCardNumber = ?')
      .get(cleanCardNumber);
    if (existingCard) {
      throw new Error(`رقم كرت الإجازة (${cleanCardNumber}) مسجل مسبقاً للموظف رقم (${existingCard.EmployeeID}).`);
    }
  }

  const cleanApprover = typeof leaveApprover === 'string' && leaveApprover.trim().length > 0
    ? leaveApprover.trim()
    : null;
  if (cleanApprover && cleanApprover.length > MAX_APPROVER_LENGTH) {
    throw new Error(`اسم المسؤول عن منح الإجازة طويل جداً (الحد الأقصى المسموح به ${MAX_APPROVER_LENGTH} حرف).`);
  }

  // ── Step 6: Atomic Transaction (Insert Employee + Default Balances + Audit Log) ──
  // المعاملة الذرية المركبة: تضمن أن إدراج الموظف وتهيئة أرصدته وتوثيق التدقيق تتم كوحدة واحدة غير قابلة للتجزئة
  return db.transaction(() => {
    const info = db
      .prepare(`
        INSERT INTO Employees (EmployeeID, FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `)
      .run(
        employeeId,
        fullName.trim(),
        gender,
        hireDate,
        jobTitle.trim(),
        cleanLocation,
        cleanCardNumber,
        cleanApprover
      );

    // Automatically initialize default Sick Leave balance buckets for new employee
    // التهيئة التلقائية لأرصدة الإجازة المرضية الافتراضية (28 يوماً براتب كامل و 45 يوماً بنصف راتب)
    const sickLeaveType = db
      .prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية'")
      .get();

    if (sickLeaveType) {
      const initBalance = db.prepare(`
        INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
        VALUES (?, ?, ?, ?)
      `);
      initBalance.run(employeeId, sickLeaveType.LeaveTypeID, 28, 100);
      initBalance.run(employeeId, sickLeaveType.LeaveTypeID, 45, 50);
    }

    // Record Audit Log / توثيق إضافة الموظف الجديد في سجل الأمان والتدقيق
    AuditService.logAction(db, {
      actionType: 'INSERT',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: null,
      newValue: {
        EmployeeID: employeeId,
        FullName: fullName.trim(),
        Gender: gender,
        HireDate: hireDate,
        JobTitle: jobTitle.trim(),
        WorkLocation: cleanLocation,
        LeaveCardNumber: cleanCardNumber,
        LeaveApprover: cleanApprover,
      },
      details: `إضافة موظف جديد: ${fullName.trim()} (الرقم الوظيفي: ${employeeId})`,
    });

    return Number(info.lastInsertRowid);
  })();
}

// ══════════════════════════════════════════════════════════════
//  searchEmployees
//
//  البحث الفوري عن الموظفين النشطين للنافذة المنبثقة (Lookup Modal):
//  - يبحث في الاسم الكامل، رقم كرت الإجازة، أو الرقم الوظيفي.
//  - الاستعلام محمي بالكامل عبر Parameterised LIKE لتفادي SQL Injection.
//  - يقتصر على الموظفين النشطين (IsActive = 1) ويُرجع بحد أقصى 50 نتيجة مرتبة هجائياً.
//
//  Live name & leave card number search used by the Lookup Modal.
//  Returns up to 50 active employees whose FullName, LeaveCardNumber,
//  or EmployeeID contains the keyword (case-insensitive).
//
//  @param {string} keyword  – raw text typed by the user / نص البحث المدخل من المستخدم
//  @param {import('better-sqlite3').Database} db
//  @returns {{ EmployeeID: number, FullName: string, JobTitle: string, WorkLocation: string|null, LeaveCardNumber: string|null, LeaveApprover: string|null }[]}
// ══════════════════════════════════════════════════════════════
function searchEmployees(keyword, db) {
  if (typeof keyword !== 'string') {
    throw new Error('كلمة البحث يجب أن تكون نصاً.');
  }
  // Parameterised LIKE — the % wildcards are safe because they are
  // concatenated in JS before binding, NOT inside the SQL string.
  // الربط يتم عبر الوسائط المجهزة في المحرك لحماية الاستعلام
  const pattern = `%${keyword.trim()}%`;

  return db
    .prepare(`
      SELECT EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsTransferred, TransferOrderNumber
      FROM   Employees
      WHERE  (
               FullName LIKE ?
               OR LeaveCardNumber LIKE ?
               OR CAST(EmployeeID AS TEXT) LIKE ?
             )
        AND  IsActive = 1
      ORDER  BY FullName ASC
      LIMIT  50
    `)
    .all(pattern, pattern, pattern);
}

const { calculateRegularLeaveBalance } = require('./LeaveService');

// ══════════════════════════════════════════════════════════════
//  getEmployeeById
//
//  استرجاع بيانات موظف محدد بالرقم الوظيفي مع احتساب الأرصدة الحالية:
//  - يجلب السجل الأساسي من جدول Employees.
//  - يستدعي محرك احتساب رصيد الإجازة الاعتيادية بدقة (المستحق الكلي، المستهلك، والمتبقي الصافي).
//  - يتحقق من وجود أرصدة الإجازة المرضية (100% و 50%) وينشئها تلقائياً إذا كانت مفقودة.
//
//  Fetches a single employee record by EmployeeID and attaches
//  current Regular and Sick Leave balance metrics.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {Employee & { balances: { regular: number, sick100: number, sick50: number } }}
// ══════════════════════════════════════════════════════════════
function getEmployeeById(employeeId, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  const employee = db
    .prepare('SELECT * FROM Employees WHERE EmployeeID = ?')
    .get(employeeId);

  if (!employee) {
    throw new Error(`تعذر العثور على الموظف صاحب الرقم (${employeeId}).`);
  }

  // Calculate Regular Leave balance metrics / احتساب مقاييس رصيد الإجازة الاعتيادية بدقة
  let regularBalance = 0;
  let unadjustedRegular = 0;
  let grossEarnedBalance = 0;
  let regularLeavesTaken = 0;
  try {
    const regRes = calculateRegularLeaveBalance(employeeId, db);
    regularBalance = regRes.finalBalance;
    grossEarnedBalance = regRes.grossEarnedBalance;
    regularLeavesTaken = regRes.regularLeavesTaken;
    unadjustedRegular = regRes.grossEarnedBalance - regRes.regularLeavesTaken;
  } catch (_e) {
    regularBalance = 0;
  }

  // Fetch Sick Leave balances (ensure default rows exist) / جلب أرصدة الإجازة المرضية والتأكد من وجودها
  let sick100 = 0;
  let sick50  = 0;
  const sickType = db
    .prepare("SELECT LeaveTypeID FROM LeaveTypes WHERE Name = 'إجازة مرضية'")
    .get();

  if (sickType) {
    db.prepare(`
      INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
      VALUES (?, ?, 28, 100), (?, ?, 45, 50)
    `).run(employeeId, sickType.LeaveTypeID, employeeId, sickType.LeaveTypeID);

    const rows = db
      .prepare('SELECT PayPercentage, TotalBalance FROM LeaveBalances WHERE EmployeeID = ? AND LeaveTypeID = ?')
      .all(employeeId, sickType.LeaveTypeID);

    for (const r of rows) {
      if (r.PayPercentage === 100) sick100 = r.TotalBalance;
      if (r.PayPercentage === 50)  sick50  = r.TotalBalance;
    }
  }

  return {
    ...employee,
    balances: {
      regular: regularBalance,
      unadjustedRegular,
      grossEarnedBalance,
      regularLeavesTaken,
      sick100,
      sick50,
    },
  };
}

// ══════════════════════════════════════════════════════════════
//  updateEmployee
//
//  تحديث بيانات الموظف القائم:
//  - يقوم بتحديث الاسم، المسمى، موقع العمل، رقم الكرت، المسؤول، وأيام التسوية.
//  - قرار معماري هام: يتم استثناء الجنس (Gender) وتاريخ التعيين (HireDate) عمداً
//    من التعديل المباشر لحماية القواعد المحاسبية والتراكمية لرصيد الإجازات السابقة.
//  - يتحقق من عدم تكرار رقم كرت الإجازة مع أي موظف آخر في النظام.
//  - تُنفذ العملية في حركة ذرية (db.transaction) لضمان اتساق التحديث مع سجل التدقيق AuditLog.
//
//  Updates FullName, JobTitle, WorkLocation, LeaveCardNumber,
//  LeaveApprover, and AdjustmentDays for an existing employee.
//  Gender and HireDate are intentionally preserved to prevent
//  corrupting historical leave accounting rules.
//
//  @param {number} employeeId
//  @param {{
//    fullName: string,
//    jobTitle: string,
//    workLocation?: string,
//    leaveCardNumber?: string,
//    leaveApprover?: string,
//    adjustmentDays?: number
//  }} updateData
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, changes: number }}
// ══════════════════════════════════════════════════════════════
function updateEmployee(employeeId, updateData, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }
  if (!updateData || typeof updateData !== 'object') {
    throw new Error('بيانات التحديث غير صالحة أو غير مكتملة.');
  }

  const {
    fullName,
    jobTitle,
    workLocation,
    leaveCardNumber,
    leaveApprover,
    adjustmentDays
  } = updateData;

  if (typeof fullName !== 'string' || fullName.trim().length === 0) {
    throw new Error('يرجى إدخال الاسم الكامل للموظف.');
  }
  if (fullName.trim().length > MAX_NAME_LENGTH) {
    throw new Error(
      `اسم الموظف طويل جداً (الحد الأقصى المسموح به ${MAX_NAME_LENGTH} حرف).`
    );
  }

  if (typeof jobTitle !== 'string' || jobTitle.trim().length === 0) {
    throw new Error('يرجى إدخال المسمى الوظيفي للموظف.');
  }
  if (jobTitle.trim().length > MAX_TITLE_LENGTH) {
    throw new Error(
      `المسمى الوظيفي طويل جداً (الحد الأقصى المسموح به ${MAX_TITLE_LENGTH} حرف).`
    );
  }

  const cleanLocation = typeof workLocation === 'string' && workLocation.trim().length > 0
    ? workLocation.trim()
    : null;
  if (cleanLocation && cleanLocation.length > MAX_LOCATION_LENGTH) {
    throw new Error(`موقع العمل طويل جداً (الحد الأقصى المسموح به ${MAX_LOCATION_LENGTH} حرف).`);
  }

  const cleanCardNumber = typeof leaveCardNumber === 'string' && leaveCardNumber.trim().length > 0
    ? leaveCardNumber.trim()
    : (typeof leaveCardNumber === 'number' ? String(leaveCardNumber).trim() : null);
  if (cleanCardNumber) {
    if (cleanCardNumber.length > MAX_CARD_LENGTH) {
      throw new Error(`رقم كرت الإجازة طويل جداً (الحد الأقصى المسموح به ${MAX_CARD_LENGTH} حرف).`);
    }
    // Enforce uniqueness against other employees / التحقق من تفرد رقم الكرت واستثناء الموظف نفسه
    const existingCard = db
      .prepare('SELECT EmployeeID FROM Employees WHERE LeaveCardNumber = ? AND EmployeeID != ?')
      .get(cleanCardNumber, employeeId);
    if (existingCard) {
      throw new Error(`رقم كرت الإجازة (${cleanCardNumber}) مسجل مسبقاً للموظف رقم (${existingCard.EmployeeID}).`);
    }
  }

  const cleanApprover = typeof leaveApprover === 'string' && leaveApprover.trim().length > 0
    ? leaveApprover.trim()
    : null;
  if (cleanApprover && cleanApprover.length > MAX_APPROVER_LENGTH) {
    throw new Error(`اسم المسؤول عن منح الإجازة طويل جداً (الحد الأقصى المسموح به ${MAX_APPROVER_LENGTH} حرف).`);
  }

  return db.transaction(() => {
    const oldEmployee = db
      .prepare('SELECT * FROM Employees WHERE EmployeeID = ?')
      .get(employeeId);

    const result = db
      .prepare(`
        UPDATE Employees
        SET FullName        = ?,
            JobTitle        = ?,
            WorkLocation    = ?,
            LeaveCardNumber = ?,
            LeaveApprover   = ?,
            AdjustmentDays  = COALESCE(?, AdjustmentDays)
        WHERE EmployeeID = ?
      `)
      .run(
        fullName.trim(),
        jobTitle.trim(),
        cleanLocation,
        cleanCardNumber,
        cleanApprover,
        adjustmentDays,
        employeeId
      );

    if (result.changes === 0) {
      throw new Error(`تعذر تحديث بيانات الموظف برقم (${employeeId}).`);
    }

    const newEmployee = db
      .prepare('SELECT * FROM Employees WHERE EmployeeID = ?')
      .get(employeeId);

    AuditService.logAction(db, {
      actionType: 'UPDATE',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: oldEmployee,
      newValue: newEmployee,
      details: `تعديل بيانات الموظف: ${fullName.trim()} (الرقم الوظيفي: ${employeeId})`,
    });

    return { success: true, changes: result.changes };
  })();
}

// ══════════════════════════════════════════════════════════════
//  deactivateEmployee
//
//  تعطيل / تجميد حساب الموظف (Soft-Delete):
//  - يقوم بتعيين IsActive = 0 بدلاً من الحذف الفيزيائي.
//  - يحافظ على السجلات التاريخية والقيود المرجعية لجميع الإجازات والمستندات.
//  - ينفذ المعاملة مع توثيق تغيير الحالة في سجل التدقيق داخل db.transaction ذري.
//
//  Soft-deletes an employee by setting IsActive = 0.
//  Preserves historical rows and foreign keys.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, changes: number }}
// ══════════════════════════════════════════════════════════════
function deactivateEmployee(employeeId, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  return db.transaction(() => {
    const emp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(employeeId);

    const result = db
      .prepare('UPDATE Employees SET IsActive = 0 WHERE EmployeeID = ?')
      .run(employeeId);

    if (result.changes === 0) {
      throw new Error(`تعذر تعطيل حساب الموظف برقم (${employeeId}).`);
    }

    AuditService.logAction(db, {
      actionType: 'STATUS_CHANGE',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: { IsActive: 1 },
      newValue: { IsActive: 0 },
      details: `تجميد / تعطيل حساب الموظف: ${emp?.FullName || employeeId} (الرقم: ${employeeId})`,
    });

    return { success: true, changes: result.changes };
  })();
}

// ══════════════════════════════════════════════════════════════
//  activateEmployee
//
//  إعادة تنشيط حساب موظف مجمد مسبقاً:
//  - يعيد تعيين IsActive = 1 ليظهر مجدداً في استعلامات البحث وقوائم النظام النشطة.
//  - يوثق العملية في سجل التدقيق والأمان داخل معاملة ذرية.
//
//  Reactivates a deactivated employee by setting IsActive = 1.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, changes: number }}
// ══════════════════════════════════════════════════════════════
function activateEmployee(employeeId, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  return db.transaction(() => {
    const emp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(employeeId);

    const result = db
      .prepare('UPDATE Employees SET IsActive = 1 WHERE EmployeeID = ?')
      .run(employeeId);

    if (result.changes === 0) {
      throw new Error(`تعذر إعادة تفعيل حساب الموظف برقم (${employeeId}).`);
    }

    AuditService.logAction(db, {
      actionType: 'STATUS_CHANGE',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: { IsActive: 0 },
      newValue: { IsActive: 1 },
      details: `إعادة تنشيط حساب الموظف: ${emp?.FullName || employeeId} (الرقم: ${employeeId})`,
    });

    return { success: true, changes: result.changes };
  })();
}

// ══════════════════════════════════════════════════════════════
//  transferEmployee
//
//  تسجيل النقل الخارجي لموظف:
//  - قرار معماري جوهري: الموظف المنقول يظل نشطاً بالكامل (IsActive = 1)
//    حتى يتمكن مسؤولو الموارد البشرية من استعراض بطاقته وسجلاته السابقة.
//  - يتم التحقق من رقم الأمر الإداري وتاريخ الأمر والملاحظات.
//  - تُنفذ العملية وتُسجل في سجل التدقيق داخل db.transaction ذري لحماية البيانات عند انقطاع الطاقة.
//
//  Records external transfer for an employee.
//  CRITICAL: Employee remains active (IsActive remains 1).
//
//  @param {number} employeeId
//  @param {{
//    transferOrderNumber?: string|null,
//    transferOrderDate?: string|null,
//    transferNotes?: string|null
//  }} transferData
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, changes: number }}
// ══════════════════════════════════════════════════════════════
function transferEmployee(employeeId, transferData, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  const emp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(employeeId);
  if (!emp) {
    throw new Error(`تعذر العثور على الموظف صاحب الرقم (${employeeId}).`);
  }

  const {
    transferOrderNumber = null,
    transferOrderDate = null,
    transferNotes = null,
  } = transferData || {};

  // 1. Validate transferOrderNumber (optional, purely numeric) / التحقق من رقم أمر النقل (أرقام فقط)
  const validOrderNumber = validateOrderNumber(transferOrderNumber, 'رقم الأمر الإداري الخاص بالنقل');

  // 2. Validate transferOrderDate (optional, valid ISO date YYYY-MM-DD) / التحقق من تاريخ أمر النقل
  let validOrderDate = null;
  if (transferOrderDate !== null && transferOrderDate !== undefined) {
    const trimmedDate = String(transferOrderDate).trim();
    if (trimmedDate !== '') {
      if (!isValidIsoDate(trimmedDate)) {
        throw new Error('تاريخ أمر النقل الإداري غير صالح. يرجى إدخال تاريخ حقيقي بصيغة YYYY-MM-DD.');
      }
      validOrderDate = trimmedDate;
    }
  }

  // 3. Validate transferNotes (optional, max length 500) / التحقق من ملاحظات النقل (الحد الأقصى 500 حرف)
  let validNotes = null;
  if (transferNotes !== null && transferNotes !== undefined) {
    const trimmedNotes = String(transferNotes).trim();
    if (trimmedNotes !== '') {
      if (trimmedNotes.length > 500) {
        throw new Error('ملاحظات النقل طويلة جداً (الحد الأقصى 500 حرف).');
      }
      validNotes = trimmedNotes;
    }
  }

  return db.transaction(() => {
    const result = db
      .prepare(`
        UPDATE Employees
        SET IsTransferred       = 1,
            TransferOrderNumber = ?,
            TransferOrderDate   = ?,
            TransferNotes       = ?
        WHERE EmployeeID = ?
      `)
      .run(validOrderNumber, validOrderDate, validNotes, employeeId);

    if (result.changes === 0) {
      throw new Error(`تعذر تسجيل النقل الخارجي للموظف برقم (${employeeId}).`);
    }

    AuditService.logAction(db, {
      actionType: 'TRANSFER',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: {
        IsTransferred: emp.IsTransferred || 0,
        TransferOrderNumber: emp.TransferOrderNumber || null,
        TransferOrderDate: emp.TransferOrderDate || null,
        TransferNotes: emp.TransferNotes || null,
      },
      newValue: {
        IsTransferred: 1,
        TransferOrderNumber: validOrderNumber,
        TransferOrderDate: validOrderDate,
        TransferNotes: validNotes,
      },
      details: `تسجيل نقل خارجي للموظف: ${emp.FullName} (الرقم: ${employeeId})`,
    });

    return { success: true, changes: result.changes };
  })();
}

// ══════════════════════════════════════════════════════════════
//  cancelEmployeeTransfer
//
//  إلغاء حالة النقل الخارجي للموظف:
//  - يعيد IsTransferred إلى 0 ويفرغ حقول رقم وتاريخ وملاحظات النقل.
//  - يُنفذ في معاملة ذرية مع توثيق العملية في سجل التدقيق الأمني.
//
//  Cancels external transfer for an employee, resetting transfer fields.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, changes: number }}
// ══════════════════════════════════════════════════════════════
function cancelEmployeeTransfer(employeeId, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  const emp = db.prepare('SELECT * FROM Employees WHERE EmployeeID = ?').get(employeeId);
  if (!emp) {
    throw new Error(`تعذر العثور على الموظف صاحب الرقم (${employeeId}).`);
  }

  return db.transaction(() => {
    const result = db
      .prepare(`
        UPDATE Employees
        SET IsTransferred       = 0,
            TransferOrderNumber = NULL,
            TransferOrderDate   = NULL,
            TransferNotes       = NULL
        WHERE EmployeeID = ?
      `)
      .run(employeeId);

    if (result.changes === 0) {
      throw new Error(`تعذر إلغاء حالة النقل للموظف برقم (${employeeId}).`);
    }

    AuditService.logAction(db, {
      actionType: 'TRANSFER_CANCELLED',
      entityType: 'Employee',
      entityID: employeeId,
      oldValue: {
        IsTransferred: emp.IsTransferred,
        TransferOrderNumber: emp.TransferOrderNumber,
        TransferOrderDate: emp.TransferOrderDate,
        TransferNotes: emp.TransferNotes,
      },
      newValue: {
        IsTransferred: 0,
        TransferOrderNumber: null,
        TransferOrderDate: null,
        TransferNotes: null,
      },
      details: `إلغاء حالة النقل الخارجي للموظف: ${emp.FullName} (الرقم: ${employeeId})`,
    });

    return { success: true, changes: result.changes };
  })();
}

// ══════════════════════════════════════════════════════════════
//  getEmployeesPaginated
//
//  استعلام ترقيم الصفحات من جانب الخادم (Server-Side Pagination):
//  - يتيح فلترة وتصفية مرنة حسب الاسم، رقم الكرت، موقع العمل، أو الرقم الوظيفي.
//  - أداء فائق: يستخدم تعبيرات الجدول الشائعة (CTE) مع استعلام فرعي لجلب بيانات
//    آخر إجازة لكل موظف في استعلام واحد متكامل وسريع يمنع مشكلة N+1 استعلام نهائياً.
//
//  Server-side paginated query for All Employees tab with
//  search filter and latest leave information (single fast query, no N+1).
//
//  @param {{ page?: number, pageSize?: number, search?: string }} options
//  @param {import('better-sqlite3').Database} db
//  @returns {{
//    data: Array<any>,
//    totalCount: number,
//    page: number,
//    pageSize: number,
//    totalPages: number
//  }}
// ══════════════════════════════════════════════════════════════
function getEmployeesPaginated({ page = 1, pageSize = 15, search = '' } = {}, db) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));
  const offset = (safePage - 1) * safePageSize;
  const trimmedSearch = (search || '').trim();

  let whereClause = '';
  let countWhereClause = '';
  const params = [];
  const countParams = [];

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    whereClause = `
      WHERE (
        FullName LIKE ? OR
        LeaveCardNumber LIKE ? OR
        WorkLocation LIKE ? OR
        CAST(EmployeeID AS TEXT) LIKE ?
      )
    `;
    countWhereClause = `
      WHERE (
        FullName LIKE ? OR
        LeaveCardNumber LIKE ? OR
        WorkLocation LIKE ? OR
        CAST(EmployeeID AS TEXT) LIKE ?
      )
    `;
    params.push(pattern, pattern, pattern, pattern);
    countParams.push(pattern, pattern, pattern, pattern);
  }

  // 1. Total matching count / احتساب العدد الكلي للسجلات المطابقة لحساب عدد الصفحات
  const countRow = db
    .prepare(`SELECT COUNT(*) AS total FROM Employees ${countWhereClause}`)
    .get(...countParams);
  const totalCount = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(totalCount / safePageSize) || 1;

  // 2. High-performance paginated query with CTE + latest leave subquery
  // الاستعلام عالي الكفاءة: جلب الصفحة المحددة مع استعلام فرعي لآخر إجازة لكل موظف
  const dataQuery = `
    WITH PagedEmps AS (
      SELECT
        EmployeeID,
        FullName,
        JobTitle,
        WorkLocation,
        LeaveCardNumber,
        LeaveApprover,
        IsActive,
        IsTransferred,
        TransferOrderNumber,
        TransferOrderDate,
        TransferNotes
      FROM Employees
      ${whereClause}
      ORDER BY IsActive DESC, FullName ASC
      LIMIT ? OFFSET ?
    )
    SELECT
      pe.*,
      (
        SELECT l.StartDate FROM Leaves l
        WHERE l.EmployeeID = pe.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveStartDate,
      (
        SELECT l.EndDate FROM Leaves l
        WHERE l.EmployeeID = pe.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveEndDate,
      (
        SELECT l.DaysCount FROM Leaves l
        WHERE l.EmployeeID = pe.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveDaysCount,
      (
        SELECT lt.Name FROM Leaves l
        JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
        WHERE l.EmployeeID = pe.EmployeeID
        ORDER BY l.StartDate DESC, l.LeaveID DESC
        LIMIT 1
      ) AS LastLeaveTypeName
    FROM PagedEmps pe
    ORDER BY pe.IsActive DESC, pe.FullName ASC
  `;

  params.push(safePageSize, offset);
  const data = db.prepare(dataQuery).all(...params);

  return {
    data,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages
  };
}

// ──────────────────────────────────────────────────────────────
//  Exports / تصدير دوال الخدمة
// ──────────────────────────────────────────────────────────────
module.exports = {
  addEmployee,
  searchEmployees,
  getEmployeeById,
  updateEmployee,
  deactivateEmployee,
  activateEmployee,
  transferEmployee,
  cancelEmployeeTransfer,
  getEmployeesPaginated,
};
