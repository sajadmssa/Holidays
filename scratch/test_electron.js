const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function log(m) {
  fs.appendFileSync(path.join(__dirname, 'test_whenready.log'), m + '\n');
}

log('before whenReady');
app.whenReady().then(() => {
  log('inside whenReady!');
  app.quit();
}).catch(e => {
  log('whenReady error: ' + e.stack);
  app.quit();
});
