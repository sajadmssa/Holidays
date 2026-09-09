// ============================================================
//  leaveRegistration.js – Leave Request Form & History Controller (Tab 1)
//  وحدة التحكم بنموذج تسجيل الإجازات وسجل حركات الموظف (التبويب الأول)
//
//  المسؤوليات الرئيسية:
//    • إدارة استمارة تقديم الإجازات واحتساب التواريخ تلقائياً وفق مبدأ (Last-Modified-Wins).
//    • فحص الأرصدة التراكمية للموظف وعرض الرصيد المكتسب والمستهلك والمتاح لحظياً.
//    • عرض بطاقة ملخص الموظف (الاسم، الوظيفة، الموقع، الكرت، والمسؤول المانح، وشارة النقل).
//    • دعم التفاصيل الإدارية (تاريخ الطلب، رقم وتاريخ المذكرة، رقم وتاريخ الأمر الإداري).
//    • عرض سجل الإجازات السابقة للموظف وإمكانية الإلغاء واسترجاع الرصيد تلقائياً.
//    • تصدير سجل إجازات الموظف التفصيلي إلى ملف Excel بصيغة رسمية وأنيقة.
// ============================================================

'use strict';

import { showToast, showConfirm, applyWeekendWarning, showExportSuccessToast } from './uiHelpers.js';
import { clearEmployeePicker } from './employeePicker.js';

// عناصر النموذج الأساسي
let form = null;
let employeeIdEl = null;
let employeeSearchInput = null;
let leaveTypeEl = null;
let startDateEl = null;
let endDateEl = null;
let requestedDaysEl = null;
let leaveApproverEl = null;
let notesEl = null;
let submitBtn = null;
let balanceDisplay = null;
let historyContainer = null;
let historyTableBody = null;
let startDateWarning = null;
let endDateWarning = null;
let exportHistoryBtn = null;

// حقول التفاصيل الإدارية والنافذة المنبثقة
let leaveRequestDateEl = null;
let leaveMemoNumberEl = null;
let leaveMemoDateEl = null;
let leaveOrderNumberEl = null;
let leaveOrderDateEl = null;
let leaveDetailsModal = null;
let btnCloseLeaveDetailsModal = null;
let leaveDetailsModalBody = null;

// بطاقة ملخص الموظف المختار
let employeeSummaryBadge = null;
let summaryEmpName = null;
let summaryEmpTitle = null;
let summaryEmpLocation = null;
let summaryEmpCard = null;
let summaryEmpApprover = null;
let summaryEmpTransferWrap = null;
let summaryEmpTransfer = null;

// قفل منع الحلقات التكرارية أثناء التحديث التفاعلي التلقائي للتواريخ
let isAutoUpdating = false;

// ── Balance Display Functions ───────────────────────────────
//  دوال إدارة عرض بطاقة رصيد الإجازة الاعتيادية
// ─────────────────────────────────────────────────────────────

/**
 * إظهار حالة جلب الرصيد الجاري من قاعدة البيانات
 */
export function showBalanceLoading() {
  if (!balanceDisplay) return;
  balanceDisplay.className = 'balance-display loading';
  balanceDisplay.textContent = 'جارٍ جلب الرصيد…';
}

/**
 * عرض تفاصيل الرصيد المسترجع (المتاح، المكتسب، والمستهلك)
 * @param {object} data
 */
export function showBalanceData(data) {
  if (!balanceDisplay) return;
  const finalBalance = Number(data.finalBalance);
  const grossEarnedBalance = Number(data.grossEarnedBalance);
  const regularLeavesTaken = Number(data.regularLeavesTaken);

  balanceDisplay.className = 'balance-display';
  balanceDisplay.textContent = ''; // تفريغ المحتوى السابق

  const spanLabel = document.createElement('span');
  spanLabel.className = 'balance-label';
  spanLabel.textContent = 'الرصيد المتاح (إجازة اعتيادية):';

  const spanValue = document.createElement('span');
  spanValue.className = 'balance-value';
  spanValue.textContent = String(finalBalance);

  const spanUnit = document.createElement('span');
  spanUnit.className = 'balance-label';
  spanUnit.textContent = 'يوم';

  const spanDiag = document.createElement('span');
  spanDiag.className = 'balance-label';
  spanDiag.textContent = `(مكتسب: ${grossEarnedBalance}\u00A0|\u00A0مُستهلك: ${regularLeavesTaken})`;

  balanceDisplay.append(spanLabel, spanValue, spanUnit, spanDiag);
}

