const test = require('node:test');
const assert = require('node:assert/strict');
const capture = require('../extension/src/capture-core.js');

test('only the edited text is serialized, including duplicate selection field', () => {
  const data = capture.envelope({text:'[邮箱已隐藏]', url:'https://example.com/a', title:'文章', mode:'region'});
  assert.equal(data.selection.text, '[邮箱已隐藏]');
  assert.equal(data.content.text, '[邮箱已隐藏]');
  assert.equal(data.selection.mode, 'region');
});
test('blank input and unsupported URLs are rejected', () => {
  assert.throws(() => capture.envelope({text:' ',url:'https://example.com'}));
  assert.throws(() => capture.envelope({text:'x',url:'chrome://settings'}));
});
test('capture merge preserves draft unless explicitly replaced', () => {
  assert.equal(capture.merge('edited draft','new text','append'), 'edited draft\n\nnew text');
  assert.equal(capture.merge('edited draft','new text','replace'), 'new text');
});
test('oversized content is rejected without silent truncation', () => {
  assert.throws(() => capture.merge('x'.repeat(100000),'x','append'), /TOO_LONG/);
});
test('redaction removes email and phone from export text', () => {
  const text = capture.redact('联系 a@example.com 或 13800138000');
  assert.doesNotMatch(text, /a@example.com|13800138000/);
});
