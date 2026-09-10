const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const project = path.resolve(__dirname,'..');
const paragraph = '真实网页内容：我们正在招聘产品经理，负责需求分析、用户研究和产品迭代。岗位要求包括清晰的表达能力和持续学习能力。';
const fixture = `<!doctype html><html lang="zh-CN"><head><title>真实采集测试</title><style>body{font:18px sans-serif;padding:40px}article{max-width:650px}p{line-height:2}.secret{display:none}</style></head><body><nav>导航噪声</nav><article><h1>产品经理岗位</h1><section id="region"><p id="first">${paragraph}</p><p id="second">第二段：联系 hr@example.com 或 13800138000。</p></section>${Array.from({length:5},()=>`<p>${paragraph}</p>`).join('')}<span class="secret">HIDDEN_SECRET</span><textarea>FORM_SECRET</textarea></article><footer>页脚噪声</footer></body></html>`;
(async () => {
  const server = http.createServer((req,res) => {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(),'feige-browser-'));
  const testExtension=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'feige-capture-extension-')),'extension');
  fs.cpSync(path.join(project,'extension'),testExtension,{recursive:true});
  const contentPath=path.join(testExtension,'src/content.js');
  fs.writeFileSync(contentPath,fs.readFileSync(contentPath,'utf8').replace("mode:startedInExtension?'closed':'open'","mode:'open'"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      executablePath: process.env.CHROMIUM_PATH,
      headless:true, viewport:{width:1440,height:960},
      args:[`--disable-extensions-except=${testExtension}`,`--load-extension=${testExtension}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await worker.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({url:url+'*'});
      await activateTab(tab);
    },url);
    assert.equal(await page.locator('#launcher').count(),1);
    const launcher = page.locator('#launcher');
    const initial = await launcher.boundingBox();
    assert.equal(initial.width,39);
    assert.equal(initial.height,39);
    await page.mouse.move(initial.x+20,initial.y+20);
    await page.mouse.down();
    await page.mouse.move(180,240,{steps:8});
    await page.mouse.up();
    assert.equal(await page.locator('#pigeon-panel').isVisible(),false,'Dragging must not open the panel');
    const moved = await launcher.boundingBox();
    assert.ok(Math.abs(moved.x-160)<2 && Math.abs(moved.y-220)<2);
    await page.locator('#launcher').click();
    await page.locator('#close').click();
    assert.deepEqual(await launcher.boundingBox(),moved,'Closing preserves launcher position');
    await page.setViewportSize({width:320,height:200});
    const bounded = await launcher.boundingBox();
    assert.ok(bounded.x>=0 && bounded.y>=0 && bounded.x+39<=320 && bounded.y+39<=200);
    await page.setViewportSize({width:1440,height:960});
    await page.locator('#launcher').click();
    assert.equal(await page.locator('#editor').inputValue(),'');
    await page.locator('#first').click({clickCount:3});
    await page.locator('#pick').click();
    assert.match(await page.locator('#editor').inputValue(),/负责需求分析/);
    await page.locator('#clear').click();
    async function select(selector) {
      await page.evaluate(selector => {
        const range = document.createRange(); range.selectNodeContents(document.querySelector(selector));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        document.querySelector(selector).dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      },selector);
      await page.locator('#pick').waitFor({state:'visible'});
      await page.locator('#pick').click();
    }
    await select('#first');
    assert.equal(await page.locator('#editor').inputValue(),paragraph);
    await select('#second');
    assert.equal(await page.locator('#editor').inputValue(),paragraph);
    await page.locator('#append').click();
    assert.match(await page.locator('#editor').inputValue(),/hr@example.com/);
    await page.locator('#redact').click();
    assert.doesNotMatch(await page.locator('#editor').inputValue(),/hr@example.com|13800138000/);
    await page.locator('[data-mode="region"]').click();
    await page.locator('#first').click();
    await page.locator('#replace').click();
    assert.equal(await page.locator('#editor').inputValue(),paragraph);
    await page.locator('[data-mode="page"]').click();
    await page.locator('#replace').click();
    const body = await page.locator('#editor').inputValue();
    assert.match(body,/需求分析/);
    assert.doesNotMatch(body,/HIDDEN_SECRET|FORM_SECRET|发送给 Agent|导航噪声/);
    await page.locator('#editor').fill('最终编辑内容');
    const [download] = await Promise.all([page.waitForEvent('download'),page.locator('#download').click()]);
    const exported = fs.readFileSync(await download.path(),'utf8');
    assert.match(exported,/最终编辑内容/);
    assert.doesNotMatch(exported,/hr@example.com|13800138000/);
    await page.locator('#close').click(); await page.locator('#launcher').click();
    assert.equal(await page.locator('#editor').inputValue(),'最终编辑内容');
    await worker.evaluate(async (url) => {const [tab] = await chrome.tabs.query({url:url+'*'}); await activateTab(tab);},url);
    assert.equal(await page.locator('#launcher').count(),1);
    fs.mkdirSync(path.join(project,'evaluations'),{recursive:true});
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:900});
      if (!await page.locator('#pigeon-panel').isVisible()) await page.locator('#launcher').click();
      const box = await page.locator('#pigeon-panel').boundingBox();
      assert.ok(box.x >= 0 && box.x+box.width <= width);
      await page.screenshot({path:path.join(project,`evaluations/capture-${width}.png`)});
    }
    assert.deepEqual(errors,[]);
    const demo = await context.newPage();
    await demo.goto(require('node:url').pathToFileURL(path.join(project,'preview/capture.html')).href);
    await demo.locator('#launcher').click();
    await demo.locator('[data-mode="page"]').click();
    assert.match(await demo.locator('#editor').inputValue(),/用户研究/);
    assert.equal(await demo.locator('#send').isDisabled(),true);
    await demo.screenshot({path:path.join(project,'evaluations/capture-demo.png')});
    console.log('PASS real extension: selection, append/replace, region, Readability, hidden/form/UI exclusion, edited export, draft reopen, idempotent activation, 3 viewports.');
    console.log('PASS local capture demo: real DOM extraction, no mocked selection, send disabled.');
  } finally { if (context) await context.close(); await new Promise(resolve=>server.close(resolve)); }
})().catch(error => {console.error(error);process.exitCode=1;});