/**
 * إظهار رسالة خطأ في حال فشل استعلام الرصيد
 * @param {string} message
 */
export function showBalanceError(message) {
  if (!balanceDisplay) return;
  balanceDisplay.className = 'balance-display error';
  balanceDisplay.textContent = `⚠ ${message}`;
}

/**
 * إخفاء بطاقة الرصيد
 */
export function hideBalance() {
  if (!balanceDisplay) return;
  balanceDisplay.className = 'balance-display hidden';
  balanceDisplay.textContent = '';
}

// ── Employee Summary Functions ──────────────────────────────
//  دوال إدارة بطاقة ملخص الموظف المختار
// ─────────────────────────────────────────────────────────────

/**
 * إخفاء بطاقة ملخص الموظف وتصفير الحقول
 */
export function hideEmployeeSummary() {
  if (employeeSummaryBadge) {
    employeeSummaryBadge.classList.add('hidden');
    if (summaryEmpName) summaryEmpName.textContent = '-';
    if (summaryEmpTitle) summaryEmpTitle.textContent = '-';
    if (summaryEmpLocation) summaryEmpLocation.textContent = '-';
    if (summaryEmpCard) summaryEmpCard.textContent = '-';
    if (summaryEmpApprover) summaryEmpApprover.textContent = '-';
    if (summaryEmpTransferWrap) summaryEmpTransferWrap.classList.add('hidden');
  }
}

/**
 * تحميل وعرض بطاقة ملخص الموظف المختار وشارة النقل الخارجي
 * @param {number} id
 */
export async function loadEmployeeSummary(id) {
  if (!employeeSummaryBadge) return;
  try {
    const response = await window.api.employee.getById(id);
    if (response.success && response.data) {
      const emp = response.data;
      if (summaryEmpName) summaryEmpName.textContent = emp.FullName || '-';
      if (summaryEmpTitle) summaryEmpTitle.textContent = emp.JobTitle || '-';
      if (summaryEmpLocation) summaryEmpLocation.textContent = emp.WorkLocation || 'غير محدد';
      if (summaryEmpCard) summaryEmpCard.textContent = emp.LeaveCardNumber || 'غير محدد';
      if (summaryEmpApprover) summaryEmpApprover.textContent = emp.LeaveApprover || 'غير محدد';
      if (summaryEmpTransferWrap) {
        if (emp.IsTransferred === 1) {
          summaryEmpTransferWrap.classList.remove('hidden');
          let title = 'موظف منقول خارجياً';
          if (emp.TransferOrderNumber) title += ` - أمر رقم: ${emp.TransferOrderNumber}`;
          if (emp.TransferOrderDate) title += ` بتاريخ ${emp.TransferOrderDate}`;
          if (emp.TransferNotes) title += ` (${emp.TransferNotes})`;
          if (summaryEmpTransfer) summaryEmpTransfer.title = title;
        } else {
          summaryEmpTransferWrap.classList.add('hidden');
        }
      }
      if (leaveApproverEl) leaveApproverEl.value = emp.LeaveApprover || '';
      employeeSummaryBadge.classList.remove('hidden');
    } else {
      hideEmployeeSummary();
      if (leaveApproverEl) leaveApproverEl.value = '';
    }
  } catch (_e) {
    hideEmployeeSummary();
    if (leaveApproverEl) leaveApproverEl.value = '';
  }
}

// ── Date & Days Reactive Helpers (Last-Modified-Wins) ───────

/**
 * حساب تاريخ النهاية تلقائياً بإضافة عدد من الأيام إلى تاريخ بداية محدد
 * مع مراعاة التوقيت القياسي UTC لتفادي فروق التوقيت الشتوي/الصيفي
 * @param {string} dateStr - تاريخ البداية بتنسيق YYYY-MM-DD
 * @param {number} daysCount - عدد أيام الإجازة
 * @returns {string|null} تاريخ النهاية المحسوب بتنسيق YYYY-MM-DD
 */
export function addDaysToDate(dateStr, daysCount) {
  if (!dateStr || !daysCount || daysCount <= 0) return null;
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  const [y, m, d] = parts;
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + (daysCount - 1));
  const resY = date.getUTCFullYear();
  const resM = String(date.getUTCMonth() + 1).padStart(2, '0');
  const resD = String(date.getUTCDate()).padStart(2, '0');
  return `${resY}-${resM}-${resD}`;
}

/**
 * إعادة احتساب عدد الأيام المطلوبة تلقائياً عند قيام المستخدم باختيار تاريخي البداية والنهاية
 * تعتمد صيغة الفرق بين التاريخين + 1 يوم (شاملاً يومي البداية والنهاية)
 */
