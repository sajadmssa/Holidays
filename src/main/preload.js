// ============================================================
//  preload.js  –  Electron Preload Script
//  Responsibilities:
//    • Acts as the SOLE bridge between Renderer and Main
//    • Exposes a typed, minimal API surface via contextBridge
//    • The Renderer has ZERO access to Node.js or Electron APIs
//    • Every method is a thin wrapper around ipcRenderer.invoke()
// ============================================================

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ──────────────────────────────────────────────────────────────
//  Security: Whitelist of valid IPC channels.
//  ipcRenderer.invoke is ONLY called through these helpers,
//  preventing a compromised renderer from sending arbitrary channels.
// ──────────────────────────────────────────────────────────────
const VALID_CHANNELS = new Set([
  'employees:getAll',
  'employees:getById',
  'employees:create',
  'employees:update',
  'employees:deactivate',
  'leaveTypes:getAll',
  'leaveBalances:getByEmployee',
  'leaveBalances:upsert',
  'leaves:getByEmployee',
  'leaves:getAll',
  'leaves:create',
  'leaves:delete',
  'audit:getAll',
  // ── Leave Engine (Phase 3 & Phase 9) ──────────────────────
  'leave:getRegularBalance',
  'leave:submitSickLeave',
  'leave:submitRegularLeave',
  'leave:getActiveToday',
  'leave:getActiveTodayPaginated',
  'leave:getHistory',
  'leave:delete',
  'leave:update',
  // ── Employee Onboarding & Management (Phase 6, 8, 10) ─────
  'employee:add',
  'employee:search',          // Phase 8: Lookup Modal
  'employee:getById',         // Phase 10: Management
  'employee:update',          // Phase 10: Management
  'employee:deactivate',      // Phase 10: Management
  'employee:activate',
  'employee:transfer',        // External transfer
  'employee:cancelTransfer',  // Cancel external transfer
  'employee:getPaginated',    // Management Table pagination
  'employee:exportAll',       // Export all employees to Excel
  // ── Reporting Engine (Phase 7 & Phase 4) ──────────────────
  'report:exportHistory',
  'report:exportActiveLeaves',
  'report:getCriticalReport',
  'report:exportCriticalReport',
  'report:getCriticalBalancesPaginated',
  'report:getAccumulatedPaginated',
  'report:exportTransferredEmployees',
  // ── Audit Logs ─────────────────────────────────────────────
  'audit:getLogs',
  // ── System Administration (Phase 11) ──────────────────────
  'system:backup',
  'system:restore',
  'system:selectDirectory',
  'system:getSetting',
  'system:setSetting',
  'system:openPath',
  // ── Employee Documents ─────────────────────────────────────
  'document:add',
  'document:list',
  'document:delete',
  'document:openExternal',
  'document:pickFile',
  'document:getStoragePath',
  'document:setStoragePath',
  'document:testStoragePath',
  'document:openStorageFolder',
  'document:print',
  'document:getDeletedStats',
  'document:purgeDeleted',
]);

