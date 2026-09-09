// ============================================================
//  services/LeaveService.js  –  Core Leave Calculation Engine
//  محرك احتساب ومعالجة الإجازات الرئيسي (Leave Business Engine)
//
//  Responsibilities / المسؤوليات الأساسية:
//    • calculateRegularLeaveBalance: خوارزمية احتساب رصيد الإجازة الاعتيادية بدقة
//      وفق أيام الخدمة الفعلية الصافية (يوم مستحق لكل 10 أيام خدمة فعلية مطروحاً
//      منها الإجازات بدون راتب مع إضافة أيام التسوية وسقف تراكمي أقصاه 180 يوماً).
//    • processSickLeave: معالجة الإجازة المرضية وتوزيعها على وعاءين ماليين
//      (28 يوماً براتب كامل 100% ثم 45 يوماً بنصف راتب 50%) داخل معاملة ذرية.
//    • checkLeaveOverlap: منع التداخل والازدواجية في فترات الإجازات لنفس الموظف.
//    • getActiveLeavesForToday / getActiveLeavesTodayPaginated: استعلام الإجازات
//      السارية حالياً مع حساب تاريخ الاستئناف والأيام المتبقية وتقسيم الصفحات.
//    • getApproachingResumptions: رصد الإجازات التي أوشكت على الانتهاء للتنبيهات.
//    • updateLeave / deleteLeave: تحديث وحذف الإجازات مع استعادة وتعديل الأرصدة
//      المتأثرة وتوثيق التعديل واسم القائم به في سجل التدقيق والأمان.
//
//  CONTRACT / ميثاق الخدمة:
//    • Every exported function receives `db` (a better-sqlite3
//      Database instance) as its LAST argument.  This keeps the
//      service stateless and easily testable.
//      (تستقبل كل دالة كائن الاتصال بقاعدة البيانات كآخر وسيط لضمان أنها عديمة الحالة وقابلة للاختبار).
//    • All operations are synchronous (better-sqlite3 is sync-only).
//      (العمليات تزامنية بالكامل لضمان الاتساق اللحظي للبيانات).
//    • Functions throw on any unrecoverable error; callers (IPC
//      handlers) must wrap calls in try/catch and surface the
//      error message to the renderer.
// ============================================================

'use strict';

const AuditService = require('./AuditService');
const { validateOrderNumber } = require('../utils/orderNumberValidator');
const LoggerService = require('./LoggerService');

// ──────────────────────────────────────────────────────────────
//  Business-rule constants / ثوابت وقواعد العمل النظامية
// ──────────────────────────────────────────────────────────────
const DAYS_PER_EARNED_LEAVE = 10;  // 1 day earned per 10 actual service days (يوم إجازة مستحق لكل 10 أيام خدمة فعلية)
const MAX_REGULAR_BALANCE   = 180; // Accumulation ceiling (days) (السقف الأعلى لتراكم رصيد الإجازة الاعتيادية 180 يوماً)

const SICK_100_MAX          = 30;  // Days paid at 100 % (أيام الإجازة المرضية براتب كامل 100%)
const SICK_50_MAX           = 45;  // Additional days paid at 50 % (أيام الإجازة المرضية بنصف راتب 50%)
const SICK_25_MAX           = 45;  // Additional days paid at 25 % (أيام الإجازة المرضية بربع راتب 25%)
const SICK_TOTAL_MAX        = SICK_100_MAX + SICK_50_MAX + SICK_25_MAX; // 120 days/year (إجمالي الرصيد المرضي السنوي 120 يوماً)

// Names as stored in LeaveTypes seed data (must match exactly)
// مسميات أنواع الإجازات كما هي معرّفة في جداول النظام التأسيسية
const LEAVE_NAME_UNPAID     = 'إجازة بدون راتب';
const LEAVE_NAME_SICK       = 'إجازة مرضية';

// ──────────────────────────────────────────────────────────────
//  Internal helpers / الدوال المساعدة الداخلية
// ──────────────────────────────────────────────────────────────

/**
 * احتساب عدد الأيام التقويمية بين تاريخين (to - from):
 * تستخدم التوقيت العالمي المنسق (UTC) لتفادي أخطاء فروق التوقيت المحلي.
 *
 * Calculates calendar days between two dates (to - from).
 * Always returns a non-negative integer.
 *
 * @param {string|Date} from
 * @param {string|Date} to
 * @returns {number}
 */
function _daysBetween(from, to) {
  const MS_PER_DAY = 86_400_000;
  const d1 = new Date(from);
  const d2 = new Date(to);

  if (isNaN(d1.getTime())) throw new Error(`تاريخ البداية غير صالح: ${from}`);
  if (isNaN(d2.getTime())) throw new Error(`تاريخ النهاية غير صالح: ${to}`);

  // Strip time component so we always count whole days / تجريد الوقت لحساب الأيام الكاملة
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());

  return Math.floor((utc2 - utc1) / MS_PER_DAY);
}

/**
 * جلب بيانات نوع الإجازة بالاسم والتحقق من وجوده:
 * ترمي خطأ صريحاً إذا كان نوع الإجازة غير معرّف بالنظام.
 *
 * Looks up a LeaveType row by name. Throws if not found.
 *
 * @param {string} name
 * @param {import('better-sqlite3').Database} db
 * @returns {{ LeaveTypeID: number, Name: string, MaxDaysPerInstance: number, RequiresOrderRef: number, GenderRestriction: string|null }}
 */
function _requireLeaveType(name, db) {
  const row = db
    .prepare('SELECT * FROM LeaveTypes WHERE Name = ?')
    .get(name);

  if (!row) {
    LoggerService.error('LeaveService', `LeaveType not found: ${name}`);
    throw new Error(`نوع الإجازة غير معرّف بالنظام: "${name}".`);
  }
  return row;
}

/**
 * فحص منع تداخل فترات الإجازات (Overlap Guard):
 * يتحقق مما إذا كانت الفترة المطلوبة تتقاطع مع أي إجازة سابقة مسجلة لنفس الموظف.
 * يُرجع تفاصيل الإجازة المتعارضة في حال وجود تداخل، أو null إذا كانت الفترة شاغرة.
 *
 * Checks if the requested date range overlaps with any existing leave for the employee.
 * Returns the conflicting leave details if an overlap exists, or null if clear.
 *
 * @param {number} employeeId
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 * @param {number|null} [excludeLeaveId=null] - LeaveID to exclude (when editing / استثناء الإجازة الحالية عند التعديل)
 * @param {import('better-sqlite3').Database} db
 * @returns {{ LeaveID: number, LeaveTypeName: string, StartDate: string, EndDate: string, DaysCount: number } | null}
 */
function checkLeaveOverlap(employeeId, startDate, endDate, excludeLeaveId, db) {
  if (!employeeId || !startDate || !endDate || !db) return null;

  let query = `
    SELECT 
      l.LeaveID, 
      l.StartDate, 
      l.EndDate, 
      l.DaysCount, 
      lt.Name AS LeaveTypeName
    FROM Leaves l
    JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    WHERE l.EmployeeID = ?
      AND l.StartDate <= ?
      AND l.EndDate   >= ?
  `;

  const params = [employeeId, endDate, startDate];

  if (excludeLeaveId) {
    query += ' AND l.LeaveID != ?';
    params.push(excludeLeaveId);
  }

  query += ' ORDER BY l.StartDate ASC LIMIT 1';

  const row = db.prepare(query).get(...params);
  return row || null;
}

