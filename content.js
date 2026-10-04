// Persian/English Bidi Fixer (RastAI)
//
// دو مشکل جدا از هم باعث به‌هم‌ریختگی می‌شن:
//
// ۱) جهت کل پاراگراف: اکثر سایت‌های چت‌بات پاراگراف‌ها رو با جهت پیش‌فرض LTR
//    رندر می‌کنن. نسخه‌ی قبلی این افزونه از attribute استاندارد dir="auto"
//    استفاده می‌کرد، ولی dir="auto" جهت رو بر اساس "اولین حرف قوی از نظر جهت"
//    تشخیص می‌ده — پس اگه یک پاراگراف فارسی با یک کلمه‌ی انگلیسی شروع بشه
//    (مثلاً "Actorهایی که ...")، مرورگر کل پاراگراف رو به‌اشتباه LTR در نظر
//    می‌گیره و هیچ اتفاقی نمی‌افته. این باگ اصلی نسخه‌ی قبلی بود.
//    راه‌حل نسخه‌ی جدید: تعداد حروف فارسی/عربی رو در برابر حروف لاتین کل متنِ
//    بلوک می‌شماریم؛ اگه اکثریت با فارسیه، dir="rtl" رو صراحتاً (نه auto)
//    ست می‌کنیم — صرف‌نظر از اینکه بلوک با چه کاراکتری شروع می‌شه.
//
// ۲) قطعات انگلیسی/عددی وسط جمله‌ی فارسی: هر قطعه‌ی لاتین رو داخل
//    <bdi dir="ltr"> ایزوله می‌کنیم تا با علائم نگارشی مجاورش قاطی نشه.

(function () {
  'use strict';

  const RTL_RANGE =
    /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  const RTL_RANGE_G =
    /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
  const LTR_LETTER_RE_G = /[A-Za-z]/g;

  // یک "قطعه لاتین": حروف/اعداد انگلیسی به همراه ./-/_/:/@/+/# داخل خودش
  const LATIN_TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9.\-_/:@+#]*/g;

  // تگ‌های بلوکی که خروجی مارک‌داون AI معمولاً توشون رندر می‌شه
  const BLOCK_TAGS = new Set([
    'P', 'LI', 'TD', 'TH', 'DIV', 'BLOCKQUOTE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'DT', 'DD', 'FIGCAPTION', 'SUMMARY'
  ]);
  const BLOCK_CONTAINER_TAGS = new Set([...BLOCK_TAGS, 'UL', 'OL', 'TABLE', 'TR']);

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'BDI'
  ]);

  let enabled = true;
  let observer = null;
  let pending = new Set();
  let debounceTimer = null;

  function needsTokenWrap(text) {
    if (!RTL_RANGE.test(text)) return false;
    LATIN_TOKEN_RE.lastIndex = 0;
    return LATIN_TOKEN_RE.test(text);
  }

  function shouldSkip(el) {
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest('.pbf-wrap')) return true;
    return false;
  }

  function hasBlockChild(el) {
    for (const child of el.children) {
      if (BLOCK_CONTAINER_TAGS.has(child.tagName)) return true;
    }
    return false;
  }

  function countDirectionalChars(text) {
    const rtl = text.match(RTL_RANGE_G);
    const ltr = text.match(LTR_LETTER_RE_G);
    return { rtl: rtl ? rtl.length : 0, ltr: ltr ? ltr.length : 0 };
  }

  // پاس اول: جهت پایه‌ی پاراگراف‌ها را با شمارش واقعی حروف (نه فقط اولین
  // حرف) اصلاح می‌کند — همین بخش مشکل اصلی رو حل می‌کنه.
  function fixParagraphDirections(root) {
    const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
    for (const el of elements) {
      if (!BLOCK_TAGS.has(el.tagName)) continue;
      if (el.isContentEditable) continue;
      if (hasBlockChild(el)) continue; // بذار فرزندهای دقیق‌تر خودشون رو مدیریت کنن

      const text = el.textContent;
      if (!text) continue;

      const { rtl, ltr } = countDirectionalChars(text);
      if (rtl === 0) continue; // اصلاً فارسی/عربی نداره

      if (el.getAttribute('dir') === 'rtl') continue; // از قبل درسته

      if (rtl >= ltr) {
        // اکثریت با فارسیه => صراحتاً rtl (نه auto، تا با شروع‌شدن جمله با
        // یک کلمه‌ی انگلیسی اشتباه تشخیص داده نشه)
        el.setAttribute('dir', 'rtl');
      }
    }
  }

  // پاس دوم: قطعات انگلیسی/عددی وسط متن فارسی را ایزوله می‌کند
  function wrapTextNode(textNode) {
    const text = textNode.nodeValue;
    LATIN_TOKEN_RE.lastIndex = 0;
    let lastIndex = 0;
    let match;
    let didWrap = false;
    const frag = document.createDocumentFragment();

    while ((match = LATIN_TOKEN_RE.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
      }
      const bdi = document.createElement('bdi');
      bdi.setAttribute('dir', 'ltr');
      bdi.textContent = match[0];
      frag.appendChild(bdi);
      lastIndex = end;
      didWrap = true;
    }
    if (!didWrap) return;
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'pbf-wrap';
    wrapper.appendChild(frag);
    if (textNode.parentNode) {
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  }

  function wrapLatinTokens(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(node.parentElement)) return NodeFilter.FILTER_REJECT;
        if (!needsTokenWrap(node.nodeValue)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    targets.forEach(wrapTextNode);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.nodeValue && needsTokenWrap(root.nodeValue) && !shouldSkip(root.parentElement)) {
        wrapTextNode(root);
      }
      if (root.parentElement) fixParagraphDirections(root.parentElement);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    fixParagraphDirections(root);
    wrapLatinTokens(root);
  }

  function processAll() {
    if (!enabled || !document.body) return;
    walk(document.body);
  }

  function scheduleWalk(node) {
    pending.add(node);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const nodes = Array.from(pending);
      pending.clear();
      nodes.forEach((n) => {
        if (document.body && document.body.contains(n)) walk(n);
      });
    }, 150);
  }

  function startObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (const m of mutations) {
        if (m.type === 'characterData') {
          if (m.target && !shouldSkip(m.target.parentElement)) scheduleWalk(m.target.parentElement || m.target);
          continue;
        }
        m.addedNodes.forEach((n) => {
          if (n.nodeType === Node.ELEMENT_NODE && n.classList && n.classList.contains('pbf-wrap')) return;
          if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.ELEMENT_NODE) {
            scheduleWalk(n);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function applyState(newEnabled) {
    enabled = newEnabled;
    if (enabled) {
      processAll();
      startObserver();
    } else {
      stopObserver();
    }
  }

  function init() {
    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get({ pbfEnabled: true }, (res) => applyState(res.pbfEnabled));
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'pbfEnabled')) {
          applyState(changes.pbfEnabled.newValue);
        }
      });
    } else {
      applyState(true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
