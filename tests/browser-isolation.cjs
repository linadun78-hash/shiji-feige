const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const project=path.resolve(__dirname,'..');

(async()=>{
  const fixture=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>Isolation ${req.url}</title></head><body style="padding:80px 40px"><p id="text">${req.url==='/a'?'SOURCE_A_ONLY':'SOURCE_B_ONLY'}</p></body></html>`);
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${fixture.address().port}`;
  let browser;
  try {
    browser=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'feige-isolation-')),{
      executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1440,height:960},
      args:[`--disable-extensions-except=${path.join(project,'extension')}`,`--load-extension=${path.join(project,'extension')}`]
    });
    const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
    const activate=page=>worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await activateTab(tab);},page.url());
    // Access is via the privileged extension API, not a root exposed to the site.
    const ui=(page,selector,action='read',value='')=>worker.evaluate(async args=>{
      const [tab]=await chrome.tabs.query({url:args.url});
      const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[args],func:({selector,action,value})=>{
        const root=chrome.dom.openOrClosedShadowRoot(document.getElementById('shiji-feige-root'));
        const node=root.querySelector(selector);
        if(action==='click')node.click();
        if(action==='fill'){node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));}
        if(action==='scroll')node.scrollIntoView({block:'center'});
        return {text:node.textContent,value:node.value,disabled:node.disabled,hidden:node.hidden,mode:root.mode};
      }});
      return result.result;
    },{url:page.url(),selector,action,value});
    const wait=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('UI state timed out');};
    const pageA=await browser.newPage();await pageA.goto(base+'/a');await activate(pageA);
    await pageA.locator('#text').click({clickCount:3});
    await wait(async()=>!(await ui(pageA,'#selection-tools')).hidden);
    await ui(pageA,'#pick','click');
    await ui(pageA,'#purpose','fill','PRIVATE_USER_PURPOSE');
    await ui(pageA,'#instruction','fill','Summarize for my decision');
    await wait(async()=>!(await ui(pageA,'#save-item')).disabled);
    await ui(pageA,'#save-item','click');
    await wait(async()=>(await ui(pageA,'#collection-count')).text==='1');
    const pageB=await browser.newPage();await pageB.goto(base+'/b');await activate(pageB);
    await ui(pageB,'#launcher','click');await ui(pageB,'[data-view="collection"]','click');
    await wait(async()=>(await ui(pageB,'#collection-count')).text==='1');
    assert.match((await ui(pageB,'#collection-list')).text,/SOURCE_A_ONLY/);
    assert.match((await ui(pageB,'#collection-list')).text,/PRIVATE_USER_PURPOSE/);
    assert.equal((await ui(pageB,'#collection-list')).mode,'closed');
    for(const page of [pageA,pageB]) {
      const hostState=await page.evaluate(()=>({root:document.querySelector('#shiji-feige-root').shadowRoot,text:document.body.textContent,html:document.documentElement.outerHTML}));
      assert.equal(hostState.root,null);
      assert.doesNotMatch(hostState.text,/PRIVATE_USER_PURPOSE/);
      assert.doesNotMatch(hostState.html,/PRIVATE_USER_PURPOSE/);
    }
    assert.doesNotMatch(await pageB.locator('body').textContent(),/SOURCE_A_ONLY/);
    await ui(pageB,'[aria-label="编辑材料"]','click');
    assert.equal((await ui(pageB,'#purpose')).value,'PRIVATE_USER_PURPOSE');
    await ui(pageB,'#purpose','scroll');
    await pageB.bringToFront();
    await pageB.screenshot({path:path.join(project,'evaluations/closed-root.png'),animations:'disabled'});
    console.log('PASS unmodified extension closed root: selection, purpose/instruction, shared collection, edit and screenshot; host page cannot read cross-source material through DOM or shadowRoot.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>fixture.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
