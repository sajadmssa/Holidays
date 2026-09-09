// ============================================================
//  balanceReportTab.js – وحدة تقارير الأرصدة الحرجة وتراكم الإجازات السنوي
//  تتولى إدارة كشف الموظفين المقتربين من استنفاد رصيدهم الاعتيادي،
//  وكشف التراكم السنوي للإجازات المستهلكة حسب السنة والنوع
// ============================================================

'use strict';

import { showToast, showExportSuccessToast } from './uiHelpers.js';
import { createPaginationController } from './paginationComponent.js';

// عناصر واجهة المستخدم لتبويب الأرصدة والتراكم
let btnRefreshBalanceReport = null;
let btnExportCriticalReport = null;
let btnApplyThreshold = null;
let kpiCriticalCount = null;
let kpiCriticalLabel = null;
let kpiTotalLeavesYear = null;
let kpiTotalDaysYear = null;
let inputBalanceThreshold = null;
let criticalBalancesTbody = null;
let selectAccumulationYear = null;
let accumulationLeavesTbody = null;
let _onManageEmployee = null;

// وحدات التحكم بالترقيم ومتغيرات الحالة
let _critPagination = null;
let _accumPagination = null;
let _isThresholdLoaded = false;
let _isApplyingThreshold = false;
let _isRefreshing = false;

/**
 * جلب واستعادة حد الرصيد الحرج المحفوظ في إعدادات النظام (_AppSettings)
 * الافتراضي: 5 أيام إذا لم يكن هناك إعداد محفوظ
 */
export async function loadSavedThreshold() {
  try {
    if (window.api?.system?.getSetting) {
      const res = await window.api.system.getSetting('critical_balance_threshold');
      const savedVal = res?.data !== undefined ? res.data : res;
      if (savedVal !== null && savedVal !== undefined && String(savedVal).trim() !== '') {
        const parsed = parseInt(String(savedVal).trim(), 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 365) {
          if (inputBalanceThreshold) {
            inputBalanceThreshold.value = String(parsed);
          }
          if (kpiCriticalLabel) {
            kpiCriticalLabel.textContent = `موظفون برصيد حرج (≤ ${parsed} أيام)`;
          }
        }
      }
    }
  } catch (_e) {
    // التراجع التلقائي الآمن إلى القيمة الافتراضية
  } finally {
    _isThresholdLoaded = true;
  }
}

/**
 * جلب قائمة الموظفين أصحاب الرصيد الحرج مقسمة لصفحات وتحديث جدول العرض وبطاقة المؤشر
 * @param {number} [page=1] - رقم الصفحة المطلوبة
 */