export function recomputeRequestedDays() {
  if (!startDateEl || !endDateEl || !requestedDaysEl) return;
  const start = startDateEl.value;
  const end = endDateEl.value;

  if (!start || !end) return;

  const parts1 = start.split('-').map(Number);
  const parts2 = end.split('-').map(Number);
  if (parts1.length !== 3 || parts2.length !== 3) return;

  const date1 = new Date(Date.UTC(parts1[0], parts1[1] - 1, parts1[2]));
  const date2 = new Date(Date.UTC(parts2[0], parts2[1] - 1, parts2[2]));

  if (isNaN(date1.getTime()) || isNaN(date2.getTime()) || date2 < date1) {
    requestedDaysEl.value = '';
    return;
  }

  const MS_PER_DAY = 86_400_000;
  const suggested = Math.round((date2.getTime() - date1.getTime()) / MS_PER_DAY) + 1;

  isAutoUpdating = true;
  requestedDaysEl.value = suggested;
  isAutoUpdating = false;
}

// ── Administrative Details Modal ────────────────────────────

/**
 * فتح النافذة المنبثقة لعرض التفاصيل الإدارية الشاملة للإجازة
 * (رقم وتاريخ المذكرة، رقم وتاريخ الأمر الإداري، تاريخ الطلب، المسؤول عن المنح والملاحظات)
 * @param {Object} leave - كائن بيانات الإجازة
 */
export function openLeaveDetailsModal(leave) {
  if (!leaveDetailsModal || !leaveDetailsModalBody) return;
  leaveDetailsModalBody.innerHTML = `
    <div class="admin-details-card">
      <div class="admin-details-header">
        <strong>${leave.LeaveName || 'إجازة'}</strong>
        <span>(${leave.DaysCount != null ? leave.DaysCount : '-'} يوم: من ${leave.StartDate || '-'} إلى ${leave.EndDate || '-'})</span>
      </div>
      <div class="admin-details-grid">
        <div class="admin-detail-item">
          <span class="detail-label">📅 تاريخ تقديم الطلب:</span>
          <span class="detail-value font-bold">${leave.RequestDate || 'غير مسجل'}</span>
        </div>
        <div class="admin-detail-item">
          <span class="detail-label">📝 رقم المذكرة:</span>
          <span class="detail-value font-bold">${leave.MemoNumber || 'غير مسجل'}</span>
        </div>
        <div class="admin-detail-item">
          <span class="detail-label">📅 تاريخ المذكرة:</span>
          <span class="detail-value font-bold">${leave.MemoDate || 'غير مسجل'}</span>
        </div>
        <div class="admin-detail-item">
          <span class="detail-label">📜 رقم الأمر الإداري:</span>
          <span class="detail-value font-bold">${leave.OrderNumber || 'غير مسجل'}</span>
        </div>
        <div class="admin-detail-item">
          <span class="detail-label">📅 تاريخ الأمر الإداري:</span>
          <span class="detail-value font-bold">${leave.OrderDate || 'غير مسجل'}</span>
        </div>
        <div class="admin-detail-item">
          <span class="detail-label">✍ المسؤول عن المنح:</span>
          <span class="detail-value">${leave.LeaveApprover || 'غير محدد'}</span>
        </div>
      </div>
      ${leave.Notes ? `<div class="admin-detail-notes"><strong>ملاحظات:</strong> ${leave.Notes}</div>` : ''}
    </div>
  `;
  leaveDetailsModal.showModal();
}

// ── Employee History & Deletion ─────────────────────────────

/**
 * جلب سجل الإجازات السابقة لموظف معين من الواجهة الخلفية وعرضه في الجدول
 * @param {number} employeeId - المعرف الفريد للموظف
 */
export async function loadEmployeeHistory(employeeId) {
  if (!historyContainer || !historyTableBody) return;

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    historyContainer.classList.add('hidden');
    historyTableBody.innerHTML = '';
    return;
  }

  try {
    const response = await window.api.leave.getHistory(employeeId);
    if (response.success && Array.isArray(response.data)) {
      renderEmployeeHistory(response.data);
    } else {
      historyContainer.classList.remove('hidden');
      historyTableBody.innerHTML = `<tr><td colspan="7" class="empty-row text-center text-danger">⚠️ تعذر تحميل سجل إجازات الموظف (${response.error || 'خطأ غير معروف'})</td></tr>`;
    }
  } catch (err) {
    historyContainer.classList.remove('hidden');
    historyTableBody.innerHTML = '<tr><td colspan="7" class="empty-row text-center text-danger">⚠️ تعذر جلب سجل الإجازات، يرجى المحاولة لاحقاً.</td></tr>';
  }
}

