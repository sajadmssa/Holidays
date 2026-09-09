const fs = require('fs');
const html = fs.readFileSync('src/renderer/index.html', 'utf8');

const tabMatches = [...html.matchAll(/id=["'](tab-[^"']+)["']/g)];
console.log('Tabs:', tabMatches.map(m => m[1]));

const navButtons = [...html.matchAll(/id=["'](btn-tab-[^"']+)["'][^>]*>([\s\S]*?)<\/button>/g)];
console.log('Nav buttons:');
navButtons.forEach(b => console.log(b[1], b[2].trim().replace(/\s+/g, ' ')));

// Let's also find where settings tab is defined
const settingsIndex = html.indexOf('tab-settings');
if (settingsIndex !== -1) {
    console.log('\nFound tab-settings at index', settingsIndex);
    console.log(html.substring(settingsIndex - 100, settingsIndex + 1500));
} else {
    // Search for settings or إعدادات
    const idx = html.indexOf('إعدادات');
    console.log('\nIndex of إعدادات:', idx);
    if (idx !== -1) {
        console.log(html.substring(idx - 100, idx + 500));
    }
}