/**
 * A generic, safe IPC invoker that validates the channel name.
 * @param {string} channel
 * @param {...any} args
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
function invoke(channel, ...args) {
  if (!VALID_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`IPC channel "${channel}" is not whitelisted.`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

// ──────────────────────────────────────────────────────────────
//  Exposed API  –  window.api in the Renderer
// ──────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('api', {

  // ── Employees ──────────────────────────────────────────────
  employees: {
    /** @returns {Promise<{success:boolean, data: Employee[]}>} */
    getAll: () => invoke('employees:getAll'),
    /** @returns {Promise<{success:boolean, data: Employee}>} */
    getById: (id) => invoke('employees:getById', id),
    /** @returns {Promise<{success:boolean, data: {id: number}}>} */
    create: (payload) => invoke('employees:create', payload),
    /** @returns {Promise<{success:boolean, data: number}>} changes count */
    update: (id, payload) => invoke('employees:update', id, payload),
    /** @returns {Promise<{success:boolean, data: number}>} changes count */
    deactivate: (id) => invoke('employees:deactivate', id),
  },

  // ── Leave Types ────────────────────────────────────────────
  leaveTypes: {
    /** @returns {Promise<{success:boolean, data: LeaveType[]}>} */
    getAll: () => invoke('leaveTypes:getAll'),
  },

  // ── Leave Balances ─────────────────────────────────────────
  leaveBalances: {
    /** @returns {Promise<{success:boolean, data: LeaveBalance[]}>} */
    getByEmployee: (employeeId) => invoke('leaveBalances:getByEmployee', employeeId),
    /** @returns {Promise<{success:boolean, data: {changes: number}}>} */
    upsert: (payload) => invoke('leaveBalances:upsert', payload),
  },

  // ── Leaves ─────────────────────────────────────────────────
  leaves: {
    /** @returns {Promise<{success:boolean, data: Leave[]}>} */
    getAll: () => invoke('leaves:getAll'),
    /** @returns {Promise<{success:boolean, data: Leave[]}>} */
    getByEmployee: (empId) => invoke('leaves:getByEmployee', empId),
    /** @returns {Promise<{success:boolean, data: {id: number}}>} */
    create: (payload) => invoke('leaves:create', payload),
    /** @returns {Promise<{success:boolean, data: number}>} changes count */
    delete: (leaveId) => invoke('leaves:delete', leaveId),
  },

  // ── Leave Engine (Phase 3) ────────────────────────────────
  leave: {
    /**
     * Returns the employee's current available regular-leave balance
     * plus diagnostic data.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data: {finalBalance:number, grossEarnedBalance:number, regularLeavesTaken:number, netServiceDays:number, unpaidDays:number, totalDays:number, hireDate:string}}>}
     */
    getRegularBalance: (employeeId) =>
      invoke('leave:getRegularBalance', employeeId),

    /**
     * Submits a sick-leave request, deducting from 100%/50% pay buckets.
     * @param {{ employeeId:number, requestedDays:number, startDate:string, endDate:string }} payload
     * @returns {Promise<{success:boolean, data: {leaveId:number, daysAt100:number, daysAt50:number, newBalance100:number, newBalance50:number}}>}
     */
    submitSickLeave: (payload) =>
      invoke('leave:submitSickLeave', payload),

    /**
     * Submits a regular-leave request after verifying sufficient balance.
     * @param {{ employeeId:number, requestedDays:number, startDate:string, endDate:string, orderRef?:string, notes?:string }} payload
     * @returns {Promise<{success:boolean, data: {leaveId:number, finalBalance:number, requestedDays:number, remainingBalance:number}}>}
     */
    submitRegularLeave: (payload) =>
      invoke('leave:submitRegularLeave', payload),

    /**
     * Returns all employees currently on leave today.
     * @returns {Promise<{success:boolean, data: {FullName:string, LeaveName:string, EndDate:string}[]}>}
     */
    getActiveToday: () =>
      invoke('leave:getActiveToday'),

    /**
     * Returns paginated active leaves today.
     * @param {{ page?:number, pageSize?:number, search?:string }} options
     * @returns {Promise<{success:boolean, data: {data:Array<any>, totalCount:number, page:number, pageSize:number, totalPages:number}}>}
     */
    getActiveTodayPaginated: (options) =>
      invoke('leave:getActiveTodayPaginated', options),

    /**
     * Fetches historical leave records for a given employee.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data: Leave[]}>}
     */
    getHistory: (employeeId) =>
      invoke('leave:getHistory', employeeId),

    /**
     * Deletes a leave record and restores balance if applicable.
     * @param {number} leaveId
     * @returns {Promise<{success:boolean, data: {deletedLeaveId:number}}>}
     */
    delete: (leaveId) =>
      invoke('leave:delete', leaveId),

    /**
     * Updates an existing leave record with full validation and audit logging.
     * @param {object} payload
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    update: (payload) =>
      invoke('leave:update', payload),

    /**
     * Exports all active leaves today to Excel.
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportActiveLeavesToExcel: () =>
      invoke('report:exportActiveLeaves'),
  },

  // ── Employee Onboarding (Phase 6) ──────────────────────────
  employee: {
    /**
     * Creates a new active employee record after server-side validation.
     * @param {{ employeeId:number, fullName:string, gender:'Male'|'Female', hireDate:string, jobTitle:string, workLocation?:string, leaveCardNumber?:string, leaveApprover?:string }} data
     * @returns {Promise<{success:boolean, data: number}>}  data = new EmployeeID
     */
    add: (data) => invoke('employee:add', data),
    /**
     * Searches active employees by partial match (name, leave card number, or ID).
     * @param {string} keyword
     * @returns {Promise<{success:boolean, data: {EmployeeID:number, FullName:string, JobTitle:string, WorkLocation:string|null, LeaveCardNumber:string|null, LeaveApprover:string|null}[]}>}
     */
    search: (keyword) => invoke('employee:search', { keyword }),
    /**
     * Fetches single employee record by ID.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data: Employee}>}
     */
    getById: (employeeId) => invoke('employee:getById', { employeeId }),
    /**
     * Updates FullName, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, and AdjustmentDays for an existing employee.
     * @param {number} employeeId
     * @param {{ fullName:string, jobTitle:string, workLocation?:string, leaveCardNumber?:string, leaveApprover?:string, adjustmentDays?:number }} payload
     * @returns {Promise<{success:boolean, data: {success:boolean, changes:number}}>}
     */
    update: (employeeId, payload) => invoke('employee:update', { employeeId, ...payload }),
    /**
     * Soft-deletes employee by setting IsActive = 0.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data: {success:boolean, changes:number}}>}
     */
    deactivate: (employeeId) => invoke('employee:deactivate', { employeeId }),
    /**
     * Reactivates employee by setting IsActive = 1.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data: {success:boolean, changes:number}}>}
     */
    activate: (employeeId) => invoke('employee:activate', { employeeId }),
    /**
     * Records external transfer for an employee.
     * Accepts either (employeeId, transferData) or a single payload object.
     * @param {number|object} employeeIdOrPayload
     * @param {{ transferOrderNumber?: string, transferOrderDate?: string, transferNotes?: string }} [transferData]
     * @returns {Promise<{success:boolean, data: {success:boolean, changes:number}}>}
     */
    transfer: (employeeIdOrPayload, transferData) => {
      if (typeof employeeIdOrPayload === 'object' && employeeIdOrPayload !== null) {
        return invoke('employee:transfer', employeeIdOrPayload);
      }
      return invoke('employee:transfer', { employeeId: employeeIdOrPayload, ...(transferData || {}) });
    },
    /**
     * Cancels external transfer for an employee.
     * Accepts either employeeId directly or { employeeId }.
     * @param {number|object} employeeIdOrPayload
     * @returns {Promise<{success:boolean, data: {success:boolean, changes:number}}>}
     */
    cancelTransfer: (employeeIdOrPayload) => {
      if (typeof employeeIdOrPayload === 'object' && employeeIdOrPayload !== null) {
        return invoke('employee:cancelTransfer', employeeIdOrPayload);
      }
      return invoke('employee:cancelTransfer', { employeeId: employeeIdOrPayload });
    },
    /**
     * Server-side paginated employee lookup with search and latest leave.
     * @param {{ page?:number, pageSize?:number, search?:string }} options
     * @returns {Promise<{success:boolean, data: {data:Array<any>, totalCount:number, page:number, pageSize:number, totalPages:number}}>}
     */
    getPaginated: (options) => invoke('employee:getPaginated', options),
    /**
     * Exports all matching employees with their leave metadata to Excel.
     * @param {{ search?:string }} options
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportAll: (options) => invoke('employee:exportAll', options),
  },

  // ── Reporting Engine (Phase 7) ───────────────────────────
  report: {
    /**
     * Opens a native Save dialog, then writes a styled .xlsx
     * report of the given employee's full leave history.
     * @param {number} employeeId
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportHistory: (employeeId) => invoke('report:exportHistory', { employeeId }),

    /**
     * Opens a native Save dialog, then writes a styled .xlsx
     * report of all employees currently on leave today.
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportActiveLeaves: () => invoke('report:exportActiveLeaves'),

    /**
     * Fetches critical balance alerts and year-to-date accumulated leaves summary.
     * @param {{ threshold?: number, year?: number }} options
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    getCriticalReport: (options) => invoke('report:getCriticalReport', options),

    /**
     * Exports critical balance alerts and accumulated leaves to Excel.
     * @param {{ threshold?: number, year?: number }} options
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportCriticalReport: (options) => invoke('report:exportCriticalReport', options),

    /**
     * Fetches paginated critical balance alerts.
     * @param {{ threshold?: number, page?: number, pageSize?: number, search?: string }} options
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    getCriticalBalancesPaginated: (options) => invoke('report:getCriticalBalancesPaginated', options),

    /**
     * Fetches paginated accumulated leaves.
     * @param {{ year?: number, page?: number, pageSize?: number, search?: string }} options
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    getAccumulatedPaginated: (options) => invoke('report:getAccumulatedPaginated', options),

    /**
     * Opens a native Save dialog and exports an official Excel
     * report of all externally transferred employees.
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    exportTransferredEmployees: () => invoke('report:exportTransferredEmployees'),
  },

  // ── System Administration (Phase 11) ──────────────────────
  system: {
    /**
     * Triggers a native Save dialog and creates a live DB backup.
     * @returns {Promise<{success:boolean, data?: {filePath?:string, canceled?:boolean}, error?:string}>}
     */
    backup: () => invoke('system:backup'),

    /**
     * Triggers a native Open dialog, validates the backup, creates a safety backup,
     * restores the database, and relaunches the application.
     * @returns {Promise<{success:boolean, data?: {safetyBackupPath?:string, canceled?:boolean}, error?:string}>}
     */
    restore: () => invoke('system:restore'),

    /**
     * Gets a configuration value from _AppSettings by key.
     * @param {string} key
     * @returns {Promise<{success:boolean, data?: string|null, error?:string}>}
     */
    getSetting: (key) => invoke('system:getSetting', key),

    /**
     * Sets or updates a configuration key-value in _AppSettings.
     * @param {string} key
     * @param {string} value
     * @returns {Promise<{success:boolean, data?: any, error?:string}>}
     */
    setSetting: (key, value) => invoke('system:setSetting', { key, value }),

    /**
     * Prompts the user with a native Open dialog to select a directory.
     * @param {string} [defaultPath]
     * @returns {Promise<{success:boolean, data?: {canceled:boolean, selectedPath?:string}, error?:string}>}
     */
    selectDirectory: (defaultPath) => invoke('system:selectDirectory', defaultPath),

    /**
     * Opens a file on the host OS with default application.
     * @param {string} filePath
     * @returns {Promise<{success:boolean, data?: any, error?:string}>}
     */
    openPath: (filePath) => invoke('system:openPath', filePath),
  },

  // ── Audit Logs ─────────────────────────────────────────────
  audit: {
    /** @returns {Promise<{success:boolean, data: AuditEntry[]}>} */
    getAll: () => invoke('audit:getAll'),
    /**
     * Queries paginated and filtered audit trail records.
     * @param {object} options - { startDate, endDate, actionType, entityType, search, page, pageSize }
     * @returns {Promise<{success:boolean, data?: {data: Array, totalCount: number, page: number, pageSize: number, totalPages: number}, error?:string}>}
     */
    getLogs: (options) => invoke('audit:getLogs', options),
  },

  // ── Employee Documents ─────────────────────────────────────
  documents: {
    /**
     * Adds a new document version for an employee (never overwrites).
     * @param {{ employeeId: number, documentType: string, sourceFilePath: string, notes?: string }} payload
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    add: (payload) => invoke('document:add', payload),

    /**
     * Lists all non-deleted document versions for an employee.
     * @param {{ employeeId: number, documentType?: string } | number} payload
     * @returns {Promise<{success:boolean, data?: Array<any>, error?: string}>}
     */
    list: (payload) => invoke('document:list', payload),

    /**
     * Soft deletes a specific document version.
     * @param {number} documentId
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    delete: (documentId) => invoke('document:delete', documentId),

    /**
     * Opens the stored document in the default OS application.
     * @param {number} documentId
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    openExternal: (documentId) => invoke('document:openExternal', documentId),

    /**
     * Opens native file picker dialog for choosing a card/document.
     * @param {{ title?: string }} [options]
     * @returns {Promise<{success:boolean, data?: {canceled:boolean, filePath?:string}, error?: string}>}
     */
    pickFile: (options) => invoke('document:pickFile', options),

    /**
     * Gets the current document storage root path.
     * @returns {Promise<{success:boolean, data?: string, error?: string}>}
     */
    getStoragePath: () => invoke('document:getStoragePath'),

    /**
     * Updates the custom storage path for employee documents.
     * @param {string} newPath
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    setStoragePath: (newPath) => invoke('document:setStoragePath', newPath),

    /**
     * Tests write/read capability of a storage folder path.
     * @param {string} targetPath
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    testStoragePath: (targetPath) => invoke('document:testStoragePath', targetPath),

    /**
     * Opens the storage root folder in file explorer.
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    openStorageFolder: () => invoke('document:openStorageFolder'),

    /**
     * Directly prints a stored document (card/PDF) to A4 paper.
     * @param {number} documentId
     * @returns {Promise<{success:boolean, data?: any, error?: string}>}
     */
    print: (documentId) => invoke('document:print', documentId),

    /**
     * Gets count and size statistics of soft-deleted documents.
     * @returns {Promise<{success:boolean, data?: {count:number, totalBytes:number, formattedSize:string}, error?: string}>}
     */
    getDeletedStats: () => invoke('document:getDeletedStats'),

    /**
     * Permanently purges soft-deleted documents from disk and database.
     * @returns {Promise<{success:boolean, data?: {purgedCount:number, purgedBytes:number, formattedSize:string}, error?: string}>}
     */
    purgeDeleted: () => invoke('document:purgeDeleted'),
  },

  // ── Automated Notifications ──────────────────────────────
  notifications: {
    /**
     * Subscribes to 11:00 AM resumption alert events pushed from Main Process.
     * @param {Function} callback - ({ date: string, count: number, employees: Array }) => void
     */
    onResumptionAlert: (callback) => {
      ipcRenderer.on('notification:resumption-alert', (_event, data) => callback(data));
    },
    /**
     * Subscribes to open-dashboard event (e.g. from clicking native notification).
     * @param {Function} callback - () => void
     */
    onOpenDashboard: (callback) => {
      ipcRenderer.on('notification:open-dashboard', () => callback());
    },
  },

});
