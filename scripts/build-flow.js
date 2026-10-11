'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lib = fs.readFileSync(path.join(root, 'lib', 'sdm630.js'), 'utf8');
const glue = fs.readFileSync(path.join(root, 'flow', 'glue.js'), 'utf8');
const func = 'const sdm = (function (module) {\n' + lib + '\nreturn module.exports;\n})({ exports: {} });\n' + glue;

const template = `<style>
  .sdm630-panel { font-family: "Segoe UI", sans-serif; line-height: 1.35; }
  .sdm630-panel .headline { font-size: 1.45rem; font-weight: 650; margin: 0 0 0.4rem; }
  .sdm630-panel .signed { margin: 0 0 0.6rem; color: #334155; }
  .sdm630-panel .import { color: #9a3412; }
  .sdm630-panel .export { color: #166534; }
  .sdm630-panel .idle { color: #334155; }
  .sdm630-panel .wait, .sdm630-panel .manual { color: #92400e; }
  .sdm630-panel table { width: 100%; border-collapse: collapse; }
  .sdm630-panel td { padding: 0.2rem 0.4rem 0.2rem 0; vertical-align: top; }
  .sdm630-panel td:first-child { color: #475569; width: 38%; }
  .sdm630-panel .note { margin: 0.6rem 0 0; color: #92400e; }
</style>
<div class="sdm630-panel" ng-if="msg.payload">
  <p class="headline" ng-class="msg.payload.tone">{{msg.payload.headline}}</p>
  <p class="signed">Register 0x0034: {{msg.payload.signed}}</p>
  <table>
    <tr ng-repeat="row in msg.payload.rows">
      <td>{{row.label}}</td>
      <td>{{row.value}}</td>
    </tr>
  </table>
  <p class="note" ng-if="msg.payload.note">{{msg.payload.note}}</p>
</div>
<div class="sdm630-panel" ng-if="!msg.payload"><p>Warte auf den ersten Zählerwert.</p></div>`;