// ══════════════════════════════════════════════════════════════
//  PUBLIC API / واجهات الاستخدام العامة
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  calculateRegularLeaveBalance
//
//  احتساب الرصيد الحالي المتاح من الإجازات الاعتيادية للموظف:
//  الخوارزمية المحاسبية المعتمدة:
//    1. التحقق من صحة الرقم الوظيفي.
//    2. جلب تاريخ التعيين وأيام التسوية من جدول الموظفين.
//    3. احتساب إجمالي الأيام التقويمية من تاريخ التعيين حتى تاريخ اليوم.
//    4. جلب معرفات الإجازات ديناميكياً من قاعدة البيانات بالاسم العربي لتفادي المعرفات الثابتة.
//    5. جمع كافة أيام "إجازة بدون راتب" التي قضاها الموظف.
//    6. جمع كافة أيام "الإجازة الاعتيادية" و "سبب آخر" المستهلكة سابقاً.
//    7. أيام الخدمة الصافية = إجمالي الأيام التقويمية − أيام الإجازة بدون راتب.
//    8. إجمالي الرصيد المستحق = floor(أيام الخدمة الصافية / 10).
//    9. الرصيد المتاح = إجمالي الرصيد المستحق + أيام التسوية − الإجازات المستهلكة.
//    10. الرصيد النهائي المعتمد = min(max(الرصيد المتاح, 0), 180) بحيث لا يقل عن صفر ولا يتجاوز 180 يوماً.
//
//  Calculates the employee's CURRENT AVAILABLE regular-leave balance.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {{
//    employeeId:           number,
//    hireDate:             string,
//    totalDays:            number,
//    unpaidDays:           number,
//    netServiceDays:       number,
//    grossEarnedBalance:   number,
//    regularLeavesTaken:   number,
//    availableBalance:     number,
//    finalBalance:         number
//  }}
// ──────────────────────────────────────────────────────────────
function calculateRegularLeaveBalance(employeeId, db) {

  // ── Step 1: Validate input / التحقق من المدخلات ──────────────
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  // ── Step 2: Fetch employee record / جلب بيانات الموظف وتاريخ التعيين ─
  const employee = db
    .prepare('SELECT EmployeeID, HireDate, IsActive, AdjustmentDays FROM Employees WHERE EmployeeID = ?')
    .get(employeeId);

  if (!employee) {
    throw new Error(`تعذر العثور على الموظف برقم (${employeeId}).`);
  }

  // ── Step 3: Total calendar days from HireDate to today ──────
  // إجمالي الأيام التقويمية منذ تاريخ التعيين حتى اليوم
  const today     = new Date();
  const totalDays = _daysBetween(employee.HireDate, today);

  if (totalDays < 0) {
    throw new Error(`تاريخ التعيين (${employee.HireDate}) في المستقبل، لا يمكن احتساب الرصيد.`);
  }

  // ── Step 4: Dynamically resolve required LeaveType IDs ──────
  // استرجاع معرفات أنواع الإجازات ديناميكياً لتفادي الأخطاء البرمجية
  const ARABIC_NAME_UNPAID  = 'إجازة بدون راتب';
  const ARABIC_NAME_REGULAR = 'إجازة اعتيادية';
  const ARABIC_NAME_OTHER   = 'سبب آخر';

  const unpaidLeaveType = db
    .prepare('SELECT LeaveTypeID, Name FROM LeaveTypes WHERE Name = ?')
    .get(ARABIC_NAME_UNPAID);

  if (!unpaidLeaveType) {
    throw new Error(`نوع الإجازة "${ARABIC_NAME_UNPAID}" غير معرّف بالنظام.`);
  }

  const regularLeaveType = db
    .prepare('SELECT LeaveTypeID, Name FROM LeaveTypes WHERE Name = ?')
    .get(ARABIC_NAME_REGULAR);

  if (!regularLeaveType) {
    throw new Error(`نوع الإجازة "${ARABIC_NAME_REGULAR}" غير معرّف بالنظام.`);
  }

  const otherLeaveType = db
    .prepare('SELECT LeaveTypeID, Name FROM LeaveTypes WHERE Name = ?')
    .get(ARABIC_NAME_OTHER);

  // ── Step 5: Sum all Unpaid Leave days taken ─────────────────
  // جمع أيام الإجازة بدون راتب لخصمها من مدة الخدمة الفعلية
  const unpaidDays = db.prepare(`
    SELECT COALESCE(SUM(l.DaysCount), 0) AS TotalDays
    FROM   Leaves l
    WHERE  l.EmployeeID  = ?
      AND  l.LeaveTypeID = ?
  `).get(employeeId, unpaidLeaveType.LeaveTypeID).TotalDays;

  // ── Step 6: Sum all Regular + Other Leave days already taken 
  // جمع أيام الإجازات الاعتيادية و"سبب آخر" المستهلكة من رصيد الموظف
  const regularLeaveTypeIds = [regularLeaveType.LeaveTypeID];
  if (otherLeaveType) {
    regularLeaveTypeIds.push(otherLeaveType.LeaveTypeID);
  }

  const placeholders = regularLeaveTypeIds.map(() => '?').join(',');
  const regularLeavesTaken = db.prepare(`
    SELECT COALESCE(SUM(l.DaysCount), 0) AS TotalDays
    FROM   Leaves l
    WHERE  l.EmployeeID  = ?
      AND  l.LeaveTypeID IN (${placeholders})
  `).get(employeeId, ...regularLeaveTypeIds).TotalDays;

  // ── Step 7: Net service days (never negative) ───────────────
  // أيام الخدمة الصافية = إجمالي الأيام - أيام الإجازة بدون راتب
  const netServiceDays = Math.max(0, totalDays - unpaidDays);

  // ── Step 8: Gross earned balance ────────────────────────────
  // الرصيد التراكمي الإجمالي = يوم واحد لكل 10 أيام خدمة فعلية
  const grossEarnedBalance = Math.floor(netServiceDays / DAYS_PER_EARNED_LEAVE);

  // ── Step 9: Deduct regular leaves already consumed ──────────
  // الرصيد المتاح = الرصيد المكتسب + أيام التسوية - الإجازات المستهلكة
  const availableBalance = grossEarnedBalance + employee.AdjustmentDays - regularLeavesTaken;

  // ── Step 10: Cap at MAX and floor at 0 ──────────────────────
  // تحديد الرصيد بالسقف الأعلى 180 يوماً وتثبيته عند الصفر كحد أدنى
  const finalBalance = Math.min(Math.max(availableBalance, 0), MAX_REGULAR_BALANCE);

  return {
    employeeId,
    hireDate:           employee.HireDate,
    totalDays,
    unpaidDays,
    netServiceDays,
    grossEarnedBalance,   // إجمالي الرصيد المكتسب قبل الخصم
    regularLeavesTaken,   // أيام الإجازات المستهلكة المسجلة بالنظام
    adjustmentDays:     employee.AdjustmentDays, // أيام التسوية اليدوية (+ أو -)
    availableBalance,     // الرصيد المتاح النظري قبل تطبيق السقف
    finalBalance,         // الرصيد النهائي المعتمد المتاح للاستهلاك
  };
}

