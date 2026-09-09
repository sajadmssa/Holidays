// ============================================================
//  employeeDocumentsModal.js – نافذة إدارة مستندات وكروت الموظف
//  تتولى إدارة كروت الزمنية (🟨 TIME_CARD) وكروت الإجازات (🟦 LEAVE_CARD)،
//  وتسجيل النسخ والسنوات مع إمكانية الفتح المباشر، الطباعة الصامتة، والحذف
// ============================================================

'use strict';

import { showToast, showConfirm } from './uiHelpers.js';

// عناصر واجهة مستخدم النافذة المنبثقة للمستندات
let documentsModal = null;
let btnCloseModal = null;
let modalTitle = null;
let modalEmpSubtitle = null;
let btnTabTimeCard = null;
let btnTabLeaveCard = null;
let badgeTimeCard = null;
let badgeLeaveCard = null;
let btnAddDocument = null;
let btnImportDocument = null;
let documentsContainer = null;
let documentsStatus = null;

// متغيرات حالة الموظف المختار والنوع النشط وقائمة المستندات
let _currentEmployeeId = null;
let _currentEmployeeName = '';
let _currentDocType = 'TIME_CARD'; // 'TIME_CARD' | 'LEAVE_CARD'
let _documentsList = [];
let _onDocumentChanged = null;

/**
 * تنسيق حجم الملف من البايت إلى وحدات مقروءة وسهلة الفهم (B, KB, MB, GB)
 * @param {number} bytes - حجم الملف بالبايت
 * @returns {string} الحجم المنسق
 */
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * تنسيق امتداد الملف لعرضه كشارة نوع (PDF, DOCX, PNG, JPG, إلخ)
 * @param {string} ext - الامتداد الأصلي للملف
 * @returns {string}
 */
function formatExtensionBadge(ext) {
  const clean = (ext || '').replace('.', '').toUpperCase();
  return clean || 'FILE';
}

/**
 * تحديث رسالة حالة النافذة (جارٍ التحميل / خطأ / إخفاء)
 * @param {string} message - نص الرسالة
 * @param {'loading'|'error'|'hidden'} state - الحالة
 */
function setModalStatus(message, state) {
  if (!documentsStatus) return;
  if (state === 'hidden') {
    documentsStatus.className = 'balance-display hidden';
    documentsStatus.textContent = '';
    return;
  }
  documentsStatus.className = `balance-display ${state}`;
  documentsStatus.textContent = message;
}

/**
 * تحديث شارات العداد على أزرار التبويبات (كرت زمنية / كرت إجازة)
 */
function updateTabBadges() {
  const timeCount = _documentsList.filter(d => d.DocumentType === 'TIME_CARD').length;
  const leaveCount = _documentsList.filter(d => d.DocumentType === 'LEAVE_CARD').length;

  if (badgeTimeCard) badgeTimeCard.textContent = String(timeCount);
  if (badgeLeaveCard) badgeLeaveCard.textContent = String(leaveCount);
}

/**
 * رسم وعرض جدول نسخ المستندات للتبويب المختار حالياً مع أزرار الفتح والطباعة والحذف
 */
