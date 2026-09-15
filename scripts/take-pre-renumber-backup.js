// scripts/take-pre-renumber-backup.js
const path = require('path');
const fs = require('fs');

async function main() {
  const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
  const appDataDir = path.join(process.env.APPDATA, 'leave-management-system');
  const projectBackupsDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(projectBackupsDir, { recursive: true });

  const appDataBackupsDir = path.join(appDataDir, 'backups');
  fs.mkdirSync(appDataBackupsDir, { recursive: true });

  const backupFileName = `pre_renumber_backup_${timestampStr}.hbak`;
  const backupFilePath = path.join(appDataBackupsDir, backupFileName);
  const projectBackupCopyPath = path.join(projectBackupsDir, backupFileName);

  console.log('=== STEP 0: CREATING OFFICIAL .HBAK BACKUP ===');
  console.log('Target .hbak path:', backupFilePath);

  // Use the system's database module
  const dbModule = require('../src/main/database');
  
  // Initialize database connection
  dbModule.initialize();
  
  // 1. Create .hbak using database.backupDatabase (the engine used by AutoBackupService and systemHandlers)
  const result = await dbModule.backupDatabase(backupFilePath);
  console.log('Backup generated successfully:', result);

  // Copy a safety duplicate to project backups directory as well
  fs.copyFileSync(backupFilePath, projectBackupCopyPath);

  // Verify the backup file
  const stat = fs.statSync(backupFilePath);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`الملف الناتج غير صالح أو فارغ: ${stat.size} bytes`);
  }

  // Validate the backup using database.validateDatabaseBackup
  const validation = dbModule.validateDatabaseBackup(backupFilePath);
  console.log('Validation Result:', JSON.stringify(validation, null, 2));

  // 2. Separate Full Directory Copy of EmployeeDocuments
  console.log('\n=== STEP 0: COPYING EMPLOYEEDOCUMENTS DIRECTORY ===');
  const srcDocDir = path.join(appDataDir, 'EmployeeDocuments');
  const destDocDir = path.join(projectBackupsDir, `EmployeeDocuments_pre_renumber_${timestampStr}`);

  function copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    let count = 0;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        count += copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
        count++;
      }
    }
    return count;
  }

  const copiedFilesCount = copyDirRecursive(srcDocDir, destDocDir);
  console.log(`Copied ${copiedFilesCount} files to: ${destDocDir}`);

  // Summary Output
  console.log('\n=== BACKUP_REPORT_JSON ===');
  console.log(JSON.stringify({
    success: true,
    hbak: {
      fileName: backupFileName,
      fullPath: backupFilePath,
      projectCopyPath: projectBackupCopyPath,
      sizeBytes: stat.size,
      createdAt: stat.birthtime.toISOString(),
      validation
    },
    employeeDocumentsBackup: {
      sourceDir: srcDocDir,
      backupDir: destDocDir,
      filesCopied: copiedFilesCount
    }
  }, null, 2));

  dbModule.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Backup failed:', err);
  process.exit(1);
});
