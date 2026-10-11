'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('node-red-contrib-modbus/modbus/core/modbus-server-core');
const sdm = require('../lib/sdm630');
const { huaweiBlock, importScenario, exportScenario, offlineScenario } = require('../lib/fixtures');

function closeTo(actual, expected, epsilon, label) {
  assert.ok(Math.abs(actual - expected) <= epsilon, label + ': ' + actual + ' != ' + expected);
}

function imageFrom(spec) {
  const result = sdm.step(null, {
    kind: 'huawei',
    now: 1_000_000,
    msg: { topic: 'huawei', payload: huaweiBlock(spec), input: { payload: { address: '37100', quantity: 39 } } }
  });
  assert.equal(result.write, true);
  return result;
}

test('Bezug wird positiv und Einspeisung negativ', () => {
  const imported = imageFrom(importScenario);
  const view = imported.state.sdmView;
  closeTo(view.pTotal, 1500, 0.01, 'import total');
  closeTo(view.pPhase[0], 600, 0.01, 'import L1');
  closeTo(view.pPhase[1], 500, 0.01, 'import L2');
  closeTo(view.pPhase[2], 400, 0.01, 'import L3');
  closeTo(view.i[0], 2.61, 0.02, 'import current');
  closeTo(view.v[0], 230, 0.01, 'voltage');
  closeTo(view.importKwh, 1234.5, 0.01, 'import energy');
  closeTo(view.exportKwh, 67.25, 0.01, 'export energy');
  closeTo(view.vll[0], 400.2, 0.01, 'line voltage');
  closeTo(view.pf, 0.99, 0.01, 'pf');
  closeTo(sdm.readFloat(imported.state.image, 0x0034), 1500, 0.01, 'register 0x34');

  const exported = imageFrom(exportScenario);
  closeTo(exported.state.sdmView.pTotal, -2088, 0.01, 'export total');
  closeTo(exported.state.sdmView.i[0], -3.2, 0.02, 'export current');
  closeTo(exported.state.sdmView.pf, -0.98, 0.01, 'export pf');
  closeTo(exported.state.sdmView.freq, 49.98, 0.01, 'freq');
  assert.match(exported.state.dashboard.headline, /Einspeisung/);
  assert.match(imported.state.dashboard.headline, /Bezug/);
});

test('fehlende Phasenleistung wird aus Spannung und Strom ersetzt', () => {
  const spec = Object.assign({}, importScenario, { pPhase: [0, 0, 0], pTotal: -1500 });
  const result = imageFrom(spec);
  closeTo(result.state.sdmView.pPhase[0], 230 * 2.61, 1, 'derived L1');
  closeTo(result.state.sdmView.pTotal, 1500, 0.01, 'total stays on register');
});

test('ein größerer Lesebereich wird auf 37100 zugeschnitten', () => {
  const block = huaweiBlock(importScenario);
  const wider = new Array(10).fill(0).concat(block);
  const regs = sdm.extractRegisters({
    payload: wider,
    input: { payload: { address: 37090 } }
  });
  assert.equal(regs.length, 39);
  assert.equal(regs[0], 1);
});

test('Status ungleich normal überschreibt den letzten Wert nicht', () => {
  const good = imageFrom(importScenario);
  const stale = sdm.step(good.state, {
    kind: 'huawei',
    now: 1_005_000,
    msg: { payload: huaweiBlock(offlineScenario), input: { payload: { address: 37100 } } }
  });
  assert.equal(stale.write, false);
  closeTo(sdm.readFloat(stale.state.image, 0x0034), 1500, 0.01, 'kept power');
  assert.match(stale.state.dashboard.note, /bleibt stehen/);
});

test('Handwert setzt die SDM630-Leistung und integriert Energie', () => {
  const armed = sdm.step(null, { kind: 'manualFlag', value: true, now: 1_000 });
  const set = sdm.step(armed.state, { kind: 'manualPower', value: -3000, now: 1_000 });
  closeTo(set.state.sdmView.pTotal, -3000, 0.01, 'manual export');
  assert.match(set.state.dashboard.headline, /Handwert/);
  assert.match(set.state.dashboard.headline, /Einspeisung/);
  assert.match(set.state.dashboard.headline, /-3\.000/);
  const later = sdm.step(set.state, { kind: 'tick', now: 11_000 });
  closeTo(later.state.sdmView.exportKwh, 3000 * 10 / 3_600_000, 0.0001, 'ten seconds');
  assert.equal(later.write, true);
});

test('Modbus-Server legt das Float an Register 0x0034', () => {
  const imported = imageFrom(importScenario);
  const input = Buffer.alloc(8000);
  const holding = Buffer.alloc(8000);
  const node = {
    modbusServer: { input, holding, coils: Buffer.alloc(8), discrete: Buffer.alloc(8) },
    error(err) { throw err; }
  };
  for (const register of ['input', 'holding']) {
    core.writeToServerMemory(node, {
      payload: { value: imported.state.image.slice(), register, address: 0, disableMsgOutput: 1 }
    });
  }
  closeTo(input.readFloatBE(0x0034 * 2), 1500, 0.01, 'input buffer');
  closeTo(holding.readFloatBE(0x000c * 2), 600, 0.01, 'holding L1');
});

test('der Import-Flow verbindet den Huawei-Client nicht', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'flows', 'sdm630.json'), 'utf8'));
  const read = flow.find((node) => node.id === 'sdm-read');
  const client = flow.find((node) => node.id === 'sdm-client');
  const server = flow.find((node) => node.id === 'sdm-srv');
  const rtu = flow.find((node) => node.id === 'sdm-rtu-in');
  assert.equal(read.d, true);
  assert.equal(read.unitid, '');
  assert.equal(read.server, 'sdm-client');
  assert.equal(client.tcpHost, '192.0.2.1');
  assert.equal(server.serverPort, '1502');
  assert.equal(rtu.port, '1503');
  assert.equal(flow.some((node) => node.type === 'ui_base'), false);
  assert.ok(flow.find((node) => node.id === 'sdm-ui-tab').order >= 10);
});

test('RTU antwortet nur Adresse 2, FC03 und FC04, und übersteht Teilstücke', () => {
  const imported = imageFrom(importScenario);
  const frame = Buffer.alloc(8);
  frame[0] = 2;
  frame[1] = 4;
  frame.writeUInt16BE(0x0034, 2);
  frame.writeUInt16BE(2, 4);
  const crc = sdm.crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;
  frame[7] = crc >> 8;

  const first = sdm.consumeRtu([], frame.subarray(0, 3), imported.state.image);
  assert.equal(first.response, null);
  const second = sdm.consumeRtu(first.pending, frame.subarray(3), imported.state.image);
  assert.equal(second.response[0], 2);
  assert.equal(second.response[1], 4);
  closeTo(second.response.readFloatBE(3), 1500, 0.01, 'rtu float');

  frame[1] = 3;
  const crc3 = sdm.crc16(frame.subarray(0, 6));
  frame[6] = crc3 & 0xff;
  frame[7] = crc3 >> 8;
  const fc3 = sdm.handleRtuRequest(imported.state.image, frame);
  assert.equal(fc3.response[1], 3);
  closeTo(fc3.response.readFloatBE(3), 1500, 0.01, 'fc3 float');

  frame[0] = 1;
  const crc1 = sdm.crc16(frame.subarray(0, 6));
  frame[6] = crc1 & 0xff;
  frame[7] = crc1 >> 8;
  const other = sdm.handleRtuRequest(imported.state.image, frame);
  assert.equal(other.response, null);
});
