// ============================================================
//  employeesTab.js – All Employees Paginated Table Controller (Tab 5)
// ============================================================

'use strict';

import { showToast, showExportSuccessToast } from './uiHelpers.js';
import { createPaginationController } from './paginationComponent.js';
import { openEmployeeDocumentsModal } from './employeeDocumentsModal.js';

let allEmployeesSearchInput = null;
let btnExportAllEmployees = null;
let allEmployeesStatus = null;
let allEmployeesTbody = null;
let _pagination = null;

let _allEmpsSearchQuery = '';
let _allEmpsDebounceTimer = null;
let _onManageEmployee = null;

export function setAllEmployeesStatus(message, state) {
  if (!allEmployeesStatus) return;
  if (state === 'hidden') {
    allEmployeesStatus.className = 'balance-display hidden';
    allEmployeesStatus.textContent = '';
    return;
  }
  allEmployeesStatus.className = `balance-display ${state}`;
  allEmployeesStatus.textContent = message;
}

export function renderAllEmployeesTable(employees) {
  if (!allEmployeesTbody) return;
  allEmployeesTbody.innerHTML = '';

  if (!employees || employees.length === 0) {
    const isSearching = _allEmpsSearchQuery.trim().length > 0;
    allEmployeesTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="9" class="text-center">
          ${isSearching ? '🔍 لا توجد نتائج مطابقة للبحث' : 'لا يوجد موظفون مسجلون في النظام'}
        </td>
      </tr>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  employees.forEach((emp) => {
    const tr = document.createElement('tr');

    const tdId = document.createElement('td');
    const tdName = document.createElement('td');
    const tdJobTitle = document.createElement('td');
    const tdLocation = document.createElement('td');
    const tdCard = document.createElement('td');
    const tdLastDate = document.createElement('td');
    const tdLastType = document.createElement('td');
    const tdStatus = document.createElement('td');
    const tdActions = document.createElement('td');

    tdId.className = 'text-center font-bold';
    tdId.textContent = String(emp.EmployeeID);

    tdName.textContent = emp.FullName || '-';
    tdJobTitle.textContent = emp.JobTitle || '-';
    tdLocation.textContent = emp.WorkLocation || '-';

    tdCard.className = 'text-center';
    tdCard.textContent = emp.LeaveCardNumber || '-';

    tdLastDate.className = 'text-center';
    if (emp.LastLeaveStartDate) {
      tdLastDate.textContent = `${emp.LastLeaveStartDate} إلى ${emp.LastLeaveEndDate || ''}`;
    } else {
      tdLastDate.textContent = 'لا توجد إجازات';
      tdLastDate.classList.add('text-muted');
    }

    tdLastType.textContent = emp.LastLeaveTypeName || '-';

    tdStatus.className = 'text-center';
    const statusSpan = document.createElement('span');
    statusSpan.className = emp.IsActive === 1 ? 'status-badge-active' : 'status-badge-inactive';
    statusSpan.textContent = emp.IsActive === 1 ? 'نشط' : 'مجمّد';
    tdStatus.appendChild(statusSpan);

    if (emp.IsTransferred === 1) {
      const transferSpan = document.createElement('span');
      transferSpan.className = 'status-badge-transferred';
      transferSpan.style.marginRight = '6px';
      transferSpan.textContent = 'منقول';
      let title = 'موظف منقول خارجياً';
      if (emp.TransferOrderNumber) title += ` - أمر رقم: ${emp.TransferOrderNumber}`;
      if (emp.TransferOrderDate) title += ` بتاريخ ${emp.TransferOrderDate}`;
      transferSpan.title = title;
      tdStatus.appendChild(transferSpan);
    }

    tdActions.className = 'text-center table-actions-cell';

    // Time Card quick button
    const btnTimeCard = document.createElement('button');
    btnTimeCard.type = 'button';
    btnTimeCard.className = 'btn-action-icon doc-btn-badge-tc';
    btnTimeCard.title = 'إدارة كروت الزمنية لهذا الموظف';
    btnTimeCard.innerHTML = '<span>🟨</span>';
    btnTimeCard.addEventListener('click', () => {
      openEmployeeDocumentsModal({
        employeeId: emp.EmployeeID,
        employeeName: emp.FullName || '',
        defaultType: 'TIME_CARD'
      });
    });

    // Leave Card quick button
    const btnLeaveCard = document.createElement('button');
    btnLeaveCard.type = 'button';
    btnLeaveCard.className = 'btn-action-icon doc-btn-badge-lc';
    btnLeaveCard.title = 'إدارة كروت الإجازة لهذا الموظف';
    btnLeaveCard.innerHTML = '<span>🟦</span>';
    btnLeaveCard.addEventListener('click', () => {
      openEmployeeDocumentsModal({
        employeeId: emp.EmployeeID,
        employeeName: emp.FullName || '',
        defaultType: 'LEAVE_CARD'
      });
    });

    // Edit employee button
    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'btn-action-secondary';
    btnEdit.style.padding = '4px 8px';
    btnEdit.style.fontSize = '0.8rem';
    btnEdit.textContent = '⚙️ تعديل';
    btnEdit.title = 'الانتقال إلى شاشة إدارة وتعديل الموظف';
    btnEdit.addEventListener('click', () => {
      if (typeof _onManageEmployee === 'function') {
        _onManageEmployee(emp.EmployeeID);
      }
    });

    tdActions.append(btnTimeCard, btnLeaveCard, btnEdit);

    tr.append(tdId, tdName, tdJobTitle, tdLocation, tdCard, tdLastDate, tdLastType, tdStatus, tdActions);
    fragment.appendChild(tr);
  });

  allEmployeesTbody.appendChild(fragment);
}

export async function loadAllEmployees(page = _pagination?.getCurrentPage() || 1) {
  if (!allEmployeesTbody) return;

  allEmployeesTbody.innerHTML = '';
  setAllEmployeesStatus('جارٍ تحميل قائمة الموظفين…', 'loading');

  try {
    const pageSize = _pagination?.getPageSize() || 15;
    const response = await window.api.employee.getPaginated({
      page,
      pageSize,
      search: _allEmpsSearchQuery
    });

    setAllEmployeesStatus('', 'hidden');

    if (!response.success) {
      setAllEmployeesStatus(`⚠️ ${response.error || 'تعذر تحميل قائمة الموظفين.'}`, 'error');
      return;
    }

    const resData = response.data || { data: [], totalCount: 0, totalPages: 1, page: 1 };

    renderAllEmployeesTable(resData.data || []);
    if (_pagination) {
      _pagination.update({
        page: resData.page,
        totalPages: resData.totalPages,
        totalCount: resData.totalCount
      });
    }

  } catch (err) {
    setAllEmployeesStatus('تعذر تحميل قائمة الموظفين، يرجى إعادة المحاولة.', 'error');
  }
}

/**
 * Initializes the All Employees tab.
 * @param {object} options
 * @param {Function} options.onManageEmployee
 */
export function initEmployeesTab(options = {}) {
  allEmployeesSearchInput = document.getElementById('all-employees-search-input');
  btnExportAllEmployees = document.getElementById('btn-export-all-employees');
  allEmployeesStatus = document.getElementById('all-employees-status');
  allEmployeesTbody = document.getElementById('all-employees-tbody');

  _onManageEmployee = options.onManageEmployee || null;

  // Initialize unified pagination controller (15 rows)
  _pagination = createPaginationController({
    infoEl: 'all-employees-pagination-info',
    pageIndicatorEl: 'all-employees-page-indicator',
    btnFirst: 'btn-page-first',
    btnPrev: 'btn-page-prev',
    btnNext: 'btn-page-next',
    btnLast: 'btn-page-last',
    unitLabel: 'موظف',
    pageSize: 15,
    onPageChange: (newPage) => loadAllEmployees(newPage)
  });

  if (allEmployeesSearchInput) {
    allEmployeesSearchInput.addEventListener('input', () => {
      clearTimeout(_allEmpsDebounceTimer);
      _allEmpsDebounceTimer = setTimeout(() => {
        _allEmpsSearchQuery = allEmployeesSearchInput.value.trim();
        if (_pagination) _pagination.resetPage();
        loadAllEmployees(1);
      }, 300);
    });
  }

  if (btnExportAllEmployees) {
    btnExportAllEmployees.addEventListener('click', async () => {
      btnExportAllEmployees.disabled = true;
      const origText = btnExportAllEmployees.innerHTML;
      btnExportAllEmployees.innerHTML = '<span>⏳</span><span>جارٍ التصدير…</span>';

      try {
        const response = await window.api.employee.exportAll({ search: _allEmpsSearchQuery });

        if (!response.success) {
          showToast(response.error || 'تعذر تصدير قائمة الموظفين، يرجى المحاولة لاحقاً.', 'error');
          return;
        }

        if (response.data?.filePath) {
          showExportSuccessToast({
            filePath: response.data.filePath,
            message: 'تم تصدير قائمة كافة الموظفين بنجاح.'
          });
        } else {
          showToast('تم تصدير قائمة الموظفين بنجاح.', 'success');
        }

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تصدير الموظفين، يرجى إعادة المحاولة.', 'error');
      } finally {
        btnExportAllEmployees.disabled = false;
        btnExportAllEmployees.innerHTML = origText;
      }
    });
  }
}