/**
 * رسم صفوف سجل الإجازات السابقة داخل جدول العرض، مع أزرار التفاصيل الإدارية والإلغاء
 * @param {Array<Object>} leaves - قائمة كائنات الإجازات للموظف
 */
export function renderEmployeeHistory(leaves) {
  if (!historyContainer || !historyTableBody) return;
  historyTableBody.innerHTML = '';

  if (!leaves || leaves.length === 0) {
    historyContainer.classList.remove('hidden');
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'empty-row text-center';
    td.textContent = 'لا توجد إجازات سابقة لهذا الموظف';
    tr.appendChild(td);
    historyTableBody.appendChild(tr);
    return;
  }

  historyContainer.classList.remove('hidden');
  const fragment = document.createDocumentFragment();

  leaves.forEach((leave) => {
    const tr = document.createElement('tr');

    const tdType = document.createElement('td');
    const tdStart = document.createElement('td');
    const tdEnd = document.createElement('td');
    const tdDays = document.createElement('td');
    const tdApprover = document.createElement('td');
    const tdAdmin = document.createElement('td');
    const tdAction = document.createElement('td');

    tdType.textContent = leave.LeaveName || '';
    tdStart.textContent = leave.StartDate || '';
    tdStart.className = 'text-center';
    tdEnd.textContent = leave.EndDate || '';
    tdEnd.className = 'text-center';
    tdDays.textContent = leave.DaysCount != null ? String(leave.DaysCount) : '';
    tdDays.className = 'text-center';
    tdApprover.textContent = leave.LeaveApprover || '-';

    tdAdmin.className = 'text-center';
    const hasAdminData = Boolean(
      leave.RequestDate || leave.MemoNumber || leave.MemoDate || leave.OrderNumber || leave.OrderDate
    );
    if (hasAdminData) {
      const btnAdmin = document.createElement('button');
      btnAdmin.type = 'button';
      btnAdmin.className = 'btn-admin-details';
      btnAdmin.textContent = '📋 تفاصيل إدارية';
      btnAdmin.title = 'عرض بيانات المذكرة والأمر الإداري';
      btnAdmin.addEventListener('click', () => openLeaveDetailsModal(leave));
      tdAdmin.appendChild(btnAdmin);
    } else {
      const spanNone = document.createElement('span');
      spanNone.className = 'text-muted';
      spanNone.textContent = '-';
      tdAdmin.appendChild(spanNone);
    }

    tdAction.className = 'text-center';
    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-danger';
    btnDelete.dataset.id = String(leave.LeaveID);
    btnDelete.textContent = '❌ إلغاء';

    tdAction.appendChild(btnDelete);

    tr.append(tdType, tdStart, tdEnd, tdDays, tdApprover, tdAdmin, tdAction);
    fragment.appendChild(tr);
  });

  historyTableBody.appendChild(fragment);
}

// ── Validation & Reset ──────────────────────────────────────

/**
 * جمع مدخلات استمارة تسجيل الإجازة والتحقق من صحتها وقواعد الأعمال المطلوبة
 * @returns {Object|null} كائن البيانات الجاهز للإرسال أو null عند وجود خطأ بالمدخلات
 */
export function collectAndValidate() {
  const employeeId = parseInt(employeeIdEl?.value.trim() || '0', 10);
  const leaveType = leaveTypeEl?.value || '';
  const startDate = startDateEl?.value || '';
  const endDate = endDateEl?.value || '';
  const notes = notesEl?.value.trim() || null;
  const requestedDays = parseInt(requestedDaysEl?.value || '0', 10);
  const leaveApprover = leaveApproverEl ? (leaveApproverEl.value.trim() || null) : null;

  const requestDate = leaveRequestDateEl?.value || null;
  const memoNumber = leaveMemoNumberEl?.value.trim() || null;
  const memoDate = leaveMemoDateEl?.value || null;
  const orderNumber = leaveOrderNumberEl?.value.trim() || null;
  const orderDate = leaveOrderDateEl?.value || null;

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    showToast('يرجى اختيار موظف مسجل من القائمة.', 'warning');
    if (employeeSearchInput) employeeSearchInput.focus();
    return null;
  }
  if (!leaveType) {
    showToast('يرجى اختيار نوع الإجازة.', 'warning');
    leaveTypeEl?.focus();
    return null;
  }
  if (!startDate) {
    showToast('يرجى تحديد تاريخ بداية الإجازة.', 'warning');
    startDateEl?.focus();
    return null;
  }
  if (!endDate) {
    showToast('يرجى تحديد تاريخ نهاية الإجازة.', 'warning');
    endDateEl?.focus();
    return null;
  }
  if (endDate < startDate) {
    showToast('تاريخ النهاية يجب أن يكون بعد أو مساوياً لتاريخ البداية.', 'warning');
    endDateEl?.focus();
    return null;
  }
  if (!requestedDaysEl?.value.trim() || !Number.isInteger(requestedDays) || requestedDays <= 0) {
    showToast('يرجى إدخال عدد أيام صحيح (أكبر من صفر).', 'warning');
    requestedDaysEl?.focus();
    return null;
  }

  return {
    employeeId,
    requestedDays,
    startDate,
    endDate,
    leaveType,
    notes,
    leaveApprover,
    requestDate,
    memoNumber,
    memoDate,
    orderNumber,
    orderDate,
  };
}

