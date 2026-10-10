'use strict';

const http = require('http');
const ModbusRTU = require('modbus-serial');
const { huaweiBlock, scenarios } = require('../lib/fixtures');

const modbusPort = Number(process.env.HUAWEI_PORT || 15021);
const httpPort = Number(process.env.HUAWEI_HTTP_PORT || 15022);
let name = process.env.SCENARIO || 'import';
if (!scenarios[name]) name = 'import';
let registers = huaweiBlock(scenarios[name]);

function setScenario(next) {
  if (!scenarios[next]) throw new Error('unbekannt: ' + next);
  name = next;
  registers = huaweiBlock(scenarios[next]);
}

const vector = {
  getHoldingRegister(addr) {
    const offset = addr - 37100;
    if (offset < 0 || offset >= registers.length) return 0;
    return registers[offset] & 0xffff;
  }
};

const server = new ModbusRTU.ServerTCP(vector, { host: '0.0.0.0', port: modbusPort });
server.on('initialized', () => {
  console.log('Huawei-Dummy Modbus TCP 0.0.0.0:' + modbusPort + ' Szenario ' + name);
});
server.on('socketError', () => {});

const admin = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/scenario') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ scenario: name }));
    return;
  }
  if (req.method === 'POST' && req.url === '/scenario') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        setScenario(body.scenario);
        console.log('Szenario ' + name);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ scenario: name }));
      } catch (err) {
        res.statusCode = 400;
        res.end(err.message);
      }
    });
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});
admin.listen(httpPort, '127.0.0.1', () => {
  console.log('Huawei-Dummy Steuerung http://127.0.0.1:' + httpPort + '/scenario');
});
