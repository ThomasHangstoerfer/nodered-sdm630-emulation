'use strict';

const METER_START = 37100;
const METER_COUNT = 39;
const IMAGE_REGISTERS = 256;
const STALE_AFTER_MS = 15000;

function i32(regs, offset) {
  const hi = regs[offset] & 0xffff;
  const lo = regs[offset + 1] & 0xffff;
  return (((hi << 16) | lo) | 0);
}

function i16(value) {
  const v = value & 0xffff;
  return (v & 0x8000) ? v - 0x10000 : v;
}

function putFloat(buf, register, value) {
  const n = Number(value);
  buf.writeFloatBE(Number.isFinite(n) ? n : 0, register * 2);
}

function readFloat(image, register) {
  const buf = Buffer.isBuffer(image) ? image : Buffer.from(image);
  return buf.readFloatBE(register * 2);
}

function emptyState() {
  return {
    manual: false,
    manualPower: 0,
    manualImportKwh: 0,
    manualExportKwh: 0,
    lastManualAt: null,
    lastHuaweiRegs: null,
    meterStatus: null,
    huaweiError: null,
    huaweiView: null,
    sdmView: null,
    image: null,
    lastGoodAt: null,
    dashboard: null
  };
}

function asRegisters(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length < 2 || value.length % 2 !== 0) return null;
    const regs = [];
    for (let i = 0; i < value.length; i += 2) regs.push(value.readUInt16BE(i));
    return regs;
  }
  if (Array.isArray(value) && value.length > 0 && value.every((n) => Number.isFinite(Number(n)))) {
    return value.map((n) => Number(n) & 0xffff);
  }
  return null;
}

function startAddressOf(msg) {
  const candidates = [
    msg && msg.input && msg.input.payload && msg.input.payload.address,
    msg && msg.input && msg.input.address,
    msg && msg.payload && msg.payload.address
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const n = Number(candidate);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

function extractRegisters(msg) {
  const payload = msg ? msg.payload : null;
  let regs = null;
  if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload) && !Array.isArray(payload)) {
    regs = asRegisters(payload.data) || asRegisters(payload.buffer) || asRegisters(payload.values) || asRegisters(payload.payload);
  }
  if (!regs) regs = asRegisters(payload);
  if (!regs && msg && Array.isArray(msg.values)) regs = asRegisters(msg.values);
  if (!regs) throw new Error('Zählerblock nicht erkannt');

  const start = startAddressOf(msg);
  if (start == null) {
    if (regs.length < METER_COUNT) throw new Error('Zu wenig Register, 39 ab 37100 erwartet');
    return regs.slice(0, METER_COUNT);
  }
  const offset = METER_START - start;
  if (offset < 0 || offset + METER_COUNT > regs.length) {
    throw new Error('Block 37100 liegt nicht in der Lesung (Start ' + start + ', Länge ' + regs.length + ')');
  }
  return regs.slice(offset, offset + METER_COUNT);
}

function decodeHuawei(regs) {
  const v = [i32(regs, 1) / 10, i32(regs, 3) / 10, i32(regs, 5) / 10];
  const i = [i32(regs, 7) / 100, i32(regs, 9) / 100, i32(regs, 11) / 100];
  const pPhaseRaw = [i32(regs, 32), i32(regs, 34), i32(regs, 36)];
  const pPhase = pPhaseRaw.map((raw, idx) => {
    if (raw !== 0) return raw;
    if (i[idx] !== 0 && v[idx] !== 0) return v[idx] * i[idx];
    return 0;
  });
  const pTotalRaw = i32(regs, 13);
  const vll = [i32(regs, 26) / 10, i32(regs, 28) / 10, i32(regs, 30) / 10];
  return {
    status: regs[0] & 0xffff,
    v,
    i,
    pPhase,
    pTotal: pTotalRaw !== 0 ? pTotalRaw : pPhase.reduce((sum, p) => sum + p, 0),
    qTotal: i32(regs, 15),
    pf: i16(regs[17]) / 1000,
    freq: i16(regs[18]) / 100 || 50,
    exportKwh: i32(regs, 19) / 100,
    importKwh: i32(regs, 21) / 100,
    vll
  };
}

