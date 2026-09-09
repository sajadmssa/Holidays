const fs = require('fs');
const path = require('path');

const src1 = path.resolve(__dirname, 'screenshot_manage_emp.png');
const src2 = path.resolve(__dirname, 'screenshot_transfer_modal.png');

const artifactDir = 'C:\\Users\\3D\\.gemini\\antigravity-ide\\brain\\7f5816a6-82bc-4934-85c5-95f73dd3fc6f';

fs.copyFileSync(src1, path.join(artifactDir, 'screenshot_manage_emp.png'));
fs.copyFileSync(src2, path.join(artifactDir, 'screenshot_transfer_modal.png'));

console.log('Screenshots copied to artifact dir successfully.');
