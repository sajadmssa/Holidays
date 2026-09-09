// ============================================================
//  employeePicker.js – Unified Autocomplete Employee Picker (Tab 1)
// ============================================================

'use strict';

let _pickerDebounceTimer = null;
let _selectedEmployee = null;

let employeeSearchInput = null;
let employeeIdEl = null;
let btnClearEmpPicker = null;
let employeePickerDropdown = null;
let employeePickerContainer = null;
let exportHistoryBtn = null;
let _onEmployeeChange = null;

export function getSelectedEmployee() {
  return _selectedEmployee;
}

export function hidePickerDropdown() {
  if (employeePickerDropdown) {
    employeePickerDropdown.classList.add('hidden');
    employeePickerDropdown.innerHTML = '';
  }
}

export function selectEmployeeForPicker(emp) {
  if (!emp) return;
  _selectedEmployee = emp;

  if (employeeIdEl) {
    employeeIdEl.value = String(emp.EmployeeID);
  }

  if (employeeSearchInput) {
    const cardPart = emp.LeaveCardNumber ? ` | كرت: ${emp.LeaveCardNumber}` : '';
    employeeSearchInput.value = `${emp.FullName} (رقم: ${emp.EmployeeID}${cardPart})`;
    employeeSearchInput.classList.add('is-selected');
  }

  if (btnClearEmpPicker) {
    btnClearEmpPicker.classList.remove('hidden');
  }

  hidePickerDropdown();

  if (exportHistoryBtn) {
    exportHistoryBtn.disabled = false;
  }

  // Trigger balance fetch, employee summary card, and leave history
  if (employeeIdEl) {
    employeeIdEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function clearEmployeePicker() {
  _selectedEmployee = null;

  if (employeeIdEl) {
    employeeIdEl.value = '';
  }

  if (employeeSearchInput) {
    employeeSearchInput.value = '';
    employeeSearchInput.classList.remove('is-selected');
  }

  if (btnClearEmpPicker) {
    btnClearEmpPicker.classList.add('hidden');
  }

  hidePickerDropdown();

  if (exportHistoryBtn) {
    exportHistoryBtn.disabled = true;
  }

  if (employeeIdEl) {
    employeeIdEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function renderPickerDropdown(employees) {
  if (!employeePickerDropdown) return;
  employeePickerDropdown.innerHTML = '';

  if (!employees || employees.length === 0) {
    const emptyDiv = document.createElement('div');
    emptyDiv.className = 'picker-dropdown-empty';
    emptyDiv.textContent = '🔍 لا يوجد موظف نشط مطابق للبحث';
    employeePickerDropdown.appendChild(emptyDiv);
    employeePickerDropdown.classList.remove('hidden');
    return;
  }

  const fragment = document.createDocumentFragment();

  employees.forEach((emp) => {
    const item = document.createElement('div');
    item.className = 'picker-dropdown-item';
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '0');

    const topRow = document.createElement('div');
    topRow.className = 'picker-item-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'picker-item-name';
    nameSpan.textContent = emp.FullName || 'بدون اسم';

    const badgesDiv = document.createElement('div');
    badgesDiv.style.display = 'flex';
    badgesDiv.style.gap = '4px';

    const idBadge = document.createElement('span');
    idBadge.className = 'picker-item-badge';
    idBadge.textContent = `رقم: ${emp.EmployeeID}`;
    badgesDiv.appendChild(idBadge);

    if (emp.LeaveCardNumber) {
      const cardBadge = document.createElement('span');
      cardBadge.className = 'picker-item-badge';
      cardBadge.textContent = `كرت: ${emp.LeaveCardNumber}`;
      badgesDiv.appendChild(cardBadge);
    }

    if (emp.IsTransferred === 1) {
      const transferBadge = document.createElement('span');
      transferBadge.className = 'status-badge-transferred';
      transferBadge.style.fontSize = '0.72rem';
      transferBadge.style.padding = '1px 5px';
      transferBadge.textContent = 'منقول';
      if (emp.TransferOrderNumber) {
        transferBadge.title = `أمر نقل رقم: ${emp.TransferOrderNumber}`;
      }
      badgesDiv.appendChild(transferBadge);
    }

    topRow.append(nameSpan, badgesDiv);

    const metaRow = document.createElement('div');
    metaRow.className = 'picker-item-meta';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = emp.JobTitle || '-';
    metaRow.appendChild(titleSpan);

    if (emp.WorkLocation) {
      const locSpan = document.createElement('span');
      locSpan.textContent = `📍 ${emp.WorkLocation}`;
      metaRow.appendChild(locSpan);
    }

    item.append(topRow, metaRow);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectEmployeeForPicker(emp);
    });

    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectEmployeeForPicker(emp);
      }
    });

    fragment.appendChild(item);
  });

  employeePickerDropdown.appendChild(fragment);
  employeePickerDropdown.classList.remove('hidden');
}

/**
 * Initializes the Employee Picker component event listeners.
 * @param {object} options
 * @param {Function} [options.onEmployeeChange]
 */
export function initEmployeePicker(options = {}) {
  employeeSearchInput = document.getElementById('employee-search-input');
  employeeIdEl = document.getElementById('employee-id');
  btnClearEmpPicker = document.getElementById('btn-clear-emp-picker');
  employeePickerDropdown = document.getElementById('employee-picker-dropdown');
  employeePickerContainer = document.querySelector('.employee-picker-container');
  exportHistoryBtn = document.getElementById('btn-export-history');
  _onEmployeeChange = options.onEmployeeChange || null;

  if (employeeSearchInput) {
    employeeSearchInput.addEventListener('input', () => {
      const query = employeeSearchInput.value.trim();

      if (_selectedEmployee) {
        _selectedEmployee = null;
        if (employeeIdEl) employeeIdEl.value = '';
        employeeSearchInput.classList.remove('is-selected');
        if (exportHistoryBtn) exportHistoryBtn.disabled = true;
        if (typeof _onEmployeeChange === 'function') {
          _onEmployeeChange(null);
        }
      }

      if (btnClearEmpPicker) {
        btnClearEmpPicker.classList.toggle('hidden', query.length === 0);
      }

      clearTimeout(_pickerDebounceTimer);
      _pickerDebounceTimer = setTimeout(async () => {
        try {
          const response = await window.api.employee.search(query);
          if (response.success) {
            renderPickerDropdown(response.data || []);
          }
        } catch (err) {
          console.error('Failed to search employees:', err);
        }
      }, 200);
    });

    employeeSearchInput.addEventListener('focus', async () => {
      if (!_selectedEmployee) {
        const query = employeeSearchInput.value.trim();
        try {
          const response = await window.api.employee.search(query);
          if (response.success) {
            renderPickerDropdown(response.data || []);
          }
        } catch (err) {
          console.error('Failed to search employees on focus:', err);
        }
      }
    });

    employeeSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hidePickerDropdown();
      } else if (e.key === 'ArrowDown') {
        const firstItem = employeePickerDropdown?.querySelector('.picker-dropdown-item');
        if (firstItem) {
          e.preventDefault();
          firstItem.focus();
        }
      }
    });
  }

  if (btnClearEmpPicker) {
    btnClearEmpPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      clearEmployeePicker();
      employeeSearchInput?.focus();
    });
  }

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (employeePickerContainer && !employeePickerContainer.contains(e.target)) {
      hidePickerDropdown();
    }
  });
}
