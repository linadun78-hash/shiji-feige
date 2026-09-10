(function (root) {
  const BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|H[1-6]|LI|UL|OL|BLOCKQUOTE|PRE|TR|BR)$/;
  const EXCLUDE = 'script,style,noscript,template,iframe,canvas,svg,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],#shiji-feige-root';
  function strip(original, clone, budget = {left:12000}) {
    const children = Array.from(original.children || []);
    const copies = Array.from(clone.children || []);
    children.forEach((child, index) => {
      if (--budget.left < 0) throw new Error('PAGE_TOO_COMPLEX');
      const style = getComputedStyle(child);
      if (child.matches(EXCLUDE) || style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') copies[index].remove();
      else strip(child, copies[index], budget);
    });
    return clone;
  }
  function textOf(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
    const content = Array.from(node.childNodes).map(textOf).join('');
    return BLOCK.test(node.nodeName) ? `\n${content}\n` : content;
  }
  function normalize(text) { return text.replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim(); }
  function region(element) {
    if (!element || element.closest(EXCLUDE)) throw new Error('EMPTY');
    return FeigeCapture.clean(normalize(textOf(strip(element, element.cloneNode(true)))));
  }
  function selected() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const parent = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (parent?.closest(EXCLUDE)) return null;
    // Selection.toString includes only the user's range; omit form/control selections.
    const text = FeigeCapture.clean(selection.toString());
    return {text, rect:range.getBoundingClientRect()};
  }
  function page() {
    const copy = document.cloneNode(true);
    strip(document.documentElement, copy.documentElement);
    const article = new Readability(copy, {charThreshold:80, maxElemsToParse:12000}).parse();
    if (!article?.content) throw new Error('NO_ARTICLE');
    const template = document.createElement('template');
    template.innerHTML = article.content;
    return FeigeCapture.clean(normalize(textOf(template.content)));
  }
  root.FeigeExtract = {selected, region, page, EXCLUDE};
})(globalThis);
