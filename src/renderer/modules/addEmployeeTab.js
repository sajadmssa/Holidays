// ============================================================
//  addEmployeeTab.js – Add New Employee Controller (Tab 3)
// ============================================================

'use strict';

import { showToast } from './uiHelpers.js';

let addEmployeeForm = null;
let empEmployeeIdEl = null;
let empFullNameEl = null;
let empGenderEl = null;
let empHireDateEl = null;
let empJobTitleEl = null;
let empWorkLocationEl = null;
let empLeaveCardNumberEl = null;
let addEmployeeBtn = null;

export function collectAndValidateEmployee() {
  const rawId = empEmployeeIdEl ? empEmployeeIdEl.value.trim() : '';
  const employeeId = parseInt(rawId, 10);
  const fullName = empFullNameEl ? empFullNameEl.value.trim() : '';
  const gender = empGenderEl ? empGenderEl.value : '';
  const hireDate = empHireDateEl ? empHireDateEl.value : '';
  const jobTitle = empJobTitleEl ? empJobTitleEl.value.trim() : '';
  const workLocation = empWorkLocationEl ? empWorkLocationEl.value.trim() : '';
  const leaveCardNumber = empLeaveCardNumberEl ? empLeaveCardNumberEl.value.trim() : '';

  if (!rawId || !Number.isInteger(employeeId) || employeeId <= 0) {
    showToast('الرقم الوظيفي مطلوب ويجب أن يكون رقماً صحيحاً موجباً.', 'warning');
    empEmployeeIdEl?.focus();
    return null;
  }
  if (!fullName) {
    showToast('يرجى إدخال الاسم الكامل للموظف.', 'warning');
    empFullNameEl?.focus();
    return null;
  }
  if (gender !== 'Male' && gender !== 'Female') {
    showToast('يرجى اختيار جنس الموظف (ذكر / أنثى).', 'warning');
    empGenderEl?.focus();
    return null;
  }
  if (!hireDate) {
    showToast('يرجى تحديد تاريخ تعيين صالح للموظف.', 'warning');
    empHireDateEl?.focus();
    return null;
  }
  if (!jobTitle) {
    showToast('يرجى إدخال المسمى الوظيفي للموظف.', 'warning');
    empJobTitleEl?.focus();
    return null;
  }

  return {
    employeeId,
    fullName,
    gender,
    hireDate,
    jobTitle,
    workLocation: workLocation || null,
    leaveCardNumber: leaveCardNumber || null,
  };
}

export function initAddEmployeeTab(options = {}) {
  const onEmployeeAdded = options.onEmployeeAdded || null;
  addEmployeeForm = document.getElementById('add-employee-form');
  empEmployeeIdEl = document.getElementById('emp-employee-id');
  empFullNameEl = document.getElementById('emp-full-name');
  empGenderEl = document.getElementById('emp-gender');
  empHireDateEl = document.getElementById('emp-hire-date');
  empJobTitleEl = document.getElementById('emp-job-title');
  empWorkLocationEl = document.getElementById('emp-work-location');
  empLeaveCardNumberEl = document.getElementById('emp-leave-card-number');
  addEmployeeBtn = document.getElementById('add-employee-btn');

  if (addEmployeeForm) {
    addEmployeeForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const payload = collectAndValidateEmployee();
      if (!payload) return;

      if (addEmployeeBtn) {
        addEmployeeBtn.disabled = true;
        addEmployeeBtn.textContent = 'جارٍ الحفظ…';
      }

      try {
        const response = await window.api.employee.add(payload);

        if (response.success) {
          showToast(`تم إضافة الموظف بنجاح برقم: ${payload.employeeId}`, 'success');
          addEmployeeForm.reset();
          if (typeof onEmployeeAdded === 'function') {
            onEmployeeAdded(payload.employeeId);
          }
        } else {
          showToast(response.error || 'تعذر إضافة الموظف. يرجى مراجعة البيانات.', 'error');
        }

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء إضافة الموظف، يرجى إعادة المحاولة.', 'error');

      } finally {
        if (addEmployeeBtn) {
          addEmployeeBtn.disabled = false;
          addEmployeeBtn.textContent = 'إضافة الموظف';
        }
      }
    });
  }
}