/**
 * تصفير وتفريغ جميع حقول الاستمارة وإخفاء بطاقة الموظف ورصيده وسجل إجازاته
 */
export function resetForm() {
  if (form) form.reset();
  if (requestedDaysEl) requestedDaysEl.value = '';
  if (leaveRequestDateEl) leaveRequestDateEl.value = '';
  if (leaveMemoNumberEl) leaveMemoNumberEl.value = '';
  if (leaveMemoDateEl) leaveMemoDateEl.value = '';
  if (leaveOrderNumberEl) leaveOrderNumberEl.value = '';
  if (leaveOrderDateEl) leaveOrderDateEl.value = '';
  clearEmployeePicker();
  if (leaveApproverEl) leaveApproverEl.value = '';
  hideBalance();
  hideEmployeeSummary();
  if (historyContainer && historyTableBody) {
    historyContainer.classList.add('hidden');
    historyTableBody.innerHTML = '';
  }

  if (startDateEl && startDateWarning) {
    startDateEl.classList.remove('weekend-warning');
    startDateWarning.classList.remove('visible');
  }
  if (endDateEl && endDateWarning) {
    endDateEl.classList.remove('weekend-warning');
    endDateWarning.classList.remove('visible');
  }
}

// ── Populate Leave Types in Registration Select ─────────────
let _cachedRegistrationLeaveTypes = [];

/**
 * تحميل أنواع الإجازات ديناميكياً من قاعدة البيانات وترتيبها في القائمة المنسدلة
 * مع تقديم الإجازات الأكثر شيوعاً كأولوية في بداية القائمة
 */
export async function loadLeaveTypesIntoSelect() {
  if (!leaveTypeEl) return;

  try {
    if (window.api && window.api.leaveTypes && typeof window.api.leaveTypes.getAll === 'function') {
      const resp = await window.api.leaveTypes.getAll();
      if (resp && resp.success && Array.isArray(resp.data) && resp.data.length > 0) {
        _cachedRegistrationLeaveTypes = resp.data;
      }
    }
  } catch (_e) {}

  if (_cachedRegistrationLeaveTypes.length === 0) {
    _cachedRegistrationLeaveTypes = [
      { LeaveTypeID: 1, Name: 'إجازة اعتيادية' },
      { LeaveTypeID: 29, Name: 'إجازة مرضية' },
      { LeaveTypeID: 55, Name: 'دورة تدريبية' },
      { LeaveTypeID: 56, Name: 'سبب آخر' },
      { LeaveTypeID: 30, Name: 'إجازة طارئة' },
      { LeaveTypeID: 4, Name: 'إجازة بدون راتب' },
      { LeaveTypeID: 32, Name: 'إجازة دراسية' },
      { LeaveTypeID: 33, Name: 'إجازة حجة' },
      { LeaveTypeID: 34, Name: 'إجازة الأمومة' },
      { LeaveTypeID: 35, Name: 'إجازة العدة' },
      { LeaveTypeID: 36, Name: 'إجازة الرضاعة' },
    ];
  }

  leaveTypeEl.innerHTML = '<option value="" disabled selected>— اختر نوع الإجازة —</option>';

  const getSortPriority = (name) => {
    if (name === 'إجازة اعتيادية') return 1;
    if (name === 'إجازة مرضية') return 2;
    if (name === 'دورة تدريبية') return 3;
    if (name === 'سبب آخر') return 4;
    return 10;
  };

  const sortedTypes = [..._cachedRegistrationLeaveTypes].sort((a, b) => {
    const prioA = getSortPriority(a.Name);
    const prioB = getSortPriority(b.Name);
    if (prioA !== prioB) return prioA - prioB;
    return (a.LeaveTypeID || 0) - (b.LeaveTypeID || 0);
  });

  sortedTypes.forEach((lt) => {
    const opt = document.createElement('option');
    opt.value = lt.Name;
    opt.textContent = lt.Name;
    leaveTypeEl.appendChild(opt);
  });
}

