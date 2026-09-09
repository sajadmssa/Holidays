// ============================================================
//  services/LeaveService.js  –  Core Leave Calculation Engine
//  Responsibilities:
//    • calculateRegularLeaveBalance: net-service-days algorithm
//    • processSickLeave:             100%/50% bucket deduction
//                                    wrapped in a db.transaction()
//
//  CONTRACT:
//    • Every exported function receives `db` (a better-sqlite3
//      Database instance) as its LAST argument.  This keeps the
//      service stateless and easily testable.
//    • All operations are synchronous (better-sqlite3 is sync-only).
//    • Functions throw on any unrecoverable error; callers (IPC
//      handlers) must wrap calls in try/catch and surface the
//      error message to the renderer.
// ============================================================

'use strict';

const AuditService = require('./AuditService');
const { validateOrderNumber } = require('../utils/orderNumberValidator');

// ──────────────────────────────────────────────────────────────
//  Business-rule constants
// ──────────────────────────────────────────────────────────────
const DAYS_PER_EARNED_LEAVE = 10;  // 1 day earned per 10 actual service days
const MAX_REGULAR_BALANCE   = 180; // Accumulation ceiling (days)

const SICK_100_MAX          = 28;  // Days paid at 100 %
const SICK_50_MAX           = 45;  // Additional days paid at 50 %
const SICK_TOTAL_MAX        = SICK_100_MAX + SICK_50_MAX; // 73 days/year

// Names as stored in LeaveTypes seed data (must match exactly)
const LEAVE_NAME_UNPAID     = 'إجازة بدون راتب';
const LEAVE_NAME_SICK       = 'إجازة مرضية';

// ──────────────────────────────────────────────────────────────
//  Internal helpers
// ──────────────────────────────────────────────────────────────