function renderDocumentsView() {
  if (!documentsContainer) return;
  documentsContainer.innerHTML = '';

  const isTimeCard = _currentDocType === 'TIME_CARD';
  const typeArabic = isTimeCard ? 'كرت الزمنية' : 'كرت الإجازة';
  const themeClass = isTimeCard ? 'doc-theme-timecard' : 'doc-theme-leavecard';

  // تحديد التبويب النشط بصرياً
  if (btnTabTimeCard) btnTabTimeCard.classList.toggle('active', isTimeCard);
  if (btnTabLeaveCard) btnTabLeaveCard.classList.toggle('active', !isTimeCard);

  const filteredDocs = _documentsList.filter(d => d.DocumentType === _currentDocType);

  // في حال عدم وجود مستندات مسجلة لهذا الموظف
  if (filteredDocs.length === 0) {
    const emptyCard = document.createElement('div');
    emptyCard.className = `doc-empty-state ${themeClass}`;
    emptyCard.innerHTML = `
      <div class="doc-empty-icon">${isTimeCard ? '🟨' : '🟦'}</div>
      <h4 class="doc-empty-title">لا توجد نسخ مسجلة من ${typeArabic}</h4>
      <p class="doc-empty-desc">لم يتم رفع أو استيراد أي ملفات ${typeArabic} لهذا الموظف حتى الآن.</p>
      <div class="doc-empty-actions">
        <button type="button" class="btn-primary doc-btn-add-quick">
          <span>➕</span>
          <span>إضافة ${typeArabic} الآن</span>
        </button>
      </div>
    `;

    const quickAddBtn = emptyCard.querySelector('.doc-btn-add-quick');
    if (quickAddBtn) {
      quickAddBtn.addEventListener('click', () => handleAddOrImportDocument(false));
    }

    documentsContainer.appendChild(emptyCard);
    return;
  }

  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'table-wrapper doc-table-wrapper';

  const table = document.createElement('table');
  table.className = `data-table doc-data-table ${themeClass}`;

  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col" class="text-center doc-col-year">السنة</th>
        <th scope="col" class="doc-col-name">اسم الملف الأصلي</th>
        <th scope="col" class="text-center doc-col-date">تاريخ الإضافة</th>
        <th scope="col" class="text-center doc-col-size">النوع والحجم</th>
        <th scope="col" class="text-center doc-col-status">الحالة</th>
        <th scope="col" class="text-center doc-col-actions">الإجراءات</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');

  filteredDocs.forEach((doc) => {
    const tr = document.createElement('tr');
    tr.className = 'doc-row';

    // Year
    const tdYear = document.createElement('td');
    tdYear.className = 'text-center font-bold';
    tdYear.innerHTML = `<span class="doc-year-badge ${themeClass}">${doc.DocumentYear}</span>`;

    // Original File Name & Notes
    const tdName = document.createElement('td');
    const nameWrapper = document.createElement('div');
    nameWrapper.className = 'doc-name-wrap';

    const fileNameSpan = document.createElement('span');
    fileNameSpan.className = 'doc-file-name';
    fileNameSpan.textContent = doc.OriginalName;
    fileNameSpan.title = doc.OriginalName;
    nameWrapper.appendChild(fileNameSpan);

    if (doc.Notes && doc.Notes.trim().length > 0) {
      const notesSpan = document.createElement('span');
      notesSpan.className = 'doc-notes-text text-muted';
      notesSpan.textContent = `📝 ${doc.Notes.trim()}`;
      nameWrapper.appendChild(notesSpan);
    }
    tdName.appendChild(nameWrapper);

    // Upload Date & Time
    const tdDate = document.createElement('td');
    tdDate.className = 'text-center doc-date-cell';
    tdDate.textContent = doc.CreatedAt ? doc.CreatedAt.slice(0, 16) : '-';

    // Extension & Size
    const tdSize = document.createElement('td');
    tdSize.className = 'text-center doc-size-cell';
    tdSize.innerHTML = `
      <span class="doc-ext-badge ext-${(doc.FileExtension || '').replace('.', '').toLowerCase()}">
        ${formatExtensionBadge(doc.FileExtension)}
      </span>
      <span class="doc-size-text">${formatFileSize(doc.FileSize)}</span>
    `;

    // File presence status
    const tdStatus = document.createElement('td');
    tdStatus.className = 'text-center';
    if (doc.fileExists) {
      tdStatus.innerHTML = '<span class="status-badge-active" title="الملف موجود وقابل للفتح">متوفر</span>';
    } else {
      tdStatus.innerHTML = '<span class="status-badge-inactive" title="الملف غير موجود بالمسار الفعلي">مفقود</span>';
    }

    // Actions
    const tdActions = document.createElement('td');
    tdActions.className = 'text-center doc-actions-cell';

    const btnOpen = document.createElement('button');
    btnOpen.type = 'button';
    btnOpen.className = 'btn-action-icon doc-btn-open';
    btnOpen.innerHTML = '<span>📂</span><span>فتح</span>';
    btnOpen.title = 'فتح المستند بالبرنامج الافتراضي';
    btnOpen.disabled = !doc.fileExists;
    btnOpen.addEventListener('click', async () => {
      try {
        const res = await window.api.documents.openExternal(doc.DocumentID);
        if (!res.success) {
          showToast(`تعذر فتح الملف: ${res.error || 'الملف غير موجود'}`, 'error');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء فتح الملف.', 'error');
      }
    });

    const btnPrint = document.createElement('button');
    btnPrint.type = 'button';
    btnPrint.className = 'btn-action-icon doc-btn-print';
    btnPrint.innerHTML = '<span>🖨️</span><span>طباعة</span>';
    btnPrint.title = 'طباعة مباشرة على حجم A4 بدون معاينة';
    btnPrint.disabled = !doc.fileExists;
    btnPrint.addEventListener('click', async () => {
      btnPrint.disabled = true;
      const originalHtml = btnPrint.innerHTML;
      btnPrint.innerHTML = '<span>⏳</span><span>جارٍ الطباعة…</span>';
      try {
        const res = await window.api.documents.print(doc.DocumentID);
        if (!res.success) {
          showToast(`تعذر تنفيذ أمر الطباعة: ${res.error || 'خطأ غير معروف'}`, 'error');
        } else if (res.data && !res.data.cancelled) {
          showToast('تم إرسال أمر الطباعة بنجاح.', 'success');
        }
      } catch (err) {
        showToast('حدث خطأ أثناء إرسال أمر الطباعة.', 'error');
      } finally {
        btnPrint.disabled = !doc.fileExists;
        btnPrint.innerHTML = originalHtml;
      }
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-action-icon btn-danger doc-btn-delete';
    btnDelete.innerHTML = '<span>🗑️</span><span>حذف</span>';
    btnDelete.title = 'حذف هذه النسخة من النظام (مع بقاء الملف بأمان على القرص)';
    btnDelete.addEventListener('click', async () => {
      const confirmed = await showConfirm(
        `هل أنت متأكد من حذف نسخة ${typeArabic} لعام (${doc.DocumentYear}) بعنوان "${doc.OriginalName}"؟\n\nلن يتمكن النظام من عرض هذا المستند بعد الحذف.`,
        'تأكيد حذف المستند'
      );
      if (!confirmed) return;

      btnDelete.disabled = true;
      try {
        const delRes = await window.api.documents.delete(doc.DocumentID);
        if (!delRes.success) {
          showToast(`تعذر حذف المستند: ${delRes.error || 'خطأ غير معروف'}`, 'error');
          btnDelete.disabled = false;
          return;
        }

        showToast(`تم حذف نسخة ${typeArabic} بنجاح.`, 'success');
        await loadEmployeeDocuments(_currentEmployeeId);
        if (typeof _onDocumentChanged === 'function') {
          _onDocumentChanged(_currentEmployeeId);
        }
      } catch (err) {
        showToast('حدث خطأ أثناء حذف المستند.', 'error');
        btnDelete.disabled = false;
      }
    });

    const actionsWrap = document.createElement('div');
    actionsWrap.className = 'doc-actions-btns';
    actionsWrap.append(btnOpen, btnPrint, btnDelete);

    tdActions.appendChild(actionsWrap);
    tr.append(tdYear, tdName, tdDate, tdSize, tdStatus, tdActions);
    tbody.appendChild(tr);
  });

  tableWrapper.appendChild(table);
  documentsContainer.appendChild(tableWrapper);
}

/**
 * جلب قائمة كافة المستندات المسجلة للموظف المختار من الواجهة الخلفية وتحديث الشارات والجدول
 * @param {number} employeeId - المعرف الفريد للموظف
 */
export async function loadEmployeeDocuments(employeeId) {
  if (!employeeId) return;

  setModalStatus('جارٍ تحميل سجل المستندات…', 'loading');
  try {
    const res = await window.api.documents.list({ employeeId });
    setModalStatus('', 'hidden');

    if (!res.success) {
      setModalStatus(`⚠️ ${res.error || 'تعذر تحميل المستندات.'}`, 'error');
      _documentsList = [];
    } else {
      _documentsList = res.data || [];
    }

    updateTabBadges();
    renderDocumentsView();
  } catch (err) {
    setModalStatus('حدث خطأ أثناء جلب المستندات.', 'error');
    _documentsList = [];
    updateTabBadges();
    renderDocumentsView();
  }
}

/**
 * معالجة رفع ملف جديد أو استيراده من مسار خارجي (فلاش USB أو مجلد خارجي)
 * مع نسخ الملف بشكل آمن إلى مجلد التخزين وتوثيق بياناته
 * @param {boolean} [isImport=false] - هل العملية استيراد خارجي أم إضافة محلية
 */
async function handleAddOrImportDocument(isImport = false) {
  if (!_currentEmployeeId) {
    showToast('يرجى تحديد موظف أولاً.', 'warning');
    return;
  }

  const isTimeCard = _currentDocType === 'TIME_CARD';
  const typeArabic = isTimeCard ? 'كرت الزمنية' : 'كرت الإجازة';
  const dialogTitle = isImport
    ? `استيراد ${typeArabic} من ملف خارجي (USB / مجلد آخر)`
    : `اختيار ملف ${typeArabic} لإضافته للنظام`;

  try {
    const pickRes = await window.api.documents.pickFile({ title: dialogTitle });
    if (!pickRes.success || pickRes.data?.canceled || !pickRes.data?.filePath) {
      return;
    }

    const sourceFilePath = pickRes.data.filePath;

    setModalStatus('جارٍ حفظ وفحص المستند…', 'loading');

    const addRes = await window.api.documents.add({
      employeeId: _currentEmployeeId,
      documentType: _currentDocType,
      sourceFilePath,
      notes: isImport ? 'مستورد من مسار خارجي' : null
    });

    setModalStatus('', 'hidden');

    if (!addRes.success) {
      showToast(`تعذر إضافة المستند: ${addRes.error || 'خطأ غير معروف'}`, 'error');
      return;
    }

    const successMsg = isImport
      ? `تم استيراد ${typeArabic} ونسخه بنجاح دون المساس بالملف الأصلي.`
      : `تمت إضافة نسخة جديدة من ${typeArabic} بنجاح.`;

    showToast(successMsg, 'success');

    await loadEmployeeDocuments(_currentEmployeeId);

    if (typeof _onDocumentChanged === 'function') {
      _onDocumentChanged(_currentEmployeeId);
    }
  } catch (err) {
    setModalStatus('', 'hidden');
    showToast(`حدث خطأ غير متوقع أثناء إضافة المستند: ${err.message}`, 'error');
  }
}

/**
 * فتح النافذة المنبثقة لمستندات وكروت موظف معين وتعيين التبويب الافتراضي
 *
 * @param {object} options
 * @param {number} options.employeeId - معرف الموظف
 * @param {string} [options.employeeName=''] - اسم الموظف
 * @param {'TIME_CARD'|'LEAVE_CARD'} [options.defaultType='TIME_CARD'] - نوع الكرت الافتراضي
 */
export function openEmployeeDocumentsModal({ employeeId, employeeName = '', defaultType = 'TIME_CARD' }) {
  if (!employeeId) return;

  _currentEmployeeId = Number(employeeId);
  _currentEmployeeName = employeeName || `موظف رقم ${employeeId}`;
  _currentDocType = defaultType === 'LEAVE_CARD' ? 'LEAVE_CARD' : 'TIME_CARD';

  if (modalTitle) {
    modalTitle.textContent = `📁 مستندات وكروت: ${_currentEmployeeName}`;
  }
  if (modalEmpSubtitle) {
    modalEmpSubtitle.textContent = `الرقم الوظيفي: ${_currentEmployeeId} • سجل كافة النسخ المحفوظة`;
  }

  if (documentsModal) {
    documentsModal.showModal();
    loadEmployeeDocuments(_currentEmployeeId);
  }
}

/**
 * تهيئة وحدة التحكم بالنافذة المنبثقة للمستندات وربط أزرار التبويبات والإضافة والاستيراد
 * @param {object} [options={}]
 * @param {Function} [options.onDocumentChanged] - دالة رد الاتصال عند إضافة أو حذف مستند
 */
export function initEmployeeDocumentsModal(options = {}) {
  _onDocumentChanged = options.onDocumentChanged || null;

  documentsModal = document.getElementById('employee-documents-modal');
  btnCloseModal = document.getElementById('btn-close-documents-modal');
  modalTitle = document.getElementById('documents-modal-title');
  modalEmpSubtitle = document.getElementById('documents-modal-subtitle');
  btnTabTimeCard = document.getElementById('btn-doc-tab-timecard');
  btnTabLeaveCard = document.getElementById('btn-doc-tab-leavecard');
  badgeTimeCard = document.getElementById('doc-badge-timecard');
  badgeLeaveCard = document.getElementById('doc-badge-leavecard');
  btnAddDocument = document.getElementById('btn-add-document');
  btnImportDocument = document.getElementById('btn-import-document');
  documentsContainer = document.getElementById('documents-container');
  documentsStatus = document.getElementById('documents-status');

  if (btnCloseModal && documentsModal) {
    btnCloseModal.addEventListener('click', () => {
      documentsModal.close();
    });
  }

  if (btnTabTimeCard) {
    btnTabTimeCard.addEventListener('click', () => {
      _currentDocType = 'TIME_CARD';
      renderDocumentsView();
    });
  }

  if (btnTabLeaveCard) {
    btnTabLeaveCard.addEventListener('click', () => {
      _currentDocType = 'LEAVE_CARD';
      renderDocumentsView();
    });
  }

  if (btnAddDocument) {
    btnAddDocument.addEventListener('click', () => handleAddOrImportDocument(false));
  }

  if (btnImportDocument) {
    btnImportDocument.addEventListener('click', () => handleAddOrImportDocument(true));
  }
}
