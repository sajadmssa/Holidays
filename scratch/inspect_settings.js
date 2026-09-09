const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');

// Print around index 4932
console.log('--- TOP HEADER SETTINGS BUTTONS ---');
console.log(html.substring(4500, 6000));

// Find any modal with settings
console.log('\n--- SETTINGS MODAL ---');
const modalIndex = html.indexOf('settings-modal') !== -1 ? html.indexOf('settings-modal') : html.indexOf('modal-settings');
console.log('modal index:', modalIndex);
if (modalIndex !== -1) {
    console.log(html.substring(modalIndex - 100, modalIndex + 2000));
} else {
    // search for modal
    const allModals = [...html.matchAll(/class="[^"]*modal[^"]*"[^>]*id="([^"]+)"/g)];
    console.log('All modals:', allModals.map(m => m[1]));
}
