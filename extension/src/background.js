importScripts('collection-core.js', 'bridge-core.js');
const BASE = 'http://127.0.0.1:8766';
const ASSETS = ['vendor/lucide.min.js', 'vendor/Readability.js', 'src/capture-core.js', 'src/collection-core.js', 'src/extract.js', 'src/view-bundle.js', 'src/content.js'];
const COLLECTION_KEY = 'feige.collection.v1';
const bridge = FeigeBridge.create({check:checkBridge, launch:()=>Promise.race([
  chrome.runtime.sendNativeMessage('com.shiji.feige',{action:'start'}),
  new Promise((_,reject)=>setTimeout(()=>reject(Error('START_TIMEOUT')),22000))
])});
let wakeError = null;
async function wakeBridge() {
  try {const result=await bridge.ensure();wakeError=null;return result;}
  catch(error) {wakeError=error.message;throw error;}
}
// Older Chromium builds expose this method only on session storage.
const storageReady = Promise.resolve().then(() => chrome.storage.local.setAccessLevel?.({accessLevel:'TRUSTED_CONTEXTS'}));
let collectionQueue = Promise.resolve();
function serialized(action) {
  const result = collectionQueue.then(action);
  collectionQueue = result.catch(() => {});
  return result;
}
async function loadCollection() {
  await storageReady;
  const data = await chrome.storage.local.get(COLLECTION_KEY);
  return data[COLLECTION_KEY] || FeigeCollection.empty();
}
async function saveCollection(state) {
  await chrome.storage.local.set({[COLLECTION_KEY]:state});
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id,{type:'FEIGE_COLLECTION_CHANGED'})));
}
async function postContext(context) {
  const response = await fetch(`${BASE}/v1/contexts`, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context),
    signal:AbortSignal.timeout(8000),redirect:'error'
  });
  const data = await response.json();
  if (!response.ok || !data.ok || typeof data.data?.context_id !== 'string') throw new Error('SEND_REJECTED');
  return data.data.context_id;
}
async function collectionRequest(message) {
  const state = await loadCollection();
  if (message.type === 'FEIGE_COLLECTION_GET') return {ok:true,state};
  if (message.type === 'FEIGE_COLLECTION_MUTATE') {
    const next = FeigeCollection.reduce(state,message.operation);
    await saveCollection(next);
    return {ok:true,state:next};
  }
  if (message.expectedRevision !== state.revision) throw new Error('CONFLICT');
  const context = FeigeCollection.envelope(state);
  if (context.items.some(item => !/^https?:/.test(item.source.url))) throw new Error('LOCAL_FILE');
  const health = await checkBridge();
  if (!health.schema_versions?.includes('2.0')) throw new Error('OUTDATED_SERVICE');
  const contextId = await postContext(context);
  state.submission = {id:contextId,read:false};
  await saveCollection(state);
  return {ok:true,state,contextId};
}
async function activateTab(tab) {
  try {
    if (!tab.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('UNSUPPORTED');
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:ASSETS});
    void wakeBridge().catch(()=>{});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  } catch {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:'当前页面无法启用；请使用普通网页，本地文件需开启文件访问权限。'});
  }
}
chrome.action.onClicked.addListener(activateTab);
async function checkBridge() {
  let response;
  try {response = await fetch(`${BASE}/health`, {signal:AbortSignal.timeout(2500),redirect:'error'});}
  catch {throw Error('BRIDGE_OFFLINE');}
  let data;
  try {data=await response.json();} catch {throw Error('WRONG_SERVICE');}
  if (!response.ok || data?.data?.service !== 'web-context-agent-bridge') throw new Error('WRONG_SERVICE');
  return data.data;
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const collectionTypes = ['FEIGE_COLLECTION_GET','FEIGE_COLLECTION_MUTATE','FEIGE_BATCH_SEND'];
  if (sender.id !== chrome.runtime.id || !sender.tab || !['FEIGE_START','FEIGE_HEALTH','FEIGE_SEND','FEIGE_RECEIPT',...collectionTypes].includes(message?.type)) return;
  (async () => {
    try {
      if (collectionTypes.includes(message.type)) return reply(await serialized(() => collectionRequest(message)));
      if (message.type === 'FEIGE_START') {await wakeBridge();return reply({ok:true});}
      await checkBridge();
      if (message.type === 'FEIGE_HEALTH') return reply({ok:true});
      if (message.type === 'FEIGE_RECEIPT') {
        if (!/^[a-f0-9-]{36}$/.test(message.contextId || '')) return reply({ok:false});
        const response = await fetch(`${BASE}/v1/contexts/${encodeURIComponent(message.contextId)}/receipt`, {
          signal:AbortSignal.timeout(2500),redirect:'error',cache:'no-store'
        });
        if (response.status === 404) return reply({ok:false,error:'CONTEXT_NOT_FOUND'});
        const data = await response.json();
        return reply({ok:response.ok && data.ok,receipt:data.data});
      }
      reply({ok:true,contextId:await postContext(message.context)});
    } catch (error) {
      if(message.type==='FEIGE_HEALTH'&&error.message==='BRIDGE_OFFLINE'&&wakeError)error=Error(wakeError);
      const known=['NATIVE_UNAVAILABLE','PORT_OCCUPIED','START_TIMEOUT','START_FAILED','SEND_REJECTED','WRONG_SERVICE','OUTDATED_SERVICE','LOCAL_FILE','CONFLICT','EMPTY_COLLECTION','MISSING_PURPOSE','MISSING_INSTRUCTION','INVALID_ITEM','INVALID_LANGUAGE','INVALID_OPERATION','EMPTY','TOO_LONG','UNSUPPORTED_URL','COLLECTION_FULL','BATCH_TOO_LONG'];
      reply({ok:false,error:known.includes(error.message)?error.message:collectionTypes.includes(message.type)&&message.type!=='FEIGE_BATCH_SEND'?'STORAGE_ERROR':'BRIDGE_OFFLINE'});
    }
  })();
  return true;
});
