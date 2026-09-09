// ============================================================
//  paginationComponent.js – Standardized Reusable Pagination Controller
//  Maintains unified 15 rows per page UI across all views with
//  complete edge-case handling (zero state, bounds, auto fallback).
// ============================================================

'use strict';

/**
 * Creates and initializes a reusable pagination controller.
 *
 * @param {object} config
 * @param {HTMLElement|string} config.infoEl - Element or ID for info text
 * @param {HTMLElement|string} config.pageIndicatorEl - Element or ID for page indicator
 * @param {HTMLElement|string} config.btnFirst - First page button or ID
 * @param {HTMLElement|string} config.btnPrev - Previous page button or ID
 * @param {HTMLElement|string} config.btnNext - Next page button or ID
 * @param {HTMLElement|string} config.btnLast - Last page button or ID
 * @param {string} [config.unitLabel='سجل'] - Arabic unit name e.g. 'موظف', 'إجازة', 'حركة'
 * @param {number} [config.pageSize=15] - Number of records per page (standard 15)
 * @param {Function} config.onPageChange - Callback invoked when page changes (newPage: number) => void
 * @returns {object} Pagination controller API
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
   * Updates the UI display elements based on current pagination state.
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

    const isFirstDisabled = _totalCount === 0 || _currentPage <= 1;
    const isLastDisabled = _totalCount === 0 || _currentPage >= _totalPages;

    if (_btnFirst) _btnFirst.disabled = isFirstDisabled;
    if (_btnPrev) _btnPrev.disabled = isFirstDisabled;
    if (_btnNext) _btnNext.disabled = isLastDisabled;
    if (_btnLast) _btnLast.disabled = isLastDisabled;
  }

  /**
   * Updates pagination data from server response and re-renders.
   * @param {{ page?: number, totalPages?: number, totalCount?: number }} params
   */
  function update({ page = _currentPage, totalPages = 1, totalCount = 0 } = {}) {
    _totalCount = typeof totalCount === 'number' && totalCount >= 0 ? totalCount : 0;
    _totalPages = Math.max(1, typeof totalPages === 'number' ? totalPages : Math.ceil(_totalCount / _pageSize) || 1);
    _currentPage = Math.max(1, Math.min(_totalPages, typeof page === 'number' ? page : 1));
    renderUI();
  }

  /**
   * Resets page to 1 (used when search or filter values change).
   */
  function resetPage() {
    _currentPage = 1;
    renderUI();
  }

  /**
   * Handles post-deletion edge case: if current page is now empty
   * and beyond totalPages, steps back automatically.
   * @param {number} newTotalCount
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

  // Bind button events
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

  // Initial render
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
