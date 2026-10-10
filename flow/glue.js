const event = sdm.classify(msg);
const now = Date.now();

if (event.kind === 'rtu') {
  const sessions = context.get('sessions') || {};
  const id = msg._session.id || 'tcp';
  const state = flow.get('state') || {};
  const chunk = Buffer.isBuffer(msg.payload) ? msg.payload : Buffer.from(msg.payload || []);
  const out = sdm.consumeRtu(sessions[id], chunk, state.image);
  sessions[id] = out.pending;
  context.set('sessions', sessions);
  if (!out.response) return null;
  msg.payload = out.response;
  return [null, null, msg];
}

const result = sdm.step(flow.get('state'), Object.assign({ now }, event));
flow.set('state', result.state);
const dash = result.state.dashboard || {};
const power = result.state.sdmView ? result.state.sdmView.pTotal : null;
if (result.state.manual) {
  node.status({ fill: 'blue', shape: 'dot', text: 'Handwert ' + (dash.signed || '') });
} else if (!result.state.image) {
  node.status({ fill: 'yellow', shape: 'ring', text: 'warte auf Huawei' });
} else if (result.state.huaweiError) {
  node.status({ fill: 'yellow', shape: 'dot', text: 'hält letzten Wert' });
} else {
  node.status({ fill: 'green', shape: 'dot', text: (power == null ? '0' : String(Math.round(power))) + ' W' });
}

if (!result.write || !result.state.image) {
  return [null, { payload: dash }, null];
}

const bytes = result.state.image.slice();
const write = (register) => ({
  payload: { value: bytes.slice(), register, address: 0, disableMsgOutput: 1 }
});
return [[write('input'), write('holding')], { payload: dash }, null];
