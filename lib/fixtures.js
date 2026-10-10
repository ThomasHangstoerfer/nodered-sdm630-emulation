'use strict';

const { METER_COUNT } = require('./sdm630');

function packI32(regs, offset, value) {
  const v = value | 0;
  regs[offset] = (v >>> 16) & 0xffff;
  regs[offset + 1] = v & 0xffff;
}

function packI16(regs, offset, value) {
  regs[offset] = value & 0xffff;
}

function huaweiBlock(spec) {
  const regs = new Array(METER_COUNT).fill(0);
  regs[0] = spec.status == null ? 1 : spec.status;
  packI32(regs, 1, Math.round(spec.v[0] * 10));
  packI32(regs, 3, Math.round(spec.v[1] * 10));
  packI32(regs, 5, Math.round(spec.v[2] * 10));
  packI32(regs, 7, Math.round(spec.i[0] * 100));
  packI32(regs, 9, Math.round(spec.i[1] * 100));
  packI32(regs, 11, Math.round(spec.i[2] * 100));
  packI32(regs, 13, Math.round(spec.pTotal));
  packI32(regs, 15, Math.round(spec.qTotal || 0));
  packI16(regs, 17, Math.round((spec.pf || 0) * 1000));
  packI16(regs, 18, Math.round((spec.freq || 50) * 100));
  packI32(regs, 19, Math.round((spec.exportKwh || 0) * 100));
  packI32(regs, 21, Math.round((spec.importKwh || 0) * 100));
  packI32(regs, 26, Math.round((spec.vll ? spec.vll[0] : 0) * 10));
  packI32(regs, 28, Math.round((spec.vll ? spec.vll[1] : 0) * 10));
  packI32(regs, 30, Math.round((spec.vll ? spec.vll[2] : 0) * 10));
  packI32(regs, 32, Math.round(spec.pPhase[0]));
  packI32(regs, 34, Math.round(spec.pPhase[1]));
  packI32(regs, 36, Math.round(spec.pPhase[2]));
  return regs;
}

const importScenario = {
  name: 'import',
  status: 1,
  v: [230, 231.5, 229],
  i: [-2.61, -2.16, -1.75],
  pPhase: [-600, -500, -400],
  pTotal: -1500,
  pf: -0.99,
  freq: 50,
  importKwh: 1234.5,
  exportKwh: 67.25,
  vll: [400.2, 399.1, 398.4],
  expect: { pTotal: 1500, pPhase: [600, 500, 400], i0: 2.61, importKwh: 1234.5, exportKwh: 67.25, v0: 230, vll0: 400.2, pf: 0.99 }
};

const exportScenario = {
  name: 'export',
  status: 1,
  v: [232, 233, 231],
  i: [3.2, 3, 2.8],
  pPhase: [742, 699, 647],
  pTotal: 2088,
  pf: 0.98,
  freq: 49.98,
  importKwh: 1234.5,
  exportKwh: 80,
  vll: [402, 401, 400],
  expect: { pTotal: -2088, pPhase: [-742, -699, -647], i0: -3.2, importKwh: 1234.5, exportKwh: 80, v0: 232, freq: 49.98, pf: -0.98 }
};

const offlineScenario = {
  name: 'offline',
  status: 0,
  v: [0, 0, 0],
  i: [0, 0, 0],
  pPhase: [0, 0, 0],
  pTotal: 0,
  pf: 0,
  freq: 0,
  importKwh: 0,
  exportKwh: 0,
  vll: [0, 0, 0]
};

const scenarios = {
  import: importScenario,
  export: exportScenario,
  offline: offlineScenario
};

module.exports = { huaweiBlock, scenarios, importScenario, exportScenario, offlineScenario };
