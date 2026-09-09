// ============================================================
//  auditLogTab.js – Audit Logs & System Monitoring Controller (Tab 7)
// ============================================================

'use strict';

import { showToast } from './uiHelpers.js';
import { createPaginationController } from './paginationComponent.js';

let btnRefreshAuditLogs = null;
let auditFilterSearch = null;
let auditFilterAction = null;
let auditFilterEntity = null;
let auditFilterStartDate = null;
let auditFilterEndDate = null;
let btnApplyAuditFilter = null;
let btnResetAuditFilter = null;
let auditLogsTbody = null;
let _pagination = null;

let auditDetailsModal = null;
let btnCloseAuditModal = null;
let auditModalBody = null;

export function renderAuditActionBadge(action) {
  const span = document.createElement('span');
  const act = String(action || '').toUpperCase();
  switch (act) {
    case 'INSERT':
      span.className = 'badge-audit badge-insert';
      span.textContent = 'إضافة (INSERT)';
      break;
    case 'UPDATE':
      span.className = 'badge-audit badge-update';
      span.textContent = 'تعديل (UPDATE)';
      break;
    case 'STATUS_CHANGE':
      span.className = 'badge-audit badge-status';
      span.textContent = 'حالة (STATUS)';
      break;
    case 'DELETE':
      span.className = 'badge-audit badge-delete';
      span.textContent = 'حذف (DELETE)';
      break;
    case 'BACKUP':
      span.className = 'badge-audit badge-backup';
      span.textContent = 'نسخ (BACKUP)';
      break;
    case 'RESTORE':
      span.className = 'badge-audit badge-restore';
      span.textContent = 'استعادة (RESTORE)';
      break;
    default:
      span.className = 'badge-audit';
      span.textContent = action || '-';
  }
  return span;
}

