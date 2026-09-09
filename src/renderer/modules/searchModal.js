// ============================================================
//  searchModal.js – Quick Employee Search Modal (Dialog)
// ============================================================

'use strict';

let searchModal = null;
let btnOpenSearch = null;
let btnOpenSearchManage = null;
let btnCloseModal = null;
let modalSearchInput = null;
let modalResultsTbody = null;

let _searchDebounceTimer = null;
let _searchTarget = 'entry'; // 'entry' | 'manage'
let _onSelectForEntry = null;
let _onSelectForManage = null;

export function openSearchModal(target = 'entry') {
  if (!searchModal || !modalSearchInput) return;
  _searchTarget = target;
  modalSearchInput.value = '';
  renderModalResults([]);
  searchModal.showModal();
  modalSearchInput.focus();
  triggerSearch('');
}

export async function triggerSearch(keyword) {
  if (!modalResultsTbody) return;
  modalResultsTbody.textContent = '';
  const loadingRow = document.createElement('tr');
  const loadingTd = document.createElement('td');
  loadingTd.colSpan = 5;
  loadingTd.textContent = 'جارٍ البحث…';
  loadingTd.className = 'empty-row text-center';
  loadingRow.appendChild(loadingTd);
  modalResultsTbody.appendChild(loadingRow);

  try {
    const response = await window.api.employee.search(keyword);

    if (!response.success) {
      renderModalError(response.error || 'تعذر استكمال عملية البحث.');
      return;
    }

    renderModalResults(response.data ?? []);

  } catch (err) {
    renderModalError('تعذر استكمال عملية البحث، يرجى إعادة المحاولة.');
  }
}

export function renderModalResults(employees) {
  if (!modalResultsTbody) return;
  modalResultsTbody.textContent = '';

  if (employees.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyTd = document.createElement('td');
    emptyTd.colSpan = 5;
    emptyTd.textContent = 'لا توجد نتائج مطابقة';
    emptyTd.className = 'empty-row text-center';
    emptyRow.appendChild(emptyTd);
    modalResultsTbody.appendChild(emptyRow);
    return;
  }

  const fragment = document.createDocumentFragment();

  employees.forEach((emp) => {
    const { EmployeeID, FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsTransferred, TransferOrderNumber } = emp;
    const tr = document.createElement('tr');
    tr.setAttribute('role', 'option');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `اختيار ${FullName}`);

    const tdId = document.createElement('td');
    const tdName = document.createElement('td');
    const tdCard = document.createElement('td');
    const tdLocation = document.createElement('td');
    const tdTitle = document.createElement('td');

    tdId.textContent = String(EmployeeID);
    tdId.className = 'text-center font-bold';
    tdName.textContent = FullName;

    if (IsTransferred === 1) {
      const transferBadge = document.createElement('span');
      transferBadge.className = 'status-badge-transferred';
      transferBadge.style.marginRight = '6px';
      transferBadge.style.fontSize = '0.72rem';
      transferBadge.style.padding = '1px 5px';
      transferBadge.textContent = 'منقول';
      if (TransferOrderNumber) {
        transferBadge.title = `أمر نقل رقم: ${TransferOrderNumber}`;
      }
      tdName.appendChild(transferBadge);
    }

    tdCard.textContent = LeaveCardNumber || '-';
    tdCard.className = 'text-center';
    tdLocation.textContent = WorkLocation || '-';
    tdTitle.textContent = JobTitle;

    tr.append(tdId, tdName, tdCard, tdLocation, tdTitle);

    const selectEmployee = () => {
      searchModal.close();
      if (_searchTarget === 'manage') {
        if (typeof _onSelectForManage === 'function') {
          _onSelectForManage(EmployeeID);
        }
      } else {
        if (typeof _onSelectForEntry === 'function') {
          _onSelectForEntry({
            EmployeeID,
            FullName,
            JobTitle,
            WorkLocation,
            LeaveCardNumber,
            LeaveApprover,
            IsTransferred,
            TransferOrderNumber
          });
        }
      }
    };

    tr.addEventListener('click', selectEmployee);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectEmployee();
      }
    });

    fragment.appendChild(tr);
  });

  modalResultsTbody.appendChild(fragment);
}

export function renderModalError(message) {
  if (!modalResultsTbody) return;
  modalResultsTbody.textContent = '';
  const errRow = document.createElement('tr');
  const errTd = document.createElement('td');
  errTd.colSpan = 5;
  errTd.textContent = `⚠️ ${message || 'تعذر استكمال عملية البحث، يرجى إعادة المحاولة.'}`;
  errTd.className = 'empty-row text-center text-danger';
  errRow.appendChild(errTd);
  modalResultsTbody.appendChild(errRow);
}

/**
 * Initializes the Search Modal dialog and trigger listeners.
 * @param {object} options
 * @param {Function} options.onSelectForEntry
 * @param {Function} options.onSelectForManage
 */
export function initSearchModal(options = {}) {
  searchModal = document.getElementById('employee-search-modal');
  btnOpenSearch = document.getElementById('btn-open-search');
  btnOpenSearchManage = document.getElementById('btn-open-search-manage');
  btnCloseModal = document.getElementById('btn-close-modal');
  modalSearchInput = document.getElementById('modal-search-input');
  modalResultsTbody = document.getElementById('modal-search-results');

  _onSelectForEntry = options.onSelectForEntry || null;
  _onSelectForManage = options.onSelectForManage || null;

  if (btnOpenSearch) {
    btnOpenSearch.addEventListener('click', () => openSearchModal('entry'));
  }

  if (btnOpenSearchManage) {
    btnOpenSearchManage.addEventListener('click', () => openSearchModal('manage'));
  }

  if (btnCloseModal && searchModal) {
    btnCloseModal.addEventListener('click', () => {
      searchModal.close();
    });
  }

  if (searchModal) {
    searchModal.addEventListener('close', () => {
      clearTimeout(_searchDebounceTimer);
    });
  }

  if (modalSearchInput) {
    modalSearchInput.addEventListener('input', () => {
      clearTimeout(_searchDebounceTimer);
      _searchDebounceTimer = setTimeout(() => {
        triggerSearch(modalSearchInput.value);
      }, 300);
    });
  }
}
