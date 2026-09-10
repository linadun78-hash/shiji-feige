/* Standalone visual prototype: no page capture, storage or network calls. */
lucide.createIcons();
const $ = (selector) => document.querySelector(selector);
const panel = $('#pigeon-panel');
const launcher = $('#launcher');
const editor = $('#editor');
const send = $('#send');
const excerpts = {
  selection: '先保留原文，再提出问题。整理资料时，同时记录来源、语境与时间，可以帮助我们回到信息发生的地方，而不是只剩一个脱离上下文的结论。',
  region: '从一段具体的内容开始\n\n先保留原文，再提出问题。整理资料时，同时记录来源、语境与时间，可以帮助我们回到信息发生的地方，而不是只剩一个脱离上下文的结论。\n\n把想继续研究的内容放在一起，区分事实、判断和待验证的问题。',
  page: '把阅读中的线索，留给下一步思考。\n\n真正有用的信息，往往散落在不同的页面里。一份岗位描述、一段项目经验，或是一条值得追问的建议。\n\n从一段具体的内容开始\n\n先保留原文，再提出问题。同时记录来源、语境与时间。\n\n让来源与内容一起留下\n\n一段文字的价值不只在于它说了什么，还在于它来自哪里。'
};
let mode = 'selection';
let scenario = 'ready';
let timer;
let sending = false;
function notice(text = '', tone = '') {
  $('#notice').textContent = text;
  $('#notice').className = `notice ${tone}`;
  $('#notice').hidden = !text;
}
function update() {
  $('#count').textContent = `${Array.from(editor.value).length} 字`;
  send.disabled = !editor.value.trim() || scenario === 'offline' || sending;
  $('#privacy').hidden = !(/[\w.+-]+@[\w.-]+\.[a-z]+/i.test(editor.value) || /1[3-9]\d{9}/.test(editor.value));
}
function setOpen(open) {
  panel.hidden = !open;
  launcher.hidden = open;
  launcher.setAttribute('aria-expanded', String(open));
  if (open) $('#close').focus(); else launcher.focus();
  if (!open) $('#sample-region').classList.remove('sample-highlight');
}
function applyScenario(value) {
  clearTimeout(timer);
  sending = false;
  scenario = value;
  $('#scenario').value = value;
  editor.value = value === 'empty' ? '' : excerpts[mode];
  if (value === 'privacy') editor.value += '\n\n联系人：林晓\n邮箱：lin@example.com\n电话：13800138000';
  $('#connection').textContent = value === 'offline' ? '未连接' : '已连接';
  $('#connection').classList.toggle('offline', value === 'offline');
  $('#draft-state').textContent = '待确认';
  send.querySelector('span').textContent = '发送给 Agent';
  notice();
  if (value === 'empty') notice('暂无可发送内容');
  if (value === 'offline') notice('本地连接不可用，草稿已保留。');
  if (value === 'error') notice('发送失败，内容已保留。', 'error');
  if (value === 'success') { notice('模拟发送完成，未传输数据。', 'success'); $('#draft-state').textContent = '已确认'; }
  update();
}
launcher.addEventListener('click', () => setOpen(true));
$('#close').addEventListener('click', () => setOpen(false));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !panel.hidden) setOpen(false); });
$('#scenario').addEventListener('change', (event) => { applyScenario(event.target.value); setOpen(true); });
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  $('#source-mode').textContent = { selection:'选区', region:'区域', page:'正文' }[mode];
  $('#sample-region').classList.toggle('sample-highlight', mode === 'region');
  applyScenario(scenario === 'offline' ? 'offline' : 'ready');
}));
editor.addEventListener('input', () => { $('#draft-state').textContent = '已编辑 · 待确认'; notice(); update(); });
$('#redact').addEventListener('click', () => {
  editor.value = editor.value.replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[邮箱已隐藏]').replace(/1[3-9]\d{9}/g, '[手机号已隐藏]');
  $('#draft-state').textContent = '已脱敏 · 待确认'; update();
});
$('#reset').addEventListener('click', () => applyScenario(scenario));
$('#recapture').addEventListener('click', () => { applyScenario(scenario === 'offline' ? 'offline' : 'ready'); editor.focus(); });
$('#settings').addEventListener('click', () => { $('#details').open = !$('#details').open; if ($('#details').open) $('#details').scrollIntoView({block:'nearest'}); });
send.addEventListener('click', () => {
  if (send.disabled) return;
  sending = true; update(); send.querySelector('span').textContent = '发送中…';
  timer = setTimeout(() => { sending = false; notice('模拟发送完成，未传输数据。', 'success'); $('#draft-state').textContent = '已确认'; send.querySelector('span').textContent = '发送给 Agent'; update(); }, 700);
});
applyScenario('ready');
