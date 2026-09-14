// ============================================================
//  dashboardTab.js – وحدة التحكم بلوحة المؤشرات والإجازات النشطة
//  تتولى عرض الموظفين المجازين اليوم، شارات المباشرة القريبة،
//  نافذة تعديل الإجازات وتوثيق التدقيق، وتنبيهات المباشرة
// ============================================================

'use strict';

import { showToast, showConfirm, showExportSuccessToast, addDaysToDate, recomputeDays } from './uiHelpers.js';
import { createPaginationController } from './paginationComponent.js';

// عناصر واجهة المستخدم للوحة المؤشرات
let dashboardStatus = null;
let dashboardSearchInput = null;
let activeLeavesTable = null;
let activeLeavestbody = null;
let btnExportActiveLeaves = null;
let _pagination = null;

// عناصر شريط تنبيهات المباشرة القريبة
let resumptionAlertBanner = null;
let alertBannerDesc = null;
let btnAlertView = null;
let btnAlertDismiss = null;

// متغيرات حالة البحث والتصفية والترتيب
let _dashboardSearchQuery = '';
let _dashboardDebounceTimer = null;
let _onSwitchToDashboard = null;
let btnFilterUrgentResumption = null;
let dashboardSortSelect = null;
let _isUrgentOnlyFilter = false;
let _dashboardSortBy = 'entry_asc';

// عناصر النافذة المنبثقة لتعديل الإجازة (Modal)
let editLeaveModal = null;
let btnCloseEditLeaveModal = null;
let btnCancelEditLeave = null;
let editLeaveForm = null;
let editLeaveIdEl = null;
let editLeaveEmployeeIdEl = null;
let editLeaveEmpNameEl = null;
let editLeaveCardNumEl = null;
let editLeaveModifierEl = null;
let editLeaveTypeEl = null;
let editLeaveApproverEl = null;
let editLeaveStartDateEl = null;
let editLeaveDaysEl = null;
let editLeaveEndDateEl = null;
let editLeaveRequestDateEl = null;
let editLeaveMemoNumEl = null;
let editLeaveMemoDateEl = null;
let editLeaveOrderNumEl = null;
let editLeaveOrderDateEl = null;
let editLeaveNotesEl = null;
let btnSaveEditLeave = null;

// مؤشرات التحديث التلقائي للتواريخ وذاكرة التخزين المؤقت لأنواع الإجازات
let isAutoUpdatingDates = false;
let _cachedLeaveTypes = [];

/**
 * تحديث شريط حالة لوحة المؤشرات (جارٍ التحميل / خطأ / إخفاء)
 * @param {string} message - نص الرسالة
 * @param {string} state - حالة العرض (loading | error | hidden)
 */
export function setDashboardStatus(message, state) {
  if (!dashboardStatus) return;
  if (state === 'hidden') {
    dashboardStatus.className = 'balance-display hidden';
    dashboardStatus.textContent = '';
    return;
  }
  dashboardStatus.className = `balance-display ${state}`;
  dashboardStatus.textContent = message;
}

/**
 * رسم جدول الإجازات النشطة حالياً وشارات موعد المباشرة المتوقعة وزر التعديل
 * @param {Array<Object>} leaves - قائمة سجلات الإجازات النشطة
 */
