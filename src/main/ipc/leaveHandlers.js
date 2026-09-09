// ============================================================
//  ipc/leaveHandlers.js  –  Leave Engine IPC Handlers
//  Responsibilities:
//    • Register the three leave-engine IPC channels
//    • Enforce the uniform { success, data|error } response envelope
//    • Never crash the Main process — all errors are caught and
//      serialised back to the Renderer as { success: false, error }
//
//  Channels exposed:
//    leave:getRegularBalance   – calculateRegularLeaveBalance
//    leave:submitSickLeave     – processSickLeave
//    leave:submitRegularLeave  – balance check + transactional INSERT
//
//  This module is stateless.  The live `db` instance is injected
//  at startup so the service stays testable without Electron running.
// ============================================================

'use strict';

const LeaveService = require('../services/LeaveService');
const AuditService = require('../services/AuditService');
const LoggerService = require('../services/LoggerService');
const { translateSqliteError } = require('../utils/sqliteErrorTranslator');
const { validateOrderNumber } = require('../utils/orderNumberValidator');

// ──────────────────────────────────────────────────────────────
//  Internal: uniform response wrapper
//  Keeps every handler free of duplicated try/catch boilerplate.
//
//  @param {Function} fn  Synchronous function that returns a value
//                        or throws an Error.
//  @returns {Function}   Electron ipcMain handler  (_event, ...args) => {}
// ──────────────────────────────────────────────────────────────
function safeHandle(fn) {
  return (_event, ...args) => {
    try {
      const data = fn(...args);
      return { success: true, data };
    } catch (err) {
      // Log full stack in app.log; send friendly message to Renderer
      LoggerService.error('LeaveHandlers', 'IPC Error', err);
      return { success: false, error: translateSqliteError(err) || err.message };
    }
  };
}

// ──────────────────────────────────────────────────────────────
//  CRIT-2 FIX: Input Validators
// ──────────────────────────────────────────────────────────────

/**
 * Returns true only if `dateString` is both structurally valid
 * (YYYY-MM-DD regex) AND calendrically real (e.g. rejects '2024-02-30').
 * Uses UTC parsing to avoid locale-timezone day-shift false positives.
 *
 * @param {string} dateString
 * @returns {boolean}
 */
const isValidDate = (dateString) =>
  typeof dateString === 'string' &&
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(dateString) &&
  !isNaN(new Date(dateString).getTime());

/** Maximum character length for free-text fields (notes, descriptions). */
const MAX_TEXT_LENGTH = 500;

