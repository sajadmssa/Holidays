
    const Database = require('better-sqlite3');
    const path = require('path');
    const fs = require('fs');
    const db = new Database('C:/Users/3D/Desktop/Holidays/scratch/sandbox_power_loss/appdata/scen2.db');
    db.pragma('journal_mode = WAL');

    const DocumentStorageService = require('C:/Users/3D/Desktop/Holidays/src/main/services/DocumentStorageService');

    // Simulate saving file
    const res = DocumentStorageService.saveFile(9902, 'TIME_CARD', 'C:/Users/3D/Desktop/Holidays/scratch/sandbox_power_loss/sample.pdf', db);
    fs.writeFileSync('C:/Users/3D/Desktop/Holidays/scratch/sandbox_power_loss/scen2_copied_file.txt', res.absolutePath);

    // Hard kill immediately before database insertion!
    process.abort();
  