// ──────────────────────────────────────────────────────────────
//  processSickLeave
//
//  معالجة الإجازة المرضية وتوزيعها على الوعاءين الماليين (100% و 50%):
//  - الوعاء الأول: أول 28 يوماً تُدفع براتب كامل (100%).
//  - الوعاء الثاني: الـ 45 يوماً التالية تُدفع بنصف راتب (50%).
//  - يتم فحص التداخل بدقة وتوزيع الأيام بالترتيب الهرمي.
//  - العملية تُنفذ بالكامل داخل معاملة ذرية (db.transaction) لضمان الخصم
//    من الأرصدة وإدراج الإجازة وتوثيق التدقيق كوحدة واحدة لا تتجزأ.
//
//  Validates and applies a sick-leave request against the two-tier
//  (100% / 50%) pay-bucket system inside a single atomic transaction.
//
//  @param {number} employeeId
//  @param {number} requestedDays
//  @param {string} startDate
//  @param {string} endDate
//  @param {import('better-sqlite3').Database} db
//  @param {string|null} leaveApprover
//  @param {object} meta
//  @returns {{ leaveId: number, daysAt100: number, daysAt50: number, newBalance100: number, newBalance50: number, quotaExceeded: boolean }}
// ──────────────────────────────────────────────────────────────
function processSickLeave(
  employeeId,
  requestedDays,
  startDate,
  endDate,
  db,
  leaveApprover = null,
  { requestDate = null, memoNumber = null, memoDate = null, orderNumber = null, orderDate = null } = {}
) {

  // ── Pre-flight validation (outside transaction — fast checks) ──
  // فحوصات التحقق السريعة قبل فتح المعاملة
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new Error('عدد أيام الإجازة يجب أن يكون رقماً صحيحاً أكبر من صفر.');
  }
  if (!startDate || !endDate) {
    throw new Error('يرجى تحديد تاريخ بداية ونهاية الإجازة.');
  }

  // Inclusive date-range count must match requestedDays
  // مطابقة عدد الأيام الفعلي بين تاريخ البداية والنهاية
  const dateRangeDays = _daysBetween(startDate, endDate) + 1;
  if (dateRangeDays !== requestedDays) {
    throw new Error(
      `عدد الأيام المدخل (${requestedDays} يوم) لا يتطابق مع الفترة المحددة (${dateRangeDays} يوم).`
    );
  }

  // ── Overlap Guard (Strict Prevention) / فحص منع تداخل التواريخ ─
  const overlap = checkLeaveOverlap(employeeId, startDate, endDate, null, db);
  if (overlap) {
    throw new Error(
      `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
    );
  }

  // ── Resolve LeaveTypeID for Sick Leave ─────────────────────
  const sickLeaveType = _requireLeaveType(LEAVE_NAME_SICK, db);

  // ── Define the atomic transaction / بدء المعاملة الذرية ─────────
  const _runTransaction = db.transaction(() => {

    // Auto-ensure default Sick Leave balance rows exist for employee
    // التأكد من وجود سجلات الرصيد الافتراضي للموظف (30 يوماً براتب كامل، 45 بنصف راتب، 45 بربع راتب)
    db.prepare(`
      INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
      VALUES (?, ?, 30, 100), (?, ?, 45, 50), (?, ?, 45, 25)
    `).run(
      employeeId, sickLeaveType.LeaveTypeID,
      employeeId, sickLeaveType.LeaveTypeID,
      employeeId, sickLeaveType.LeaveTypeID
    );

    // ── A: Read all balance buckets / قراءة أرصدة الأوعية المالية الثلاثة ──
    const balances = db
      .prepare(`
        SELECT PayPercentage, TotalBalance
        FROM   LeaveBalances
        WHERE  EmployeeID  = ?
          AND  LeaveTypeID = ?
        ORDER  BY PayPercentage DESC   -- 100 first, then 50, then 25
      `)
      .all(employeeId, sickLeaveType.LeaveTypeID);

    const bucket = { 100: 0, 50: 0, 25: 0 };
    for (const row of balances) {
      if (row.PayPercentage === 100 || row.PayPercentage === 50 || row.PayPercentage === 25) {
        bucket[row.PayPercentage] = row.TotalBalance;
      }
    }

    const totalAvailable = bucket[100] + bucket[50] + bucket[25];
    const quotaExceeded = requestedDays > totalAvailable;

    // ── B/C/D: Distribute requested days across buckets ─────────
    // توزيع الأيام المطلوبة هرمياً (استهلاك وعاء 100% أولاً ثم 50% ثم 25%)
    let daysAt100 = 0;
    let daysAt50  = 0;
    let daysAt25  = 0;
    let remaining = requestedDays;

    if (remaining <= bucket[100]) {
      // Entire request satisfied by the 100% bucket
      daysAt100 = remaining;
      remaining = 0;
    } else {
      daysAt100 = Math.max(0, bucket[100]);
      remaining -= daysAt100;

      if (remaining <= bucket[50]) {
        daysAt50 = remaining;
        remaining = 0;
      } else {
        daysAt50 = Math.max(0, bucket[50]);
        remaining -= daysAt50;

        // Spill remainder into 25% bucket (may exceed bucket[25] if quotaExceeded)
        daysAt25 = remaining;
        remaining = 0;
      }
    }

    // ── E: Persist deductions / تسجيل خصم الأيام من الأرصدة ─────
    const updateBalance = db.prepare(`
      UPDATE LeaveBalances
      SET    TotalBalance = TotalBalance - ?
      WHERE  EmployeeID   = ?
        AND  LeaveTypeID  = ?
        AND  PayPercentage = ?
    `);

    if (daysAt100 > 0) {
      const r = updateBalance.run(daysAt100, employeeId, sickLeaveType.LeaveTypeID, 100);
      if (r.changes === 0) {
        throw new Error(
          'processSickLeave: Failed to deduct from Sick Leave 100% bucket — ' +
          'LeaveBalances row missing for this employee.'
        );
      }
    }

    if (daysAt50 > 0) {
      const r = updateBalance.run(daysAt50, employeeId, sickLeaveType.LeaveTypeID, 50);
      if (r.changes === 0) {
        throw new Error(
          'processSickLeave: Failed to deduct from Sick Leave 50% bucket — ' +
          'LeaveBalances row missing for this employee.'
        );
      }
    }

    if (daysAt25 > 0) {
      const r = updateBalance.run(daysAt25, employeeId, sickLeaveType.LeaveTypeID, 25);
      if (r.changes === 0) {
        throw new Error(
          'processSickLeave: Failed to deduct from Sick Leave 25% bucket — ' +
          'LeaveBalances row missing for this employee.'
        );
      }
    }

    // ── F: Insert Leaves record / إدراج قيد الإجازة في جدول Leaves ─
    const insertResult = db
      .prepare(`
        INSERT INTO Leaves
          (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, Notes, LeaveApprover, RequestDate, MemoNumber, MemoDate, OrderNumber, OrderDate)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        employeeId,
        sickLeaveType.LeaveTypeID,
        startDate,
        endDate,
        requestedDays,
        `Sick Leave processed: ${daysAt100}d @ 100% pay, ${daysAt50}d @ 50% pay, ${daysAt25}d @ 25% pay`,
        leaveApprover ?? null,
        requestDate ?? null,
        memoNumber ?? null,
        memoDate ?? null,
        orderNumber ?? null,
        orderDate ?? null
      );

    const newLeaveId = Number(insertResult.lastInsertRowid);

    // توثيق تسجيل الإجازة المرضية في سجل التدقيق والأمان
    AuditService.logAction(db, {
      actionType: 'INSERT',
      entityType: 'Leave',
      entityID: newLeaveId,
      oldValue: null,
      newValue: {
        LeaveID: newLeaveId,
        EmployeeID: employeeId,
        LeaveType: 'إجازة مرضية',
        StartDate: startDate,
        EndDate: endDate,
        DaysCount: requestedDays,
        DaysAt100: daysAt100,
        DaysAt50: daysAt50,
        DaysAt25: daysAt25,
        LeaveApprover: leaveApprover ?? null,
        RequestDate: requestDate ?? null,
        MemoNumber: memoNumber ?? null,
        MemoDate: memoDate ?? null,
        OrderNumber: orderNumber ?? null,
        OrderDate: orderDate ?? null,
      },
      details: `تسجيل إجازة مرضية (${requestedDays} يوم) للموظف رقم (${employeeId}) من ${startDate} إلى ${endDate}`,
    });

    return {
      leaveId:       newLeaveId,
      daysAt100,
      daysAt50,
      daysAt25,
      newBalance100: bucket[100] - daysAt100,
      newBalance50:  bucket[50]  - daysAt50,
      newBalance25:  bucket[25]  - daysAt25,
      quotaExceeded,
    };
  }); // end transaction definition

  // Execute — any uncaught throw inside auto-rolls back
  return _runTransaction();
}