function clampPf(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function toSdm(huawei) {
  const pPhase = huawei.pPhase.map((p) => -p);
  const current = huawei.i.map((a) => -a);
  const pTotal = -huawei.pTotal;
  const qTotal = -huawei.qTotal;
  const pf = clampPf(huawei.pf === 0 ? (pTotal === 0 ? 1 : Math.sign(pTotal)) : -huawei.pf);
  const vaPhase = pPhase.map((p, idx) => {
    const apparent = Math.abs(huawei.v[idx] * huawei.i[idx]);
    return apparent || Math.abs(p);
  });
  const sqrt3 = Math.sqrt(3);
  return {
    v: huawei.v.slice(),
    i: current,
    pPhase,
    pTotal,
    qTotal,
    vaPhase,
    vaTotal: vaPhase.reduce((sum, va) => sum + va, 0),
    pf,
    pfPhase: pPhase.map((p) => (p === 0 ? 0 : Math.sign(p) * (Math.abs(pf) || 1))),
    freq: huawei.freq,
    importKwh: huawei.importKwh,
    exportKwh: huawei.exportKwh,
    vAvg: (huawei.v[0] + huawei.v[1] + huawei.v[2]) / 3,
    iSum: current[0] + current[1] + current[2],
    iAvg: (current[0] + current[1] + current[2]) / 3,
    vll: huawei.vll.map((volts, idx) => volts || huawei.v[idx] * sqrt3),
    iN: 0
  };
}

function buildImage(sdm) {
  const buf = Buffer.alloc(IMAGE_REGISTERS * 2);
  putFloat(buf, 0x0000, sdm.v[0]);
  putFloat(buf, 0x0002, sdm.v[1]);
  putFloat(buf, 0x0004, sdm.v[2]);
  putFloat(buf, 0x0006, sdm.i[0]);
  putFloat(buf, 0x0008, sdm.i[1]);
  putFloat(buf, 0x000a, sdm.i[2]);
  putFloat(buf, 0x000c, sdm.pPhase[0]);
  putFloat(buf, 0x000e, sdm.pPhase[1]);
  putFloat(buf, 0x0010, sdm.pPhase[2]);
  putFloat(buf, 0x0012, sdm.vaPhase[0]);
  putFloat(buf, 0x0014, sdm.vaPhase[1]);
  putFloat(buf, 0x0016, sdm.vaPhase[2]);
  putFloat(buf, 0x001e, sdm.pfPhase[0]);
  putFloat(buf, 0x0020, sdm.pfPhase[1]);
  putFloat(buf, 0x0022, sdm.pfPhase[2]);
  putFloat(buf, 0x002a, sdm.vAvg);
  putFloat(buf, 0x002e, sdm.iAvg);
  putFloat(buf, 0x0030, sdm.iSum);
  putFloat(buf, 0x0034, sdm.pTotal);
  putFloat(buf, 0x0038, sdm.vaTotal);
  putFloat(buf, 0x003c, sdm.qTotal);
  putFloat(buf, 0x003e, sdm.pf);
  putFloat(buf, 0x0046, sdm.freq);
  putFloat(buf, 0x0048, sdm.importKwh);
  putFloat(buf, 0x004a, sdm.exportKwh);
  putFloat(buf, 0x00c8, sdm.vll[0]);
  putFloat(buf, 0x00ca, sdm.vll[1]);
  putFloat(buf, 0x00cc, sdm.vll[2]);
  putFloat(buf, 0x00e0, sdm.iN);
  return buf;
}

function manualSdm(state, now) {
  if (state.lastManualAt != null) {
    let dtMs = now - state.lastManualAt;
    if (dtMs < 0) dtMs = 0;
    if (dtMs > 60000) dtMs = 60000;
    const kwh = Math.abs(state.manualPower) * (dtMs / 3600000) / 1000;
    if (state.manualPower > 0) state.manualImportKwh += kwh;
    else if (state.manualPower < 0) state.manualExportKwh += kwh;
  }
  state.lastManualAt = now;
  const voltage = [230, 230, 230];
  const pPhase = [state.manualPower / 3, state.manualPower / 3, state.manualPower / 3];
  const current = pPhase.map((p, idx) => p / voltage[idx]);
  const sign = state.manualPower === 0 ? 1 : Math.sign(state.manualPower);
  return {
    v: voltage,
    i: current,
    pPhase,
    pTotal: state.manualPower,
    qTotal: 0,
    vaPhase: pPhase.map((p) => Math.abs(p)),
    vaTotal: Math.abs(state.manualPower),
    pf: sign,
    pfPhase: pPhase.map((p) => (p === 0 ? 0 : Math.sign(p))),
    freq: 50,
    importKwh: state.manualImportKwh,
    exportKwh: state.manualExportKwh,
    vAvg: 230,
    iSum: current.reduce((sum, a) => sum + a, 0),
    iAvg: current.reduce((sum, a) => sum + a, 0) / 3,
    vll: voltage.map((v) => v * Math.sqrt(3)),
    iN: 0
  };
}

function fmt(value, digits) {
  if (!Number.isFinite(value)) return '–';
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(digits);
  const parts = fixed.split('.');
  const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const body = digits ? grouped + ',' + parts[1] : grouped;
  return negative ? '-' + body : body;
}

function direction(power) {
  if (power > 25) return 'Bezug';
  if (power < -25) return 'Einspeisung';
  return 'ausgeglichen';
}

function phaseText(voltage, current, power) {
  return fmt(voltage, 1) + ' V · ' + fmt(current, 2) + ' A · ' + fmt(power, 0) + ' W';
}

function makeDashboard(state, now) {
  const ageSec = state.lastGoodAt == null ? null : Math.max(0, Math.round((now - state.lastGoodAt) / 1000));
  const stale = !state.manual && !!state.image && (state.huaweiError || (now - state.lastGoodAt) > STALE_AFTER_MS);
  const sdm = state.sdmView;
  const huawei = state.huaweiView;
  const rows = [];
  if (huawei) {
    rows.push({ label: 'Huawei gesamt', value: fmt(huawei.pTotal, 0) + ' W (positiv = Einspeisung)' });
    huawei.v.forEach((volts, idx) => {
      rows.push({ label: 'Huawei L' + (idx + 1), value: phaseText(volts, huawei.i[idx], huawei.pPhase[idx]) });
    });
  }
  if (sdm) {
    rows.push({ label: 'SDM630 gesamt', value: fmt(sdm.pTotal, 0) + ' W (positiv = Bezug)' });
    sdm.v.forEach((volts, idx) => {
      rows.push({ label: 'SDM630 L' + (idx + 1), value: phaseText(volts, sdm.i[idx], sdm.pPhase[idx]) });
    });
    rows.push({ label: 'Frequenz', value: fmt(sdm.freq, 2) + ' Hz' });
    rows.push({ label: 'Import', value: fmt(sdm.importKwh, 2) + ' kWh' });
    rows.push({ label: 'Export', value: fmt(sdm.exportKwh, 2) + ' kWh' });
    rows.push({ label: 'Leistungsfaktor', value: fmt(sdm.pf, 2) });
  }
  let note = '';
  if (!state.image) note = 'Noch kein gültiger Zählerwert. Der SDM630-Slave bleibt auf 0, bis der Huawei Status „normal“ meldet.';
  else if (state.manual) note = 'Handwert ist aktiv. Der Growatt sieht diese Leistung, nicht den Huawei.';
  else if (state.huaweiError) note = state.huaweiError;
  else if (stale) note = 'Huawei-Lesung ist älter als 15 s. Der letzte gültige Wert bleibt stehen.';
  else note = 'Zähler normal' + (ageSec == null ? '' : ', Alter ' + ageSec + ' s') + '.';

  const power = sdm ? sdm.pTotal : null;
  return {
    tone: !sdm ? 'wait' : state.manual ? 'manual' : stale ? 'wait' : power > 25 ? 'import' : power < -25 ? 'export' : 'idle',
    headline: !sdm ? 'Warte auf den Huawei-Zähler' : (state.manual ? 'Handwert · ' : '') + direction(power) + ' · ' + fmt(power, 0) + ' W',
    signed: sdm ? fmt(power, 0) + ' W' : '–',
    rows,
    note
  };
}

function publish(state, sdm, now) {
  state.sdmView = sdm;
  state.image = Array.from(buildImage(sdm));
  state.lastGoodAt = now;
}

function applyHuawei(state, msg) {
  const regs = extractRegisters(msg);
  const decoded = decodeHuawei(regs);
  state.meterStatus = decoded.status;
  state.huaweiView = {
    v: decoded.v,
    i: decoded.i,
    pPhase: decoded.pPhase,
    pTotal: decoded.pTotal,
    freq: decoded.freq,
    importKwh: decoded.importKwh,
    exportKwh: decoded.exportKwh
  };
  if (decoded.status !== 1) {
    state.huaweiError = 'Zählerstatus ' + decoded.status + ' (nicht normal). Der letzte gültige SDM630-Wert bleibt stehen.';
    return;
  }
  state.huaweiError = null;
  state.lastHuaweiRegs = regs.map((n) => n & 0xffff);
  if (!state.manual) publish(state, toSdm(decoded), state._now);
}

function step(rawState, event) {
  const state = Object.assign(emptyState(), rawState || {});
  const now = event.now == null ? Date.now() : event.now;
  state._now = now;

  if (event.kind === 'manualFlag') {
    state.manual = !!event.value;
    if (!state.manual) state.lastManualAt = null;
  } else if (event.kind === 'manualPower') {
    state.manualPower = Number(event.value) || 0;
  } else if (event.kind === 'huawei') {
    try {
      applyHuawei(state, event.msg);
    } catch (err) {
      state.huaweiError = err.message;
    }
  } else if (event.kind === 'huaweiError') {
    state.huaweiError = event.error || 'Lesefehler Huawei';
  }

  if (event.kind === 'manualFlag' && !state.manual && state.lastHuaweiRegs && state.meterStatus === 1 && !state.huaweiError) {
    publish(state, toSdm(decodeHuawei(state.lastHuaweiRegs)), now);
  }

  let write = false;
  if (state.manual) {
    publish(state, manualSdm(state, now), now);
    write = true;
  } else if (event.kind === 'huawei' && state.meterStatus === 1 && !state.huaweiError) {
    write = true;
  } else if (event.kind === 'tick' && state.image) {
    write = true;
  }

  delete state._now;
  state.dashboard = makeDashboard(state, now);
  return { state, write };
}

function crc16(buffer) {
  let crc = 0xffff;
  for (let n = 0; n < buffer.length; n++) {
    crc ^= buffer[n];
    for (let bit = 0; bit < 8; bit++) {
      const lsb = crc & 1;
      crc >>>= 1;
      if (lsb) crc ^= 0xa001;
    }
  }
  return crc & 0xffff;
}

function exceptionFrame(slave, fc, code) {
  const resp = Buffer.alloc(5);
  resp[0] = slave;
  resp[1] = fc | 0x80;
  resp[2] = code;
  const crc = crc16(resp.subarray(0, 3));
  resp[3] = crc & 0xff;
  resp[4] = (crc >> 8) & 0xff;
  return resp;
}

function handleRtuRequest(image, frame) {
  if (!frame || frame.length < 8) return { consume: 0, response: null };
  const crc = crc16(frame.subarray(0, 6));
  const got = frame[6] | (frame[7] << 8);
  if (crc !== got) return { consume: 1, response: null };
  const slave = frame[0];
  const fc = frame[1];
  const address = (frame[2] << 8) | frame[3];
  const quantity = (frame[4] << 8) | frame[5];
  if (slave !== 2) return { consume: 8, response: null };
  if (fc !== 3 && fc !== 4) return { consume: 8, response: exceptionFrame(slave, fc, 1) };
  if (quantity < 1 || quantity > 125) return { consume: 8, response: exceptionFrame(slave, fc, 3) };
  const source = image && image.length ? Buffer.from(image) : Buffer.alloc(IMAGE_REGISTERS * 2);
  const start = address * 2;
  const byteLen = quantity * 2;
  if (start < 0 || start + byteLen > source.length) return { consume: 8, response: exceptionFrame(slave, fc, 2) };
  const resp = Buffer.alloc(3 + byteLen + 2);
  resp[0] = slave;
  resp[1] = fc;
  resp[2] = byteLen;
  source.copy(resp, 3, start, start + byteLen);
  const outCrc = crc16(resp.subarray(0, resp.length - 2));
  resp[resp.length - 2] = outCrc & 0xff;
  resp[resp.length - 1] = (outCrc >> 8) & 0xff;
  return { consume: 8, response: resp };
}

function consumeRtu(pending, chunk, image) {
  let buf = pending && pending.length ? Buffer.concat([Buffer.from(pending), Buffer.from(chunk)]) : Buffer.from(chunk);
  const responses = [];
  while (buf.length >= 8) {
    const result = handleRtuRequest(image, buf);
    if (!result.consume) break;
    buf = buf.subarray(result.consume);
    if (result.response) responses.push(result.response);
  }
  if (buf.length > 64) buf = buf.subarray(buf.length - 64);
  return {
    pending: Array.from(buf),
    response: responses.length ? Buffer.concat(responses) : null
  };
}

function classify(msg) {
  if (msg && msg._session && msg._session.type === 'tcp') return { kind: 'rtu' };
  if (!msg || msg.topic === 'tick') return { kind: 'tick' };
  if (msg.topic === 'manual') {
    return { kind: 'manualFlag', value: msg.payload === true || msg.payload === 'true' || msg.payload === 1 };
  }
  if (msg.topic === 'manualPower') return { kind: 'manualPower', value: Number(msg.payload) };
  return { kind: 'huawei', msg };
}

module.exports = {
  METER_START,
  METER_COUNT,
  IMAGE_REGISTERS,
  STALE_AFTER_MS,
  emptyState,
  extractRegisters,
  decodeHuawei,
  toSdm,
  buildImage,
  readFloat,
  step,
  crc16,
  handleRtuRequest,
  consumeRtu,
  classify,
  makeDashboard
};
