// ============================================================
//  employeePicker.js – Unified Autocomplete Employee Picker (Tab 1)
//  حقل الاختيار والبحث التلقائي الذكي للموظفين (شاشة تسجيل الإجازات)
//
//  المسؤوليات الرئيسية:
//    • توفير بحث لحظي ذكي (Debounced Autocomplete) بالاسم والرقم الوظيفي ورقم الكرت.
//    • عرض قائمة منسدلة أنيقة بنتائج البحث توضح الاسم، الوظيفة، مكان العمل، وشارة النقل إن وجد.
//    • اختيار الموظف وتحديث الحقول المرتبطة وعرض كرت الموظف وملخص الأرصدة تلقائياً.
//    • دعم التنقل بلوحة المفاتيح (الأسهم، Enter، Escape) وإغلاق القائمة عند النقر بالخارج.
// ============================================================

'use strict';

// مؤقت تأخير الاستعلام (Debounce Timer) لمنع الضغط على قاعدة البيانات أثناء سرعة الكتابة
let _pickerDebounceTimer = null;
let _selectedEmployee = null;

// مراجع عناصر واجهة المستخدم في صفحة تسجيل الإجازة
let employeeSearchInput = null;
let employeeIdEl = null;
let btnClearEmpPicker = null;
let employeePickerDropdown = null;
let employeePickerContainer = null;
let exportHistoryBtn = null;
let _onEmployeeChange = null;

/**
 * الحصول على كائن بيانات الموظف المختار حالياً
 * @returns {object|null}
 */
export function getSelectedEmployee() {
  return _selectedEmployee;
}

/**
 * إخفاء القائمة المنسدلة للبحث وتفريغ محتواها
 */
export function hidePickerDropdown() {
  if (employeePickerDropdown) {
    employeePickerDropdown.classList.add('hidden');
    employeePickerDropdown.innerHTML = '';
  }
}

/**
 * تحديد موظف وتثبيته في حقل الاختيار وإطلاق أحداث تحديث الأرصدة والسجل
 * @param {object} emp بيانات الموظف
 */
export function selectEmployeeForPicker(emp) {
  if (!emp) return;
  _selectedEmployee = emp;

  // تعيين الرقم الوظيفي في الحقل المخفي
  if (employeeIdEl) {
    employeeIdEl.value = String(emp.EmployeeID);
  }

  // تنسيق النص الظاهر في حقل البحث
  if (employeeSearchInput) {
    const cardPart = emp.LeaveCardNumber ? ` | كرت: ${emp.LeaveCardNumber}` : '';
    const dossierPart = emp.DossierNumber ? ` | إضبارة: ${emp.DossierNumber}` : '';
    employeeSearchInput.value = `${emp.FullName} (رقم: ${emp.EmployeeID}${cardPart}${dossierPart})`;
    employeeSearchInput.classList.add('is-selected');
  }

  // إظهار زر التصفير (X)
  if (btnClearEmpPicker) {
    btnClearEmpPicker.classList.remove('hidden');
  }

  hidePickerDropdown();

  // تفعيل زر تصدير السجل التاريخي للموظف المختار
  if (exportHistoryBtn) {
    exportHistoryBtn.disabled = false;
  }

  // إطلاق حدث 'change' لتحديث استعلام الأرصدة وعرض السجل في شاشة الإجازات
  if (employeeIdEl) {
    employeeIdEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * تفريغ حقل الاختيار وإلغاء تحديد الموظف وإعادة تعيين الأرصدة
 */
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

  // إطلاق حدث التغيير لتصفير كرت الموظف وجدول الإجازات المعروض
  if (employeeIdEl) {
    employeeIdEl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/**
 * بناء وتصيير عناصر القائمة المنسدلة لنتائج البحث
 * @param {Array<object>} employees قائمة الموظفين المطابقين
 */
export function renderPickerDropdown(employees) {
  if (!employeePickerDropdown) return;
  employeePickerDropdown.innerHTML = '';

  // في حال عدم وجود أي نتائج مطابقة
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

    // السطر العلوي: الاسم والشارات
    const topRow = document.createElement('div');
    topRow.className = 'picker-item-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'picker-item-name';
    nameSpan.textContent = emp.FullName || 'بدون اسم';

    const badgesDiv = document.createElement('div');
    badgesDiv.style.display = 'flex';
    badgesDiv.style.gap = '4px';

    // شارة الرقم الوظيفي
    const idBadge = document.createElement('span');
    idBadge.className = 'picker-item-badge';
    idBadge.textContent = `رقم: ${emp.EmployeeID}`;
    badgesDiv.appendChild(idBadge);

    // شارة رقم كرت الإجازة
    if (emp.LeaveCardNumber) {
      const cardBadge = document.createElement('span');
      cardBadge.className = 'picker-item-badge';
      cardBadge.textContent = `كرت: ${emp.LeaveCardNumber}`;
      badgesDiv.appendChild(cardBadge);
    }

    // شارة رقم الإضبارة
    if (emp.DossierNumber) {
      const dossierBadge = document.createElement('span');
      dossierBadge.className = 'picker-item-badge';
      dossierBadge.textContent = `إضبارة: ${emp.DossierNumber}`;
      badgesDiv.appendChild(dossierBadge);
    }

    // شارة الموظف المنقول خارجياً مع تفاصيل رقم الأمر الإداري
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

    // السطر السفلي: العنوان الوظيفي ومكان العمل
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

    // حدث النقر لاختيار الموظف
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      selectEmployeeForPicker(emp);
    });

    // دعم الاختيار عبر زر Enter أو المسافة عند التركيز بلوحة المفاتيح
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
 * تهيئة موديول حقل اختيار الموظف وربط كافة مستمعات الأحداث
 * Initializes the Employee Picker component event listeners.
 * @param {object} options خيارات التهيئة
 * @param {Function} [options.onEmployeeChange] رد نداء عند تغيير الموظف
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
    // الاستماع لمدخلات المستخدم والبحث التلقائي المؤجل (Debounced Search)
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

    // إظهار النتائج الأولية فور التركيز على الحقل
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

    // التنقل وإغلاق القائمة عبر لوحة المفاتيح
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

  // ربط زر التصفير (X)
  if (btnClearEmpPicker) {
    btnClearEmpPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      clearEmployeePicker();
      employeeSearchInput?.focus();
    });
  }

  // إغلاق القائمة المنسدلة تلقائياً عند النقر في أي مكان خارج الحاوية
  document.addEventListener('click', (e) => {
    if (employeePickerContainer && !employeePickerContainer.contains(e.target)) {
      hidePickerDropdown();
    }
  });
}

