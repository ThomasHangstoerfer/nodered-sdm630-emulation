'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const ModbusRTU = require('modbus-serial');
const sdm = require('../lib/sdm630');

const root = path.join(__dirname, '..');
const userDir = path.join(root, '.nodered-test');

function execNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { out += chunk; });
    child.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(script + ' exited ' + code + '\n' + out));
    });
  });
}

function spawnService(script) {
  const child = spawn(process.execPath, [script], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  child.log = () => log;
  return child;
}

function stop(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
}

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: 15022, method, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')));
    });
    req.on('error', reject);
    if (body) req.end(JSON.stringify(body));
    else req.end();
  });
}

function floatFromRegisters(data) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(data[0], 0);
  buf.writeUInt16BE(data[1], 2);
  return buf.readFloatBE(0);
}

async function readPower(fc) {
  const client = new ModbusRTU();
  await client.connectTCP('127.0.0.1', { port: 1502 });
  client.setID(2);
  client.setTimeout(2000);
  const response = fc === 3
    ? await client.readHoldingRegisters(0x0034, 2)
    : await client.readInputRegisters(0x0034, 2);
  client.close(() => {});
  return floatFromRegisters(response.data);
}

async function waitForPower(expected) {
  const deadline = Date.now() + 25000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await readPower(4);
      if (Math.abs(last - expected) < 1) return last;
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Leistung ' + expected + ' nicht erreicht, zuletzt ' + last);
}

function rtuRead(slave, fc, address, quantity) {
  const frame = Buffer.alloc(8);
  frame[0] = slave;
  frame[1] = fc;
  frame.writeUInt16BE(address, 2);
  frame.writeUInt16BE(quantity, 4);
  const crc = sdm.crc16(frame.subarray(0, 6));
  frame[6] = crc & 0xff;
  frame[7] = crc >> 8;
  return new Promise((resolve, reject) => {
    const socket = net.connect(1503, '127.0.0.1');
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks));
    }, 600);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(frame));
  });
}

test('Dummy, Vorzeichen und beide Growatt-Zugänge', async () => {
  await execNode(path.join(root, 'scripts', 'prepare-test.js'));
  const dummy = spawnService(path.join(root, 'scripts', 'huawei-dummy.js'));
  const red = spawn(process.execPath, [path.join(root, 'node_modules', 'node-red', 'red.js'), '--userDir', userDir], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let redLog = '';
  red.stdout.on('data', (chunk) => { redLog += chunk; });
  red.stderr.on('data', (chunk) => { redLog += chunk; });
  try {
    const imported = await waitForPower(1500);
    assert.ok(Math.abs(imported - 1500) < 1);
    const holding = await readPower(3);
    assert.ok(Math.abs(holding - 1500) < 1, 'FC03');

    const client = new ModbusRTU();
    await client.connectTCP('127.0.0.1', { port: 1502 });
    client.setID(2);
    client.setTimeout(2000);
    const phases = await client.readInputRegisters(0x000c, 6);
    client.close(() => {});
    assert.ok(Math.abs(floatFromRegisters(phases.data.slice(0, 2)) - 600) < 1);

    await request('POST', '/scenario', { scenario: 'export' });
    const exported = await waitForPower(-2088);
    assert.ok(Math.abs(exported + 2088) < 1);

    const rtu = await rtuRead(2, 4, 0x0034, 2);
    assert.equal(rtu[1], 4);
    assert.ok(Math.abs(rtu.readFloatBE(3) + 2088) < 1);
    const ignored = await rtuRead(1, 4, 0x0034, 2);
    assert.equal(ignored.length, 0);

    await request('POST', '/scenario', { scenario: 'offline' });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const kept = await readPower(4);
    assert.ok(Math.abs(kept + 2088) < 1, 'offline darf nicht auf 0 springen, war ' + kept);
  } catch (err) {
    err.message += '\n--- node-red ---\n' + redLog.slice(-4000) + '\n--- dummy ---\n' + dummy.log().slice(-2000);
    throw err;
  } finally {
    stop(red);
    stop(dummy);
  }
});