// ── Helper to identify balance-deducting leave types ─────────
/**
 * التحقق مما إذا كان نوع الإجازة المختار يخصم من الرصيد الاعتيادي السنوي
 * @param {string} type - مسمى نوع الإجازة
 * @returns {boolean}
 */
const isRegularBalanceType = (type) =>
  type === 'regular' ||
  type === 'other' ||
  type === 'إجازة اعتيادية' ||
  type === 'سبب آخر';

// ── Module Initialization ───────────────────────────────────

/**
 * تهيئة موديول تسجيل الإجازات: ربط عناصر DOM ومستمعات الأحداث التفاعلية وحساب الرصيد وتصدير السجل
 */
export function initLeaveRegistration() {
  form = document.getElementById('leave-form');
  employeeIdEl = document.getElementById('employee-id');
  employeeSearchInput = document.getElementById('employee-search-input');
  leaveTypeEl = document.getElementById('leave-type');
  startDateEl = document.getElementById('start-date');
  endDateEl = document.getElementById('end-date');
  requestedDaysEl = document.getElementById('requested-days');
  leaveApproverEl = document.getElementById('leave-approver');
  notesEl = document.getElementById('notes');
  submitBtn = document.getElementById('submit-btn');
  balanceDisplay = document.getElementById('balance-display');
  historyContainer = document.getElementById('employee-history-container');
  historyTableBody = document.getElementById('history-table-body');
  startDateWarning = document.getElementById('start-date-warning');
  endDateWarning = document.getElementById('end-date-warning');
  exportHistoryBtn = document.getElementById('btn-export-history');

  leaveRequestDateEl = document.getElementById('leave-request-date');
  leaveMemoNumberEl = document.getElementById('leave-memo-number');
  leaveMemoDateEl = document.getElementById('leave-memo-date');
  leaveOrderNumberEl = document.getElementById('leave-order-number');
  leaveOrderDateEl = document.getElementById('leave-order-date');
  leaveDetailsModal = document.getElementById('leave-details-modal');
  btnCloseLeaveDetailsModal = document.getElementById('btn-close-leave-details-modal');
  leaveDetailsModalBody = document.getElementById('leave-details-modal-body');

  employeeSummaryBadge = document.getElementById('employee-summary-badge');
  summaryEmpName = document.getElementById('summary-emp-name');
  summaryEmpTitle = document.getElementById('summary-emp-title');
  summaryEmpLocation = document.getElementById('summary-emp-location');
  summaryEmpCard = document.getElementById('summary-emp-card');
  summaryEmpApprover = document.getElementById('summary-emp-approver');
  summaryEmpTransferWrap = document.getElementById('summary-emp-transfer-wrap');
  summaryEmpTransfer = document.getElementById('summary-emp-transfer');

  // Dynamically load leave types into dropdown
  loadLeaveTypesIntoSelect();

  if (btnCloseLeaveDetailsModal && leaveDetailsModal) {
    btnCloseLeaveDetailsModal.addEventListener('click', () => {
      leaveDetailsModal.close();
    });
  }

  // Employee ID change -> fetch balance & info
  if (employeeIdEl) {
    employeeIdEl.addEventListener('change', async () => {
      const raw = employeeIdEl.value.trim();
      const id = parseInt(raw, 10);

      if (!raw || !Number.isInteger(id) || id <= 0) {
        hideBalance();
        hideEmployeeSummary();
        if (historyContainer && historyTableBody) {
          historyContainer.classList.add('hidden');
          historyTableBody.innerHTML = '';
        }
        return;
      }

      // Load employee summary info & leave history
      loadEmployeeSummary(id);
      loadEmployeeHistory(id);

      // Only fetch balance for regular and other (balance-deducting) leaves
      if (!isRegularBalanceType(leaveTypeEl?.value)) {
        hideBalance();
        return;
      }

      showBalanceLoading();

      try {
        const response = await window.api.leave.getRegularBalance(id);
        if (response.success) {
          showBalanceData(response.data);
        } else {
          showBalanceError(response.error || 'تعذر جلب رصيد الإجازات، يرجى إعادة المحاولة.');
        }
      } catch (err) {
        showBalanceError('تعذر جلب رصيد الإجازات، يرجى إعادة المحاولة.');
      }
    });
  }

  // إعادة جلب الرصيد عند تغيير نوع الإجازة إذا كانت تقتطع من الرصيد الاعتيادي
  if (leaveTypeEl) {
    leaveTypeEl.addEventListener('change', async () => {
      const id = parseInt(employeeIdEl?.value.trim() || '0', 10);

      if (isRegularBalanceType(leaveTypeEl.value) && Number.isInteger(id) && id > 0) {
        showBalanceLoading();
        try {
          const response = await window.api.leave.getRegularBalance(id);
          if (response.success) {
            showBalanceData(response.data);
          } else {
            showBalanceError(response.error || 'تعذر جلب رصيد الإجازات، يرجى إعادة المحاولة.');
          }
        } catch (err) {
          showBalanceError('تعذر جلب رصيد الإجازات، يرجى إعادة المحاولة.');
        }
      } else {
        hideBalance();
      }
    });
  }

  // التنبيه على عطلات نهاية الأسبوع وإعادة الحساب التلقائي (قاعدة: التعديل الأخير يحدد النتيجة Last-Modified-Wins)
  if (startDateEl) {
    const handleStartChange = () => {
      if (isAutoUpdating) return;
      if (startDateWarning) applyWeekendWarning(startDateEl, startDateWarning);
      const days = parseInt(requestedDaysEl?.value || '0', 10);
      if (startDateEl.value && Number.isInteger(days) && days > 0) {
        isAutoUpdating = true;
        const computedEnd = addDaysToDate(startDateEl.value, days);
        if (computedEnd) {
          endDateEl.value = computedEnd;
          if (endDateWarning) applyWeekendWarning(endDateEl, endDateWarning);
        }
        isAutoUpdating = false;
      } else if (startDateEl.value && endDateEl.value) {
        recomputeRequestedDays();
      }
    };
    startDateEl.addEventListener('change', handleStartChange);
    startDateEl.addEventListener('input', handleStartChange);
  }

  if (endDateEl) {
    const handleEndChange = () => {
      if (isAutoUpdating) return;
      if (endDateWarning) applyWeekendWarning(endDateEl, endDateWarning);
      recomputeRequestedDays();
    };
    endDateEl.addEventListener('change', handleEndChange);
    endDateEl.addEventListener('input', handleEndChange);
  }

  if (requestedDaysEl) {
    const handleDaysChange = () => {
      if (isAutoUpdating) return;
      const days = parseInt(requestedDaysEl.value, 10);
      if (startDateEl?.value && Number.isInteger(days) && days > 0) {
        isAutoUpdating = true;
        const computedEnd = addDaysToDate(startDateEl.value, days);
        if (computedEnd) {
          endDateEl.value = computedEnd;
          if (endDateWarning) applyWeekendWarning(endDateEl, endDateWarning);
        }
        isAutoUpdating = false;
      }
    };
    requestedDaysEl.addEventListener('input', handleDaysChange);
    requestedDaysEl.addEventListener('change', handleDaysChange);
  }

  // تصدير سجل إجازات الموظف الفردي إلى ملف Excel
  if (exportHistoryBtn) {
    exportHistoryBtn.addEventListener('click', async () => {
      const rawId = employeeIdEl?.value.trim() || '';
      const employeeId = Number(rawId);

      if (!employeeId || !Number.isInteger(employeeId) || employeeId <= 0) {
        showToast('يرجى إدخال رقم الموظف أولاً قبل تصدير سجله.', 'warning');
        employeeIdEl?.focus();
        return;
      }

      exportHistoryBtn.disabled = true;
      exportHistoryBtn.textContent = 'جارٍ التصدير…';

      try {
        const response = await window.api.report.exportHistory(employeeId);

        if (!response.success) {
          showToast(response.error || 'تعذر تصدير سجل الموظف، يرجى إعادة المحاولة.', 'error');
          return;
        }

        if (response.data?.filePath) {
          showExportSuccessToast({
            filePath: response.data.filePath,
            message: 'تم تصدير سجل إجازات الموظف بنجاح.'
          });
        } else {
          showToast('تم حفظ التقرير بنجاح.', 'success');
        }

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تصدير السجل، يرجى إعادة المحاولة.', 'error');

      } finally {
        exportHistoryBtn.disabled = false;
        exportHistoryBtn.textContent = '📄 تصدير سجل الموظف';
      }
    });
  }

  // إلغاء إجازة سابقة من جدول السجل واسترجاع رصيدها
  if (historyTableBody) {
    historyTableBody.addEventListener('click', async (event) => {
      const btn = event.target.closest('.btn-danger');
      if (!btn) return;

      const leaveId = Number(btn.dataset.id);
      if (!Number.isInteger(leaveId) || leaveId <= 0) return;

      const confirmed = await showConfirm(
        'هل أنت متأكد من إلغاء هذه الإجازة واسترجاع الرصيد للموظف؟',
        'إلغاء الإجازة'
      );
      if (!confirmed) return;

      try {
        const response = await window.api.leave.delete(leaveId);
        if (response.success) {
          showToast('تم إلغاء الإجازة بنجاح.', 'success');
          employeeIdEl?.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          showToast(response.error || 'تعذر إلغاء الإجازة، يرجى المحاولة لاحقاً.', 'error');
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء إلغاء الإجازة، يرجى إعادة المحاولة.', 'error');
      }
    });
  }

  // معالجة تقديم استمارة طلب الإجازة (إجازة مرضية أو اعتيادية/أخرى)
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const payload = collectAndValidate();
      if (!payload) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جارٍ التقديم…';
      }

      try {
        let response;

        // إرسال الإجازة عبر قناة IPC المناسبة بحسب نوع الإجازة
        if (payload.leaveType === 'sick' || payload.leaveType === 'إجازة مرضية') {
          response = await window.api.leave.submitSickLeave({
            employeeId: payload.employeeId,
            requestedDays: payload.requestedDays,
            startDate: payload.startDate,
            endDate: payload.endDate,
            leaveApprover: payload.leaveApprover,
            requestDate: payload.requestDate,
            memoNumber: payload.memoNumber,
            memoDate: payload.memoDate,
            orderNumber: payload.orderNumber,
            orderDate: payload.orderDate,
          });

        } else {
          response = await window.api.leave.submitRegularLeave({
            employeeId: payload.employeeId,
            requestedDays: payload.requestedDays,
            startDate: payload.startDate,
            endDate: payload.endDate,
            notes: payload.notes,
            leaveType: payload.leaveType,
            leaveApprover: payload.leaveApprover,
            requestDate: payload.requestDate,
            memoNumber: payload.memoNumber,
            memoDate: payload.memoDate,
            orderNumber: payload.orderNumber,
            orderDate: payload.orderDate,
          });
        }

        if (response.success) {
          const d = response.data;

          // عرض إشعار النجاح المناسب مع رصيد الموظف المتبقي
          if (
            payload.leaveType === 'regular' ||
            payload.leaveType === 'other' ||
            payload.leaveType === 'إجازة اعتيادية' ||
            payload.leaveType === 'سبب آخر'
          ) {
            showToast(
              `تم تسجيل طلب الإجازة بنجاح! (رقم القيد: ${d.leaveId} | المتبقي: ${d.remainingBalance} يوم)`,
              'success',
              4500
            );
          } else if (payload.leaveType === 'sick' || payload.leaveType === 'إجازة مرضية') {
            const tierBreakdown = `براتب تام: ${d.daysAt100} يوم، بنصف راتب: ${d.daysAt50} يوم، بربع راتب: ${d.daysAt25 || 0} يوم`;
            if (d.quotaExceeded) {
              showToast(
                `تم تسجيل الإجازة المرضية بنجاح وتجاوزت السقف السنوي (رقم القيد: ${d.leaveId} | ${tierBreakdown})`,
                'warning',
                6000
              );
            } else {
              showToast(
                `تم تسجيل الإجازة المرضية بنجاح (رقم القيد: ${d.leaveId} | ${tierBreakdown})`,
                'success',
                4500
              );
            }
          } else if (payload.leaveType === 'training' || payload.leaveType === 'دورة تدريبية') {
            showToast(
              `تم تسجيل طلب الدورة التدريبية بنجاح! (رقم القيد: ${d.leaveId})`,
              'success',
              4500
            );
          } else {
            showToast(
              `تم تسجيل طلب (${payload.leaveType}) بنجاح! (رقم القيد: ${d.leaveId})`,
              'success',
              4500
            );
          }

          if (response.warning) {
            showToast(response.warning, 'warning', 6000);
          }

          resetForm();

        } else {
          showToast(`تعذر تقديم الطلب: ${response.error || 'يرجى مراجعة البيانات المدخلة.'}`, 'error', 5000);
        }

      } catch (err) {
        showToast(`حدث خطأ غير متوقع أثناء تقديم الطلب، يرجى إعادة المحاولة.`, 'error');

      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'تقديم طلب الإجازة';
        }
      }
    });
  }
}