// ──────────────────────────────────────────────────────────────
//  processRegularLeave
//
//  معالجة وتسجيل الإجازة الاعتيادية (أو سبب آخر / دورة تدريبية):
//  1. التحقق من المدخلات ومطابقة عدد الأيام الفعلي مع التواريخ.
//  2. فحص تداخل التواريخ مع إجازات أخرى للموظف (سواء قبل المعاملة أو داخلها).
//  3. تنفيذ حركة ذرية تعيد فحص الرصيد لحظياً داخل Transaction لمنع مشكلة التزامن (Race Condition).
//  4. خصم الرصيد وإدراج السجل وتوثيق العملية في سجل التدقيق والأمان Audit Logs.
//
//  @param {number} employeeId
//  @param {number} requestedDays
//  @param {string} startDate
//  @param {string} endDate
//  @param {import('better-sqlite3').Database} db
//  @param {string} [leaveType='إجازة اعتيادية']
//  @param {object} [meta={}]
//  @returns {{ leaveId: number, finalBalance: number|null, requestedDays: number, remainingBalance: number|null }}
// ──────────────────────────────────────────────────────────────
function processRegularLeave(
  employeeId,
  requestedDays,
  startDate,
  endDate,
  db,
  leaveType = 'إجازة اعتيادية',
  {
    orderRef = null,
    notes = null,
    leaveApprover = null,
    requestDate = null,
    memoNumber = null,
    memoDate = null,
    orderNumber = null,
    orderDate = null,
  } = {}
) {
  // ── Pre-flight validation (outside transaction — fast checks) ──
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new Error('عدد أيام الإجازة يجب أن يكون رقماً صحيحاً أكبر من صفر.');
  }
  if (!startDate || !endDate) {
    throw new Error('يرجى تحديد تاريخ بداية ونهاية الإجازة.');
  }

  // Inclusive date-range count must match requestedDays
  const dateRangeDays = _daysBetween(startDate, endDate) + 1;
  if (dateRangeDays !== requestedDays) {
    throw new Error(
      `عدد الأيام المدخل (${requestedDays} يوم) لا يتطابق مع الفترة المحددة (${dateRangeDays} يوم).`
    );
  }

  // ── Resolve the target LeaveType ───────────────────────────
  let targetLeaveName = typeof leaveType === 'string' ? leaveType.trim() : '';
  if (targetLeaveName === 'regular') {
    targetLeaveName = 'إجازة اعتيادية';
  } else if (targetLeaveName === 'other') {
    targetLeaveName = 'سبب آخر';
  } else if (targetLeaveName === 'training') {
    targetLeaveName = 'دورة تدريبية';
  }

  const targetLeaveType = db
    .prepare('SELECT LeaveTypeID, Name FROM LeaveTypes WHERE Name = ?')
    .get(targetLeaveName);

  if (!targetLeaveType) {
    throw new Error(`نوع الإجازة غير معرّف بالنظام: "${targetLeaveName || leaveType}".`);
  }

  targetLeaveName = targetLeaveType.Name;
  const isBalanced = (targetLeaveName === 'إجازة اعتيادية' || targetLeaveName === 'سبب آخر');

  // ── Step 0: Check Overlap (Strict Prevention) ─────────────
  const overlap = checkLeaveOverlap(employeeId, startDate, endDate, null, db);
  if (overlap) {
    throw new Error(
      `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
    );
  }

  // ── Define atomic transaction ─────────────────────────────
  const _runTransaction = db.transaction(() => {
    let finalBalance = null;
    let remainingBalance = null;

    // Re-check overlap inside transaction for concurrency safety
    const txOverlap = checkLeaveOverlap(employeeId, startDate, endDate, null, db);
    if (txOverlap) {
      throw new Error(
        `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${txOverlap.LeaveTypeName} من ${txOverlap.StartDate} إلى ${txOverlap.EndDate} — ${txOverlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
      );
    }

    if (isBalanced) {
      // Step A: Re-compute balance inside the transaction
      const balanceResult = calculateRegularLeaveBalance(employeeId, db);
      finalBalance = balanceResult.finalBalance;

      // Step B: Reject if insufficient balance
      if (requestedDays > finalBalance) {
        throw new Error(
          `رصيد الإجازات الاعتيادية غير كافٍ (المطلوب: ${requestedDays} يوم، المتبقي: ${finalBalance} يوم).`
        );
      }

      remainingBalance = finalBalance - requestedDays;
    }

    // Step C: INSERT into Leaves
    const insertResult = db
      .prepare(`
        INSERT INTO Leaves
          (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderRef, Notes, LeaveApprover, RequestDate, MemoNumber, MemoDate, OrderNumber, OrderDate)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        employeeId,
        targetLeaveType.LeaveTypeID,
        startDate,
        endDate,
        requestedDays,
        orderRef ?? (orderNumber || null),
        notes    ?? null,
        leaveApprover ?? null,
        requestDate ?? null,
        memoNumber  ?? null,
        memoDate    ?? null,
        orderNumber ?? null,
        orderDate   ?? null
      );

    const newLeaveId = Number(insertResult.lastInsertRowid);

    // Step D: Log Audit trail
    AuditService.logAction(db, {
      actionType: 'INSERT',
      entityType: 'Leave',
      entityID: newLeaveId,
      oldValue: null,
      newValue: {
        LeaveID: newLeaveId,
        EmployeeID: employeeId,
        LeaveType: targetLeaveName,
        StartDate: startDate,
        EndDate: endDate,
        DaysCount: requestedDays,
        RemainingBalance: remainingBalance,
        LeaveApprover: leaveApprover ?? null,
        RequestDate: requestDate ?? null,
        MemoNumber: memoNumber ?? null,
        MemoDate: memoDate ?? null,
        OrderNumber: orderNumber ?? null,
        OrderDate: orderDate ?? null,
      },
      details: `تسجيل ${targetLeaveName} (${requestedDays} يوم) للموظف رقم (${employeeId}) من ${startDate} إلى ${endDate}`,
    });

    return {
      leaveId: newLeaveId,
      finalBalance,
      requestedDays,
      remainingBalance,
    };
  });

  return _runTransaction();
}

// ──────────────────────────────────────────────────────────────
//  getActiveLeavesForToday
//
//  استرجاع قائمة الإجازات السارية في تاريخ اليوم الحالي:
//  - يحسب تلقائياً تاريخ المباشرة المفترض (اليوم التالي لتاريخ النهاية).
//  - يحسب الأيام المتبقية على انتهاء الإجازة آنياً عبر دالة julianday.
//
//  Returns all leave records where today's local date falls
//  inclusively between StartDate and EndDate.
//
//  @param {import('better-sqlite3').Database} db
//  @returns {{ EmployeeID: number, FullName: string, JobTitle: string, LeaveCardNumber: string|null, WorkLocation: string|null, LeaveName: string, StartDate: string, EndDate: string, ResumptionDate: string, DaysRemaining: number, LeaveApprover: string|null }[]}
// ──────────────────────────────────────────────────────────────
function getActiveLeavesForToday(db) {
  return db
    .prepare(`
      SELECT
        l.LeaveID                   AS LeaveID,
        l.LeaveTypeID               AS LeaveTypeID,
        e.EmployeeID                AS EmployeeID,
        e.FullName                  AS FullName,
        e.JobTitle                  AS JobTitle,
        e.LeaveCardNumber           AS LeaveCardNumber,
        e.WorkLocation              AS WorkLocation,
        lt.Name                     AS LeaveName,
        l.LeaveApprover             AS LeaveApprover,
        l.StartDate                 AS StartDate,
        l.EndDate                   AS EndDate,
        l.DaysCount                 AS DaysCount,
        l.OrderRef                  AS OrderRef,
        l.Notes                     AS Notes,
        l.RequestDate               AS RequestDate,
        l.MemoNumber                AS MemoNumber,
        l.MemoDate                  AS MemoDate,
        l.OrderNumber               AS OrderNumber,
        l.OrderDate                 AS OrderDate,
        DATE(l.EndDate, '+1 day')   AS ResumptionDate,
        CAST(ROUND(julianday(l.EndDate) - julianday(date('now', 'localtime'))) AS INTEGER) AS DaysRemaining
      FROM   Leaves     l
      JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
      JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE  date('now', 'localtime') BETWEEN l.StartDate AND l.EndDate
        AND  e.IsTransferred = 0
      ORDER  BY l.EndDate ASC, e.FullName ASC
    `)
    .all();
}

// ──────────────────────────────────────────────────────────────
//  getActiveLeavesTodayPaginated
//
//  استرجاع الإجازات السارية اليوم مع تقسيم الصفحات وفلاتر البحث والفرز:
//  - يدعم البحث بالاسم أو رقم الكرت أو نوع الإجازة أو موقع العمل.
//  - يدعم فلترة الحالات العاجلة (urgentOnly) التي توشك على الانتهاء خلال 3 أيام.
//  - يدعم الفرز الديناميكي بحسب تاريخ الاستئناف أو الاسم.
//
//  Server-side paginated query for Active Leaves Today tab with
//  search filter, total count, and 15 rows per page.
//
//  @param {{ page?: number, pageSize?: number, search?: string, sortBy?: string, urgentOnly?: boolean }} options
//  @param {import('better-sqlite3').Database} db
//  @returns {{ data: Array<any>, totalCount: number, page: number, pageSize: number, totalPages: number }}
// ──────────────────────────────────────────────────────────────
function getActiveLeavesTodayPaginated({ page = 1, pageSize = 15, search = '', sortBy = 'resumption_asc', urgentOnly = false } = {}, db) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safePageSize = Math.max(1, Math.min(200, parseInt(pageSize, 10) || 15));
  const offset = (safePage - 1) * safePageSize;
  const trimmedSearch = (search || '').trim();

  let searchClause = '';
  const params = [];
  const countParams = [];

  if (trimmedSearch.length > 0) {
    const pattern = `%${trimmedSearch}%`;
    searchClause += `
      AND (
        e.FullName LIKE ? OR
        e.LeaveCardNumber LIKE ? OR
        e.WorkLocation LIKE ? OR
        lt.Name LIKE ? OR
        CAST(e.EmployeeID AS TEXT) LIKE ?
      )
    `;
    params.push(pattern, pattern, pattern, pattern, pattern);
    countParams.push(pattern, pattern, pattern, pattern, pattern);
  }

  if (urgentOnly) {
    searchClause += ` AND CAST(ROUND(julianday(l.EndDate) - julianday(date('now', 'localtime'))) AS INTEGER) <= 3 `;
  }

  // 1. Total matching count / احتساب العدد الكلي للسجلات المطابقة
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM   Leaves     l
    JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
    JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    WHERE  date('now', 'localtime') BETWEEN l.StartDate AND l.EndDate
      AND  e.IsTransferred = 0
    ${searchClause}
  `;
  const countRow = db.prepare(countQuery).get(...countParams);
  const totalCount = countRow ? countRow.total : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));

  // Determine dynamic sort order / تحديد ترتيب الفرز المطلوب
  let orderByClause = 'ORDER BY l.EndDate ASC, e.FullName ASC';
  if (sortBy === 'resumption_desc') {
    orderByClause = 'ORDER BY l.EndDate DESC, e.FullName ASC';
  } else if (sortBy === 'name_asc') {
    orderByClause = 'ORDER BY e.FullName ASC, l.EndDate ASC';
  }

  // 2. Paginated data query / استعلام جلب بيانات الصفحة المحددة
  const dataQuery = `
    SELECT
      l.LeaveID                   AS LeaveID,
      l.LeaveTypeID               AS LeaveTypeID,
      e.EmployeeID                AS EmployeeID,
      e.FullName                  AS FullName,
      e.JobTitle                  AS JobTitle,
      e.LeaveCardNumber           AS LeaveCardNumber,
      e.WorkLocation              AS WorkLocation,
      lt.Name                     AS LeaveName,
      l.LeaveApprover             AS LeaveApprover,
      l.StartDate                 AS StartDate,
      l.EndDate                   AS EndDate,
      l.DaysCount                 AS DaysCount,
      l.OrderRef                  AS OrderRef,
      l.Notes                     AS Notes,
      l.RequestDate               AS RequestDate,
      l.MemoNumber                AS MemoNumber,
      l.MemoDate                  AS MemoDate,
      l.OrderNumber               AS OrderNumber,
      l.OrderDate                 AS OrderDate,
      DATE(l.EndDate, '+1 day')   AS ResumptionDate,
      CAST(ROUND(julianday(l.EndDate) - julianday(date('now', 'localtime'))) AS INTEGER) AS DaysRemaining
    FROM   Leaves     l
    JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
    JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    WHERE  date('now', 'localtime') BETWEEN l.StartDate AND l.EndDate
      AND  e.IsTransferred = 0
    ${searchClause}
    ${orderByClause}
    LIMIT ? OFFSET ?
  `;

  const data = db.prepare(dataQuery).all(...params, safePageSize, offset);

  return {
    data,
    totalCount,
    page: safePage,
    pageSize: safePageSize,
    totalPages,
  };
}

