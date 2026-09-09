const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');

const modalStart = html.indexOf('id="system-settings-modal"');
const modalEnd = html.indexOf('</dialog>', modalStart);
console.log(html.substring(modalStart - 10, modalEnd + 9));
