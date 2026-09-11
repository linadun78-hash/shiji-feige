const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const project=process.env.FEIGE_E2E_PROJECT;
const output=process.env.FEIGE_E2E_OUTPUT;
const base=`http://127.0.0.1:${process.env.FEIGE_E2E_PORT}`;
const healthy=async()=>{try{return (await fetch(base+'/health')).ok;}catch{return false;}};
const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,250));}throw Error('Timed out');};
(async()=>{
  let browser;
  const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<title>Feige auto-start test</title><p id="text">Synthetic webpage material for native start verification.</p>');});
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  try {
    assert.equal(await healthy(),false,'Test service must begin stopped');
    browser=await chromium.launchPersistentContext(path.join(output,'browser-profile'),{
      executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1200,height:900},
      args:[`--disable-extensions-except=${path.join(project,'extension')}`,`--load-extension=${path.join(project,'extension')}`]
    });
    const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${fixture.address().port}`);
    await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await activateTab(tab);},page.url());
    await wait(healthy);
    const stateFile=path.join(process.env.FEIGE_E2E_STATE,'instance.json');
    const instance=JSON.parse(fs.readFileSync(stateFile)).instance;
    await page.locator('#launcher').click();
    await page.locator('#connection').filter({hasText:'服务可用'}).waitFor();
    await worker.evaluate(()=>Promise.all([wakeBridge(),wakeBridge()]));
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).instance,instance);
    await page.screenshot({path:path.join(output,'panel-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'panel-mobile.png')});
    await promisify(execFile)(process.env.PYTHON_PATH,['-m','server.desktop','stop'],{cwd:project,windowsHide:true});
    assert.equal(await healthy(),false);
    // Hold a read-only health request while the user explicitly requests a start.
    await worker.evaluate(()=>{
      globalThis.originalFeigeCheck=checkBridge;
      globalThis.feigeHealthHeld=false;
      let first=true;
      checkBridge=async()=>{
        if(first){first=false;globalThis.feigeHealthHeld=true;await new Promise(resolve=>globalThis.releaseFeigeHealth=resolve);throw Error('BRIDGE_OFFLINE');}
        return originalFeigeCheck();
      };
    });
    await wait(()=>worker.evaluate(()=>globalThis.feigeHealthHeld));
    await page.locator('#details').evaluate(node=>node.open=true);
    await page.locator('#check').click();
    await worker.evaluate(()=>releaseFeigeHealth());
    await wait(healthy);
    await worker.evaluate(()=>checkBridge=originalFeigeCheck);
    assert.notEqual(JSON.parse(fs.readFileSync(stateFile)).instance,instance);
    const manager=await browser.newPage();
    await manager.goto('chrome://extensions/');
    await manager.locator('extensions-item').first().waitFor();
    await manager.getByText('拾集 · 飞鸽',{exact:true}).waitFor();
    await manager.screenshot({path:path.join(output,'extensions-manager.png')});
    const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
    assert.equal(manifest.version,'0.4.0');
    const icon=await worker.evaluate(async()=>{
      const bitmap=await createImageBitmap(await (await fetch(chrome.runtime.getURL('icons/128.png'))).blob());
      return {width:bitmap.width,height:bitmap.height};
    });
    assert.deepEqual(icon,{width:128,height:128});
    await browser.close();browser=null;
    assert.equal(await healthy(),true,'Native service must survive browser exit');
    console.log('PASS: real native wake-up, Unicode install path, reuse, stop/restart, icon, browser exit survival');
  } finally {await browser?.close();await new Promise(r=>fixture.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
