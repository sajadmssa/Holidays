// ============================================================
//  paginationComponent.js – وحدة التحكم الموحدة بالترقيم وقوائم البيانات
//  تضمن معياراً ثابتاً لتقسيم الصفحات (15 سجلاً لكل صفحة) عبر كافة واجهات
//  التطبيق مع معالجة الحالات الحدية (سجلات فارغة، حدود التنقل، والتراجع بعد الحذف)
// ============================================================

'use strict';

/**
 * إنشاء وتهيئة وحدة تحكم قابلة لإعادة الاستخدام لترقيم الصفحات
 *
 * @param {object} config - كائن إعدادات الترقيم
 * @param {HTMLElement|string} config.infoEl - عنصر أو معرف نص معلومات العرض (مثال: عرض 1 - 15 من 100)
 * @param {HTMLElement|string} config.pageIndicatorEl - عنصر أو معرف مؤشر الصفحة الحالية (مثال: صفحة 1 من 7)
 * @param {HTMLElement|string} config.btnFirst - زر الانتقال للصفحة الأولى
 * @param {HTMLElement|string} config.btnPrev - زر الانتقال للصفحة السابقة
 * @param {HTMLElement|string} config.btnNext - زر الانتقال للصفحة التالية
 * @param {HTMLElement|string} config.btnLast - زر الانتقال للصفحة الأخيرة
 * @param {string} [config.unitLabel='سجل'] - مسمى الوحدة بالعربية (مثال: 'موظف'، 'إجازة'، 'حركة')
 * @param {number} [config.pageSize=15] - عدد السجلات في الصفحة الواحدة (المعيار المعتمد: 15)
 * @param {Function} config.onPageChange - دالة رد الاتصال عند تغيير رقم الصفحة (newPage: number) => void
 * @returns {object} واجهة برمجة وحدة التحكم بالترقيم
 */
export function createPaginationController({
  infoEl,
  pageIndicatorEl,
  btnFirst,
  btnPrev,
  btnNext,
  btnLast,
  unitLabel = 'سجل',
  pageSize = 15,
  onPageChange
}) {
  const getEl = (el) => (typeof el === 'string' ? document.getElementById(el) : el);

  const _info = getEl(infoEl);
  const _pageIndicator = getEl(pageIndicatorEl);
  const _btnFirst = getEl(btnFirst);
  const _btnPrev = getEl(btnPrev);
  const _btnNext = getEl(btnNext);
  const _btnLast = getEl(btnLast);

  let _currentPage = 1;
  let _totalPages = 1;
  let _totalCount = 0;
  const _pageSize = pageSize || 15;

  /**
   * تحديث وتوليد نصوص واجهة المستخدم وحالة تعطيل أزرار التنقل
   */
  function renderUI() {
    if (_info) {
      if (_totalCount === 0) {
        _info.textContent = `عرض 0 من 0 ${unitLabel}`;
      } else {
        const startCount = (_currentPage - 1) * _pageSize + 1;
        const endCount = Math.min(_currentPage * _pageSize, _totalCount);
        _info.textContent = `عرض ${startCount} - ${endCount} من إجمالي ${_totalCount} ${unitLabel}`;
      }
    }

    if (_pageIndicator) {
      _pageIndicator.textContent = `صفحة ${_currentPage} من ${_totalPages}`;
    }

    // تعطيل أزرار البداية والنهاية عند الوصول لحدود الصفحات
    const isFirstDisabled = _totalCount === 0 || _currentPage <= 1;
    const isLastDisabled = _totalCount === 0 || _currentPage >= _totalPages;

    if (_btnFirst) _btnFirst.disabled = isFirstDisabled;
    if (_btnPrev) _btnPrev.disabled = isFirstDisabled;
    if (_btnNext) _btnNext.disabled = isLastDisabled;
    if (_btnLast) _btnLast.disabled = isLastDisabled;
  }

  /**
   * تحديث بيانات الترقيم بناءً على استجابة الخادم وإعادة رسم الواجهة
   * @param {{ page?: number, totalPages?: number, totalCount?: number }} params
   */
  function update({ page = _currentPage, totalPages = 1, totalCount = 0 } = {}) {
    _totalCount = typeof totalCount === 'number' && totalCount >= 0 ? totalCount : 0;
    _totalPages = Math.max(1, typeof totalPages === 'number' ? totalPages : Math.ceil(_totalCount / _pageSize) || 1);
    _currentPage = Math.max(1, Math.min(_totalPages, typeof page === 'number' ? page : 1));
    renderUI();
  }

  /**
   * إعادة التعيين إلى الصفحة الأولى (تستخدم عند تغيير فلاتر البحث أو التصفية)
   */
  function resetPage() {
    _currentPage = 1;
    renderUI();
  }

  /**
   * معالجة الحالات الحدية بعد حذف سجل: في حال أصبحت الصفحة الحالية فارغة وتجاوزت إجمالي الصفحات، يتم التراجع تلقائياً
   * @param {number} newTotalCount - إجمالي عدد السجلات الجديد بعد الحذف
   */
  function handleRecordDeleted(newTotalCount) {
    if (typeof newTotalCount === 'number') {
      _totalCount = Math.max(0, newTotalCount);
      _totalPages = Math.max(1, Math.ceil(_totalCount / _pageSize) || 1);
      if (_currentPage > _totalPages) {
        _currentPage = _totalPages;
        if (typeof onPageChange === 'function') {
          onPageChange(_currentPage);
          return;
        }
      }
      renderUI();
    }
  }

  // ربط أحداث النقر على أزرار التنقل
  if (_btnFirst) {
    _btnFirst.addEventListener('click', () => {
      if (_currentPage > 1) {
        _currentPage = 1;
        if (typeof onPageChange === 'function') onPageChange(_currentPage);
      }
    });
  }

  if (_btnPrev) {
    _btnPrev.addEventListener('click', () => {
      if (_currentPage > 1) {
        _currentPage -= 1;
        if (typeof onPageChange === 'function') onPageChange(_currentPage);
      }
    });
  }

  if (_btnNext) {
    _btnNext.addEventListener('click', () => {
      if (_currentPage < _totalPages) {
        _currentPage += 1;
        if (typeof onPageChange === 'function') onPageChange(_currentPage);
      }
    });
  }

  if (_btnLast) {
    _btnLast.addEventListener('click', () => {
      if (_currentPage < _totalPages) {
        _currentPage = _totalPages;
        if (typeof onPageChange === 'function') onPageChange(_currentPage);
      }
    });
  }

  // الرسم الأولي لواجهة الترقيم
  renderUI();

  return {
    update,
    resetPage,
    handleRecordDeleted,
    getCurrentPage: () => _currentPage,
    getPageSize: () => _pageSize,
    getTotalPages: () => _totalPages,
    getTotalCount: () => _totalCount,
    setPage: (p) => {
      _currentPage = Math.max(1, Math.min(_totalPages, p));
      renderUI();
    }
  };
}