export function openAuditSnapshotModal(log) {
  if (!auditDetailsModal || !auditModalBody) return;
  auditModalBody.innerHTML = '';

  const headerBox = document.createElement('div');
  headerBox.style.marginBottom = '16px';
  headerBox.style.padding = '12px 16px';
  headerBox.style.background = '#f8fafc';
  headerBox.style.borderRadius = '8px';
  headerBox.style.border = '1px solid #e2e8f0';

  let dateStr = log.Timestamp || '';
  try {
    const d = new Date(log.Timestamp);
    if (!isNaN(d.getTime())) {
      dateStr = d.toLocaleString('ar-IQ', { dateStyle: 'full', timeStyle: 'medium' });
    }
  } catch (_e) {}

  headerBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <div><strong>رقم الحركة:</strong> #${log.LogID}</div>
      <div><strong>التوقيت:</strong> ${dateStr}</div>
    </div>
    <div style="display: flex; gap: 16px; align-items: center;">
      <div><strong>الكيان:</strong> ${log.EntityType} (ID: ${log.EntityID || '-'})</div>
      <div><strong>العملية:</strong> ${log.ActionType || log.Action || '-'}</div>
    </div>
    <div style="margin-top: 8px; color: #475569;"><strong>البيان:</strong> ${log.Details || '-'}</div>
  `;
  auditModalBody.appendChild(headerBox);

  // Parse OldValues and NewValues
  let oldObj = log.OldValueParsed || null;
  let newObj = log.NewValueParsed || null;
  try {
    const rawOld = log.OldValue || log.OldValues;
    if (!oldObj && rawOld) oldObj = typeof rawOld === 'object' ? rawOld : JSON.parse(rawOld);
  } catch (_e) {}
  try {
    const rawNew = log.NewValue || log.NewValues;
    if (!newObj && rawNew) newObj = typeof rawNew === 'object' ? rawNew : JSON.parse(rawNew);
  } catch (_e) {}

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = oldObj ? '1fr 1fr' : '1fr';
  grid.style.gap = '16px';

  if (oldObj) {
    const oldCol = document.createElement('div');
    oldCol.innerHTML = `<h4 style="margin: 0 0 8px 0; color: #dc2626; font-size: 0.95rem;">🔴 الحالة السابقة (Old Snapshot):</h4>`;
    const pre = document.createElement('pre');
    pre.className = 'json-viewer';
    pre.textContent = JSON.stringify(oldObj, null, 2);
    oldCol.appendChild(pre);
    grid.appendChild(oldCol);
  }

  if (newObj) {
    const newCol = document.createElement('div');
    newCol.innerHTML = `<h4 style="margin: 0 0 8px 0; color: #16a34a; font-size: 0.95rem;">🟢 الحالة الجديدة (New Snapshot):</h4>`;
    const pre = document.createElement('pre');
    pre.className = 'json-viewer';
    pre.textContent = JSON.stringify(newObj, null, 2);
    newCol.appendChild(pre);
    grid.appendChild(newCol);
  }

  if (!oldObj && !newObj) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'text-muted text-center';
    emptyNotice.style.padding = '24px';
    emptyNotice.textContent = 'لا تتوفر لقطة JSON مفصلة لهذه الحركة.';
    grid.appendChild(emptyNotice);
  }

  auditModalBody.appendChild(grid);
  auditDetailsModal.showModal();
}

export async function loadAuditLogs(page = _pagination?.getCurrentPage() || 1) {
  if (!auditLogsTbody) return;

  auditLogsTbody.innerHTML = '<tr><td colspan="6" class="text-center">جارٍ تحميل سجل التدقيق…</td></tr>';

  const action = auditFilterAction?.value !== 'ALL' ? auditFilterAction?.value : undefined;
  const entity = auditFilterEntity?.value !== 'ALL' ? auditFilterEntity?.value : undefined;
  const search = auditFilterSearch?.value?.trim() || undefined;
  const startDate = auditFilterStartDate?.value || undefined;
  const endDate = auditFilterEndDate?.value || undefined;

  try {
    const pageSize = _pagination?.getPageSize() || 15;
    const res = await window.api.audit.getLogs({
      page,
      pageSize,
      actionType: action,
      entityType: entity,
      search,
      startDate,
      endDate
    });

    if (!res.success) {
      showToast(res.error || 'تعذر تحميل سجل التدقيق.', 'error');
      auditLogsTbody.innerHTML = '<tr><td colspan="6" class="empty-row text-center text-danger">⚠️ تعذر تحميل سجل التدقيق، يرجى إعادة المحاولة.</td></tr>';
      return;
    }

    const { data, totalCount, totalPages } = res.data;

    auditLogsTbody.innerHTML = '';

    if (!data || data.length === 0) {
      auditLogsTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="6" class="text-center text-muted">
            🔍 لا توجد حركات تدقيق مطابقة للشروط المحددة
          </td>
        </tr>
      `;
      if (_pagination) {
        _pagination.update({
          page: 1,
          totalPages: 1,
          totalCount: 0
        });
      }
      return;
    }

    const frag = document.createDocumentFragment();
    data.forEach((log) => {
      const tr = document.createElement('tr');

      const tdId = document.createElement('td');
      tdId.className = 'text-center font-bold';
      tdId.textContent = String(log.LogID);

      const tdDate = document.createElement('td');
      tdDate.className = 'text-center';
      tdDate.style.fontSize = '0.85rem';
      try {
        const d = new Date(log.Timestamp);
        tdDate.textContent = isNaN(d.getTime()) ? log.Timestamp : d.toLocaleString('ar-IQ', { dateStyle: 'short', timeStyle: 'short' });
      } catch (_e) {
        tdDate.textContent = log.Timestamp;
      }

      const tdAction = document.createElement('td');
      tdAction.className = 'text-center';
      tdAction.appendChild(renderAuditActionBadge(log.ActionType || log.Action));

      const tdEntity = document.createElement('td');
      tdEntity.className = 'text-center';
      tdEntity.textContent = `${log.EntityType}${log.EntityID ? ` #${log.EntityID}` : ''}`;

      const tdDetails = document.createElement('td');
      tdDetails.textContent = log.Details || '-';

      const tdModal = document.createElement('td');
      tdModal.className = 'text-center';
      const btnView = document.createElement('button');
      btnView.type = 'button';
      btnView.className = 'btn-action-secondary';
      btnView.style.padding = '4px 8px';
      btnView.style.fontSize = '0.8rem';
      btnView.textContent = '👁️ معاينة';
      btnView.title = 'عرض لقطة البيانات المسجلة';
      btnView.addEventListener('click', () => openAuditSnapshotModal(log));
      tdModal.appendChild(btnView);

      tr.append(tdId, tdDate, tdAction, tdEntity, tdDetails, tdModal);
      frag.appendChild(tr);
    });

    auditLogsTbody.appendChild(frag);

    if (_pagination) {
      _pagination.update({
        page: res.data.page,
        totalPages: res.data.totalPages,
        totalCount: res.data.totalCount
      });
    }

  } catch (err) {
    showToast('حدث خطأ غير متوقع أثناء تحميل سجل التدقيق.', 'error');
    auditLogsTbody.innerHTML = '<tr><td colspan="6" class="empty-row text-center text-danger">⚠️ حدث خطأ أثناء تحميل سجل التدقيق.</td></tr>';
  }
}

