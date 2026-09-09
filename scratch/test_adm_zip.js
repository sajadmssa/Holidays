const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const zip = new AdmZip();
zip.addFile('manifest.json', Buffer.from(JSON.stringify({ version: '4.0', test: true }), 'utf8'));
const outPath = path.join(__dirname, 'test.zip');
zip.writeZip(outPath);

const readZip = new AdmZip(outPath);
const entries = readZip.getEntries();
console.log('Entries in zip:', entries.map(e => e.entryName));
const manifestText = readZip.readAsText('manifest.json');
console.log('Manifest content:', manifestText);

fs.unlinkSync(outPath);
console.log('Test completed successfully!');
