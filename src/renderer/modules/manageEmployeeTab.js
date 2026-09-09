// ============================================================
//  manageEmployeeTab.js – Employee Management & Editing Controller (Tab 4)
// ============================================================

'use strict';

import { showToast, showConfirm } from './uiHelpers.js';
import { openEmployeeDocumentsModal } from './employeeDocumentsModal.js';

let manageEmpIdInput = null;
let btnLoadManageEmp = null;
let manageEmpWarning = null;
let formManageEmp = null;
let manageFullNameInput = null;
let manageJobTitleInput = null;
let manageWorkLocationInput = null;
let manageLeaveCardNumberInput = null;
let manageGenderInput = null;
let manageHireDateInput = null;
let btnSaveManageEmp = null;
let btnDeactivateEmp = null;
let btnActivateEmp = null;
let manageEmpBalances = null;
let manageRegularBalanceInput = null;
let manageSick100BalanceInput = null;
let manageSick50BalanceInput = null;
let btnManageOpenTimecards = null;
let btnManageOpenLeavecards = null;
let manageBadgeTimecardCount = null;
let manageBadgeLeavecardCount = null;

let currentManagingEmpId = null;
let currentManagingEmpData = null;

let manageEmpTransferredBanner = null;
let manageEmpTransferredDetails = null;
let btnTransferEmp = null;

let transferModal = null;
let btnCloseTransferModal = null;
let btnCancelTransferModal = null;
let formTransferEmployee = null;
let transferModalEmpName = null;
let transferOrderNumberInput = null;
let transferOrderDateInput = null;
let transferNotesInput = null;
let btnSaveTransfer = null;
let btnCancelTransferStatus = null;

