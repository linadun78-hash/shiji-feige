const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function create(options) {
  const file = path.join(__dirname, '../extension/src/bridge-core.js');
  assert.ok(fs.existsSync(file), 'Native wake-up controller is not implemented');
  return require(file).create(options);
}
test('offline concurrent requests launch once and verify HTTP readiness', async () => {
  let online = false, starts = 0, checks = 0;
  const bridge = create({check: async () => {checks++; if(!online) throw Error('BRIDGE_OFFLINE'); return {service:'feige'};},
    launch: async () => {starts++; await new Promise(r=>setTimeout(r,10)); online=true; return {ok:true};}});
  await Promise.all([bridge.ensure(),bridge.ensure(),bridge.ensure()]);
  assert.equal(starts,1); assert.ok(checks>=2);
  await bridge.ensure(); assert.equal(starts,1);
});
test('port collision never invokes native host', async () => {
  let starts = 0;
  const bridge = create({check:async()=>{throw Error('WRONG_SERVICE');},launch:async()=>{starts++;}});
  await assert.rejects(bridge.ensure(),/WRONG_SERVICE/);assert.equal(starts,0);
});
test('missing registration and unsuccessful launch preserve actionable errors', async () => {
  const bridge = create({check:async()=>{throw Error('BRIDGE_OFFLINE');},launch:async()=>{throw Error('native host not found');}});
  await assert.rejects(bridge.ensure(),/NATIVE_UNAVAILABLE/);
  const failed = create({check:async()=>{throw Error('BRIDGE_OFFLINE');},launch:async()=>({ok:false,error:'PORT_OCCUPIED'})});
  await assert.rejects(failed.ensure(),/PORT_OCCUPIED/);
  const unready = create({check:async()=>{throw Error('BRIDGE_OFFLINE');},launch:async()=>({ok:true})});
  await assert.rejects(unready.ensure(),/START_FAILED/);
});

test('explicit start survives an in-flight read-only health check', async () => {
  const source=fs.readFileSync(path.join(__dirname,'../extension/src/content.js'),'utf8');
  const checkSource=source.slice(source.indexOf('  async function check('),source.indexOf('  async function checkReceipt('));
  let release;const calls=[];
  const context=vm.createContext({Boolean,request:async message=>{
    calls.push(message.type);
    if(calls.length===1)await new Promise(resolve=>release=resolve);
    return {ok:true};
  },$:()=>({classList:{remove(){}},textContent:'',disabled:false}),update(){},checkReceipt:async()=>{},disconnected(){}});
  vm.runInContext('let checkBusy=false, startQueued=false, connected=false;'+checkSource+';globalThis.check=check;',context);
  const active=context.check();await context.check(true);release();await active;
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,['FEIGE_HEALTH','FEIGE_START']);
});
