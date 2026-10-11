'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
execFileSync(process.execPath, [path.join(__dirname, 'build-flow.js')], { stdio: 'inherit' });

const userDir = path.join(root, '.nodered-test');
fs.rmSync(userDir, { recursive: true, force: true });
fs.mkdirSync(path.join(userDir, 'node_modules'), { recursive: true });
for (const name of ['node-red-contrib-modbus', 'node-red-dashboard']) {
  fs.symlinkSync(path.join(root, 'node_modules', name), path.join(userDir, 'node_modules', name));
}

const flow = JSON.parse(fs.readFileSync(path.join(root, 'flows', 'sdm630.json'), 'utf8'));
flow.unshift({
  id: 'sdm-ui-base',
  type: 'ui_base',
  theme: { name: 'theme-light' },
  site: {
    name: 'SDM630 Test',
    hideToolbar: 'false',
    allowSwipe: 'false',
    lockMenu: 'false',
    allowTempTheme: 'true',
    dateFormat: 'DD.MM.YYYY',
    sizes: { sx: 48, sy: 48, gx: 6, gy: 6, cx: 6, cy: 6, px: 0, py: 0 }
  }
});
const client = flow.find((node) => node.id === 'sdm-client');
client.tcpHost = '127.0.0.1';
client.tcpPort = '15021';
client.name = 'Huawei-Dummy';
const read = flow.find((node) => node.id === 'sdm-read');
delete read.d;
read.rate = '1';
fs.writeFileSync(path.join(userDir, 'flows.json'), JSON.stringify(flow, null, 2));

fs.writeFileSync(path.join(userDir, 'settings.js'), `'use strict';
module.exports = {
  uiPort: 18880,
  flowFile: 'flows.json',
  flowFilePretty: true,
  credentialSecret: 'sdm630-test',
  functionExternalModules: false,
  logging: { console: { level: 'info', metrics: false, audit: false } },
  editorTheme: { projects: { enabled: false } }
};
`);

console.log(userDir);