export async function loadEmployeeForManagement(id) {
  if (!id || !Number.isInteger(id) || id <= 0) {
    showToast('يرجى إدخال رقم موظف صحيح.', 'warning');
    return;
  }

  if (manageEmpIdInput) {
    manageEmpIdInput.value = String(id);
  }

  if (btnLoadManageEmp) {
    btnLoadManageEmp.disabled = true;
    btnLoadManageEmp.textContent = 'جارٍ التحميل…';
  }

  try {
    const response = await window.api.employee.getById(id);
    if (!response.success || !response.data) {
      showToast(`تعذر جلب بيانات الموظف: ${response.error || 'الموظف غير موجود'}`, 'error');
      if (formManageEmp) formManageEmp.classList.add('hidden');
      if (manageEmpWarning) manageEmpWarning.classList.add('hidden');
      if (manageEmpBalances) manageEmpBalances.classList.add('hidden');
      if (manageBadgeTimecardCount) manageBadgeTimecardCount.textContent = '0';
      if (manageBadgeLeavecardCount) manageBadgeLeavecardCount.textContent = '0';
      currentManagingEmpId = null;
      return;
    }

    const emp = response.data;
    currentManagingEmpId = emp.EmployeeID;
    currentManagingEmpData = emp;

    if (manageFullNameInput) manageFullNameInput.value = emp.FullName || '';
    if (manageJobTitleInput) manageJobTitleInput.value = emp.JobTitle || '';
    if (manageWorkLocationInput) manageWorkLocationInput.value = emp.WorkLocation || '';
    if (manageLeaveCardNumberInput) manageLeaveCardNumberInput.value = emp.LeaveCardNumber || '';
    if (manageGenderInput) {
      manageGenderInput.value = emp.Gender === 'Male' ? 'ذكر' : (emp.Gender === 'Female' ? 'أنثى' : (emp.Gender || ''));
    }
    if (manageHireDateInput) manageHireDateInput.value = emp.HireDate || '';

    // Render Global Leave Balances
    if (manageEmpBalances && emp.balances) {
      manageEmpBalances.classList.remove('hidden');

      if (manageRegularBalanceInput) manageRegularBalanceInput.value = emp.balances.regular;
      if (manageSick100BalanceInput) manageSick100BalanceInput.value = emp.balances.sick100;
      if (manageSick50BalanceInput) manageSick50BalanceInput.value = emp.balances.sick50;

      // Store baseline regular balance for AdjustmentDays calculation
      // baseline = uncapped earned balance minus regular leaves taken (grossEarnedBalance - regularLeavesTaken)
      const baseline = (emp.balances.unadjustedRegular !== undefined)
        ? emp.balances.unadjustedRegular
        : (emp.balances.regular - (emp.AdjustmentDays || 0));
      if (manageRegularBalanceInput) {
        manageRegularBalanceInput.dataset.baseline = String(baseline);
      }
    }

    // Load Document Counts for badges
    try {
      const docRes = await window.api.documents.list({ employeeId: currentManagingEmpId });
      if (docRes && docRes.success && Array.isArray(docRes.data)) {
        const timeCount = docRes.data.filter(d => d.DocumentType === 'TIME_CARD').length;
        const leaveCount = docRes.data.filter(d => d.DocumentType === 'LEAVE_CARD').length;
        if (manageBadgeTimecardCount) manageBadgeTimecardCount.textContent = String(timeCount);
        if (manageBadgeLeavecardCount) manageBadgeLeavecardCount.textContent = String(leaveCount);
      } else {
        if (manageBadgeTimecardCount) manageBadgeTimecardCount.textContent = '0';
        if (manageBadgeLeavecardCount) manageBadgeLeavecardCount.textContent = '0';
      }
    } catch (_docErr) {
      if (manageBadgeTimecardCount) manageBadgeTimecardCount.textContent = '0';
      if (manageBadgeLeavecardCount) manageBadgeLeavecardCount.textContent = '0';
    }

    if (emp.IsActive === 0) {
      if (manageEmpWarning) manageEmpWarning.classList.remove('hidden');
      if (manageFullNameInput) manageFullNameInput.disabled = false;
      if (manageJobTitleInput) manageJobTitleInput.disabled = false;
      if (btnSaveManageEmp) btnSaveManageEmp.disabled = false;

      if (btnDeactivateEmp) btnDeactivateEmp.classList.add('hidden');
      if (btnActivateEmp) {
        btnActivateEmp.classList.remove('hidden');
        btnActivateEmp.disabled = false;
      }
    } else {
      if (manageEmpWarning) manageEmpWarning.classList.add('hidden');
      if (manageFullNameInput) manageFullNameInput.disabled = false;
      if (manageJobTitleInput) manageJobTitleInput.disabled = false;
      if (btnSaveManageEmp) btnSaveManageEmp.disabled = false;

      if (btnDeactivateEmp) {
        btnDeactivateEmp.classList.remove('hidden');
        btnDeactivateEmp.disabled = false;
      }
      if (btnActivateEmp) btnActivateEmp.classList.add('hidden');
    }

    // Render External Transfer Banner & Button state
    if (emp.IsTransferred === 1) {
      if (manageEmpTransferredBanner) {
        manageEmpTransferredBanner.classList.remove('hidden');
      }
      if (manageEmpTransferredDetails) {
        const orderNum = emp.TransferOrderNumber ? `أمر رقم: ${emp.TransferOrderNumber}` : 'أمر رقم: (غير محدد)';
        const orderDate = emp.TransferOrderDate ? ` | بتاريخ: ${emp.TransferOrderDate}` : '';
        const notes = emp.TransferNotes ? ` | الوجهة/ملاحظات: ${emp.TransferNotes}` : '';
        manageEmpTransferredDetails.textContent = `${orderNum}${orderDate}${notes}`;
      }
      if (btnTransferEmp) {
        btnTransferEmp.classList.add('is-transferred-active');
        btnTransferEmp.textContent = '🚚 تعديل بيانات النقل';
      }
    } else {
      if (manageEmpTransferredBanner) {
        manageEmpTransferredBanner.classList.add('hidden');
      }
      if (btnTransferEmp) {
        btnTransferEmp.classList.remove('is-transferred-active');
        btnTransferEmp.textContent = '🚚 نقل خارجي';
      }
    }

    if (formManageEmp) formManageEmp.classList.remove('hidden');

  } catch (err) {
    showToast('حدث خطأ غير متوقع أثناء جلب بيانات الموظف.', 'error');
    if (formManageEmp) formManageEmp.classList.add('hidden');
    if (manageEmpWarning) manageEmpWarning.classList.add('hidden');
    if (manageEmpBalances) manageEmpBalances.classList.add('hidden');
    if (manageEmpTransferredBanner) manageEmpTransferredBanner.classList.add('hidden');
    if (btnTransferEmp) {
      btnTransferEmp.classList.remove('is-transferred-active');
      btnTransferEmp.textContent = '🚚 نقل خارجي';
    }
    if (manageBadgeTimecardCount) manageBadgeTimecardCount.textContent = '0';
    if (manageBadgeLeavecardCount) manageBadgeLeavecardCount.textContent = '0';
    currentManagingEmpId = null;
    currentManagingEmpData = null;
  } finally {
    if (btnLoadManageEmp) {
      btnLoadManageEmp.disabled = false;
      btnLoadManageEmp.textContent = '🔍 تحميل البيانات';
    }
  }
}

