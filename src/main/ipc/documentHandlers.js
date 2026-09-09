// ============================================================
//  ipc/documentHandlers.js – Employee Documents IPC Layer
//  Responsibilities:
//    • Register IPC channels for employee document operations
//    • Pick files and folders using native Electron dialogs
//    • Open stored documents in default OS applications (PDF readers, image viewers)
//    • Safe async error handling with Arabic translations
// ============================================================

'use strict';

const { BrowserWindow, dialog, shell } = require('electron');
const { pathToFileURL } = require('url');
const DocumentService = require('../services/DocumentService');
const LoggerService = require('../services/LoggerService');
const { translateFileError } = require('../utils/fileErrorTranslator');
const { translateSqliteError } = require('../utils/sqliteErrorTranslator');

/**
 * Async uniform response wrapper.
 * @param {Function} fn
 */
function safeHandleAsync(fn) {
  return async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { success: true, data };
    } catch (err) {
      LoggerService.error('DocumentHandlers', 'IPC Error', err);
      const translatedMsg = translateFileError(err) || translateSqliteError(err) || err.message;
      return { success: false, error: translatedMsg };
    }
  };
}

/**
 * Registers document-related IPC channels.
 *
 * @param {Electron.IpcMain} ipcMain
 * @param {import('better-sqlite3').Database} db
 */