// ──────────────────────────────────────────────────────────────
//  getApproachingResumptions
//
//  رصد الإجازات التي أوشكت على الانتهاء لتوليد الإشعارات والتنبيهات:
//  تسترجع الموظفين الذين تنتهي إجازاتهم خلال الأيام المحددة (افتراضياً 3 أيام).
//
//  @param {import('better-sqlite3').Database} db
//  @param {number} daysThreshold
//  @returns {{ EmployeeID: number, FullName: string, LeaveCardNumber: string|null, WorkLocation: string|null, LeaveName: string, StartDate: string, EndDate: string, ResumptionDate: string, DaysRemaining: number }[]}
// ──────────────────────────────────────────────────────────────
function getApproachingResumptions(db, daysThreshold = 3) {
  return db
    .prepare(`
      SELECT
        e.EmployeeID                AS EmployeeID,
        e.FullName                  AS FullName,
        e.LeaveCardNumber           AS LeaveCardNumber,
        e.WorkLocation              AS WorkLocation,
        lt.Name                     AS LeaveName,
        l.StartDate                 AS StartDate,
        l.EndDate                   AS EndDate,
        DATE(l.EndDate, '+1 day')   AS ResumptionDate,
        CAST(ROUND(julianday(l.EndDate) - julianday(date('now', 'localtime'))) AS INTEGER) AS DaysRemaining
      FROM   Leaves     l
      JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
      JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE  date('now', 'localtime') BETWEEN l.StartDate AND l.EndDate
        AND  e.IsTransferred = 0
        AND  l.EndDate <= date('now', 'localtime', '+' || ? || ' days')
      ORDER  BY l.EndDate ASC, e.FullName ASC
    `)
    .all(daysThreshold);
}

