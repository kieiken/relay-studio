import baseMessages from './messages-zh-TW.js';
import bridgeMessages from './messages-bridge-zh-TW.js';
const messages={...baseMessages,...bridgeMessages};
export const localeKey = 'relay.ui-language';
export const supportedLocales = ['ja', 'zh-TW'];
let locale = 'ja';
try { const saved = globalThis.localStorage?.getItem(localeKey); if (supportedLocales.includes(saved)) locale = saved; } catch { /* Storage may be disabled in a private browser. */ }
const escaped = Object.keys(messages).sort((a,b)=>b.length-a.length).map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const pattern = new RegExp(escaped.join('|'), 'g');
export const getLocale = () => locale;
export const dateLocale = () => locale === 'zh-TW' ? 'zh-TW' : 'ja-JP';
export function setLocale(value) {
  if (!supportedLocales.includes(value)) throw new Error('Unsupported UI language');
  locale = value;
  try { globalThis.localStorage?.setItem(localeKey, value); } catch { /* Keep the current session usable. */ }
}
// Only authored UI literals and known system messages may enter this function.
// Values interpolated into ui`` (manuscripts, URLs, names, IDs) pass through unchanged.
export const untranslatedUI = new Set();
export function t(source) {
  if (locale !== 'zh-TW' || typeof source !== 'string') return source;
  const translated = source.replace(pattern, key => messages[key]);
  if (/[\u3041-\u3096\u30a1-\u30fa]/.test(translated)) untranslatedUI.add(source);
  return translated;
}
export function ui(strings, ...values) {
  return strings.reduce((result, fragment, index) => result + t(fragment) + (index < values.length ? String(values[index]) : ''), '');
}
const originalText = new WeakMap(), originalAttributes = new WeakMap();
// Used only for the static app shell, never the content editor or data views.
export function localizeShell(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!originalText.has(node)) originalText.set(node, node.nodeValue);
    node.nodeValue = t(originalText.get(node));
  }
  for (const node of [root, ...root.querySelectorAll('[aria-label], [title]')]) {
    if (!originalAttributes.has(node)) originalAttributes.set(node, Object.fromEntries(['aria-label','title'].filter(key=>node.hasAttribute(key)).map(key=>[key,node.getAttribute(key)])));
    for (const [key, value] of Object.entries(originalAttributes.get(node))) node.setAttribute(key,t(value));
  }
}