function registerDocumentHandlers(ipcMain, db) {

  // ── document:add ─────────────────────────────────────────────
  // Adds a new document version for an employee (does not delete previous versions)
  ipcMain.handle(
    'document:add',
    safeHandleAsync(async (payload) => {
      if (!payload || typeof payload !== 'object') {
        throw new Error('بيانات إضافة المستند غير صالحة.');
      }
      return DocumentService.addDocument(payload, db);
    })
  );

  // ── document:list ────────────────────────────────────────────
  // Lists non-deleted document versions for an employee
  ipcMain.handle(
    'document:list',
    safeHandleAsync(async (payload) => {
      let filter = payload;
      if (typeof payload === 'number' || typeof payload === 'string') {
        filter = { employeeId: Number(payload) };
      }
      return DocumentService.listDocuments(filter, db);
    })
  );

  // ── document:delete ──────────────────────────────────────────
  // Soft deletes a specific document version (leaves physical file on disk)
  ipcMain.handle(
    'document:delete',
    safeHandleAsync(async (documentId) => {
      const docId = typeof documentId === 'object' ? documentId.documentId : documentId;
      return DocumentService.softDeleteDocument(docId, db);
    })
  );

  // ── document:openExternal ────────────────────────────────────
  // Opens the document file on the host OS using the default viewer
  ipcMain.handle(
    'document:openExternal',
    safeHandleAsync(async (documentId) => {
      const docId = typeof documentId === 'object' ? documentId.documentId : documentId;
      const doc = DocumentService.getDocumentById(docId, db);

      if (!doc.fileExists || !doc.absolutePath) {
        throw new Error('الملف غير موجود في مجلد التخزين (قد يكون تم نقله أو حذفه يدوياً).');
      }

      const openErr = await shell.openPath(doc.absolutePath);
      if (openErr) {
        throw new Error(`تعذر فتح الملف بالبرنامج الافتراضي: ${openErr}`);
      }

      return { opened: true, filePath: doc.absolutePath };
    })
  );

  // ── document:pickFile ────────────────────────────────────────
  // Prompts user with native Open dialog for selecting a card/document file
  ipcMain.handle(
    'document:pickFile',
    safeHandleAsync(async (options = {}) => {
      const win = BrowserWindow.getFocusedWindow();
      const title = options.title || 'اختيار ملف كرت الموظف (PDF أو صورة)';
      const result = await dialog.showOpenDialog(win, {
        title,
        buttonLabel: 'اختيار الملف',
        filters: [
          { name: 'المستندات والصور المدعومة', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'] },
          { name: 'ملفات PDF', extensions: ['pdf'] },
          { name: 'ملفات الصور', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
          { name: 'جميع الملفات', extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { canceled: true };
      }

      return {
        canceled: false,
        filePath: result.filePaths[0]
      };
    })
  );

  // ── document:getStoragePath ──────────────────────────────────
  ipcMain.handle(
    'document:getStoragePath',
    safeHandleAsync(async () => {
      return DocumentService.getStoragePath(db);
    })
  );

  // ── document:setStoragePath ──────────────────────────────────
  ipcMain.handle(
    'document:setStoragePath',
    safeHandleAsync(async (newPath) => {
      const pathVal = typeof newPath === 'object' ? newPath.path : newPath;
      return DocumentService.setStoragePath(pathVal, db);
    })
  );

  // ── document:testStoragePath ─────────────────────────────────
  ipcMain.handle(
    'document:testStoragePath',
    safeHandleAsync(async (targetPath) => {
      const pathVal = typeof targetPath === 'object' ? targetPath.path : targetPath;
      return DocumentService.testStoragePath(pathVal);
    })
  );

  // ── document:openStorageFolder ───────────────────────────────
  ipcMain.handle(
    'document:openStorageFolder',
    safeHandleAsync(async () => {
      const storageRoot = DocumentService.getStoragePath(db);
      const openErr = await shell.openPath(storageRoot);
      if (openErr) {
        throw new Error(`تعذر فتح مجلد التخزين: ${openErr}`);
      }
      return { opened: true, path: storageRoot };
    })
  );

  // ── document:print ───────────────────────────────────────────
  // Prints the card/document directly on A4 paper using webContents.print()
  ipcMain.handle(
    'document:print',
    safeHandleAsync(async (documentId) => {
      const docId = typeof documentId === 'object' ? documentId.documentId : documentId;
      const doc = DocumentService.getDocumentById(docId, db);

      if (!doc.fileExists || !doc.absolutePath) {
        throw new Error('الملف غير موجود في مجلد التخزين لطباعته.');
      }

      const ext = (doc.FileExtension || '').toLowerCase();
      const isPdf = ext === '.pdf';
      const fileUrl = pathToFileURL(doc.absolutePath).href;

      return new Promise((resolve, reject) => {
        const printWin = new BrowserWindow({
          show: false,
          width: 800,
          height: 600,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          }
        });

        let finished = false;
        const cleanup = () => {
          if (!finished) {
            finished = true;
            try { printWin.destroy(); } catch (_) {}
          }
        };

        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('انتهت مهلة تجهيز أمر الطباعة.'));
        }, 30000);

        const executePrint = () => {
          printWin.webContents.print(
            {
              silent: false, // Opens native print dialog directly so user can choose printer and print on A4
              printBackground: true,
              pageSize: 'A4',
            },
            (success, failureReason) => {
              clearTimeout(timeout);
              cleanup();
              if (!success && failureReason && failureReason !== 'cancelled') {
                reject(new Error(`فشل تنفيذ أمر الطباعة: ${failureReason}`));
              } else {
                resolve({ printed: true, cancelled: failureReason === 'cancelled' });
              }
            }
          );
        };

        if (isPdf) {
          printWin.loadURL(fileUrl);
          printWin.webContents.on('did-finish-load', () => {
            setTimeout(executePrint, 500);
          });
        } else {
          // Render HTML page formatted for A4
          const htmlContent = `
            <!DOCTYPE html>
            <html dir="rtl" lang="ar">
            <head>
              <meta charset="utf-8" />
              <title>طباعة كرت - ${doc.OriginalName || ''}</title>
              <style>
                @page {
                  size: A4 portrait;
                  margin: 0;
                }
                * {
                  box-sizing: border-box;
                }
                html, body {
                  margin: 0;
                  padding: 0;
                  width: 100%;
                  height: 100%;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background-color: #ffffff;
                }
                img {
                  max-width: 98vw;
                  max-height: 98vh;
                  object-fit: contain;
                  display: block;
                  margin: auto;
                }
              </style>
            </head>
            <body>
              <img src="${fileUrl}" onload="window.__imgLoaded = true;" />
            </body>
            </html>
          `;

          printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
          printWin.webContents.on('did-finish-load', () => {
            setTimeout(executePrint, 400);
          });
        }

        printWin.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(`تعذر تحميل الملف للطباعة: ${errorDescription} (${errorCode})`));
        });
      });
    })
  );

  // ── document:getDeletedStats ─────────────────────────────────
  ipcMain.handle(
    'document:getDeletedStats',
    safeHandleAsync(async () => {
      return DocumentService.getDeletedDocumentsStats(db);
    })
  );

  // ── document:purgeDeleted ────────────────────────────────────
  ipcMain.handle(
    'document:purgeDeleted',
    safeHandleAsync(async () => {
      return DocumentService.purgeDeletedDocuments(db);
    })
  );

  LoggerService.info('DocumentHandlers', 'Registered document IPC handlers');
}

module.exports = { registerDocumentHandlers };