// ──────────────────────────────────────────────────────────────
//  registerLeaveHandlers(ipcMain, db)
//
//  Call this ONCE after db.initialize() in main.js.
//
//  @param {Electron.IpcMain} ipcMain  – Electron ipcMain instance
//  @param {import('better-sqlite3').Database} db  – Initialised DB
// ──────────────────────────────────────────────────────────────
function registerLeaveHandlers(ipcMain, db) {

  // ── leave:getRegularBalance ──────────────────────────────────
  //
  //  Returns the employee's current available regular-leave balance
  //  plus full diagnostic data (grossEarned, taken, netServiceDays…).
  //
  //  Renderer payload:  employeeId  {number}
  //  Response data:     { finalBalance, grossEarnedBalance, regularLeavesTaken, … }
  // ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'leave:getRegularBalance',
    safeHandle((employeeId) => {
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(
          `leave:getRegularBalance: invalid employeeId (${employeeId}).`
        );
      }
      return LeaveService.calculateRegularLeaveBalance(employeeId, db);
    })
  );

  // ── leave:submitSickLeave ────────────────────────────────────
  //
  //  Validates and atomically processes a sick-leave request,
  //  deducting from 100%/50% pay buckets in the correct order.
  //
  //  Renderer payload:
  //    { employeeId, requestedDays, startDate, endDate }
  //  Response data:
  //    { leaveId, daysAt100, daysAt50, newBalance100, newBalance50 }
  // ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'leave:submitSickLeave',
    safeHandle((payload) => {
      const {
        employeeId,
        requestedDays,
        startDate,
        endDate,
        leaveApprover,
        requestDate,
        memoNumber,
        memoDate,
        orderNumber,
        orderDate,
      } = payload ?? {};

      // Surface-level guard before handing off to the service
      if (!payload || typeof payload !== 'object') {
        throw new Error('leave:submitSickLeave: payload must be an object.');
      }
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(`leave:submitSickLeave: invalid employeeId (${employeeId}).`);
      }
      if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
        throw new Error(`leave:submitSickLeave: invalid requestedDays (${requestedDays}).`);
      }
      // CRIT-2 FIX: Strict ISO-8601 date validation — rejects missing,
      // non-string, structurally invalid, and calendrically impossible dates.
      if (!isValidDate(startDate)) {
        throw new Error(
          `leave:submitSickLeave: invalid startDate "${startDate}". ` +
          'Expected a real calendar date in YYYY-MM-DD format.'
        );
      }
      if (!isValidDate(endDate)) {
        throw new Error(
          `leave:submitSickLeave: invalid endDate "${endDate}". ` +
          'Expected a real calendar date in YYYY-MM-DD format.'
        );
      }
      if (leaveApprover != null && typeof leaveApprover === 'string' && leaveApprover.length > MAX_TEXT_LENGTH) {
        throw new Error(
          `leave:submitSickLeave: leaveApprover field exceeds maximum allowed length ` +
          `of ${MAX_TEXT_LENGTH} characters.`
        );
      }
      if (memoNumber != null && typeof memoNumber === 'string' && memoNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم المذكرة طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (orderNumber != null && typeof orderNumber === 'string' && orderNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم الأمر الإداري طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }

      const validMemoNumber = validateOrderNumber(memoNumber, 'رقم المذكرة');
      const validOrderNumber = validateOrderNumber(orderNumber, 'رقم الأمر الإداري');

      return LeaveService.processSickLeave(
        employeeId,
        requestedDays,
        startDate,
        endDate,
        db,
        leaveApprover ?? null,
        {
          requestDate: requestDate || null,
          memoNumber: validMemoNumber,
          memoDate: memoDate || null,
          orderNumber: validOrderNumber,
          orderDate: orderDate || null,
        }
      );
    })
  );

  // ── leave:submitRegularLeave ─────────────────────────────────
  //
  //  1. Calls calculateRegularLeaveBalance to get finalBalance.
  //  2. Rejects if requestedDays > finalBalance.
  //  3. On approval, executes a db.transaction() that:
  //       a. Re-verifies the balance inside the transaction (prevents
  //          TOCTOU race if two requests land simultaneously).
  //       b. INSERTs the leave row (DB triggers still fire:
  //          gender guard, inactive-employee guard, audit log).
  //
  //  Renderer payload:
  //    { employeeId, requestedDays, startDate, endDate, orderRef?, notes?, requestDate?, memoNumber?, memoDate?, orderNumber?, orderDate? }
  //  Response data:
  //    { leaveId, finalBalance, requestedDays, remainingBalance }
  // ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'leave:submitRegularLeave',
    safeHandle((payload) => {
      const {
        employeeId,
        requestedDays,
        startDate,
        endDate,
        leaveType,
        orderRef,
        notes,
        leaveApprover,
        requestDate,
        memoNumber,
        memoDate,
        orderNumber,
        orderDate,
      } = payload ?? {};

      // ── Input guards ─────────────────────────────────────────
      if (!payload || typeof payload !== 'object') {
        throw new Error('leave:submitRegularLeave: payload must be an object.');
      }
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(`leave:submitRegularLeave: invalid employeeId (${employeeId}).`);
      }
      if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
        throw new Error(
          `leave:submitRegularLeave: invalid requestedDays (${requestedDays}).`
        );
      }
      // CRIT-2 FIX: Strict ISO-8601 date validation.
      if (!isValidDate(startDate)) {
        throw new Error('يرجى إدخال تاريخ بداية الإجازة بصيغة صحيحة (YYYY-MM-DD).');
      }
      if (!isValidDate(endDate)) {
        throw new Error('يرجى إدخال تاريخ نهاية الإجازة بصيغة صحيحة (YYYY-MM-DD).');
      }
      // CRIT-2 FIX: Cap free-text fields to prevent memory exhaustion
      if (notes != null && typeof notes === 'string' && notes.length > MAX_TEXT_LENGTH) {
        throw new Error(`حقل الملاحظات طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (leaveApprover != null && typeof leaveApprover === 'string' && leaveApprover.length > MAX_TEXT_LENGTH) {
        throw new Error(`اسم المسؤول عن منح الإجازة طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (memoNumber != null && typeof memoNumber === 'string' && memoNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم المذكرة طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (orderNumber != null && typeof orderNumber === 'string' && orderNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم الأمر الإداري طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }

      const validMemoNumber = validateOrderNumber(memoNumber, 'رقم المذكرة');
      const validOrderNumber = validateOrderNumber(orderNumber, 'رقم الأمر الإداري');
      const validOrderRef = validateOrderNumber(orderRef, 'رقم الأمر الإداري');

      // ── Resolve the target LeaveType ─────────────────────────
      let targetLeaveName = typeof leaveType === 'string' ? leaveType.trim() : '';

      // Legacy fallback mapping for backward compatibility
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

      // ── Step 0: Check Overlap (Strict Prevention) ───────────
      const overlap = LeaveService.checkLeaveOverlap(employeeId, startDate, endDate, null, db);
      if (overlap) {
        throw new Error(
          `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${overlap.LeaveTypeName} من ${overlap.StartDate} إلى ${overlap.EndDate} — ${overlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
        );
      }

      // ── Atomic transaction ──────────────────────────────────
      const _run = db.transaction(() => {
        let finalBalance = null;
        let remainingBalance = null;

        // Re-check overlap inside transaction for concurrency safety
        const txOverlap = LeaveService.checkLeaveOverlap(employeeId, startDate, endDate, null, db);
        if (txOverlap) {
          throw new Error(
            `تعذر الحفظ: يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف (${txOverlap.LeaveTypeName} من ${txOverlap.StartDate} إلى ${txOverlap.EndDate} — ${txOverlap.DaysCount} يوم). يرجى تصحيح التواريخ أو تعديل الإجازة السابقة.`
          );
        }

        if (isBalanced) {
          // Step A: Re-compute balance inside the transaction so the
          //         check and the insert are one atomic unit.
          const balanceResult = LeaveService.calculateRegularLeaveBalance(
            employeeId,
            db
          );

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
        //  DB triggers (gender, inactive-employee, audit) fire automatically.
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
            validOrderRef ?? (validOrderNumber || null),
            notes    ?? null,
            leaveApprover ?? null,
            requestDate ?? null,
            validMemoNumber  ?? null,
            memoDate    ?? null,
            validOrderNumber ?? null,
            orderDate   ?? null
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
            LeaveType: targetLeaveName,
            StartDate: startDate,
            EndDate: endDate,
            DaysCount: requestedDays,
            RemainingBalance: remainingBalance,
            LeaveApprover: leaveApprover ?? null,
            RequestDate: requestDate ?? null,
            MemoNumber: validMemoNumber ?? null,
            MemoDate: memoDate ?? null,
            OrderNumber: validOrderNumber ?? null,
            OrderDate: orderDate ?? null,
          },
          details: `تسجيل ${targetLeaveName} (${requestedDays} يوم) للموظف رقم (${employeeId}) من ${startDate} إلى ${endDate}`,
        });

        return {
          leaveId:           newLeaveId,
          finalBalance,
          requestedDays,
          remainingBalance,
        };
      });

      return _run();
    })
  );

  // ── leave:getActiveToday ─────────────────────────────────────
  ipcMain.handle(
    'leave:getActiveToday',
    safeHandle(() => {
      return LeaveService.getActiveLeavesForToday(db);
    })
  );

  // ── leave:getActiveTodayPaginated ─────────────────────────────
  ipcMain.handle(
    'leave:getActiveTodayPaginated',
    safeHandle((options = {}) => {
      return LeaveService.getActiveLeavesTodayPaginated(options, db);
    })
  );

  // ── leave:getHistory ──────────────────────────────────────────
  ipcMain.handle(
    'leave:getHistory',
    safeHandle((payload) => {
      const employeeId = Number(payload?.employeeId ?? payload);
      if (!Number.isInteger(employeeId) || employeeId <= 0) {
        throw new Error(`leave:getHistory: invalid employeeId (${employeeId}).`);
      }
      return LeaveService.getEmployeeLeaves(employeeId, db);
    })
  );

  // ── leave:delete ──────────────────────────────────────────────
  ipcMain.handle(
    'leave:delete',
    safeHandle((payload) => {
      const leaveId = Number(payload?.leaveId ?? payload);
      if (!Number.isInteger(leaveId) || leaveId <= 0) {
        throw new Error(`leave:delete: invalid leaveId (${leaveId}).`);
      }
      return LeaveService.deleteLeave(leaveId, db);
    })
  );

  // ── leave:update ──────────────────────────────────────────────
  //
  //  Updates an existing leave record, checks balances, records
  //  the mandatory modifier name in AuditLogs, and returns result.
  // ────────────────────────────────────────────────────────────
  ipcMain.handle(
    'leave:update',
    safeHandle((payload) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('leave:update: payload must be an object.');
      }

      const leaveId = Number(payload.leaveId);
      if (!Number.isInteger(leaveId) || leaveId <= 0) {
        throw new Error('معرّف الإجازة غير صالح.');
      }

      const modifierName = (payload.modifierName || '').trim();
      if (!modifierName) {
        throw new Error('اسم القائم بالتعديل إلزامي لإتمام عملية التعديل في سجل النظام.');
      }

      if (modifierName.length > MAX_TEXT_LENGTH) {
        throw new Error(`اسم القائم بالتعديل طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }

      if (!isValidDate(payload.startDate)) {
        throw new Error('يرجى إدخال تاريخ بداية الإجازة بصيغة صحيحة (YYYY-MM-DD).');
      }

      if (!isValidDate(payload.endDate)) {
        throw new Error('يرجى إدخال تاريخ نهاية الإجازة بصيغة صحيحة (YYYY-MM-DD).');
      }

      const requestedDays = Number(payload.requestedDays);
      if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
        throw new Error('عدد أيام الإجازة يجب أن يكون رقماً صحيحاً أكبر من صفر.');
      }

      if (payload.notes != null && typeof payload.notes === 'string' && payload.notes.length > MAX_TEXT_LENGTH) {
        throw new Error(`حقل الملاحظات طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (payload.leaveApprover != null && typeof payload.leaveApprover === 'string' && payload.leaveApprover.length > MAX_TEXT_LENGTH) {
        throw new Error(`اسم المسؤول عن منح الإجازة طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (payload.memoNumber != null && typeof payload.memoNumber === 'string' && payload.memoNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم المذكرة طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }
      if (payload.orderNumber != null && typeof payload.orderNumber === 'string' && payload.orderNumber.length > MAX_TEXT_LENGTH) {
        throw new Error(`رقم الأمر الإداري طويل جداً (الحد الأقصى ${MAX_TEXT_LENGTH} حرف).`);
      }

      const validPayload = {
        ...payload,
        memoNumber: validateOrderNumber(payload.memoNumber, 'رقم المذكرة'),
        orderNumber: validateOrderNumber(payload.orderNumber, 'رقم الأمر الإداري'),
      };

      return LeaveService.updateLeave(leaveId, validPayload, db);
    })
  );

  console.log('[LeaveHandlers] Registered: leave:getRegularBalance, leave:submitSickLeave, leave:submitRegularLeave, leave:getActiveToday, leave:getActiveTodayPaginated, leave:getHistory, leave:delete, leave:update');
}

module.exports = { registerLeaveHandlers };