export async function loadCriticalBalances(page = 1) {
  const threshold = parseInt(inputBalanceThreshold?.value || '5', 10);

  if (criticalBalancesTbody) {
    criticalBalancesTbody.innerHTML = '<tr><td colspan="9" class="text-center">جارٍ تحميل كشف الأرصدة الحرجة…</td></tr>';
  }

  try {
    const res = await window.api.report.getCriticalBalancesPaginated({
      threshold,
      page,
      pageSize: 15,
    });

    if (!res.success) {
      showToast(res.error || 'تعذر تحميل كشف الأرصدة الحرجة.', 'error');
      if (criticalBalancesTbody) {
        criticalBalancesTbody.innerHTML = '<tr><td colspan="9" class="empty-row text-center text-danger">⚠️ تعذر تحميل كشف الأرصدة الحرجة.</td></tr>';
      }
      _critPagination?.update({ totalCount: 0, page: 1, totalPages: 1, pageSize: 15 });
      return;
    }

    const { data: criticalEmployees, criticalCount, totalCount, totalPages } = res.data;

    // 1. KPI Count & Dynamic Label
    if (kpiCriticalCount) kpiCriticalCount.textContent = String(criticalCount ?? 0);
    if (kpiCriticalLabel) kpiCriticalLabel.textContent = `موظفون برصيد حرج (≤ ${threshold} أيام)`;

    // 2. Table
    if (criticalBalancesTbody) {
      criticalBalancesTbody.innerHTML = '';
      if (!criticalEmployees || criticalEmployees.length === 0) {
        criticalBalancesTbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="9" class="text-center text-muted">
              ✅ لا يوجد موظفون برصيد إجازة اعتيادية حرج (أقل من أو يساوي ${threshold} أيام)
            </td>
          </tr>
        `;
      } else {
        const frag = document.createDocumentFragment();
        criticalEmployees.forEach((emp) => {
          const tr = document.createElement('tr');

          const tdId = document.createElement('td');
          tdId.className = 'text-center font-bold';
          tdId.textContent = String(emp.EmployeeID);

          const tdName = document.createElement('td');
          tdName.textContent = emp.FullName || '-';

          const tdJob = document.createElement('td');
          tdJob.textContent = emp.JobTitle || '-';

          const tdLoc = document.createElement('td');
          tdLoc.textContent = emp.WorkLocation || '-';

          const tdCard = document.createElement('td');
          tdCard.className = 'text-center';
          tdCard.textContent = emp.LeaveCardNumber || '-';

          const tdBal = document.createElement('td');
          tdBal.className = 'text-center';
          const balBadge = document.createElement('span');
          balBadge.className = emp.RemainingBalance <= 0 ? 'badge-critical-zero' : 'badge-critical-low';
          balBadge.textContent = `${emp.RemainingBalance} يوم`;
          tdBal.appendChild(balBadge);

          const tdTaken = document.createElement('td');
          tdTaken.className = 'text-center';
          tdTaken.textContent = String(emp.RegularLeavesTaken);

          const tdGross = document.createElement('td');
          tdGross.className = 'text-center';
          tdGross.textContent = String(emp.GrossEarnedBalance);

          const tdAct = document.createElement('td');
          tdAct.className = 'text-center';
          const btnManage = document.createElement('button');
          btnManage.type = 'button';
          btnManage.className = 'btn-action-secondary';
          btnManage.style.padding = '4px 8px';
          btnManage.style.fontSize = '0.8rem';
          btnManage.textContent = '⚙️ إدارة';
          btnManage.title = 'تعديل أو تسوية رصيد الموظف';
          btnManage.addEventListener('click', () => {
            if (typeof _onManageEmployee === 'function') {
              _onManageEmployee(emp.EmployeeID);
            }
          });
          tdAct.appendChild(btnManage);

          tr.append(tdId, tdName, tdJob, tdLoc, tdCard, tdBal, tdTaken, tdGross, tdAct);
          frag.appendChild(tr);
        });
        criticalBalancesTbody.appendChild(frag);
      }
    }

    // 3. Update pagination
    _critPagination?.update({
      totalCount: totalCount ?? 0,
      page: res.data.page ?? page,
      totalPages: totalPages ?? 1,
      pageSize: res.data.pageSize ?? 15,
    });

  } catch (err) {
    showToast('حدث خطأ غير متوقع أثناء تحميل كشف الأرصدة الحرجة.', 'error');
    if (criticalBalancesTbody) {
      criticalBalancesTbody.innerHTML = '<tr><td colspan="9" class="empty-row text-center text-danger">⚠️ تعذر تحميل كشف الأرصدة الحرجة.</td></tr>';
    }
    _critPagination?.update({ totalCount: 0, page: 1, totalPages: 1, pageSize: 15 });
  }
}

/**
 * جلب كشف التراكم السنوي للإجازات المستهلكة حسب السنة المحددة مقسمة لصفحات
 * مع تحديث بطاقات المؤشرات (إجمالي الإجازات، وإجمالي الأيام المستهلكة)
 * @param {number} [page=1] - رقم الصفحة المطلوبة
 */
export async function loadAccumulationLeaves(page = 1) {
  const year = parseInt(selectAccumulationYear?.value || String(new Date().getFullYear()), 10);

  if (accumulationLeavesTbody) {
    accumulationLeavesTbody.innerHTML = '<tr><td colspan="10" class="text-center">جارٍ تحميل كشف التراكم…</td></tr>';
  }

  try {
    const res = await window.api.report.getAccumulatedPaginated({
      year,
      page,
      pageSize: 15,
    });

    if (!res.success) {
      showToast(res.error || 'تعذر تحميل كشف تراكم الإجازات.', 'error');
      if (accumulationLeavesTbody) {
        accumulationLeavesTbody.innerHTML = '<tr><td colspan="10" class="empty-row text-center text-danger">⚠️ تعذر تحميل كشف تراكم الإجازات.</td></tr>';
      }
      _accumPagination?.update({ totalCount: 0, page: 1, totalPages: 1, pageSize: 15 });
      return;
    }

    const { data: accumulatedLeaves, totalCount, totalPages, summary } = res.data;

    // 1. KPIs
    if (kpiTotalLeavesYear) kpiTotalLeavesYear.textContent = String(summary?.totalLeavesThisYear ?? 0);
    if (kpiTotalDaysYear) kpiTotalDaysYear.textContent = String(summary?.totalDaysThisYear ?? 0);

    // 2. Table
    if (accumulationLeavesTbody) {
      accumulationLeavesTbody.innerHTML = '';
      if (!accumulatedLeaves || accumulatedLeaves.length === 0) {
        accumulationLeavesTbody.innerHTML = `
          <tr class="empty-row">
            <td colspan="10" class="text-center text-muted">
              لا توجد إجازات مستهلكة مسجلة في سنة ${year}
            </td>
          </tr>
        `;
      } else {
        const frag = document.createDocumentFragment();
        accumulatedLeaves.forEach((emp) => {
          const tr = document.createElement('tr');

          const tdId = document.createElement('td');
          tdId.className = 'text-center font-bold';
          tdId.textContent = String(emp.EmployeeID);

          const tdName = document.createElement('td');
          tdName.textContent = emp.FullName || '-';

          const tdJob = document.createElement('td');
          tdJob.textContent = emp.JobTitle || '-';

          const tdLoc = document.createElement('td');
          tdLoc.textContent = emp.WorkLocation || '-';

          const tdCard = document.createElement('td');
          tdCard.className = 'text-center';
          tdCard.textContent = emp.LeaveCardNumber || '-';

          const tdTotal = document.createElement('td');
          tdTotal.className = 'text-center font-bold';
          tdTotal.textContent = `${emp.TotalConsumedDays} يوم`;

          const tdReg = document.createElement('td');
          tdReg.className = 'text-center';
          tdReg.textContent = String(emp.RegularDays);

          const tdSick = document.createElement('td');
          tdSick.className = 'text-center';
          tdSick.textContent = String(emp.SickDays);

          const tdOther = document.createElement('td');
          tdOther.className = 'text-center';
          tdOther.textContent = String(emp.OtherDays);

          const tdCount = document.createElement('td');
          tdCount.className = 'text-center';
          tdCount.textContent = String(emp.LeavesCount);

          tr.append(tdId, tdName, tdJob, tdLoc, tdCard, tdTotal, tdReg, tdSick, tdOther, tdCount);
          frag.appendChild(tr);
        });
        accumulationLeavesTbody.appendChild(frag);
      }
    }

    // 3. Update pagination
    _accumPagination?.update({
      totalCount: totalCount ?? 0,
      page: res.data.page ?? page,
      totalPages: totalPages ?? 1,
      pageSize: res.data.pageSize ?? 15,
    });

  } catch (err) {
    showToast('حدث خطأ غير متوقع أثناء تحميل كشف تراكم الإجازات.', 'error');
    if (accumulationLeavesTbody) {
      accumulationLeavesTbody.innerHTML = '<tr><td colspan="10" class="empty-row text-center text-danger">⚠️ تعذر تحميل كشف تراكم الإجازات.</td></tr>';
    }
    _accumPagination?.update({ totalCount: 0, page: 1, totalPages: 1, pageSize: 15 });
  }
}

/**
 * تحميل كلا التقريرين (الأرصدة الحرجة + التراكم السنوي) بالتوازي عند فتح التبويب أو تحديثه
 */
export async function loadBalanceAndAccumulationReport() {
  if (!_isThresholdLoaded) {
    await loadSavedThreshold();
  }
  await Promise.all([
    loadCriticalBalances(1),
    loadAccumulationLeaves(1),
  ]);
}

/**
 * تهيئة تبويب تقارير الأرصدة والتراكم وربط وحدات الترقيم ومستمعات الأحداث
 * @param {object} [options={}]
 * @param {Function} [options.onManageEmployee] - دالة الانتقال لتبويب إدارة الموظف لتسوية رصيده
 */
export function initBalanceReportTab(options = {}) {
  btnRefreshBalanceReport = document.getElementById('btn-refresh-balance-report');
  btnExportCriticalReport = document.getElementById('btn-export-critical-report');
  btnApplyThreshold = document.getElementById('btn-apply-threshold');
  kpiCriticalCount = document.getElementById('kpi-critical-count');
  kpiCriticalLabel = document.getElementById('kpi-critical-label');
  kpiTotalLeavesYear = document.getElementById('kpi-total-leaves-year');
  kpiTotalDaysYear = document.getElementById('kpi-total-days-year');
  inputBalanceThreshold = document.getElementById('input-balance-threshold');
  criticalBalancesTbody = document.getElementById('critical-balances-tbody');
  selectAccumulationYear = document.getElementById('select-accumulation-year');
  accumulationLeavesTbody = document.getElementById('accumulation-leaves-tbody');

  _onManageEmployee = options.onManageEmployee || null;

  // Initialize Critical Balances pagination controller
  _critPagination = createPaginationController({
    pageSize: 15,
    unitLabel: 'موظف',
    infoEl: 'critical-pagination-info',
    btnFirst: 'btn-critical-page-first',
    btnPrev: 'btn-critical-page-prev',
    pageIndicatorEl: 'critical-page-indicator',
    btnNext: 'btn-critical-page-next',
    btnLast: 'btn-critical-page-last',
    onPageChange: (newPage) => loadCriticalBalances(newPage),
  });

  // Initialize Yearly Accumulation pagination controller
  _accumPagination = createPaginationController({
    pageSize: 15,
    unitLabel: 'موظف',
    infoEl: 'accum-pagination-info',
    btnFirst: 'btn-accum-page-first',
    btnPrev: 'btn-accum-page-prev',
    pageIndicatorEl: 'accum-page-indicator',
    btnNext: 'btn-accum-page-next',
    btnLast: 'btn-accum-page-last',
    onPageChange: (newPage) => loadAccumulationLeaves(newPage),
  });

  // زر التحديث اليدوي مع مؤشر دوران وتعطيل الزر مؤقتاً
  if (btnRefreshBalanceReport) {
    btnRefreshBalanceReport.addEventListener('click', async () => {
      if (_isRefreshing) return;
      _isRefreshing = true;
      const origHtml = btnRefreshBalanceReport.innerHTML;
      btnRefreshBalanceReport.disabled = true;
      btnRefreshBalanceReport.innerHTML = '<span class="spin">🔄</span> <span>جارٍ التحديث…</span>';

      try {
        _critPagination?.resetPage();
        _accumPagination?.resetPage();
        await loadBalanceAndAccumulationReport();
        showToast('تم تحديث بيانات التقرير بنجاح.', 'success');
      } catch (err) {
        showToast('حدث خطأ أثناء تحديث التقرير.', 'error');
      } finally {
        _isRefreshing = false;
        btnRefreshBalanceReport.disabled = false;
        btnRefreshBalanceReport.innerHTML = origHtml;
      }
    });
  }

  // معالجة تطبيق حد الرصيد الحرج وحفظه في إعدادات النظام وتحديث الجدول فورياً
  const applyThreshold = async () => {
    if (_isApplyingThreshold) return;
    _isApplyingThreshold = true;

    const origText = btnApplyThreshold ? btnApplyThreshold.innerHTML : 'تطبيق';
    if (btnApplyThreshold) {
      btnApplyThreshold.disabled = true;
      btnApplyThreshold.innerHTML = '<span class="spin">⏳</span> <span>جارٍ التطبيق…</span>';
    }

    try {
      const threshold = parseInt(inputBalanceThreshold?.value || '5', 10);
      if (window.api?.system?.setSetting) {
        window.api.system.setSetting('critical_balance_threshold', String(threshold)).catch(() => {});
      }
      _critPagination?.resetPage();
      await loadCriticalBalances(1);
    } finally {
      _isApplyingThreshold = false;
      if (btnApplyThreshold) {
        btnApplyThreshold.disabled = false;
        btnApplyThreshold.innerHTML = origText;
      }
    }
  };

  if (btnApplyThreshold) {
    btnApplyThreshold.addEventListener('click', applyThreshold);
  }

  // دعم تطبيق الحد الحرج بالضغط على مفتاح Enter
  if (inputBalanceThreshold) {
    inputBalanceThreshold.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        applyThreshold();
      }
    });
  }

  // إعادة تحميل كشف التراكم عند تغيير السنة المختارة
  if (selectAccumulationYear) {
    selectAccumulationYear.addEventListener('change', () => {
      _accumPagination?.resetPage();
      loadAccumulationLeaves(1);
    });
  }

  // تصدير كشف الأرصدة الحرجة والتراكم السنوي إلى ملف Excel
  if (btnExportCriticalReport) {
    btnExportCriticalReport.addEventListener('click', async () => {
      btnExportCriticalReport.disabled = true;
      const origHtml = btnExportCriticalReport.innerHTML;
      btnExportCriticalReport.innerHTML = '<span>⏳</span><span>جارٍ التصدير…</span>';

      try {
        const threshold = parseInt(inputBalanceThreshold?.value || '5', 10);
        const year = parseInt(selectAccumulationYear?.value || String(new Date().getFullYear()), 10);
        const res = await window.api.report.exportCriticalReport({ threshold, year });

        if (!res.success) {
          showToast(res.error || 'تعذر تصدير الكشف، يرجى المحاولة لاحقاً.', 'error');
          return;
        }

        if (res.data?.canceled) {
          return;
        }

        if (res.data?.filePath) {
          showExportSuccessToast({
            filePath: res.data.filePath,
            message: 'تم تصدير تقرير الأرصدة والتراكم بنجاح.'
          });
        } else {
          showToast('تم تصدير تقرير الأرصدة والتراكم بنجاح.', 'success');
        }

      } catch (err) {
        showToast('حدث خطأ غير متوقع أثناء تصدير الكشف، يرجى إعادة المحاولة.', 'error');
      } finally {
        btnExportCriticalReport.disabled = false;
        btnExportCriticalReport.innerHTML = origHtml;
      }
    });
  }
}
