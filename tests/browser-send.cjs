const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {once} = require('node:events');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = path.resolve(__dirname, '..');
const port = Number(process.env.FEIGE_TEST_PORT || 8766);
assert.ok(Number.isInteger(port) && port>0 && port<65536);
const base = `http://127.0.0.1:${port}`;
const python = process.env.PYTHON_PATH || 'python';

(async () => {
  // Never run destructive test requests against an existing user service.
  const probe = net.createServer();
  await new Promise((resolve,reject) => {probe.once('error',reject);probe.listen(port,'127.0.0.1',resolve);});
  await new Promise(resolve => probe.close(resolve));
  const testExtension = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'feige-extension-')),'extension');
  fs.cpSync(path.join(project,'extension'),testExtension,{recursive:true});
  // DOM locator coverage uses an open root only in this temporary test copy.
  // browser-isolation.cjs separately exercises the unmodified closed root.
  const contentPath=path.join(testExtension,'src/content.js');
  fs.writeFileSync(contentPath,fs.readFileSync(contentPath,'utf8').replace("mode:startedInExtension?'closed':'open'","mode:'open'"));
  const backgroundPath=path.join(testExtension,'src/background.js');
  fs.writeFileSync(backgroundPath,fs.readFileSync(backgroundPath,'utf8').replace('http://127.0.0.1:8766',base));
  const backend = spawn(python,['-m','uvicorn','server.app:app','--host','127.0.0.1','--port',String(port)],{cwd:project,windowsHide:true,stdio:'ignore'});
  let startError;
  backend.on('error',error => {startError=error;});
  let browser;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'feige-send-'));
  const fixture = http.createServer((req,res) => {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="zh-CN"><head><title>${req.url==='/second'?'岗位要求 B':'岗位介绍 A'}</title><style>body{padding:80px 40px;font:18px/1.8 sans-serif}article{max-width:640px}</style></head><body><article><p id="text">${req.url==='/second'?'需要产品规划、用户研究和清晰的沟通能力。':'Original private hr@example.com 13800138000'}</p></article></body></html>`);
  });
  try {
    let healthy = false;
    for (let attempt=0;attempt<50;attempt++) {
      if (startError) throw startError;
      assert.equal(backend.exitCode,null,'Test backend stopped unexpectedly');
      try {healthy=(await fetch(base+'/health')).ok;} catch {}
      if(healthy)break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(healthy,'Test backend did not start');
    assert.equal((await fetch(base+'/v1/contexts/latest')).status,404);
    await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
    const url=`http://127.0.0.1:${fixture.address().port}/`;
    browser=await chromium.launchPersistentContext(profile,{
      executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1440,height:960},
      args:[`--disable-extensions-except=${testExtension}`,`--load-extension=${testExtension}`]
    });
    const worker=browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    console.log('Browser:',await worker.evaluate(()=>navigator.userAgent));
    assert.equal((await worker.evaluate(()=>loadCollection())).items.length,0);
    const errors=[];
    const activate=async page=>{
      await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await activateTab(tab);},page.url());
    };
    const page=await browser.newPage();
    page.on('pageerror',error=>{errors.push(error.message);console.error('Page error:',error.message);});
    await page.goto(url);
    await activate(page);
    await page.locator('#text').click({clickCount:3});
    await page.locator('#pick').click();
    await page.locator('#editor').fill('Approved hr@example.com 13800138000');
    await page.locator('#redact').click();
    const approved=await page.locator('#editor').inputValue();
    assert.doesNotMatch(approved,/hr@example.com|13800138000/);
    assert.equal((await fetch(base+'/v1/contexts/latest')).status,404,'Draft leaked before approval');
    assert.equal(await page.locator('#agent-handoff').isVisible(),false);
    await page.locator('#save-item').click();
    assert.equal(await page.locator('#send').isDisabled(),true,'Incomplete purpose must block send');
    await page.getByRole('button',{name:'编辑材料',exact:true}).click();
    await page.locator('#purpose').fill('判断岗位适合度');
    await page.locator('#preset').selectOption('explain');
    assert.match(await page.locator('#instruction').inputValue(),/易懂的例子/);
    await page.locator('#instruction').fill('列出岗位亮点与信息缺口，不虚构我的经历。');
    assert.equal(await page.locator('#preset').inputValue(),'custom');
    await page.locator('#item-language').selectOption('en');
    await page.locator('#save-item').click();
    const page2=await browser.newPage();
    page2.on('pageerror',error=>errors.push(error.message));
    await page2.goto(url+'second');await activate(page2);
    await page2.locator('#text').click({clickCount:3});await page2.locator('#pick').click();
    await page2.locator('#purpose').fill('确定需要准备哪些案例');
    await page2.locator('#preset').selectOption('actions');
    await page2.locator('#save-item').click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#collection-count').textContent==='2');
    await page2.locator('.collection-row').nth(1).getByRole('button',{name:'上移',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('.collection-row').textContent.includes('岗位要求 B'));

    // Keep an unsaved edit in one tab while the other saves a newer revision.
    await page.locator('.collection-row').nth(1).getByRole('button',{name:'编辑材料',exact:true}).click();
    await page.locator('#purpose').fill('未保存的旧版本');
    await page2.locator('.collection-row').nth(1).getByRole('button',{name:'编辑材料',exact:true}).click();
    await page2.locator('#purpose').fill('比较岗位与我的项目经验');
    await page2.locator('#save-item').click();
    await page.locator('#save-item').click();
    assert.match(await page.locator('#notice').textContent(),/其他页面更新/);
    assert.equal(await page.locator('#purpose').inputValue(),'未保存的旧版本');
    await page.locator('#clear').click();
    await page.locator('[data-view="collection"]').click();
    await page.locator('.collection-row').nth(1).getByRole('button',{name:'编辑材料',exact:true}).click();
    assert.equal(await page.locator('#purpose').inputValue(),'比较岗位与我的项目经验');
    await page2.locator('.collection-row').nth(1).getByRole('button',{name:'编辑材料',exact:true}).click();
    await page2.locator('#purpose').fill('判断岗位适合度并比较我的项目经验');
    await page2.locator('#save-item').click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#purpose').value==='判断岗位适合度并比较我的项目经验');
    await page.locator('[data-view="collection"]').click();
    await page.locator('#batch-language').selectOption('en');
    await page2.locator('#batch-language').selectOption('bilingual');
    await page2.locator('#overall').fill('分别回答后，归纳申请前需要补充的材料。');
    await page2.locator('#save-settings').click();
    await page.locator('#save-settings').click();
    assert.match(await page.locator('#notice').textContent(),/预设未保存/);
    await page.locator('#reset-settings').click();
    assert.equal(await page.locator('#batch-language').inputValue(),'bilingual');

    // Reference-only material may omit a purpose; unchecked material is not transmitted.
    await page2.locator('#recapture').click();
    await page2.locator('#text').click({clickCount:3});await page2.locator('#pick').click();
    await page2.locator('#reference').check();await page2.locator('#save-item').click();
    await page2.locator('.collection-row').nth(2).locator('input[type="checkbox"]').uncheck();
    await page.reload();await activate(page);await page.locator('#launcher').click();
    await page.locator('[data-view="collection"]').click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#collection-count').textContent==='3');
    await page.locator('.collection-row').nth(0).locator('input[type="checkbox"]').uncheck();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelectorAll('.collection-heading label span')[1].textContent.startsWith('1.'));
    await page.locator('.collection-row').nth(0).locator('input[type="checkbox"]').check();
    assert.equal(await page.locator('#batch-language').inputValue(),'bilingual');
    const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#export-batch').click()]);
    const exported=fs.readFileSync(await download.path(),'utf8');
    assert.match(exported,/判断岗位适合度并比较我的项目经验/);assert.match(exported,/确定需要准备哪些案例/);
    assert.match(exported,/用户任务要求/);
    assert.equal((await fetch(base+'/v1/contexts/latest')).status,404,'Collection leaked before send');
    await page.bringToFront();
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#batch-language').scrollIntoViewIfNeeded();
      const overflow=await page.locator('#collection-view').evaluate(node=>node.scrollWidth>node.clientWidth);
      assert.equal(overflow,false);
      await page.screenshot({path:path.join(project,`evaluations/task-collection-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:960});
    await page.locator('#send').click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#draft-state').textContent.includes('等待 MCP'));
    const saved=(await (await fetch(base+'/v1/contexts/latest')).json()).data;
    assert.equal(saved.context.kind,'task_batch');
    assert.equal(saved.context.items.length,2);
    assert.equal(saved.context.items[0].source.url,url+'second');
    assert.equal(saved.context.items[0].purpose,'确定需要准备哪些案例');
    assert.equal(saved.context.items[0].response_language,'bilingual');
    assert.equal(saved.context.items[1].content,approved);
    assert.equal(saved.context.items[1].source.url,url);
    assert.equal(saved.context.items[1].purpose,'判断岗位适合度并比较我的项目经验');
    assert.equal(saved.context.items[1].instruction,'列出岗位亮点与信息缺口，不虚构我的经历。');
    assert.equal(saved.context.items[1].response_language,'en');
    assert.equal(saved.context.overall_instruction,'分别回答后，归纳申请前需要补充的材料。');
    await page.locator('#send').click();
    await page.waitForFunction(()=>!document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#send').disabled);
    assert.equal((await (await fetch(base+'/v1/contexts/latest')).json()).data.context_id,saved.context_id,'Repeated send should reuse the same snapshot');
    await page.locator('#agent-handoff').waitFor({state:'visible'});
    const prompt=await page.locator('#agent-prompt').inputValue();
    assert.ok(prompt.includes(JSON.stringify({context_id:saved.context_id})));
    assert.match(prompt,/feige.*get_selected_context/);
    assert.match(prompt,/purpose.*instruction.*response_language/);
    assert.doesNotMatch(prompt,/hr@example.com|13800138000/);
    if (process.env.FEIGE_TEST_RELOAD === '1') {
      await worker.evaluate(() => {setTimeout(()=>chrome.runtime.reload(),50);});
      await page.locator('#settings').click();
      await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#connection').textContent==='未连接',null,{timeout:15000});
      await page.locator('#check').click();
      const detail=await page.locator('#bridge-detail').textContent();
      console.log('Reload connection detail:',detail);
      assert.match(detail,/扩展.*刷新网页/);
      assert.doesNotMatch(detail,/练习页/);
      assert.match(await page.locator('#draft-state').textContent(),/曾保存.*无法核验/);
      assert.equal(await page.locator('#collection-count').textContent(),'3');
      assert.equal(await page.locator('#send').isDisabled(),true);
      assert.equal((await (await fetch(base+'/v1/contexts/latest')).json()).data.context_id,saved.context_id);
      await page.locator('#connection-notice').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(project,'evaluations/extension-reloaded.png')});
      console.log('PASS actual extension reload: invalidated context is not a practice page, saved status unverified, draft preserved, backend snapshot unaffected.');
      return;
    }
    await browser.grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
    await page.locator('#copy-prompt').click();
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),prompt);
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:960});
      await page.locator('#agent-handoff').scrollIntoViewIfNeeded();
      const box=await page.locator('#agent-prompt').boundingBox();
      assert.ok(box.x>=0 && box.x+box.width<=width);
      fs.mkdirSync(path.join(project,'evaluations'),{recursive:true});
      await page.screenshot({path:path.join(project,`evaluations/agent-prompt-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:960});
    const result=await promisify(execFile)(python,['tests/mcp_read.py',base+'/mcp',saved.context_id],{cwd:project,timeout:15000,windowsHide:true});
    assert.deepEqual(JSON.parse(result.stdout).data.context.items,saved.context.items);
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#draft-state').textContent==='MCP 已读取');
    fs.mkdirSync(path.join(project,'evaluations'),{recursive:true});
    await page.screenshot({path:path.join(project,'evaluations/send-mcp-read.png')});
    await page.locator('.collection-row').nth(1).getByRole('button',{name:'编辑材料',exact:true}).click();
    for(const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#save-item').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.task-fields').evaluate(node=>node.scrollWidth>node.clientWidth),false);
      await page.screenshot({path:path.join(project,`evaluations/task-fields-${width}.png`)});
    }
    await page.setViewportSize({width:1440,height:960});
    await page.locator('#editor').fill('Revised draft not submitted');
    assert.equal(await page.locator('#send').isDisabled(),true);
    await page.locator('#save-item').click();
    await page.locator('#agent-handoff').waitFor({state:'hidden'});
    assert.equal((await (await fetch(base+'/v1/contexts/latest')).json()).data.context.items[1].content,approved);
    const exited=once(backend,'exit');backend.kill();await exited;
    if(!await page.locator('#send').isDisabled())await page.locator('#send').click();
    await page.locator('#check').evaluate(node=>node.click());
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#connection').textContent==='未连接');
    assert.equal(await page.locator('#editor').inputValue(),'Revised draft not submitted');
    await page.reload();await activate(page);await page.locator('#launcher').click();await page.locator('[data-view="collection"]').click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelector('#collection-count').textContent==='3');
    assert.match(await page.locator('.collection-row').nth(1).textContent(),/Revised draft not submitted/);
    await page.locator('.collection-row').nth(2).getByRole('button',{name:'移除材料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#shiji-feige-root').shadowRoot.querySelectorAll('.collection-row').length===2);
    assert.deepEqual(errors,[]);
    await browser.close();
    browser=await chromium.launchPersistentContext(profile,{
      executablePath:process.env.CHROMIUM_PATH,headless:true,viewport:{width:1440,height:960},
      args:[`--disable-extensions-except=${testExtension}`,`--load-extension=${testExtension}`]
    });
    const restartedWorker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
    const restored=await restartedWorker.evaluate(()=>loadCollection());
    assert.equal(restored.items.length,2);
    assert.equal(restored.items[1].content,'Revised draft not submitted');
    assert.equal(restored.settings.language,'bilingual');
    console.log('PASS 2-page collection, edit/template/language binding, concurrent edit/settings conflicts, persisted refresh, reference and selection, reorder/remove, Markdown export, batch HTTP/MCP and receipt, idempotent retry, no preapproval transfer, offline persistence, 3 viewports.');
    console.log('PASS full browser restart: collection and sending presets retained.');
  } catch(error) {
    if(browser)for(const page of browser.pages()) {
      console.error('Failure page:',page.url(),await page.locator('#shiji-feige-root').evaluateAll(nodes=>nodes.map(node=>({notice:node.shadowRoot.querySelector('#notice').textContent,connection:node.shadowRoot.querySelector('#connection-notice').textContent,body:node.shadowRoot.querySelector('#pigeon-panel').innerText}))).catch(()=>[]));
    }
    if(browser)for(const worker of browser.serviceWorkers())console.error('Worker collection:',await worker.evaluate(async()=>{try{return await loadCollection();}catch(error){return error.stack;}}));
    throw error;
  } finally {
    if(browser)await browser.close();
    if(backend.exitCode===null && !backend.killed){const exited=once(backend,'exit');backend.kill();await exited;}
    if(fixture.listening)await new Promise(resolve=>fixture.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