// ──────────────────────────────────────────────────────────────
//  getEmployeeLeaves
//
//  استرجاع السجل التاريخي الكامل لجميع إجازات موظف محدد:
//  مرتباً تنازلياً من أحدث إجازة إلى أقدمها.
//
//  @param {number} employeeId
//  @param {import('better-sqlite3').Database} db
//  @returns {{ LeaveID: number, EmployeeID: number, LeaveTypeID: number, LeaveName: string, StartDate: string, EndDate: string, DaysCount: number, OrderRef: string|null, Notes: string|null, CreatedAt: string }[]}
// ──────────────────────────────────────────────────────────────
function getEmployeeLeaves(employeeId, db) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  return db
    .prepare(`
      SELECT
        l.LeaveID,
        l.EmployeeID,
        l.LeaveTypeID,
        lt.Name AS LeaveName,
        l.LeaveApprover,
        l.StartDate,
        l.EndDate,
        l.DaysCount,
        l.OrderRef,
        l.Notes,
        l.RequestDate,
        l.MemoNumber,
        l.MemoDate,
        l.OrderNumber,
        l.OrderDate,
        l.CreatedAt
      FROM   Leaves l
      JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE  l.EmployeeID = ?
      ORDER  BY l.StartDate DESC
    `)
    .all(employeeId);
}

// ──────────────────────────────────────────────────────────────
//  deleteLeave
//
//  حذف قيد إجازة مع استعادة الرصيد إذا كانت إجازة مرضية:
//  - تُنفذ داخل معاملة ذرية (db.transaction).
//  - إذا كانت الإجازة مرضية، يتم رد عدد أيامها إلى رصيد الموظف في LeaveBalances.
//  - توثق عملية الحذف مع تفاصيلها في سجل التدقيق والأمان.
//
//  Deletes a leave record and restores balance if it was a Sick Leave.
//  Executed inside an atomic transaction.
//
//  @param {number} leaveId
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, deletedLeaveId: number }}
// ──────────────────────────────────────────────────────────────
function deleteLeave(leaveId, db) {
  if (!Number.isInteger(leaveId) || leaveId <= 0) {
    throw new Error('معرّف الإجازة غير صالح.');
  }

  const _txn = db.transaction(() => {
    // Step 1: Query the Leaves row with LeaveType name / جلب سجل الإجازة قبل الحذف
    const leave = db
      .prepare(`
        SELECT l.*, lt.Name AS LeaveTypeName
        FROM   Leaves l
        JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
        WHERE  l.LeaveID = ?
      `)
      .get(leaveId);

    if (!leave) {
      throw new Error(`تعذر العثور على قيد الإجازة برقم (${leaveId}).`);
    }

    // Step 2 & 3: IF Sick Leave, restore DaysCount back to LeaveBalances per tier
    // استعادة الأيام إلى رصيد الإجازات المرضية للموظف بدقة لكل شريحة
    if (leave.LeaveTypeName === LEAVE_NAME_SICK) {
      const match = leave.Notes?.match(/(\d+)d\s*@\s*100%\s*pay[,\s]+(\d+)d\s*@\s*50%\s*pay(?:[,\s]+(\d+)d\s*@\s*25%\s*pay)?/);
      if (match) {
        const d100 = parseInt(match[1], 10) || 0;
        const d50  = parseInt(match[2], 10) || 0;
        const d25  = parseInt(match[3] || '0', 10) || 0;
        const updateBal = db.prepare(`
          UPDATE LeaveBalances
          SET TotalBalance = TotalBalance + ?
          WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = ?
        `);
        if (d100 > 0) updateBal.run(d100, leave.EmployeeID, leave.LeaveTypeID, 100);
        if (d50 > 0)  updateBal.run(d50, leave.EmployeeID, leave.LeaveTypeID, 50);
        if (d25 > 0)  updateBal.run(d25, leave.EmployeeID, leave.LeaveTypeID, 25);
      } else {
        // Fallback for legacy records: restore to 100%
        db.prepare(`
          UPDATE LeaveBalances
          SET TotalBalance = TotalBalance + ?
          WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = 100
        `).run(leave.DaysCount, leave.EmployeeID, leave.LeaveTypeID);
      }
    }

    // Step 4: DELETE FROM Leaves WHERE LeaveID = ? / تنفيذ الحذف
    const result = db
      .prepare('DELETE FROM Leaves WHERE LeaveID = ?')
      .run(leaveId);

    if (result.changes === 0) {
      throw new Error(`فشل حذف قيد الإجازة برقم (${leaveId}).`);
    }

    // توثيق الحذف في سجل الأمان والتدقيق
    AuditService.logAction(db, {
      actionType: 'DELETE',
      entityType: 'Leave',
      entityID: leaveId,
      oldValue: leave,
      newValue: null,
      details: `حذف سجل إجازة (${leave.LeaveTypeName} - ${leave.DaysCount} يوم) للموظف رقم (${leave.EmployeeID})`,
    });

    return { success: true, deletedLeaveId: leaveId };
  });

  return _txn();
}