const flow = [
  {
    id: 'sdm-tab',
    type: 'tab',
    label: 'SDM630 Emulation',
    disabled: false,
    info: 'Liest den DTSU666-H über den bestehenden Huawei-Modbus-Client und antwortet dem Growatt als Eastron SDM630. Die Huawei-Lesung ist absichtlich deaktiviert.'
  },
  {
    id: 'sdm-ui-tab',
    type: 'ui_tab',
    name: 'SDM630',
    icon: 'dashboard',
    order: 99,
    disabled: false,
    hidden: false
  },
  {
    id: 'sdm-ui-hand',
    type: 'ui_group',
    name: 'Handwert',
    tab: 'sdm-ui-tab',
    order: 1,
    disp: true,
    width: 12,
    collapse: false,
    className: ''
  },
  {
    id: 'sdm-ui-live',
    type: 'ui_group',
    name: 'Messwerte',
    tab: 'sdm-ui-tab',
    order: 2,
    disp: true,
    width: 12,
    collapse: false,
    className: ''
  },
  {
    id: 'sdm-note',
    type: 'comment',
    z: 'sdm-tab',
    name: 'Vor dem Aktivieren den bestehenden Modbus-Client wählen',
    info: 'Die Modbus-Lesung ist deaktiviert und zeigt auf einen Platzhalter ohne erreichbaren Host. Vor dem Aktivieren im Read-Node den bereits vorhandenen Huawei-Client auswählen, den Platzhalter löschen und die Unit-ID leer lassen. Liegt Register 37100 schon in einer bestehenden Lesung, diesen Ausgang oder den Link-In „Bestehende Huawei-Lesung“ verwenden und den Read-Node aus lassen.',
    x: 280,
    y: 40,
    wires: []
  },
  {
    id: 'sdm-client',
    type: 'modbus-client',
    name: 'Platzhalter, nicht verbinden',
    clienttype: 'tcp',
    bufferCommands: true,
    stateLogEnabled: false,
    queueLogEnabled: false,
    failureLogEnabled: true,
    tcpHost: '192.0.2.1',
    tcpPort: '502',
    tcpType: 'DEFAULT',
    serialPort: '/dev/ttyUSB',
    serialType: 'RTU-BUFFERD',
    serialBaudrate: '9600',
    serialDatabits: '8',
    serialStopbits: '1',
    serialParity: 'none',
    serialConnectionDelay: '100',
    serialAsciiResponseStartDelimiter: '0x3A',
    unit_id: '1',
    commandDelay: '1',
    clientTimeout: '1000',
    reconnectOnTimeout: true,
    reconnectTimeout: '2000',
    parallelUnitIdsAllowed: true,
    showErrors: false,
    showWarnings: true,
    showLogs: true
  },
  {
    id: 'sdm-read',
    type: 'modbus-read',
    z: 'sdm-tab',
    d: true,
    name: 'Huawei Zähler 37100',
    topic: 'huawei',
    showStatusActivities: false,
    logIOActivities: false,
    showErrors: false,
    showWarnings: true,
    unitid: '',
    dataType: 'HoldingRegister',
    adr: '37100',
    quantity: '39',
    rate: '5',
    rateUnit: 's',
    delayOnStart: false,
    enableDeformedMessages: false,
    startDelayTime: '',
    server: 'sdm-client',
    useIOFile: false,
    ioFile: '',
    useIOForPayload: false,
    emptyMsgOnFail: false,
    x: 180,
    y: 160,
    wires: [['sdm-fn'], []]
  },
  {
    id: 'sdm-link',
    type: 'link in',
    z: 'sdm-tab',
    name: 'Bestehende Huawei-Lesung',
    links: [],
    x: 190,
    y: 220,
    wires: [['sdm-fn']]
  },
  {
    id: 'sdm-tick',
    type: 'inject',
    z: 'sdm-tab',
    name: 'Alle 2 s nachlegen',
    props: [{ p: 'topic', vt: 'str' }],
    repeat: '2',
    crontab: '',
    once: true,
    onceDelay: '1',
    topic: 'tick',
    payload: '',
    payloadType: 'date',
    x: 170,
    y: 280,
    wires: [['sdm-fn']]
  },
  {
    id: 'sdm-switch',
    type: 'ui_switch',
    z: 'sdm-tab',
    name: '',
    label: 'Handwert statt Huawei',
    tooltip: 'Aktivieren, um die Gesamtleistung von Hand vorzugeben.',
    group: 'sdm-ui-hand',
    order: 1,
    width: 6,
    height: 1,
    passthru: true,
    decouple: 'false',
    topic: 'manual',
    topicType: 'str',
    style: '',
    onvalue: true,
    onvalueType: 'bool',
    onicon: '',
    oncolor: '',
    offvalue: false,
    offvalueType: 'bool',
    officon: '',
    offcolor: '',
    animate: false,
    className: '',
    x: 170,
    y: 340,
    wires: [['sdm-fn']]
  },
  {
    id: 'sdm-power',
    type: 'ui_template',
    z: 'sdm-tab',
    group: 'sdm-ui-hand',
    name: 'Leistung eingeben',
    order: 2,
    width: 6,
    height: 4,
    format: `<form ng-submit="send({topic:'manualPower', payload:power*1})" style="padding:4px 0">
  <label for="leistung" style="display:block;margin-bottom:4px">Leistung in Watt</label>
  <input id="leistung" type="number" step="10" min="-20000" max="20000" ng-model="power" ng-init="power=0" aria-label="Leistung in Watt. Positiv ist Bezug, negativ ist Einspeisung." style="width:100%;font-size:1.1rem;padding:6px;box-sizing:border-box">
  <button type="submit" style="margin-top:8px">Übernehmen</button>
  <p style="margin:6px 0 0;color:#475569">Positiv ist Bezug, negativ ist Einspeisung. Wirkt nur bei eingeschaltetem Handwert.</p>
</form>`,
    storeOutMessages: false,
    fwdInMessages: false,
    resendOnRefresh: false,
    templateScope: 'local',
    className: '',
    x: 180,
    y: 400,
    wires: [['sdm-fn']]
  },
  {
    id: 'sdm-fn',
    type: 'function',
    z: 'sdm-tab',
    name: 'Huawei nach SDM630',
    func,
    outputs: 3,
    timeout: 0,
    noerr: 0,
    initialize: '',
    finalize: '',
    libs: [],
    x: 520,
    y: 260,
    wires: [['sdm-srv'], ['sdm-ui'], ['sdm-rtu-out']]
  },
  {
    id: 'sdm-srv',
    type: 'modbus-server',
    z: 'sdm-tab',
    name: 'SDM630 Modbus TCP 1502',
    logEnabled: false,
    hostname: '0.0.0.0',
    serverPort: '1502',
    responseDelay: '1',
    delayUnit: 'ms',
    coilsBufferSize: '1000',
    holdingBufferSize: '1000',
    inputBufferSize: '1000',
    discreteBufferSize: '1000',
    showErrors: true,
    showStatusActivities: false,
    x: 820,
    y: 180,
    wires: [[], [], [], [], []]
  },
  {
    id: 'sdm-rtu-in',
    type: 'tcp in',
    z: 'sdm-tab',
    name: 'SDM630 RTU über TCP 1503',
    server: 'server',
    host: '',
    port: '1503',
    datamode: 'stream',
    datatype: 'buffer',
    newline: '',
    topic: '',
    base64: false,
    trim: false,
    x: 200,
    y: 480,
    wires: [['sdm-fn']]
  },
  {
    id: 'sdm-rtu-out',
    type: 'tcp out',
    z: 'sdm-tab',
    name: 'RTU-Antwort',
    host: '',
    port: '',
    beserver: 'reply',
    base64: false,
    end: false,
    x: 800,
    y: 340,
    wires: []
  },
  {
    id: 'sdm-ui',
    type: 'ui_template',
    z: 'sdm-tab',
    group: 'sdm-ui-live',
    name: 'Messwerte',
    order: 1,
    width: 12,
    height: 9,
    format: template,
    storeOutMessages: true,
    fwdInMessages: false,
    resendOnRefresh: true,
    templateScope: 'local',
    className: '',
    x: 800,
    y: 260,
    wires: [[]]
  }
];

const out = path.join(root, 'flows', 'sdm630.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(flow, null, 2) + '\n');
console.log('wrote ' + out);