export function renderActiveLeavesTable(leaves) {
  if (!activeLeavestbody) return;
  activeLeavestbody.innerHTML = '';

  if (!leaves || leaves.length === 0) {
    const isSearching = _dashboardSearchQuery.trim().length > 0 || _isUrgentOnlyFilter;
    activeLeavestbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="12" class="text-center">
          ${isSearching ? '🔍 لا توجد نتائج مطابقة للبحث أو التصفية' : 'لا توجد إجازات نشطة حالياً'}
        </td>
      </tr>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  leaves.forEach((item) => {
    const {
      FullName,
      LeaveCardNumber,
      WorkLocation,
      LeaveName,
      LeaveApprover,
      StartDate,
      EndDate,
      ResumptionDate,
      DaysRemaining,
      SequenceNumber,
      JobNumber,
      DepartmentName,
      HasConflict
    } = item;
    const tr = document.createElement('tr');
    if (HasConflict) {
      tr.classList.add('row-conflict');
    }

    const tdSeq = document.createElement('td');
    const tdName = document.createElement('td');
    const tdJobNumber = document.createElement('td');
    const tdDept = document.createElement('td');
    const tdCard = document.createElement('td');
    const tdLocation = document.createElement('td');
    const tdType = document.createElement('td');
    const tdApprover = document.createElement('td');
    const tdStart = document.createElement('td');
    const tdEnd = document.createElement('td');
    const tdResumption = document.createElement('td');
    const tdAction = document.createElement('td');

    tdSeq.className = 'text-center font-bold';
    tdSeq.textContent = SequenceNumber != null ? String(SequenceNumber) : '-';

    const spanName = document.createElement('span');
    spanName.textContent = FullName || '';
    tdName.appendChild(spanName);

    if (HasConflict) {
      const conflictBadge = document.createElement('span');
      conflictBadge.className = 'conflict-badge';
      conflictBadge.title = 'تنبيه: يوجد تداخل أو تكرار في تواريخ الإجازات المسجلة لهذا الموظف';
      conflictBadge.textContent = '⚠️ تعارض / تكرار إجازة';
      tdName.appendChild(conflictBadge);
    }

    tdJobNumber.className = 'text-center';
    tdJobNumber.textContent = JobNumber || '-';

    tdDept.textContent = DepartmentName || '-';

    tdCard.textContent = LeaveCardNumber || '-';
    tdCard.className = 'text-center';
    tdLocation.textContent = WorkLocation || '-';
    tdType.textContent = LeaveName || '';
    tdApprover.textContent = LeaveApprover || '-';
    tdStart.className = 'text-center';
    tdStart.textContent = StartDate || '';
    tdEnd.className = 'text-center';
    tdEnd.textContent = EndDate || '';

    // Resumption Badge & Date
    tdResumption.className = 'text-center';
    const badge = document.createElement('div');
    badge.className = 'badge-resumption';

    const spanDate = document.createElement('span');
    spanDate.className = 'resumption-date-text';
    spanDate.textContent = ResumptionDate || 'غداً';

    const spanStatus = document.createElement('span');
    spanStatus.className = 'resumption-status-text';

    const days = DaysRemaining != null ? Number(DaysRemaining) : 0;
    if (days === 0) {
      badge.classList.add('badge-resumption-urgent');
      spanStatus.textContent = '⚠️ المباشرة غداً (آخر يوم)';
    } else if (days === 1) {
      badge.classList.add('badge-resumption-urgent');
      spanStatus.textContent = '⚠️ تبقت يومان على المباشرة';
    } else if (days === 2) {
      badge.classList.add('badge-resumption-soon');
      spanStatus.textContent = '⚠️ تبقت 3 أيام على المباشرة';
    } else if (days === 3) {
      badge.classList.add('badge-resumption-soon');
      spanStatus.textContent = '⚠️ تبقت 4 أيام على المباشرة';
    } else {
      badge.classList.add('badge-resumption-normal');
      spanStatus.textContent = `📅 بعد ${days + 1} يوم`;
    }

    badge.append(spanDate, spanStatus);
    tdResumption.appendChild(badge);

    // Actions column: Edit button
    tdAction.className = 'text-center';
    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'btn-edit-leave';
    btnEdit.innerHTML = '<span>✏️</span> <span>تعديل</span>';
    btnEdit.title = 'تعديل بيانات هذه الإجازة';
    btnEdit.addEventListener('click', () => openEditLeaveModal(item));
    tdAction.appendChild(btnEdit);

    tr.append(tdSeq, tdName, tdJobNumber, tdDept, tdCard, tdLocation, tdType, tdApprover, tdStart, tdEnd, tdResumption, tdAction);
    fragment.appendChild(tr);
  });

  activeLeavestbody.appendChild(fragment);
}

/**
 * جلب قائمة الإجازات النشطة المقسمة لصفحات من الواجهة الخلفية وتحديث الجدول وعنصر الترقيم
 * تدعم التصفية حسب البحث النصي، والفرز، وحصر المباشرات العاجلة فقط
 * @param {number} [page=1] - رقم الصفحة المطلوبة
 */
export async function loadActiveLeaves(page = _pagination?.getCurrentPage() || 1) {
  if (!activeLeavestbody) return;

  activeLeavestbody.innerHTML = '';
  setDashboardStatus('جارٍ تحميل البيانات…', 'loading');

  try {
    const pageSize = _pagination?.getPageSize() || 15;
    const response = await window.api.leave.getActiveTodayPaginated({
      page,
      pageSize,
      search: _dashboardSearchQuery,
      sortBy: _dashboardSortBy,
      urgentOnly: _isUrgentOnlyFilter
    });

    setDashboardStatus('', 'hidden');

    if (!response.success) {
      setDashboardStatus(`⚠️ ${response.error || 'تعذر تحميل بيانات الإجازات الحالية.'}`, 'error');
      return;
    }

    const resData = response.data || { data: [], totalCount: 0, totalPages: 1, page: 1 };
    renderActiveLeavesTable(resData.data || []);

    if (_pagination) {
      _pagination.update({
        page: resData.page,
        totalPages: resData.totalPages,
        totalCount: resData.totalCount
      });
    }

  } catch (err) {
    setDashboardStatus('تعذر تحميل بيانات الإجازات الحالية، يرجى إعادة المحاولة.', 'error');
  }
}

// ── Populate Leave Types in Edit Select ─────────────────────
/**
 * التأكد من تحميل قائمة أنواع الإجازات من الخادم وتعبئتها في القائمة المنسدلة لنافذة التعديل
 */
async function ensureLeaveTypesLoaded() {
  if (_cachedLeaveTypes.length > 0 && editLeaveTypeEl) {
    return;
  }

  try {
    if (window.api && window.api.leaveTypes && typeof window.api.leaveTypes.getAll === 'function') {
      const resp = await window.api.leaveTypes.getAll();
      if (resp && resp.success && Array.isArray(resp.data)) {
        _cachedLeaveTypes = resp.data;
      }
    }
  } catch (_e) {}

  if (_cachedLeaveTypes.length === 0) {
    _cachedLeaveTypes = [
      { LeaveTypeID: 1, Name: 'إجازة اعتيادية' },
      { LeaveTypeID: 29, Name: 'إجازة مرضية' },
      { LeaveTypeID: 56, Name: 'سبب آخر' },
      { LeaveTypeID: 55, Name: 'دورة تدريبية' },
      { LeaveTypeID: 30, Name: 'إجازة طارئة' },
      { LeaveTypeID: 4, Name: 'إجازة بدون راتب' },
      { LeaveTypeID: 32, Name: 'إجازة دراسية' },
      { LeaveTypeID: 33, Name: 'إجازة حجة' },
      { LeaveTypeID: 34, Name: 'إجازة الأمومة' },
      { LeaveTypeID: 35, Name: 'إجازة العدة' },
      { LeaveTypeID: 36, Name: 'إجازة الرضاعة' },
    ];
  }

  if (editLeaveTypeEl) {
    editLeaveTypeEl.innerHTML = '';
    _cachedLeaveTypes.forEach((lt) => {
      const opt = document.createElement('option');
      opt.value = String(lt.LeaveTypeID || lt.Name);
      opt.textContent = lt.Name;
      editLeaveTypeEl.appendChild(opt);
    });
  }
}

// ── Open Edit Leave Modal ───────────────────────────────────
/**
 * فتح النافذة المنبثقة لتعديل بيانات إجازة مسجلة وتعبئة حقولها بالبيانات الحالية
 * مع التركيز التلقائي على حقل اسم القائم بالتعديل الإلزامي لسجل التدقيق
 * @param {Object} leave - كائن بيانات الإجازة المراد تعديلها
 */
export async function openEditLeaveModal(leave) {
  if (!editLeaveModal || !leave) return;

  await ensureLeaveTypesLoaded();

  if (editLeaveIdEl) editLeaveIdEl.value = String(leave.LeaveID || '');
  if (editLeaveEmployeeIdEl) editLeaveEmployeeIdEl.value = String(leave.EmployeeID || '');

  if (editLeaveEmpNameEl) editLeaveEmpNameEl.textContent = `الموظف: ${leave.FullName || '-'}`;
  if (editLeaveCardNumEl) editLeaveCardNumEl.textContent = leave.LeaveCardNumber ? `رقم كرت الإجازة: ${leave.LeaveCardNumber}` : 'رقم كرت الإجازة: غير محدد';

  // Mandatory modifier field starts empty and focused
  if (editLeaveModifierEl) {
    editLeaveModifierEl.value = '';
  }

  // Select Leave Type
  if (editLeaveTypeEl) {
    let matched = false;
    for (const opt of editLeaveTypeEl.options) {
      if (opt.textContent.trim() === (leave.LeaveName || '').trim() || opt.value === String(leave.LeaveTypeID)) {
        opt.selected = true;
        matched = true;
        break;
      }
    }
    if (!matched && editLeaveTypeEl.options.length > 0) {
      editLeaveTypeEl.selectedIndex = 0;
    }
  }

  if (editLeaveApproverEl) editLeaveApproverEl.value = leave.LeaveApprover || '';
  if (editLeaveStartDateEl) editLeaveStartDateEl.value = leave.StartDate || '';
  if (editLeaveEndDateEl) editLeaveEndDateEl.value = leave.EndDate || '';
  if (editLeaveDaysEl) {
    const days = leave.DaysCount != null ? Number(leave.DaysCount) : recomputeDays(leave.StartDate, leave.EndDate) || 1;
    editLeaveDaysEl.value = String(days);
  }

  if (editLeaveRequestDateEl) editLeaveRequestDateEl.value = leave.RequestDate || '';
  if (editLeaveMemoNumEl) editLeaveMemoNumEl.value = leave.MemoNumber || '';
  if (editLeaveMemoDateEl) editLeaveMemoDateEl.value = leave.MemoDate || '';
  if (editLeaveOrderNumEl) editLeaveOrderNumEl.value = leave.OrderNumber || leave.OrderRef || '';
  if (editLeaveOrderDateEl) editLeaveOrderDateEl.value = leave.OrderDate || '';
  if (editLeaveNotesEl) editLeaveNotesEl.value = leave.Notes || '';

  editLeaveModal.showModal();

  setTimeout(() => {
    if (editLeaveModifierEl) {
      editLeaveModifierEl.focus();
    }
  }, 60);
}

// ── Submit Edit Leave Form ──────────────────────────────────
/**
 * معالجة تقديم استمارة تعديل الإجازة مع التحقق الصارم من الحقول الإلزامية
 * والتعامل مع تحذير تجاوز الرصيد المتاح (confirmExcess) وتوثيق اسم المعدل في سجل التدقيق
 * @param {Event} event - حدث تقديم الاستمارة
 */
async function handleEditLeaveSubmit(event) {
  event.preventDefault();

  const leaveId = Number(editLeaveIdEl?.value);
  if (!Number.isInteger(leaveId) || leaveId <= 0) {
    showToast('معرّف الإجازة غير صالح.', 'error');
    return;
  }

  const modifierName = (editLeaveModifierEl?.value || '').trim();
  if (!modifierName) {
    showToast('⚠️ يرجى إدخال اسم القائم بالتعديل لإتمام العملية والتوثيق بسجل التدقيق.', 'warning', 4500);
    editLeaveModifierEl?.focus();
    return;
  }

  const startDate = editLeaveStartDateEl?.value || '';
  const endDate = editLeaveEndDateEl?.value || '';
  const daysCount = parseInt(editLeaveDaysEl?.value || '0', 10);
  const selectedTypeVal = editLeaveTypeEl?.value || '';
  const selectedTypeName = editLeaveTypeEl?.options[editLeaveTypeEl.selectedIndex]?.textContent || '';

  if (!startDate || !endDate) {
    showToast('يرجى تحديد تاريخ بداية ونهاية الإجازة.', 'warning');
    return;
  }
  if (endDate < startDate) {
    showToast('تاريخ النهاية يجب أن يكون بعد أو مساوياً لتاريخ البداية.', 'warning');
    editLeaveEndDateEl?.focus();
    return;
  }
  if (!Number.isInteger(daysCount) || daysCount <= 0) {
    showToast('يرجى إدخال عدد أيام صحيح أكبر من صفر.', 'warning');
    editLeaveDaysEl?.focus();
    return;
  }

  const payload = {
    leaveId,
    leaveType: selectedTypeName || selectedTypeVal,
    startDate,
    endDate,
    requestedDays: daysCount,
    leaveApprover: editLeaveApproverEl?.value.trim() || null,
    requestDate: editLeaveRequestDateEl?.value || null,
    memoNumber: editLeaveMemoNumEl?.value.trim() || null,
    memoDate: editLeaveMemoDateEl?.value || null,
    orderNumber: editLeaveOrderNumEl?.value.trim() || null,
    orderDate: editLeaveOrderDateEl?.value || null,
    notes: editLeaveNotesEl?.value.trim() || null,
    modifierName,
    confirmExcess: false,
  };

  if (btnSaveEditLeave) {
    btnSaveEditLeave.disabled = true;
    btnSaveEditLeave.textContent = 'جارٍ الحفظ…';
  }

  try {
    let response = await window.api.leave.update(payload);

    // 1. التحقق من تأكيد التداخل عند تعديل الإجازة لتتداخل مع إجازة أخرى
    if (!response.success && response.data?.requiresOverlapConfirmation) {
      const overlapData = response.data?.overlap || {};
      const overlapMsg = `يوجد تداخل في التواريخ مع إجازة مسجلة مسبقاً لهذا الموظف:\n\n• نوع الإجازة السابقة: ${overlapData.LeaveTypeName || 'إجازة مسجلة'}\n• الفترة: من ${overlapData.StartDate || ''} إلى ${overlapData.EndDate || ''} (${overlapData.DaysCount || ''} يوم)\n\nهل تريد المتابعة وتأكيد تعديل هذه الإجازة كسجل متداخل؟`;

      const userConfirmed = await showConfirm(
        overlapMsg,
        '⚠️ تأكيد تعديل إجازة متداخلة'
      );

      if (userConfirmed) {
        if (btnSaveEditLeave) {
          btnSaveEditLeave.textContent = 'جارٍ تأكيد الحفظ…';
        }
        response = await window.api.leave.update({ ...payload, confirmOverlap: true });
      } else {
        if (btnSaveEditLeave) {
          btnSaveEditLeave.disabled = false;
          btnSaveEditLeave.textContent = '💾 حفظ التعديلات';
        }
        return;
      }
    }

    // 2. إذا تجاوزت الإجازة الرصيد المتاح، يتم عرض نافذة تأكيد بمقدار العجز بدقة
    if (!response.success && response.data?.requiresConfirmation) {
      const confirmData = response.data;
      const warningMsg = confirmData.message || `عدد الأيام المطلوبة (${confirmData.requestedDays} يوم) يتجاوز الرصيد المتاح (${confirmData.availableBalance} يوم) بمقدار (${confirmData.deficit} يوم). هل تريد المتابعة وتأكيد الحفظ برصيد سالب؟`;

      const userConfirmed = await showConfirm(
        warningMsg,
        '⚠️ تحذير: تجاوز الرصيد المتاح'
      );

      if (userConfirmed) {
        if (btnSaveEditLeave) {
          btnSaveEditLeave.textContent = 'جارٍ تأكيد الحفظ…';
        }
        response = await window.api.leave.update({ ...payload, confirmExcess: true });
      } else {
        if (btnSaveEditLeave) {
          btnSaveEditLeave.disabled = false;
          btnSaveEditLeave.textContent = '💾 حفظ التعديلات';
        }
        return;
      }
    }

    if (response.success) {
      if (editLeaveModal) editLeaveModal.close();
      showToast('تم تعديل بيانات الإجازة وتوثيق الحركة بنجاح.', 'success', 4000);
      await loadActiveLeaves();
    } else {
      showToast(response.error || 'تعذر حفظ تعديل الإجازة، يرجى مراجعة البيانات.', 'error', 5000);
    }

  } catch (err) {
    showToast('حدث خطأ غير متوقع أثناء حفظ التعديل، يرجى إعادة المحاولة.', 'error');
  } finally {
    if (btnSaveEditLeave) {
      btnSaveEditLeave.disabled = false;
      btnSaveEditLeave.textContent = '💾 حفظ التعديلات';
    }
  }
}

/**
 * تهيئة لوحة المؤشرات وشريط تنبيهات المباشرة ونافذة تعديل الإجازات
 * @param {object} [options={}]
 * @param {Function} [options.onSwitchToDashboard] - دالة التحويل التلقائي لتبويب لوحة المؤشرات
 */
export function initDashboardTab(options = {}) {
  dashboardStatus = document.getElementById('dashboard-status');
  dashboardSearchInput = document.getElementById('dashboard-search-input');
  btnFilterUrgentResumption = document.getElementById('btn-filter-urgent-resumption');
  dashboardSortSelect = document.getElementById('dashboard-sort-select');
  activeLeavesTable = document.getElementById('active-leaves-table');
  activeLeavestbody = activeLeavesTable ? activeLeavesTable.querySelector('tbody') : null;
  btnExportActiveLeaves = document.getElementById('btn-export-active-leaves');

  resumptionAlertBanner = document.getElementById('resumption-alert-banner');
  alertBannerDesc = document.getElementById('alert-banner-desc');
  btnAlertView = document.getElementById('btn-alert-view');
  btnAlertDismiss = document.getElementById('btn-alert-dismiss');

  // Edit Modal bindings
  editLeaveModal = document.getElementById('edit-leave-modal');
  btnCloseEditLeaveModal = document.getElementById('btn-close-edit-leave-modal');
  btnCancelEditLeave = document.getElementById('btn-cancel-edit-leave');
  editLeaveForm = document.getElementById('edit-leave-form');
  editLeaveIdEl = document.getElementById('edit-leave-id');
  editLeaveEmployeeIdEl = document.getElementById('edit-leave-employee-id');
  editLeaveEmpNameEl = document.getElementById('edit-leave-emp-name');
  editLeaveCardNumEl = document.getElementById('edit-leave-card-num');
  editLeaveModifierEl = document.getElementById('edit-leave-modifier');
  editLeaveTypeEl = document.getElementById('edit-leave-type');
  editLeaveApproverEl = document.getElementById('edit-leave-approver');
  editLeaveStartDateEl = document.getElementById('edit-leave-start-date');
  editLeaveDaysEl = document.getElementById('edit-leave-days');
  editLeaveEndDateEl = document.getElementById('edit-leave-end-date');
  editLeaveRequestDateEl = document.getElementById('edit-leave-request-date');
  editLeaveMemoNumEl = document.getElementById('edit-leave-memo-num');
  editLeaveMemoDateEl = document.getElementById('edit-leave-memo-date');
  editLeaveOrderNumEl = document.getElementById('edit-leave-order-num');
  editLeaveOrderDateEl = document.getElementById('edit-leave-order-date');
  editLeaveNotesEl = document.getElementById('edit-leave-notes');
  btnSaveEditLeave = document.getElementById('btn-save-edit-leave');

  _onSwitchToDashboard = options.onSwitchToDashboard || null;

  // تهيئة وحدة التحكم الموحدة بالترقيم (15 سجلاً لكل صفحة)
  _pagination = createPaginationController({
    infoEl: 'dashboard-pagination-info',
    pageIndicatorEl: 'dashboard-page-indicator',
    btnFirst: 'btn-dashboard-page-first',
    btnPrev: 'btn-dashboard-page-prev',
    btnNext: 'btn-dashboard-page-next',
    btnLast: 'btn-dashboard-page-last',
    unitLabel: 'موظف',
    pageSize: 15,
    onPageChange: (newPage) => loadActiveLeaves(newPage)
  });

  // حقل البحث التلقائي مع تأخير زمني (Debounce 300ms) لمنع إرهاق قاعدة البيانات
  if (dashboardSearchInput) {
    dashboardSearchInput.addEventListener('input', () => {
      clearTimeout(_dashboardDebounceTimer);
      _dashboardDebounceTimer = setTimeout(() => {
        _dashboardSearchQuery = dashboardSearchInput.value.trim();
        if (_pagination) _pagination.resetPage();
        loadActiveLeaves(1);
      }, 300);
    });
  }

  // زر تصفية المباشرات العاجلة (خلال 3 أيام أو أقل)
  if (btnFilterUrgentResumption) {
    btnFilterUrgentResumption.addEventListener('click', () => {
      _isUrgentOnlyFilter = !_isUrgentOnlyFilter;
      btnFilterUrgentResumption.classList.toggle('active', _isUrgentOnlyFilter);
      if (_pagination) _pagination.resetPage();
      loadActiveLeaves(1);
    });
  }

  // القائمة المنسدلة لترتيب النتائج (حسب موعد المباشرة أو الاسم أو تاريخ البدء)
  if (dashboardSortSelect) {
    dashboardSortSelect.addEventListener('change', () => {
      _dashboardSortBy = dashboardSortSelect.value;
      if (_pagination) _pagination.resetPage();
      loadActiveLeaves(1);
    });
  }

  // التزامن التفاعلي ثنائي الاتجاه بين التواريخ وعدد الأيام في نافذة التعديل
  if (editLeaveStartDateEl) {
    const onStartChange = () => {
      if (isAutoUpdatingDates) return;
      const days = parseInt(editLeaveDaysEl?.value || '0', 10);
      if (editLeaveStartDateEl.value && Number.isInteger(days) && days > 0) {
        isAutoUpdatingDates = true;
        const computedEnd = addDaysToDate(editLeaveStartDateEl.value, days);
        if (computedEnd && editLeaveEndDateEl) {
          editLeaveEndDateEl.value = computedEnd;
        }
        isAutoUpdatingDates = false;
      } else if (editLeaveStartDateEl.value && editLeaveEndDateEl?.value) {
        const computedDays = recomputeDays(editLeaveStartDateEl.value, editLeaveEndDateEl.value);
        if (computedDays && editLeaveDaysEl) {
          isAutoUpdatingDates = true;
          editLeaveDaysEl.value = String(computedDays);
          isAutoUpdatingDates = false;
        }
      }
    };
    editLeaveStartDateEl.addEventListener('input', onStartChange);
    editLeaveStartDateEl.addEventListener('change', onStartChange);
  }

  if (editLeaveEndDateEl) {
    const onEndChange = () => {
      if (isAutoUpdatingDates) return;
      if (editLeaveStartDateEl?.value && editLeaveEndDateEl.value) {
        const computedDays = recomputeDays(editLeaveStartDateEl.value, editLeaveEndDateEl.value);
        if (computedDays && editLeaveDaysEl) {
          isAutoUpdatingDates = true;
          editLeaveDaysEl.value = String(computedDays);
          isAutoUpdatingDates = false;
        }
      }
    };
    editLeaveEndDateEl.addEventListener('input', onEndChange);
    editLeaveEndDateEl.addEventListener('change', onEndChange);
  }

  if (editLeaveDaysEl) {
    const onDaysChange = () => {
      if (isAutoUpdatingDates) return;
      const days = parseInt(editLeaveDaysEl.value || '0', 10);
      if (editLeaveStartDateEl?.value && Number.isInteger(days) && days > 0) {
        isAutoUpdatingDates = true;
        const computedEnd = addDaysToDate(editLeaveStartDateEl.value, days);
        if (computedEnd && editLeaveEndDateEl) {
          editLeaveEndDateEl.value = computedEnd;
        }
        isAutoUpdatingDates = false;
      }
    };
    editLeaveDaysEl.addEventListener('input', onDaysChange);
    editLeaveDaysEl.addEventListener('change', onDaysChange);
  }

  // إغلاق النافذة المنبثقة لتعديل الإجازة
  if (btnCloseEditLeaveModal && editLeaveModal) {
    btnCloseEditLeaveModal.addEventListener('click', () => editLeaveModal.close());
  }
  if (btnCancelEditLeave && editLeaveModal) {
    btnCancelEditLeave.addEventListener('click', () => editLeaveModal.close());
  }
  if (editLeaveForm) {
    editLeaveForm.addEventListener('submit', handleEditLeaveSubmit);
  }

  // زر تصدير قائمة الإجازات النشطة الحالية إلى ملف Excel
  if (btnExportActiveLeaves) {
    btnExportActiveLeaves.addEventListener('click', async () => {
      btnExportActiveLeaves.disabled = true;
      const origHtml = btnExportActiveLeaves.innerHTML;
      btnExportActiveLeaves.innerHTML = '<span>⏳</span><span>جارٍ التصدير…</span>';

      try {
        const response = await window.api.report.exportActiveLeaves();

        if (!response.success) {
          showToast(response.error || 'تعذر تصدير تقرير الإجازات الحالية، يرجى إعادة المحاولة.', 'error');
          return;
        }

        if (response.data?.filePath) {
          showExportSuccessToast({
            filePath: response.data.filePath,
            message: 'تم تصدير تقرير الإجازات الحالية بنجاح.'
          });
        } else {
          showToast('تم تصدير تقرير الإجازات الحالية بنجاح.', 'success');
        }

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء التصدير، يرجى إعادة المحاولة.', 'error');
      } finally {
        btnExportActiveLeaves.disabled = false;
        btnExportActiveLeaves.innerHTML = origHtml;
      }
    });
  }

  // مستمعات شريط تنبيهات المباشرة الواردة من نافذة التطبيق الرئيسية عبر IPC
  if (window.api && window.api.notifications) {
    window.api.notifications.onResumptionAlert(({ count, employees }) => {
      if (resumptionAlertBanner && count > 0) {
        if (alertBannerDesc) {
          const names = (employees || []).slice(0, 3).map((e) => e.FullName).join('، ');
          const extra = count > 3 ? ` و ${count - 3} آخرين` : '';
          alertBannerDesc.textContent = `يوجد ${count} موظف/ين تنتهي إجازتهم خلال 3 أيام قادمة (${names}${extra}).`;
        }
        resumptionAlertBanner.classList.remove('hidden');
      }
    });

    window.api.notifications.onOpenDashboard(() => {
      if (typeof _onSwitchToDashboard === 'function') {
        _onSwitchToDashboard();
      }
      if (resumptionAlertBanner) resumptionAlertBanner.classList.add('hidden');
    });
  }

  if (btnAlertView) {
    btnAlertView.addEventListener('click', () => {
      if (typeof _onSwitchToDashboard === 'function') {
        _onSwitchToDashboard();
      }
      if (resumptionAlertBanner) resumptionAlertBanner.classList.add('hidden');
    });
  }

  if (btnAlertDismiss) {
    btnAlertDismiss.addEventListener('click', () => {
      if (resumptionAlertBanner) resumptionAlertBanner.classList.add('hidden');
    });
  }
}
