// ============================================================
//  addEmployeeTab.js – Add New Employee Controller (Tab 3)
//  وحدة التحكم بإضافة موظف جديد إلى النظام (التبويب الثالث)
//
//  المسؤوليات الرئيسية:
//    • جمع مدخلات استمارة تسجيل الموظف والتحقق من صحتها من جانب العميل (Client-side validation).
//    • التحقق من إيجابية وصحة الرقم الوظيفي والاسم والجنس وتاريخ التعيين والعنوان الوظيفي والقسم.
//    • استدعاء خدمة إضافة الموظف عبر قناة IPC (employee:add) والتعامل مع حالات النجاح والفشل.
//    • إعادة تعيين النموذج وتنبيه المستخدم بنجاح العملية وتحديث جداول الموظفين في التبويبات الأخرى.
// ============================================================

'use strict';

import { showToast } from './uiHelpers.js';
import { openQuickAddDepartmentModal } from './systemSettings.js';

// مراجع عناصر الاستمارة في واجهة المستخدم
let addEmployeeForm = null;
let empJobNumberEl = null;
let empDepartmentEl = null;
let btnAddDeptFromAddEmp = null;
let empFullNameEl = null;
let empGenderEl = null;
let empHireDateEl = null;
let empJobTitleEl = null;
let empWorkLocationEl = null;
let empLeaveCardNumberEl = null;
let empWorkShiftTypeEl = null;
let addEmployeeBtn = null;

/**
 * تحميل وتعبئة قائمة الأقسام المتاحة في القائمة المنسدلة
 * @param {number|string|null} [selectIdToSet]
 */
export async function populateAddEmployeeDepartments(selectIdToSet = null) {
  if (!empDepartmentEl) return;
  try {
    const res = await window.api.departments.getAll();
    if (res && res.success && Array.isArray(res.data)) {
      const currentVal = selectIdToSet != null ? String(selectIdToSet) : empDepartmentEl.value;
      empDepartmentEl.innerHTML = '<option value="" selected>— اختر القسم / الشعبة (اختياري) —</option>' +
        res.data.map(d => `<option value="${d.DepartmentID}">${d.DepartmentName || d.Name}</option>`).join('');
      if (currentVal) empDepartmentEl.value = currentVal;
    }
  } catch (err) {
    console.error('Failed to load departments in addEmployeeTab:', err);
  }
}

/**
 * استخراج وقراءة بيانات الموظف من الحقول وإجراء التحقق الأولي من صحتها
 * @returns {object|null} كائن بيانات الموظف أو null في حال وجود خطأ في الإدخال
 */
export function collectAndValidateEmployee() {
  const jobNumber = empJobNumberEl ? empJobNumberEl.value.trim() : '';
  const departmentId = empDepartmentEl && empDepartmentEl.value ? parseInt(empDepartmentEl.value, 10) : null;
  const fullName = empFullNameEl ? empFullNameEl.value.trim() : '';
  const gender = empGenderEl ? empGenderEl.value : '';
  const hireDate = empHireDateEl ? empHireDateEl.value : '';
  const jobTitle = empJobTitleEl ? empJobTitleEl.value.trim() : '';
  const workLocation = empWorkLocationEl ? empWorkLocationEl.value.trim() : '';
  const leaveCardNumber = empLeaveCardNumberEl ? empLeaveCardNumberEl.value.trim() : '';
  const workShiftType = empWorkShiftTypeEl && empWorkShiftTypeEl.value ? empWorkShiftTypeEl.value : 'دوام صباحي';

  // التحقق من الاسم الكامل
  if (!fullName) {
    showToast('يرجى إدخال الاسم الكامل للموظف.', 'warning');
    empFullNameEl?.focus();
    return null;
  }
  // التحقق من الجنس (مهم لحساب قيود إجازات الأمومة لاحقاً)
  if (gender !== 'Male' && gender !== 'Female') {
    showToast('يرجى اختيار جنس الموظف (ذكر / أنثى).', 'warning');
    empGenderEl?.focus();
    return null;
  }
  // التحقق من تاريخ التعيين (مهم لاحتساب رصيد الإجازة الاعتيادية 1 يوم لكل 10 أيام خدمة)
  if (!hireDate) {
    showToast('يرجى تحديد تاريخ تعيين صالح للموظف.', 'warning');
    empHireDateEl?.focus();
    return null;
  }
  // التحقق من العنوان الوظيفي
  if (!jobTitle) {
    showToast('يرجى إدخال المسمى الوظيفي للموظف.', 'warning');
    empJobTitleEl?.focus();
    return null;
  }

  return {
    fullName,
    gender,
    hireDate,
    jobTitle,
    workLocation: workLocation || null,
    leaveCardNumber: leaveCardNumber || null,
    jobNumber: jobNumber || null,
    departmentId: departmentId || null,
    workShiftType
  };
}

/**
 * تهيئة تبويب إضافة موظف جديد وربط حدث إرسال الاستمارة
 * @param {object} options خيارات التفاعل (مثل تحديث جدول الموظفين عند الإضافة)
 */
export function initAddEmployeeTab(options = {}) {
  const onEmployeeAdded = options.onEmployeeAdded || null;
  addEmployeeForm = document.getElementById('add-employee-form');
  empJobNumberEl = document.getElementById('emp-job-number');
  empDepartmentEl = document.getElementById('emp-department');
  btnAddDeptFromAddEmp = document.getElementById('btn-add-dept-from-add-emp');
  empFullNameEl = document.getElementById('emp-full-name');
  empGenderEl = document.getElementById('emp-gender');
  empHireDateEl = document.getElementById('emp-hire-date');
  empJobTitleEl = document.getElementById('emp-job-title');
  empWorkLocationEl = document.getElementById('emp-work-location');
  empLeaveCardNumberEl = document.getElementById('emp-leave-card-number');
  empWorkShiftTypeEl = document.getElementById('emp-work-shift-type');
  addEmployeeBtn = document.getElementById('add-employee-btn');

  // تحميل قائمة الأقسام
  populateAddEmployeeDepartments();

  // ربط زر الإضافة السريعة لقسم جديد من داخل النموذج
  if (btnAddDeptFromAddEmp) {
    btnAddDeptFromAddEmp.addEventListener('click', (e) => {
      e.preventDefault();
      openQuickAddDepartmentModal(empDepartmentEl);
    });
  }

  if (addEmployeeForm) {
    addEmployeeForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const payload = collectAndValidateEmployee();
      if (!payload) return;

      // قفل زر الإرسال وتغيير النص لتفادي تكرار النقر
      if (addEmployeeBtn) {
        addEmployeeBtn.disabled = true;
        addEmployeeBtn.textContent = 'جارٍ الحفظ…';
      }

      try {
        const response = await window.api.employee.add(payload);

        if (response.success) {
          const createdId = response.data?.employeeId || response.data;
          showToast(`تم إضافة الموظف بنجاح برقم: ${createdId || 'تلقائي'}`, 'success');
          addEmployeeForm.reset();
          if (typeof onEmployeeAdded === 'function') {
            onEmployeeAdded(createdId);
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