/**
 * Returns the number of whole calendar days between two ISO-8601
 * date strings (or Date objects).  Result is (to - from) in days.
 * Throws if either value cannot be parsed.
 *
const LoggerService = require('./LoggerService');

/**
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

  // Strip time component so we always count whole days
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());

  return Math.floor((utc2 - utc1) / MS_PER_DAY);
}

/**
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
 * Checks if the requested date range overlaps with any existing leave for the employee.
 * Returns the conflicting leave details if an overlap exists, or null if clear.
 *
 * @param {number} employeeId
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate   - YYYY-MM-DD
 * @param {number|null} [excludeLeaveId=null] - LeaveID to exclude (when editing)
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
//  PUBLIC API
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  calculateRegularLeaveBalance
//
//  Calculates the employee's CURRENT AVAILABLE regular-leave balance.
//  Fixes critical accounting bug: gross earned days must have all
//  previously-taken regular leaves subtracted before being returned.
//  Leave type IDs are resolved dynamically from the DB by Arabic name.
//
//  Algorithm:
//    1.  Validate employeeId.
//    2.  Fetch HireDate from Employees.
//    3.  Calculate total calendar days from HireDate to Today.
//    4.  Dynamically resolve LeaveTypeID for 'إجازة بدون راتب' (Unpaid)
//        and 'إجازة اعتيادية' (Regular). Throw if either is missing.
//    5.  Sum DaysCount of all Unpaid Leave taken by this employee.
//    6.  Sum DaysCount of all Regular Leave taken by this employee.
//    7.  Net Service Days = Total Calendar Days − Unpaid Leave Days.
//    8.  Gross Earned Balance = floor(Net Service Days / 10).
//    9.  Current Available Balance = Gross Earned − Regular Leaves Taken.
//    10. Final Balance = min(Current Available Balance, 180)  [never < 0].
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

  // ── Step 1: Validate input ──────────────────────────────────
  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    throw new Error('الرقم الوظيفي غير صالح.');
  }

  // ── Step 2: Fetch employee record ───────────────────────────
  const employee = db
    .prepare('SELECT EmployeeID, HireDate, IsActive, AdjustmentDays FROM Employees WHERE EmployeeID = ?')
    .get(employeeId);

  if (!employee) {
    throw new Error(`تعذر العثور على الموظف برقم (${employeeId}).`);
  }

  // ── Step 3: Total calendar days from HireDate to today ──────
  const today     = new Date();
  const totalDays = _daysBetween(employee.HireDate, today);

  if (totalDays < 0) {
    throw new Error(`تاريخ التعيين (${employee.HireDate}) في المستقبل، لا يمكن احتساب الرصيد.`);
  }

  // ── Step 4: Dynamically resolve required LeaveType IDs ──────
  //  Use exact Arabic names as stored in the seed data.
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
  const unpaidDays = db.prepare(`
    SELECT COALESCE(SUM(l.DaysCount), 0) AS TotalDays
    FROM   Leaves l
    WHERE  l.EmployeeID  = ?
      AND  l.LeaveTypeID = ?
  `).get(employeeId, unpaidLeaveType.LeaveTypeID).TotalDays;

  // ── Step 6: Sum all Regular + Other Leave days already taken 
  //  "سبب آخر" deducts directly from the Regular Leave balance.
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
  const netServiceDays = Math.max(0, totalDays - unpaidDays);

  // ── Step 8: Gross earned balance ────────────────────────────
  const grossEarnedBalance = Math.floor(netServiceDays / DAYS_PER_EARNED_LEAVE);

  // ── Step 9: Deduct regular leaves already consumed ──────────
  const availableBalance = grossEarnedBalance + employee.AdjustmentDays - regularLeavesTaken;

  // ── Step 10: Cap at MAX and floor at 0 ──────────────────────
  const finalBalance = Math.min(Math.max(availableBalance, 0), MAX_REGULAR_BALANCE);

  return {
    employeeId,
    hireDate:           employee.HireDate,
    totalDays,
    unpaidDays,
    netServiceDays,
    grossEarnedBalance,   // Days earned before deducting consumed leave
    regularLeavesTaken,   // Days already recorded in Leaves table
    adjustmentDays:     employee.AdjustmentDays, // Manual adjustments
    availableBalance,     // grossEarned + adjustment - taken  (may be negative before clamp)
    finalBalance,         // Authoritative value: min(max(available, 0), 180)
  };
}

// ──────────────────────────────────────────────────────────────
//  processSickLeave
//
//  Validates and applies a sick-leave request against the two-tier
//  (100% / 50%) pay-bucket system inside a single atomic transaction.
//
//  Bucket rules (per year):
//    • First 30 days → full pay  (PayPercentage = 100)
//    • Next  45 days → half pay  (PayPercentage = 50)
//    • Beyond 75 days combined → request REJECTED
//
//  Transaction guarantee: if ANY step throws, the entire
//  transaction is rolled back automatically — no partial mutations.
//
//  @param {number} employeeId
//  @param {number} requestedDays   Positive integer
//  @param {string} startDate       ISO-8601 (YYYY-MM-DD)
//  @param {string} endDate         ISO-8601 (YYYY-MM-DD)
//  @param {import('better-sqlite3').Database} db
//  @returns {{
//    leaveId:       number,
//    daysAt100:     number,
//    daysAt50:      number,
//    newBalance100: number,
//    newBalance50:  number
//  }}
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

  // Hard ceiling before touching the DB - REMOVED for soft limit support

  // ── Overlap Guard (Strict Prevention) ─────────────────────
  const overlap = checkLeaveOverlap(employeeId, startDate, endDate, null, db);
  if (overlap) {
    throw new Error(
      `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
    );
  }

  // ── Resolve LeaveTypeID for Sick Leave ─────────────────────
  const sickLeaveType = _requireLeaveType(LEAVE_NAME_SICK, db);

  // ── Define the atomic transaction ──────────────────────────
  const _runTransaction = db.transaction(() => {

    // Auto-ensure default Sick Leave balance rows exist for employee
    db.prepare(`
      INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
      VALUES (?, ?, 28, 100), (?, ?, 45, 50)
    `).run(employeeId, sickLeaveType.LeaveTypeID, employeeId, sickLeaveType.LeaveTypeID);

    // ── A: Read both balance buckets ─────────────────────────
    const balances = db
      .prepare(`
        SELECT PayPercentage, TotalBalance
        FROM   LeaveBalances
        WHERE  EmployeeID  = ?
          AND  LeaveTypeID = ?
        ORDER  BY PayPercentage DESC   -- 100 first, then 50
      `)
      .all(employeeId, sickLeaveType.LeaveTypeID);

    const bucket = { 100: 0, 50: 0 };
    for (const row of balances) {
      if (row.PayPercentage === 100 || row.PayPercentage === 50) {
        bucket[row.PayPercentage] = row.TotalBalance;
      }
    }

    const totalAvailable = bucket[100] + bucket[50];
    const quotaExceeded = requestedDays > totalAvailable;

    // ── B/C/D: Distribute requested days across buckets ─────────
    let daysAt100 = 0;
    let daysAt50  = 0;
    let remaining = requestedDays;

    if (remaining <= bucket[100]) {
      // Entire request satisfied by the 100% bucket
      daysAt100 = remaining;
      remaining = 0;
    } else {
      // Exhaust the 100% bucket, spill remainder into 50%
      // 50% bucket might go negative, which is allowed with soft limits
      daysAt100 = bucket[100];
      remaining -= bucket[100];
      daysAt50  = remaining;
      remaining = 0;
    }

    // ── E: Persist deductions ─────────────────────────────────
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

    // ── F: Insert Leaves record (DB triggers still fire here) ─
    //  trg_prevent_female_leave_for_male, trg_prevent_inactive_employee_leave,
    //  trg_enforce_order_ref, and trg_audit_leave_insert all fire on this INSERT.
    //  Any trigger RAISE(ABORT, …) rolls back the whole transaction.
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
        `Sick Leave processed: ${daysAt100}d @ 100% pay, ${daysAt50}d @ 50% pay`,
        leaveApprover ?? null,
        requestDate ?? null,
        memoNumber ?? null,
        memoDate ?? null,
        orderNumber ?? null,
        orderDate ?? null
      );

    const newLeaveId = Number(insertResult.lastInsertRowid);

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
      newBalance100: bucket[100] - daysAt100,
      newBalance50:  bucket[50]  - daysAt50,
      quotaExceeded,
    };
  }); // end transaction definition

  // Execute — any uncaught throw inside auto-rolls back
  return _runTransaction();
}

// ──────────────────────────────────────────────────────────────
//  getActiveLeavesForToday
//
//  Returns all leave records where today's local date falls
//  inclusively between StartDate and EndDate.
//  Includes computed DaysRemaining and expected ResumptionDate.
//
//  Columns returned:
//    FullName       – from Employees
//    LeaveCardNumber– from Employees
//    WorkLocation   – from Employees
//    LeaveName      – aliased from LeaveTypes.Name
//    StartDate      – from Leaves
//    EndDate        – from Leaves
//    ResumptionDate – day after EndDate (DATE(EndDate, '+1 day'))
//    DaysRemaining  – days left until EndDate (0 = ends today)
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
      ORDER  BY l.EndDate ASC, e.FullName ASC
    `)
    .all();
}

// ──────────────────────────────────────────────────────────────
//  getActiveLeavesTodayPaginated
//
//  Server-side paginated query for Active Leaves Today tab with
//  search filter, total count, and 15 rows per page.
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

  // 1. Total matching count
  const countQuery = `
    SELECT COUNT(*) AS total
    FROM   Leaves     l
    JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
    JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
    WHERE  date('now', 'localtime') BETWEEN l.StartDate AND l.EndDate
    ${searchClause}
  `;
  const countRow = db.prepare(countQuery).get(...countParams);
  const totalCount = countRow ? countRow.total : 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / safePageSize));

  // Determine dynamic sort order
  let orderByClause = 'ORDER BY l.EndDate ASC, e.FullName ASC';
  if (sortBy === 'resumption_desc') {
    orderByClause = 'ORDER BY l.EndDate DESC, e.FullName ASC';
  } else if (sortBy === 'name_asc') {
    orderByClause = 'ORDER BY e.FullName ASC, l.EndDate ASC';
  }

  // 2. Paginated data query
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
//  Returns employees whose leave is ending within the next N days
//  (inclusive of today, default 3 days) for notification triggers.
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
        AND  l.EndDate <= date('now', 'localtime', '+' || ? || ' days')
      ORDER  BY l.EndDate ASC, e.FullName ASC
    `)
    .all(daysThreshold);
}

// ──────────────────────────────────────────────────────────────
//  getEmployeeLeaves
//
//  Fetches all historical leave records for a specific employee,
//  joining LeaveTypes to include the human-readable leave name.
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
    // Step 1: Query the Leaves row with LeaveType name
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

    // Step 2 & 3: IF Sick Leave, restore DaysCount back to LeaveBalances
    if (leave.LeaveTypeName === LEAVE_NAME_SICK) {
      db.prepare(`
        UPDATE LeaveBalances
        SET    TotalBalance = TotalBalance + ?
        WHERE  EmployeeID   = ?
          AND  LeaveTypeID  = ?
      `).run(leave.DaysCount, leave.EmployeeID, leave.LeaveTypeID);
    }

    // Step 4: DELETE FROM Leaves WHERE LeaveID = ?
    const result = db
      .prepare('DELETE FROM Leaves WHERE LeaveID = ?')
      .run(leaveId);

    if (result.changes === 0) {
      throw new Error(`فشل حذف قيد الإجازة برقم (${leaveId}).`);
    }

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

  // 1. Fetch current leave snapshot with employee metadata
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

  // 2. Resolve target LeaveType
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

  // Check gender restriction
  if (targetLeaveType.GenderRestriction === 'Female' && oldLeave.EmployeeGender !== 'Female') {
    throw new Error(`نوع الإجازة (${targetLeaveType.Name}) مخصص للإناث فقط.`);
  }

  // Validate dates
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
  const overlap = checkLeaveOverlap(oldLeave.EmployeeID, startDate, endDate, leaveId, db);
  if (overlap) {
    throw new Error(
      `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
    );
  }

  // 3. Balance management inside atomic transaction
  const _txn = db.transaction(() => {
    let quotaExceeded = false;
    let deficit = 0;
    let availableBalance = null;
    let remainingBalance = null;

    const isOldSick = oldLeave.LeaveTypeName === LEAVE_NAME_SICK;
    const isNewSick = targetLeaveType.Name === LEAVE_NAME_SICK;
    const isOldRegular = oldLeave.LeaveTypeName === 'إجازة اعتيادية' || oldLeave.LeaveTypeName === 'سبب آخر';
    const isNewRegular = targetLeaveType.Name === 'إجازة اعتيادية' || targetLeaveType.Name === 'سبب آخر';

    // A: Handle Sick Leave Bucket Restoration
    if (isOldSick) {
      db.prepare(`
        UPDATE LeaveBalances
        SET TotalBalance = TotalBalance + ?
        WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = 100
      `).run(oldLeave.DaysCount, oldLeave.EmployeeID, oldLeave.LeaveTypeID);
    }

    // B: Handle Target Sick Leave Deduction
    if (isNewSick) {
      db.prepare(`
        INSERT OR IGNORE INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
        VALUES (?, ?, 28, 100), (?, ?, 45, 50)
      `).run(oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID);

      const balances = db.prepare(`
        SELECT PayPercentage, TotalBalance
        FROM LeaveBalances
        WHERE EmployeeID = ? AND LeaveTypeID = ?
        ORDER BY PayPercentage DESC
      `).all(oldLeave.EmployeeID, targetLeaveType.LeaveTypeID);

      const bucket = { 100: 0, 50: 0 };
      for (const row of balances) {
        if (row.PayPercentage === 100 || row.PayPercentage === 50) {
          bucket[row.PayPercentage] = row.TotalBalance;
        }
      }

      const totalAvailable = bucket[100] + bucket[50];
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
      let remaining = finalDaysCount;

      if (remaining <= bucket[100]) {
        daysAt100 = remaining;
      } else {
        daysAt100 = bucket[100];
        remaining -= bucket[100];
        daysAt50 = remaining;
      }

      const updateBal = db.prepare(`
        UPDATE LeaveBalances
        SET TotalBalance = TotalBalance - ?
        WHERE EmployeeID = ? AND LeaveTypeID = ? AND PayPercentage = ?
      `);

      if (daysAt100 > 0) updateBal.run(daysAt100, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, 100);
      if (daysAt50 > 0) updateBal.run(daysAt50, oldLeave.EmployeeID, targetLeaveType.LeaveTypeID, 50);

    } else if (isNewRegular) {
      // C: Handle Regular Leave Balance
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

    // D: Persist the UPDATE into Leaves
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

    // E: Record Audit Trail with Modifier Name in details
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
//  Exports
// ──────────────────────────────────────────────────────────────
module.exports = {
  calculateRegularLeaveBalance,
  processSickLeave,
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
    SICK_TOTAL_MAX,
    LEAVE_NAME_UNPAID,
    LEAVE_NAME_SICK,
  },
};

