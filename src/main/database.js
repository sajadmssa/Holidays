// ============================================================
//  database.js  –  Database Service (Main Process ONLY)
//  Responsibilities:
//    • Open better-sqlite3 with WAL mode + foreign keys
//    • Run migrations on startup (idempotent)
//    • Expose typed repository methods consumed by IPC handlers
//    • Provide a clean `close()` for graceful shutdown
//
//  This file MUST NEVER be imported by the renderer or preload.
// ============================================================

'use strict';

const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// ──────────────────────────────────────────────────────────────
//  Database File Location
//  Stored in the OS user-data directory so it survives app updates.
//  On Windows: %APPDATA%\leave-management-system\leave_management.db
// ──────────────────────────────────────────────────────────────
const DB_DIR = process.env.HOLIDAYS_DB_DIR
  ? process.env.HOLIDAYS_DB_DIR
  : ((app && typeof app.getPath === 'function')
      ? app.getPath('userData')
      : path.join(process.env.APPDATA || '.', 'leave-management-system'));
const DB_PATH = path.join(DB_DIR, 'leave_management.db');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/** @type {import('better-sqlite3').Database | null} */
let _db = null;

// ──────────────────────────────────────────────────────────────
//  Internal Accessor  (throws if called before initialize())
// ──────────────────────────────────────────────────────────────
function getDb() {
  if (!_db) throw new Error('Database has not been initialized. Call db.initialize() first.');
  return _db;
}

// ──────────────────────────────────────────────────────────────
//  initialize()
//  Opens (or creates) the SQLite file, applies PRAGMAs, and
//  runs all migration files in lexical order.
// ──────────────────────────────────────────────────────────────
function initialize() {
  if (_db) return; // Already initialized

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  console.log(`[DB] Opening database at: ${DB_PATH}`);
  _db = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'development' ? console.log : undefined });

  // ── Critical PRAGMAs ────────────────────────────────────────
  _db.pragma('journal_mode = WAL');    // Write-Ahead Logging for concurrency + speed
  _db.pragma('foreign_keys = ON');     // Enforce referential integrity
  _db.pragma('synchronous = NORMAL');  // Safe + fast with WAL
  _db.pragma('cache_size = -16000');   // 16 MB page cache
  _db.pragma('temp_store = MEMORY');   // Keep temp tables in RAM

  // ── Run Migrations ─────────────────────────────────────────
  runMigrations();

  console.log('[DB] Database ready.');
}

