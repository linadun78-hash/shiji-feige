(function (root) {
  const LIMIT = 100000;
  function clean(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('EMPTY');
    if (text.length > LIMIT) throw new Error('TOO_LONG');
    return text.trim();
  }
  function merge(draft, incoming, action) {
    return clean(action === 'append' && draft.trim() ? `${draft}\n\n${clean(incoming)}` : incoming);
  }
  function envelope({text, url, title, mode = 'selection', capturedAt = new Date().toISOString()}) {
    const parsed = new URL(url);
    if (!['https:', 'http:', 'file:'].includes(parsed.protocol)) throw new Error('UNSUPPORTED_URL');
    const approved = clean(text);
    return {
      schema_version:'1.0',
      source:{site:parsed.hostname || 'local-file', url, title:title || parsed.hostname || '本地页面', captured_at:capturedAt},
      selection:{mode, heading:'', text:approved},
      content:{format:'markdown', text:approved, blocks:[]},
      privacy:{redacted_fields:[]}
    };
  }
  function redact(text) {
    return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已隐藏]').replace(/\b1[3-9]\d{9}\b/g, '[手机号已隐藏]');
  }
  const api = {clean, merge, envelope, redact, LIMIT};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FeigeCapture = api;
})(globalThis);