export function initAuditLogTab() {
  btnRefreshAuditLogs = document.getElementById('btn-refresh-audit-logs');
  auditFilterSearch = document.getElementById('audit-filter-search');
  auditFilterAction = document.getElementById('audit-filter-action');
  auditFilterEntity = document.getElementById('audit-filter-entity');
  auditFilterStartDate = document.getElementById('audit-filter-start-date');
  auditFilterEndDate = document.getElementById('audit-filter-end-date');
  btnApplyAuditFilter = document.getElementById('btn-apply-audit-filter');
  btnResetAuditFilter = document.getElementById('btn-reset-audit-filter');
  auditLogsTbody = document.getElementById('audit-logs-tbody');

  auditDetailsModal = document.getElementById('audit-details-modal');
  btnCloseAuditModal = document.getElementById('btn-close-audit-modal');
  auditModalBody = document.getElementById('audit-modal-body');

  // Initialize unified pagination controller (15 rows)
  _pagination = createPaginationController({
    infoEl: 'audit-pagination-info',
    pageIndicatorEl: 'audit-page-indicator',
    btnFirst: 'btn-audit-page-first',
    btnPrev: 'btn-audit-page-prev',
    btnNext: 'btn-audit-page-next',
    btnLast: 'btn-audit-page-last',
    unitLabel: 'حركة',
    pageSize: 15,
    onPageChange: (newPage) => loadAuditLogs(newPage)
  });

  if (btnCloseAuditModal && auditDetailsModal) {
    btnCloseAuditModal.addEventListener('click', () => {
      auditDetailsModal.close();
    });
  }

  if (btnRefreshAuditLogs) {
    btnRefreshAuditLogs.addEventListener('click', () => loadAuditLogs(1));
  }

  if (btnApplyAuditFilter) {
    btnApplyAuditFilter.addEventListener('click', () => {
      if (_pagination) _pagination.resetPage();
      loadAuditLogs(1);
    });
  }

  if (btnResetAuditFilter) {
    btnResetAuditFilter.addEventListener('click', () => {
      if (auditFilterSearch) auditFilterSearch.value = '';
      if (auditFilterAction) auditFilterAction.value = 'ALL';
      if (auditFilterEntity) auditFilterEntity.value = 'ALL';
      if (auditFilterStartDate) auditFilterStartDate.value = '';
      if (auditFilterEndDate) auditFilterEndDate.value = '';
      if (_pagination) _pagination.resetPage();
      loadAuditLogs(1);
    });
  }
}