// ──────────────────────────────────────────────────────────────
//  runMigrations()
//  Reads every .sql file from the migrations directory in order
//  and executes it. Uses `CREATE TABLE IF NOT EXISTS` and
//  `INSERT OR IGNORE` so re-runs are safe (idempotent).
// ──────────────────────────────────────────────────────────────
function runMigrations() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS _Migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      executedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const executed = new Set(
    _db.prepare('SELECT name FROM _Migrations').all().map(r => r.name)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // lexical sort ensures 001_ runs before 002_ etc.

  for (const file of files) {
    if (!executed.has(file)) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[DB] Applying migration: ${file}`);
      _db.transaction(() => {
        try {
          _db.exec(sql);
        } catch (err) {
          if (err.message.includes('duplicate column name')) {
            console.log(`[DB Migration Notice] Column already exists in ${file}: ${err.message}`);
          } else {
            throw err;
          }
        }
        _db.prepare('INSERT INTO _Migrations (name) VALUES (?)').run(file);
      })();
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  close()
//  Call on app exit to flush WAL and release the file lock.
// ──────────────────────────────────────────────────────────────
function close() {
  if (_db) {
    try {
      // Execute PRAGMA optimize to update query statistics and keep DB compact
      _db.pragma('optimize');
    } catch (optErr) {
      console.warn('[DB Close Warning] PRAGMA optimize failed:', optErr.message);
    }
    _db.close();
    _db = null;
    console.log('[DB] Database closed.');
  }
}

// ══════════════════════════════════════════════════════════════
//  ── REPOSITORY METHODS ──────────────────────────────────────
//  All methods are synchronous (better-sqlite3 is sync-only).
//  Each method is a pure data-access function with no business logic.
// ══════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
//  Employees
// ──────────────────────────────────────────────────────────────

/**
 * @returns {Employee[]}
 */
function getAllEmployees() {
  return getDb()
    .prepare('SELECT * FROM Employees ORDER BY FullName ASC')
    .all();
}

/**
 * @param {number} id
 * @returns {Employee | undefined}
 */
function getEmployeeById(id) {
  return getDb()
    .prepare('SELECT * FROM Employees WHERE EmployeeID = ?')
    .get(id);
}

/**
 * @param {{ fullName:string, gender:'Male'|'Female', hireDate:string, jobTitle:string, workLocation?:string, leaveCardNumber?:string, leaveApprover?:string }} payload
 * @returns {{ id: number }}
 */
function createEmployee({ fullName, gender, hireDate, jobTitle, workLocation, leaveCardNumber, leaveApprover }) {
  const result = getDb()
    .prepare(`
      INSERT INTO Employees (FullName, Gender, HireDate, JobTitle, WorkLocation, LeaveCardNumber, LeaveApprover, IsActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `)
    .run(
      fullName,
      gender,
      hireDate,
      jobTitle,
      workLocation ?? null,
      leaveCardNumber ?? null,
      leaveApprover ?? null
    );

  // Audit
  _auditLog('CREATE_EMPLOYEE', { employeeId: result.lastInsertRowid, fullName, gender, jobTitle, workLocation, leaveCardNumber, leaveApprover });

  return { id: result.lastInsertRowid };
}

/**
 * @param {number} id
 * @param {{ fullName?:string, gender?:string, hireDate?:string, jobTitle?:string, workLocation?:string, leaveCardNumber?:string, leaveApprover?:string }} payload
 * @returns {number} number of rows changed
 */
function updateEmployee(id, { fullName, gender, hireDate, jobTitle, workLocation, leaveCardNumber, leaveApprover }) {
  const result = getDb()
    .prepare(`
      UPDATE Employees
      SET FullName        = COALESCE(?, FullName),
          Gender          = COALESCE(?, Gender),
          HireDate        = COALESCE(?, HireDate),
          JobTitle        = COALESCE(?, JobTitle),
          WorkLocation    = COALESCE(?, WorkLocation),
          LeaveCardNumber = COALESCE(?, LeaveCardNumber),
          LeaveApprover   = COALESCE(?, LeaveApprover)
      WHERE EmployeeID = ?
    `)
    .run(
      fullName ?? null,
      gender ?? null,
      hireDate ?? null,
      jobTitle ?? null,
      workLocation ?? null,
      leaveCardNumber ?? null,
      leaveApprover ?? null,
      id
    );

  _auditLog('UPDATE_EMPLOYEE', { employeeId: id });
  return result.changes;
}

/**
 * Soft-delete: sets IsActive = 0.
 * @param {number} id
 * @returns {number} number of rows changed
 */
function deactivateEmployee(id) {
  const result = getDb()
    .prepare('UPDATE Employees SET IsActive = 0 WHERE EmployeeID = ?')
    .run(id);

  _auditLog('DEACTIVATE_EMPLOYEE', { employeeId: id });
  return result.changes;
}

// ──────────────────────────────────────────────────────────────
//  Leave Types
// ──────────────────────────────────────────────────────────────

/**
 * @returns {LeaveType[]}
 */
function getAllLeaveTypes() {
  return getDb()
    .prepare('SELECT * FROM LeaveTypes ORDER BY Name ASC')
    .all();
}

// ──────────────────────────────────────────────────────────────
//  Leave Balances
// ──────────────────────────────────────────────────────────────

/**
 * @param {number} employeeId
 * @returns {LeaveBalance[]}
 */
function getLeaveBalancesByEmployee(employeeId) {
  return getDb()
    .prepare(`
      SELECT lb.*, lt.Name AS LeaveTypeName, lt.GenderRestriction
      FROM   LeaveBalances lb
      JOIN   LeaveTypes    lt ON lt.LeaveTypeID = lb.LeaveTypeID
      WHERE  lb.EmployeeID = ?
      ORDER  BY lt.Name ASC
    `)
    .all(employeeId);
}

/**
 * INSERT or REPLACE a balance entry.
 * @param {{ employeeId:number, leaveTypeId:number, totalBalance:number, payPercentage:100|50 }} payload
 */
function upsertLeaveBalance({ employeeId, leaveTypeId, totalBalance, payPercentage }) {
  const result = getDb()
    .prepare(`
      INSERT INTO LeaveBalances (EmployeeID, LeaveTypeID, TotalBalance, PayPercentage)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(EmployeeID, LeaveTypeID, PayPercentage) DO UPDATE SET
        TotalBalance  = excluded.TotalBalance,
        PayPercentage = excluded.PayPercentage
    `)
    .run(employeeId, leaveTypeId, totalBalance, payPercentage);

  return { changes: result.changes };
}

// ──────────────────────────────────────────────────────────────
//  Leaves
// ──────────────────────────────────────────────────────────────

/**
 * @returns {Leave[]}  All leaves, joined with employee & type names
 */
function getAllLeaves() {
  return getDb()
    .prepare(`
      SELECT
        l.*,
        e.FullName       AS EmployeeName,
        e.Gender         AS EmployeeGender,
        lt.Name          AS LeaveTypeName
      FROM   Leaves     l
      JOIN   Employees  e  ON e.EmployeeID  = l.EmployeeID
      JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      ORDER  BY l.StartDate DESC
    `)
    .all();
}

/**
 * @param {number} employeeId
 * @returns {Leave[]}
 */
function getLeavesByEmployee(employeeId) {
  return getDb()
    .prepare(`
      SELECT
        l.*,
        lt.Name AS LeaveTypeName
      FROM   Leaves     l
      JOIN   LeaveTypes lt ON lt.LeaveTypeID = l.LeaveTypeID
      WHERE  l.EmployeeID = ?
      ORDER  BY l.StartDate DESC
    `)
    .all(employeeId);
}

/**
 * Creates a new leave record.
 * NOTE: Gender enforcement and order-ref enforcement are handled
 *       by DB-level TRIGGERS — they will throw on violation.
 *       The audit trigger also fires automatically.
 *
 * @param {{ employeeId:number, leaveTypeId:number, startDate:string, endDate:string, daysCount:number, orderRef?:string, notes?:string, leaveApprover?:string }} payload
 * @returns {{ id: number }}
 */
function createLeave({ employeeId, leaveTypeId, startDate, endDate, daysCount, orderRef, notes, leaveApprover }) {
  const result = getDb()
    .prepare(`
      INSERT INTO Leaves (EmployeeID, LeaveTypeID, StartDate, EndDate, DaysCount, OrderRef, Notes, LeaveApprover)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      employeeId, leaveTypeId,
      startDate, endDate, daysCount,
      orderRef ?? null, notes ?? null,
      leaveApprover ?? null
    );
  // NOTE: trg_audit_leave_insert fires automatically here.
  return { id: result.lastInsertRowid };
}

/**
 * Deletes a leave record.
 * NOTE: trg_audit_leave_delete fires automatically.
 * @param {number} leaveId
 * @returns {number} number of rows deleted
 */
function deleteLeave(leaveId) {
  const result = getDb()
    .prepare('DELETE FROM Leaves WHERE LeaveID = ?')
    .run(leaveId);
  return result.changes;
}

// ──────────────────────────────────────────────────────────────
//  Audit Log
// ──────────────────────────────────────────────────────────────

/**
 * @returns {AuditEntry[]}
 */
function getAuditLog() {
  return getDb()
    .prepare('SELECT * FROM AuditLogs ORDER BY Timestamp DESC')
    .all();
}

/**
 * Internal helper to write audit entries from JS-side operations.
 * @param {string} actionType
 * @param {object} details
 */
function _auditLog(actionType, details) {
  try {
    const AuditService = require('./services/AuditService');
    AuditService.logAction(getDb(), {
      actionType: actionType.includes('CREATE') ? 'INSERT' : (actionType.includes('DEACTIVATE') ? 'STATUS_CHANGE' : 'UPDATE'),
      entityType: 'Employee',
      entityID: details?.employeeId || null,
      details: typeof details === 'string' ? details : JSON.stringify(details)
    });
  } catch (err) {
    console.warn('[DB Audit Error]', err.message);
  }
}

/**
 * Safely creates a live backup of the SQLite database and EmployeeDocuments.
 * If destinationPath is .hbak or .zip (or default), bundles DB + EmployeeDocuments + manifest.json.
 * If destinationPath is .db, creates native direct SQLite backup.
 *
 * @param {string} destinationPath
 * @returns {Promise<{ filePath: string, isBundle: boolean }>}
 */
async function backupDatabase(destinationPath) {
  if (!destinationPath || typeof destinationPath !== 'string') {
    throw new Error('backupDatabase: destinationPath must be a non-empty string.');
  }

  const destExt = path.extname(destinationPath).toLowerCase();
  const isBundle = destExt === '.hbak' || destExt === '.zip' || destExt !== '.db';

  if (!isBundle) {
    await getDb().backup(destinationPath);
    return { filePath: destinationPath, isBundle: false };
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(destinationPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // 1. Create temporary SQLite snapshot
  const tempDbName = `temp_snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`;
  const tempDbPath = path.join(DB_DIR, tempDbName);

  try {
    await getDb().backup(tempDbPath);

    // 2. Build ZIP archive
    const zip = new AdmZip();

    // Add SQLite DB snapshot as leave_management.db
    zip.addLocalFile(tempDbPath, '', 'leave_management.db');

    // Add EmployeeDocuments directory if present
    let docStoragePath = null;
    try {
      const DocumentStorageService = require('./services/DocumentStorageService');
      docStoragePath = DocumentStorageService.getStorageRoot(_db);
    } catch (_) {
      docStoragePath = path.join(DB_DIR, 'EmployeeDocuments');
    }

    let documentsCount = 0;
    if (docStoragePath && fs.existsSync(docStoragePath)) {
      const files = fs.readdirSync(docStoragePath);
      if (files.length > 0) {
        zip.addLocalFolder(docStoragePath, 'EmployeeDocuments');
      }
    }

    try {
      const docRow = _db.prepare("SELECT COUNT(*) as cnt FROM EmployeeDocuments WHERE IsDeleted = 0").get();
      documentsCount = docRow ? Number(docRow.cnt) : 0;
    } catch (_) {}

    const employeesCount = _db.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
    const leavesCount = _db.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;

    // 3. Add manifest.json metadata
    const manifest = {
      app: 'Holidays - Leave Management System',
      version: '4.0.0',
      schemaVersion: 14,
      createdAt: new Date().toISOString(),
      employeesCount,
      leavesCount,
      documentsCount,
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));

    // 4. Write zip bundle to destination
    zip.writeZip(destinationPath);

    return { filePath: destinationPath, isBundle: true };
  } finally {
    if (fs.existsSync(tempDbPath)) {
      try { fs.unlinkSync(tempDbPath); } catch (_) {}
    }
  }
}

/**
 * Validates a potential backup file before restoring.
 * Handles both ZIP/HBAK bundle files and legacy .db SQLite files.
 * @param {string} backupPath
 * @param {import('better-sqlite3').Database} [activeDbInstance]
 * @returns {{ valid: boolean, isBundle: boolean, employeesCount: number, leavesCount: number, documentsCount?: number, warning: string | null }}
 */
function validateDatabaseBackup(backupPath, activeDbInstance = _db) {
  if (!backupPath || typeof backupPath !== 'string' || !fs.existsSync(backupPath)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود أو المسار غير صالح.');
  }

  const stats = fs.statSync(backupPath);
  if (stats.size < 64) {
    throw new Error('حجم الملف صغير جداً ولا يمثل نسخة احتياطية صحيحة.');
  }

  // Check if file is a ZIP/HBAK (PK\x03\x04 = 0x50, 0x4B, 0x03, 0x04)
  const fd = fs.openSync(backupPath, 'r');
  const headerBuf = Buffer.alloc(16);
  fs.readSync(fd, headerBuf, 0, 16, 0);
  fs.closeSync(fd);

  const isZip = headerBuf[0] === 0x50 && headerBuf[1] === 0x4B && headerBuf[2] === 0x03 && headerBuf[3] === 0x04;

  if (isZip) {
    // ── Bundle Validation (.hbak / .zip) ────────────────────────
    let zip = null;
    try {
      zip = new AdmZip(backupPath);
    } catch (zipErr) {
      throw new Error(`تعذر قراءة حزمة الأرشيف المضغوطة: ${zipErr.message}`);
    }

    const entries = zip.getEntries();
    const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));

    if (!dbEntry) {
      throw new Error('حزمة النسخة الاحتياطية غير صالحة؛ ملف قاعدة البيانات (.db) غير موجود بداخلها.');
    }

    // Extract DB to temp location for validation
    const tempValidateDbPath = path.join(DB_DIR, `temp_val_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);

    let tempDb = null;
    try {
      const dbBuffer = zip.readFile(dbEntry);
      if (!dbBuffer || dbBuffer.length < 512) {
        throw new Error('ملف قاعدة البيانات داخل الحزمة تالف أو فارغ.');
      }
      fs.writeFileSync(tempValidateDbPath, dbBuffer);

      // Verify SQLite header magic bytes on extracted DB
      const dbHeader = dbBuffer.toString('utf8', 0, 15);
      if (dbHeader !== 'SQLite format 3') {
        throw new Error('الملف الداخلي ليس قاعدة بيانات SQLite صالحة.');
      }

      tempDb = new Database(tempValidateDbPath, { readonly: true, fileMustExist: true });
      const check = tempDb.prepare('PRAGMA integrity_check').get();
      if (!check || check.integrity_check !== 'ok') {
        throw new Error('فحص السلامة الهيكلية لقاعدة البيانات داخل الحزمة أظهر تلفاً (Integrity Check Failed).');
      }

      const requiredTables = ['Employees', 'Leaves', 'LeaveTypes', '_Migrations'];
      const existingTables = new Set(
        tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
      );

      for (const table of requiredTables) {
        if (!existingTables.has(table)) {
          throw new Error(`قاعدة البيانات داخل الحزمة غير متوافقة؛ الجدول الأساسي (${table}) غير موجود.`);
        }
      }

      const employeesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
      const leavesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;
      let documentsCount = 0;
      if (existingTables.has('EmployeeDocuments')) {
        documentsCount = tempDb.prepare('SELECT COUNT(*) as c FROM EmployeeDocuments WHERE IsDeleted = 0').get()?.c ?? 0;
      }

      // Comparison check against active DB
      let warning = null;
      const currentActiveDb = activeDbInstance || _db;
      if (currentActiveDb) {
        try {
          const activeTables = new Set(
            currentActiveDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
          );

          if (activeTables.has('EmployeeDocuments')) {
            const activeDocInfo = currentActiveDb.prepare(
              'SELECT COUNT(*) as cnt, MAX(CreatedAt) as latestCreated FROM EmployeeDocuments WHERE IsDeleted = 0'
            ).get();

            if (activeDocInfo && activeDocInfo.cnt > 0) {
              if (existingTables.has('EmployeeDocuments')) {
                const backupDocInfo = tempDb.prepare(
                  'SELECT COUNT(*) as cnt, MAX(CreatedAt) as latestCreated FROM EmployeeDocuments WHERE IsDeleted = 0'
                ).get();

                const backupLatest = backupDocInfo?.latestCreated || '';
                const activeLatest = activeDocInfo.latestCreated || '';

                if (!backupLatest || activeLatest > backupLatest || activeDocInfo.cnt > (backupDocInfo?.cnt || 0)) {
                  warning = 'تحذير: قد تحتوي قاعدة البيانات الحالية على مستندات (كروت) أُضيفت بعد تاريخ هذه النسخة، وسيتم استبدال البيانات بالكامل.';
                }
              }
            }
          }
        } catch (checkErr) {
          console.warn('[DB Restore Warning Check Error]', checkErr.message);
        }
      }

      return { valid: true, isBundle: true, employeesCount, leavesCount, documentsCount, warning };
    } finally {
      if (tempDb) {
        try { tempDb.close(); } catch (_) {}
      }
      if (fs.existsSync(tempValidateDbPath)) {
        try { fs.unlinkSync(tempValidateDbPath); } catch (_) {}
      }
    }
  }

  // ── Legacy .db SQLite file validation ────────────────────────
  const headerStr = headerBuf.toString('utf8', 0, 15);
  if (headerStr !== 'SQLite format 3') {
    throw new Error('الملف المختار ليس ملف قاعدة بيانات SQLite أو حزمة HBAK صالحة.');
  }

  let tempDb = null;
  try {
    tempDb = new Database(backupPath, { readonly: true, fileMustExist: true });

    const check = tempDb.prepare('PRAGMA integrity_check').get();
    if (!check || check.integrity_check !== 'ok') {
      throw new Error('فحص السلامة الهيكلية أظهر تلفاً في ملف قاعدة البيانات (Integrity Check Failed).');
    }

    const requiredTables = ['Employees', 'Leaves', 'LeaveTypes', '_Migrations'];
    const existingTables = new Set(
      tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
    );

    for (const table of requiredTables) {
      if (!existingTables.has(table)) {
        throw new Error(`قاعدة البيانات المختارة غير متوافقة؛ الجدول الأساسي (${table}) غير موجود.`);
      }
    }

    const employeesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Employees').get()?.c ?? 0;
    const leavesCount = tempDb.prepare('SELECT COUNT(*) as c FROM Leaves').get()?.c ?? 0;

    let warning = 'ملاحظة: هذه نسخة قديمة بصيغة قاعدة بيانات فقط (.db) ولا تتضمن أرشيف المستندات المجمعة.';

    return { valid: true, isBundle: false, employeesCount, leavesCount, documentsCount: 0, warning };
  } finally {
    if (tempDb) {
      try { tempDb.close(); } catch (_) {}
    }
  }
}

/**
 * Creates an automatic pre-restore safety backup bundle of active DB and documents.
 * @returns {Promise<string>} Path of the safety backup file
 */
async function createSafetyBackup() {
  const backupsDir = path.join(DB_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safetyBackupPath = path.join(backupsDir, `pre_restore_safety_backup_${timestamp}.hbak`);

  await backupDatabase(safetyBackupPath);
  return safetyBackupPath;
}

/**
 * Restores active database and documents from a validated backup file (.hbak / .zip or .db).
 * Automatically takes a safety backup first, closes connection, and restores files.
 * Handles custom storage paths intelligently and rolls back if interrupted.
 *
 * @param {string} backupPath
 * @returns {Promise<{ success: boolean, safetyBackupPath: string, pathMigrated?: boolean, pathMessage?: string|null, targetDocPath?: string }>}
 */
async function restoreDatabase(backupPath) {
  // Ensure database is initialized before safety backup
  if (!_db && fs.existsSync(DB_PATH)) {
    initialize();
  }

  // 1. Strict Validation
  const validation = validateDatabaseBackup(backupPath);

  // 2. Pre-restore Safety Backup
  const safetyBackupPath = await createSafetyBackup();

  // 3. Checkpoint WAL and close connection
  if (_db) {
    try { _db.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}
  }
  close();

  // 4. Remove WAL/SHM auxiliary files if present
  const walPath = `${DB_PATH}-wal`;
  const shmPath = `${DB_PATH}-shm`;
  if (fs.existsSync(walPath)) try { fs.unlinkSync(walPath); } catch (_) {}
  if (fs.existsSync(shmPath)) try { fs.unlinkSync(shmPath); } catch (_) {}

  // 5. Restore Database & Documents (with automatic rollback on error)
  let pathMigrated = false;
  let pathMessage = null;
  let activeTargetDocPath = null;

  try {
    if (validation.isBundle) {
      const zip = new AdmZip(backupPath);
      const entries = zip.getEntries();

      // Extract leave_management.db
      const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));
      if (!dbEntry) {
        throw new Error('تعذر استخراج ملف قاعدة البيانات من الحزمة.');
      }
      const dbData = zip.readFile(dbEntry);
      fs.writeFileSync(DB_PATH, dbData);

      // Determine the target storage directory from the restored DB itself
      const DocumentStorageService = require('./services/DocumentStorageService');
      const defaultDocPath = DocumentStorageService.getDefaultStorageRoot();
      let customStoragePath = null;
      let tempRestoredDb = null;

      try {
        tempRestoredDb = new Database(DB_PATH);
        const settingRow = tempRestoredDb.prepare("SELECT Value FROM _AppSettings WHERE Key = 'employee_documents_storage_path'").get();
        if (settingRow && settingRow.Value && typeof settingRow.Value === 'string' && settingRow.Value.trim().length > 0) {
          customStoragePath = path.resolve(settingRow.Value.trim());
        }

        if (customStoragePath) {
          try {
            DocumentStorageService.testStoragePath(customStoragePath);
            activeTargetDocPath = customStoragePath;
          } catch (pathTestErr) {
            // Path unavailable on current machine -> fallback to default and update setting in restored DB
            activeTargetDocPath = defaultDocPath;
            pathMigrated = true;
            pathMessage = `تم تعديل مسار تخزين المستندات تلقائياً إلى المسار الافتراضي (${defaultDocPath}) لتعذر الوصول إلى المسار السابق (${customStoragePath}).`;
            console.warn(`[DB Restore Notice] Custom path unavailable: ${customStoragePath}. Migrated to: ${defaultDocPath}`);

            tempRestoredDb.prepare(`
              INSERT INTO _AppSettings (Key, Value, UpdatedAt)
              VALUES ('employee_documents_storage_path', '', datetime('now', 'localtime'))
              ON CONFLICT(Key) DO UPDATE SET Value = '', UpdatedAt = excluded.UpdatedAt
            `).run();
          }
        } else {
          activeTargetDocPath = defaultDocPath;
        }
      } catch (readErr) {
        activeTargetDocPath = defaultDocPath;
      } finally {
        if (tempRestoredDb) {
          try { tempRestoredDb.close(); } catch (_) {}
        }
      }

      if (!fs.existsSync(activeTargetDocPath)) {
        fs.mkdirSync(activeTargetDocPath, { recursive: true });
      }

      // Extract all entries under EmployeeDocuments/ to activeTargetDocPath
      for (const entry of entries) {
        if (entry.entryName.startsWith('EmployeeDocuments/') && !entry.isDirectory) {
          const relativeInsideDoc = entry.entryName.replace(/^EmployeeDocuments\//, '');
          const targetPath = path.join(activeTargetDocPath, relativeInsideDoc);
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          const content = zip.readFile(entry);
          fs.writeFileSync(targetPath, content);
        }
      }
    } else {
      // Legacy .db file
      fs.copyFileSync(backupPath, DB_PATH);
    }
  } catch (restoreErr) {
    // CRITICAL: Interrupted or failed extraction -> Emergency Auto-Rollback to safety backup
    console.error('[DB Restore Failed] Rolling back to pre-restore safety backup:', restoreErr.message);
    try {
      await _emergencyRollback(safetyBackupPath);
      console.log('[DB Rollback Succeeded] System reverted to safety backup state.');
    } catch (rollbackErr) {
      console.error('[DB Rollback Failed] Could not restore safety backup:', rollbackErr.message);
    }
    throw new Error(`فشلت عملية الاستعادة: ${restoreErr.message}. تم التراجع التلقائي إلى الحالة السابقة للنسخ الاحتياطي.`);
  }

  return {
    success: true,
    safetyBackupPath,
    pathMigrated,
    pathMessage,
    targetDocPath: activeTargetDocPath
  };
}

/**
 * Emergency rollback helper: Reverts DB and documents to the pre-restore safety backup.
 * @param {string} safetyBackupPath
 */
async function _emergencyRollback(safetyBackupPath) {
  if (!safetyBackupPath || !fs.existsSync(safetyBackupPath)) {
    throw new Error('ملف النسخة الاحتياطية الوقائية غير موجود لإجراء التراجع.');
  }

  const zip = new AdmZip(safetyBackupPath);
  const entries = zip.getEntries();

  // Restore DB
  const dbEntry = entries.find(e => !e.isDirectory && (e.entryName === 'leave_management.db' || e.entryName.endsWith('.db')));
  if (dbEntry) {
    fs.writeFileSync(DB_PATH, zip.readFile(dbEntry));
  }

  // Restore documents to the pre-restore location
  let preRestoreDocPath = null;
  let rollbackDb = null;
  try {
    const DocumentStorageService = require('./services/DocumentStorageService');
    rollbackDb = new Database(DB_PATH, { readonly: true });
    preRestoreDocPath = DocumentStorageService.getStorageRoot(rollbackDb);
  } catch (_) {
    preRestoreDocPath = path.join(DB_DIR, 'EmployeeDocuments');
  } finally {
    if (rollbackDb) {
      try { rollbackDb.close(); } catch (_) {}
    }
  }

  if (preRestoreDocPath) {
    if (!fs.existsSync(preRestoreDocPath)) {
      fs.mkdirSync(preRestoreDocPath, { recursive: true });
    }
    for (const entry of entries) {
      if (entry.entryName.startsWith('EmployeeDocuments/') && !entry.isDirectory) {
        const relative = entry.entryName.replace(/^EmployeeDocuments\//, '');
        const target = path.join(preRestoreDocPath, relative);
        const parent = path.dirname(target);
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(target, zip.readFile(entry));
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────
//  Exports
// ──────────────────────────────────────────────────────────────
module.exports = {
  initialize,
  close,
  getDb,
  // Employees
  getAllEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
  // Leave Types
  getAllLeaveTypes,
  // Leave Balances
  getLeaveBalancesByEmployee,
  upsertLeaveBalance,
  // Leaves
  getAllLeaves,
  getLeavesByEmployee,
  createLeave,
  deleteLeave,
  // Audit
  getAuditLog,
  // System / Backup / Restore
  backupDatabase,
  validateDatabaseBackup,
  createSafetyBackup,
  restoreDatabase,
};