// ──────────────────────────────────────────────────────────────
//  updateLeave
//
//  تحديث بيانات قيد إجازة قائم داخل معاملة ذرية متكاملة:
//  - يتحقق من قيود الجنس والتواريخ والمدد ومنع التداخل الزمني.
//  - يعيد تقييم الأرصدة (الاعتيادية والمرضية) ويدعم التجاوز بتأكيد صريح (Soft Limits).
//  - يسجل اسم القائم بالتعديل بشكل إلزامي في سجل التدقيق والأمان.
//
//  Updates an existing leave record within an atomic transaction.
//  Re-evaluates balance rules (Regular and Sick), handles soft limits
//  (allowing excess with explicit confirmation), logs the change to
//  AuditLogs with the mandatory modifier name, and returns the result.
//
//  @param {number} leaveId
//  @param {object} payload
//  @param {import('better-sqlite3').Database} db
//  @returns {{ success: boolean, requiresConfirmation?: boolean, quotaExceeded?: boolean, leaveId?: number, deficit?: number, availableBalance?: number, remainingBalance?: number, message?: string }}
// ──────────────────────────────────────────────────────────────
function updateLeave(leaveId, payload, db) {
  if (!Number.isInteger(leaveId) || leaveId <= 0) {
    throw new Error('معرّف الإجازة غير صالح.');
  }

  const {
    leaveType,
    startDate,
    endDate,
    requestedDays,
    leaveApprover,
    requestDate,
    memoNumber,
    memoDate,
    orderNumber,
    orderDate,
    notes,
    modifierName,
    confirmExcess = false,
  } = payload || {};

  const trimmedModifier = (modifierName || '').trim();
  if (!trimmedModifier) {
    throw new Error('اسم القائم بالتعديل إلزامي ولا يمكن حفظ التعديل بدونه.');
  }

  const validOrderNumber = validateOrderNumber(orderNumber, 'رقم الأمر الإداري');
  const validMemoNumber = validateOrderNumber(memoNumber, 'رقم المذكرة');

  // 1. Fetch current leave snapshot with employee metadata / جلب السجل الحالي وبيانات الموظف
  const oldLeave = db.prepare(`
    SELECT
      l.*,
      lt.Name AS LeaveTypeName,
      e.FullName AS EmployeeFullName,
      e.Gender AS EmployeeGender,
      e.HireDate,
      e.AdjustmentDays,
      e.IsActive AS EmployeeIsActive
    FROM Leaves l
    JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    JOIN Employees e ON e.EmployeeID = l.EmployeeID
    WHERE l.LeaveID = ?
  `).get(leaveId);

  if (!oldLeave) {
    throw new Error(`تعذر العثور على قيد الإجازة برقم (${leaveId}).`);
  }

  // 2. Resolve target LeaveType / تحديد نوع الإجازة المستهدف
  let targetLeaveType = null;
  if (typeof leaveType === 'number') {
    targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE LeaveTypeID = ?').get(leaveType);
  } else if (typeof leaveType === 'string' && leaveType.trim()) {
    targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get(leaveType.trim());
    if (!targetLeaveType) {
      if (leaveType === 'regular' || leaveType === 'اعتيادية') {
        targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('إجازة اعتيادية');
      } else if (leaveType === 'sick' || leaveType === 'مرضية') {
        targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get(LEAVE_NAME_SICK);
      } else if (leaveType === 'other' || leaveType === 'سبب آخر') {
        targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('سبب آخر');
      } else if (leaveType === 'training' || leaveType === 'دورة تدريبية') {
        targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE Name = ?').get('دورة تدريبية');
      }
    }
  } else {
    targetLeaveType = db.prepare('SELECT * FROM LeaveTypes WHERE LeaveTypeID = ?').get(oldLeave.LeaveTypeID);
  }

  if (!targetLeaveType) {
    throw new Error(`نوع الإجازة المحدد غير معرّف بالنظام: "${leaveType}".`);
  }

  // Check gender restriction / التحقق من قيود الجنس (مثل إجازة الأمومة)
  if (targetLeaveType.GenderRestriction === 'Female' && oldLeave.EmployeeGender !== 'Female') {
    throw new Error(`نوع الإجازة (${targetLeaveType.Name}) مخصص للإناث فقط.`);
  }

  // Validate dates / التحقق من صحة التواريخ
  if (!startDate || !endDate) {
    throw new Error('يرجى تحديد تاريخ بداية ونهاية الإجازة.');
  }
  if (endDate < startDate) {
    throw new Error('تاريخ النهاية يجب أن يكون بعد أو مساوياً لتاريخ البداية.');
  }

  const calculatedDays = _daysBetween(startDate, endDate) + 1;
  const finalDaysCount = Number.isInteger(requestedDays) && requestedDays > 0 ? requestedDays : calculatedDays;

  if (finalDaysCount !== calculatedDays) {
    throw new Error(`عدد الأيام المدخل (${finalDaysCount} يوم) لا يتطابق مع الفترة المحددة (${calculatedDays} يوم).`);
  }

  const effectiveOrderRef = (validOrderNumber || '').trim() || (oldLeave.OrderRef || null);
  if (targetLeaveType.RequiresOrderRef === 1 && !effectiveOrderRef) {
    throw new Error(`رقم الأمر الإداري إلزامي لنوع الإجازة (${targetLeaveType.Name}).`);
  }

  // ── Overlap Guard (Strict Prevention, Excluding Current Leave) ─
  // التحقق من عدم التداخل مع إجازات الموظف الأخرى (باستثناء الإجازة الحالية الجاري تعديلها)
  const overlap = checkLeaveOverlap(oldLeave.EmployeeID, startDate, endDate, leaveId, db);
  if (overlap) {
    throw new Error(
      `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
    );
  }

  // 3. Balance management inside atomic transaction
  // إدارة الأرصدة وإعادة الحساب داخل المعاملة الذرية
  const _txn = db.transaction(() => {
    let quotaExceeded = false;
    let deficit = 0;
    let availableBalance = null;
    let remainingBalance = null;

    const isOldSick = oldLeave.LeaveTypeName === LEAVE_NAME_SICK;
    const isNewSick = targetLeaveType.Name === LEAVE_NAME_SICK;
    const isOldRegular = oldLeave.LeaveTypeName === 'إجازة اعتيادية' || oldLeave.LeaveTypeName === 'سبب آخر';
    const isNewRegular = targetLeaveType.Name === 'إجازة اعتيادية' || targetLeaveType.Name === 'سبب آخر';

    // A: Handle Sick Leave Bucket Restoration / استرداد الرصيد المرضي السابق في حال تم تغيير نوع الإجازة أو تعديلها
    if (isOldSick) {
      const match = oldLeave.Notes?.match(/(\d+)d\s*@\s*100%\s*pay[,\s]+(\d+)d\s*@\s*50%\s*pay(?:[,\s]+(\d+)d\s*@\s*25%\s*pay)?/);
      if (match) {
        const d100 = parseInt(match[1], 10) || 0;
        const d50  = parseInt(match[2], 10) || 0;
        const d25  = parseInt(match[3] || '0', 10) || 0;
        const updateBal = db.prepare(`
          UPDATE LeaveBalances
          SET TotalBalance = TotalBalance + ?
          WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = ?
        `);
        if (d100 > 0) updateBal.run(d100, oldLeave.EmployeeID, oldLeave.LeaveTypeID, 100);
        if (d50 > 0)  updateBal.run(d50, oldLeave.EmployeeID, oldLeave.LeaveTypeID, 50);
        if (d25 > 0)  updateBal.run(d25, oldLeave.EmployeeID, oldLeave.LeaveTypeID, 25);
      } else {
        db.prepare(`
          UPDATE LeaveBalances
          SET TotalBalance = TotalBalance + ?
          WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = 100
        `).run(oldLeave.DaysCount, oldLeave.EmployeeID, oldLeave.LeaveTypeID);
      }
    }

    // B: Handle Target Sick Leave Deduction / معالجة خصم الرصيد المرضي الجديد
    if (isNewSick) {
      db.prepare(`
        INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
        VALUES (?, ?, 30, 100), (?, ?, 45, 50), (?, ?, 45, 25)
      `).run(
        oldLeave.EmployeeID, targetLeaveType.LeaveTypeID,
        oldLeave.EmployeeID, targetLeaveType.LeaveTypeID,
        oldLeave.EmployeeID, targetLeaveType.LeaveTypeID
      );

      const balances = db.prepare(`
        SELECT PayPercentage, TotalBalance
        FROM LeaveBalances
        WHERE EmployeeID = ? AND LeaveTypeID = ?
        ORDER BY PayPercentage DESC
      `).all(oldLeave.EmployeeID, targetLeaveType.LeaveTypeID);

      const bucket = { 100: 0, 50: 0, 25: 0 };
      for (const row of balances) {
        if (row.PayPercentage === 100 || row.PayPercentage === 50 || row.PayPercentage === 25) {
          bucket[row.PayPercentage] = row.TotalBalance;
        }
      }

      const totalAvailable = bucket[100] + bucket[50] + bucket[25];
      if (finalDaysCount > totalAvailable) {
        quotaExceeded = true;
        deficit = finalDaysCount - totalAvailable;
      }

      if (quotaExceeded && !confirmExcess) {
        return {
          success: false,
          requiresConfirmation: true,
          quotaExceeded: true,
          leaveType: targetLeaveType.Name,
          requestedDays: finalDaysCount,
          availableBalance: totalAvailable,
          deficit,
          message: `عدد الأيام المطلوبة (${finalDaysCount} يوم) يتجاوز الرصيد المرضي المتاح (${totalAvailable} يوم) بمقدار (${deficit} يوم). هل تريد المتابعة وتأكيد الحفظ؟`
        };
      }

      let daysAt100 = 0;
      let daysAt50 = 0;
      let daysAt25 = 0;
      let remaining = finalDaysCount;

      if (remaining <= bucket[100]) {
        daysAt100 = remaining;
      } else {
        daysAt100 = Math.max(0, bucket[100]);
        remaining -= daysAt100;
        if (remaining <= bucket[50]) {
          daysAt50 = remaining;
        } else {
          daysAt50 = Math.max(0, bucket[50]);
          remaining -= daysAt50;
          daysAt25 = remaining;
        }
      }

      const updateBal = db.prepare(`
        UPDATE LeaveBalances
        SET TotalBalance = TotalBalance - ?
        WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = ?
      `);

      if (daysAt100 > 0) updateBal.run(daysAt100, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, 100);
      if (daysAt50 > 0) updateBal.run(daysAt50, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, 50);
      if (daysAt25 > 0) updateBal.run(daysAt25, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, 25);

    } else if (isNewRegular) {
      // C: Handle Regular Leave Balance / معالجة رصيد الإجازة الاعتيادية
      const currentBalance = calculateRegularLeaveBalance(oldLeave.EmployeeID, db);
      const effectiveAvailable = currentBalance.availableBalance + (isOldRegular ? oldLeave.DaysCount : 0);
      availableBalance = effectiveAvailable;
      remainingBalance = effectiveAvailable - finalDaysCount;

      if (finalDaysCount > effectiveAvailable) {
        quotaExceeded = true;
        deficit = finalDaysCount - effectiveAvailable;
      }

      if (quotaExceeded && !confirmExcess) {
        return {
          success: false,
          requiresConfirmation: true,
          quotaExceeded: true,
          leaveType: targetLeaveType.Name,
          requestedDays: finalDaysCount,
          availableBalance: effectiveAvailable,
          deficit,
          message: `عدد الأيام المطلوبة (${finalDaysCount} يوم) يتجاوز الرصيد الاعتيادي المتاح (${effectiveAvailable} يوم) بمقدار (${deficit} يوم). هل تريد المتابعة وتأكيد الحفظ برصيد سالب؟`
        };
      }
    }

    // D: Persist the UPDATE into Leaves / تحديث السجل في جدول Leaves
    db.prepare(`
      UPDATE Leaves
      SET LeaveTypeID = ?,
          StartDate = ?,
          EndDate = ?,
          DaysCount = ?,
          OrderRef = ?,
          Notes = ?,
          LeaveApprover = ?,
          RequestDate = ?,
          MemoNumber = ?,
          MemoDate = ?,
          OrderNumber = ?,
          OrderDate = ?
      WHERE LeaveID = ?
    `).run(
      targetLeaveType.LeaveTypeID,
      startDate,
      endDate,
      finalDaysCount,
      validOrderNumber || effectiveOrderRef,
      notes ?? null,
      leaveApprover ?? null,
      requestDate ?? null,
      validMemoNumber ?? null,
      memoDate ?? null,
      validOrderNumber ?? null,
      orderDate ?? null,
      leaveId
    );

    // Fetch updated record
    const updatedLeave = db.prepare(`
      SELECT
        l.*,
        lt.Name AS LeaveTypeName
      FROM Leaves l
      JOIN LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE l.LeaveID = ?
    `).get(leaveId);

    // E: Record Audit Trail with Modifier Name in details / توثيق التعديل واسم القائم به في سجل الأمان
    AuditService.logAction(db, {
      actionType: 'UPDATE',
      entityType: 'Leave',
      entityID: leaveId,
      oldValue: {
        LeaveID: oldLeave.LeaveID,
        EmployeeID: oldLeave.EmployeeID,
        LeaveType: oldLeave.LeaveTypeName,
        StartDate: oldLeave.StartDate,
        EndDate: oldLeave.EndDate,
        DaysCount: oldLeave.DaysCount,
        LeaveApprover: oldLeave.LeaveApprover,
        RequestDate: oldLeave.RequestDate,
        MemoNumber: oldLeave.MemoNumber,
        MemoDate: oldLeave.MemoDate,
        OrderNumber: oldLeave.OrderNumber,
        OrderDate: oldLeave.OrderDate,
        Notes: oldLeave.Notes,
      },
      newValue: {
        LeaveID: updatedLeave.LeaveID,
        EmployeeID: updatedLeave.EmployeeID,
        LeaveType: updatedLeave.LeaveTypeName,
        StartDate: updatedLeave.StartDate,
        EndDate: updatedLeave.EndDate,
        DaysCount: updatedLeave.DaysCount,
        LeaveApprover: updatedLeave.LeaveApprover,
        RequestDate: updatedLeave.RequestDate,
        MemoNumber: updatedLeave.MemoNumber,
        MemoDate: updatedLeave.MemoDate,
        OrderNumber: updatedLeave.OrderNumber,
        OrderDate: updatedLeave.OrderDate,
        Notes: updatedLeave.Notes,
        ModifiedBy: trimmedModifier,
      },
      details: `تم تعديل الإجازة بواسطة: ${trimmedModifier} — الموظف: ${oldLeave.EmployeeFullName} (تغيير من [${oldLeave.LeaveTypeName} من ${oldLeave.StartDate} إلى ${oldLeave.EndDate} (${oldLeave.DaysCount} يوم)] إلى [${targetLeaveType.Name} من ${startDate} إلى ${endDate} (${finalDaysCount} يوم)])`,
    });

    return {
      success: true,
      leaveId,
      quotaExceeded,
      deficit,
      availableBalance,
      remainingBalance,
      updatedLeave,
    };
  });

  return _txn();
}

// ──────────────────────────────────────────────────────────────
//  Exports / تصدير دوال وثوابت الخدمة
// ──────────────────────────────────────────────────────────────
module.exports = {
  calculateRegularLeaveBalance,
  processSickLeave,
  processRegularLeave,
  getActiveLeavesForToday,
  getActiveLeavesToday: getActiveLeavesForToday,
  getActiveLeavesTodayPaginated,
  getApproachingResumptions,
  getEmployeeLeaves,
  deleteLeave,
  updateLeave,
  checkLeaveOverlap,

  // Expose constants so IPC handlers and tests can reference them
  // without embedding magic numbers.
  CONSTANTS: {
    DAYS_PER_EARNED_LEAVE,
    MAX_REGULAR_BALANCE,
    SICK_100_MAX,
    SICK_50_MAX,
    SICK_25_MAX,
    SICK_TOTAL_MAX,
    LEAVE_NAME_UNPAID,
    LEAVE_NAME_SICK,
  },
};