export function initManageEmployeeTab(options = {}) {
  const onEmployeeUpdated = options.onEmployeeUpdated || null;
  manageEmpIdInput = document.getElementById('manage-emp-id');
  btnLoadManageEmp = document.getElementById('btn-load-manage-emp');
  manageEmpWarning = document.getElementById('manage-emp-warning');
  formManageEmp = document.getElementById('form-manage-employee');
  manageFullNameInput = document.getElementById('manage-full-name');
  manageJobTitleInput = document.getElementById('manage-job-title');
  manageWorkLocationInput = document.getElementById('manage-work-location');
  manageLeaveCardNumberInput = document.getElementById('manage-leave-card-number');
  manageGenderInput = document.getElementById('manage-gender');
  manageHireDateInput = document.getElementById('manage-hire-date');
  btnSaveManageEmp = document.getElementById('btn-save-manage-emp');
  btnDeactivateEmp = document.getElementById('btn-deactivate-emp');
  btnActivateEmp = document.getElementById('btn-activate-emp');
  manageEmpBalances = document.getElementById('manage-emp-balances');
  manageRegularBalanceInput = document.getElementById('manage-regular-balance');
  manageSick100BalanceInput = document.getElementById('manage-sick-100-balance');
  manageSick50BalanceInput = document.getElementById('manage-sick-50-balance');

  btnManageOpenTimecards = document.getElementById('btn-manage-open-timecards');
  btnManageOpenLeavecards = document.getElementById('btn-manage-open-leavecards');
  manageBadgeTimecardCount = document.getElementById('manage-badge-timecard-count');
  manageBadgeLeavecardCount = document.getElementById('manage-badge-leavecard-count');

  manageEmpTransferredBanner = document.getElementById('manage-emp-transferred-banner');
  manageEmpTransferredDetails = document.getElementById('manage-emp-transferred-details');
  btnTransferEmp = document.getElementById('btn-transfer-emp');

  transferModal = document.getElementById('transfer-employee-modal');
  btnCloseTransferModal = document.getElementById('btn-close-transfer-modal');
  btnCancelTransferModal = document.getElementById('btn-cancel-transfer-modal');
  formTransferEmployee = document.getElementById('form-transfer-employee');
  transferModalEmpName = document.getElementById('transfer-modal-emp-name');
  transferOrderNumberInput = document.getElementById('transfer-order-number');
  transferOrderDateInput = document.getElementById('transfer-order-date');
  transferNotesInput = document.getElementById('transfer-notes');
  btnSaveTransfer = document.getElementById('btn-save-transfer');
  btnCancelTransferStatus = document.getElementById('btn-cancel-transfer-status');

  if (btnManageOpenTimecards) {
    btnManageOpenTimecards.addEventListener('click', () => {
      if (!currentManagingEmpId) return;
      openEmployeeDocumentsModal({
        employeeId: currentManagingEmpId,
        employeeName: manageFullNameInput?.value || '',
        defaultType: 'TIME_CARD'
      });
    });
  }

  if (btnManageOpenLeavecards) {
    btnManageOpenLeavecards.addEventListener('click', () => {
      if (!currentManagingEmpId) return;
      openEmployeeDocumentsModal({
        employeeId: currentManagingEmpId,
        employeeName: manageFullNameInput?.value || '',
        defaultType: 'LEAVE_CARD'
      });
    });
  }

  if (btnLoadManageEmp) {
    btnLoadManageEmp.addEventListener('click', () => {
      const id = parseInt(manageEmpIdInput?.value.trim() || '0', 10);
      loadEmployeeForManagement(id);
    });
  }

  if (formManageEmp) {
    formManageEmp.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!currentManagingEmpId) return;

      const fullName = manageFullNameInput?.value.trim() || '';
      const jobTitle = manageJobTitleInput?.value.trim() || '';
      const workLocation = manageWorkLocationInput ? manageWorkLocationInput.value.trim() : '';
      const leaveCardNumber = manageLeaveCardNumberInput ? manageLeaveCardNumberInput.value.trim() : '';

      if (!fullName) {
        showToast('يرجى إدخال الاسم الكامل.', 'warning');
        manageFullNameInput?.focus();
        return;
      }
      if (!jobTitle) {
        showToast('يرجى إدخال المسمى الوظيفي.', 'warning');
        manageJobTitleInput?.focus();
        return;
      }

      if (btnSaveManageEmp) {
        btnSaveManageEmp.disabled = true;
        btnSaveManageEmp.textContent = 'جارٍ الحفظ…';
      }

      try {
        // 1. Calculate AdjustmentDays for Regular Leave
        const newRegularVal = parseInt(manageRegularBalanceInput?.value || '0', 10);
        const baseline = parseInt(manageRegularBalanceInput?.dataset.baseline || '0', 10);
        const adjustmentDays = newRegularVal - baseline;

        // 2. Update Employee (FullName, JobTitle, WorkLocation, LeaveCardNumber, AdjustmentDays)
        const response = await window.api.employee.update(currentManagingEmpId, {
          fullName,
          jobTitle,
          workLocation: workLocation || null,
          leaveCardNumber: leaveCardNumber || null,
          adjustmentDays
        });

        if (!response.success) {
          showToast(response.error || 'تعذر تحديث بيانات الموظف، يرجى المحاولة لاحقاً.', 'error');
          return;
        }

        // 3. Upsert Sick Leave Balances
        // First, find the LeaveTypeID for Sick Leave
        const ltRes = await window.api.leaveTypes.getAll();
        const sickType = ltRes?.data?.find(lt => lt.Name === 'إجازة مرضية');

        if (sickType) {
          const sick100Val = parseInt(manageSick100BalanceInput?.value || '0', 10);
          const sick50Val = parseInt(manageSick50BalanceInput?.value || '0', 10);

          const res100 = await window.api.leaveBalances.upsert({
            employeeId: currentManagingEmpId,
            leaveTypeId: sickType.LeaveTypeID,
            totalBalance: sick100Val,
            payPercentage: 100
          });

          const res50 = await window.api.leaveBalances.upsert({
            employeeId: currentManagingEmpId,
            leaveTypeId: sickType.LeaveTypeID,
            totalBalance: sick50Val,
            payPercentage: 50
          });

          if (!res100?.success || !res50?.success) {
            const errorMsg = (!res100?.success ? res100?.error : res50?.error) || 'خطأ غير معروف';
            showToast(`تم تحديث بيانات الموظف، لكن حدث خطأ أثناء تحديث رصيد الإجازة المرضية: ${errorMsg}. يرجى مراجعة الرصيد يدوياً.`, 'warning');
            if (typeof onEmployeeUpdated === 'function') {
              onEmployeeUpdated(currentManagingEmpId);
            }
            return;
          }
        }

        showToast('تم تحديث بيانات الموظف بنجاح.', 'success');
        if (typeof onEmployeeUpdated === 'function') {
          onEmployeeUpdated(currentManagingEmpId);
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء حفظ التعديلات.', 'error');
      } finally {
        if (btnSaveManageEmp) {
          btnSaveManageEmp.disabled = false;
          btnSaveManageEmp.textContent = '💾 حفظ التعديلات';
        }
      }
    });
  }

  if (btnDeactivateEmp) {
    btnDeactivateEmp.addEventListener('click', async () => {
      if (!currentManagingEmpId) return;

      const confirmed = await showConfirm(
        'هل أنت متأكد من تجميد هذا الموظف؟ لن يتمكن من أخذ إجازات جديدة.',
        'تجميد الموظف'
      );
      if (!confirmed) return;

      btnDeactivateEmp.disabled = true;

      try {
        const response = await window.api.employee.deactivate(currentManagingEmpId);

        if (response.success) {
          showToast('تم تجميد الموظف بنجاح.', 'success');
          loadEmployeeForManagement(currentManagingEmpId);
          if (typeof onEmployeeUpdated === 'function') {
            onEmployeeUpdated(currentManagingEmpId);
          }
        } else {
          showToast(response.error || 'تعذر تجميد الموظف، يرجى المحاولة لاحقاً.', 'error');
          btnDeactivateEmp.disabled = false;
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تجميد الموظف.', 'error');
        btnDeactivateEmp.disabled = false;
      }
    });
  }

  if (btnActivateEmp) {
    btnActivateEmp.addEventListener('click', async () => {
      if (!currentManagingEmpId) return;

      const confirmed = await showConfirm(
        'هل أنت متأكد من إلغاء تجميد هذا الموظف وإعادة تفعيله؟',
        'إعادة تفعيل الموظف'
      );
      if (!confirmed) return;

      btnActivateEmp.disabled = true;

      try {
        const response = await window.api.employee.activate(currentManagingEmpId);

        if (response.success) {
          showToast('تم إعادة تفعيل الموظف بنجاح.', 'success');
          loadEmployeeForManagement(currentManagingEmpId);
          if (typeof onEmployeeUpdated === 'function') {
            onEmployeeUpdated(currentManagingEmpId);
          }
        } else {
          showToast(response.error || 'تعذر إعادة تفعيل الموظف، يرجى المحاولة لاحقاً.', 'error');
          btnActivateEmp.disabled = false;
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تفعيل الموظف.', 'error');
        btnActivateEmp.disabled = false;
      }
    });
  }

  // ── Transfer Employee Handlers ──────────────────────────────
  if (btnTransferEmp) {
    btnTransferEmp.addEventListener('click', () => {
      if (!currentManagingEmpId || !currentManagingEmpData) {
        showToast('يرجى اختيار موظف أولاً لتسجيل أو تعديل بيانات النقل.', 'warning');
        return;
      }

      if (transferModalEmpName) {
        transferModalEmpName.textContent = `الموظف: ${currentManagingEmpData.FullName || '-'} (الرقم: ${currentManagingEmpId})`;
      }

      if (transferOrderNumberInput) {
        transferOrderNumberInput.value = currentManagingEmpData.TransferOrderNumber || '';
      }
      if (transferOrderDateInput) {
        transferOrderDateInput.value = currentManagingEmpData.TransferOrderDate || '';
      }
      if (transferNotesInput) {
        transferNotesInput.value = currentManagingEmpData.TransferNotes || '';
      }

      if (btnCancelTransferStatus) {
        if (currentManagingEmpData.IsTransferred === 1) {
          btnCancelTransferStatus.classList.remove('hidden');
        } else {
          btnCancelTransferStatus.classList.add('hidden');
        }
      }

      if (transferModal && typeof transferModal.showModal === 'function') {
        transferModal.showModal();
      }
    });
  }

  if (btnCloseTransferModal && transferModal) {
    btnCloseTransferModal.addEventListener('click', () => {
      transferModal.close();
    });
  }

  if (btnCancelTransferModal && transferModal) {
    btnCancelTransferModal.addEventListener('click', () => {
      transferModal.close();
    });
  }

  if (formTransferEmployee) {
    formTransferEmployee.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentManagingEmpId) return;

      const rawOrderNumber = transferOrderNumberInput ? transferOrderNumberInput.value.trim() : '';
      const orderDate = transferOrderDateInput ? (transferOrderDateInput.value.trim() || null) : null;
      const notes = transferNotesInput ? (transferNotesInput.value.trim() || null) : null;

      // Validate numeric order number if provided
      let orderNumber = null;
      if (rawOrderNumber) {
        const normalized = rawOrderNumber.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
        if (!/^\d+$/.test(normalized)) {
          showToast('رقم الأمر الإداري الخاص بالنقل يجب أن يتكون من أرقام فقط.', 'warning');
          transferOrderNumberInput?.focus();
          return;
        }
        orderNumber = normalized;
      }

      if (btnSaveTransfer) {
        btnSaveTransfer.disabled = true;
        btnSaveTransfer.textContent = 'جارٍ الحفظ…';
      }

      try {
        const response = await window.api.employee.transfer(currentManagingEmpId, {
          transferOrderNumber: orderNumber,
          transferOrderDate: orderDate,
          transferNotes: notes
        });

        if (!response.success) {
          showToast(response.error || 'تعذر تسجيل بيانات النقل الخارجي.', 'error');
          return;
        }

        showToast('تم تسجيل بيانات النقل الخارجي للموظف بنجاح.', 'success');
        if (transferModal) transferModal.close();

        await loadEmployeeForManagement(currentManagingEmpId);
        if (typeof onEmployeeUpdated === 'function') {
          onEmployeeUpdated(currentManagingEmpId);
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء حفظ بيانات النقل.', 'error');
      } finally {
        if (btnSaveTransfer) {
          btnSaveTransfer.disabled = false;
          btnSaveTransfer.textContent = '💾 حفظ بيانات النقل';
        }
      }
    });
  }

  if (btnCancelTransferStatus) {
    btnCancelTransferStatus.addEventListener('click', async () => {
      if (!currentManagingEmpId) return;

      const confirmed = await showConfirm(
        'هل أنت متأكد من إلغاء حالة النقل الخارجي لهذا الموظف وإعادته كنشط اعتيادي بدون شارة نقل؟',
        'إلغاء حالة النقل الخارجي'
      );
      if (!confirmed) return;

      btnCancelTransferStatus.disabled = true;
      try {
        const response = await window.api.employee.cancelTransfer(currentManagingEmpId);

        if (!response.success) {
          showToast(response.error || 'تعذر إلغاء حالة النقل، يرجى المحاولة لاحقاً.', 'error');
          btnCancelTransferStatus.disabled = false;
          return;
        }

        showToast('تم إلغاء حالة النقل الخارجي بنجاح.', 'success');
        btnCancelTransferStatus.disabled = false;
        if (transferModal) transferModal.close();

        await loadEmployeeForManagement(currentManagingEmpId);
        if (typeof onEmployeeUpdated === 'function') {
          onEmployeeUpdated(currentManagingEmpId);
        }
      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء إلغاء حالة النقل.', 'error');
        btnCancelTransferStatus.disabled = false;
      }
    });
  }
}
