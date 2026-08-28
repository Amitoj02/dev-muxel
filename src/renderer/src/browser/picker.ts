/**
 * Pointing at something in the page.
 *
 * The pane needs to know which element you mean, and the only process that can
 * answer that is the guest itself — so the picker is a script injected into
 * the page rather than anything drawn over the top of it. Hit-testing an
 * element from outside a separate WebContents is not possible, and an overlay
 * in the host document would sit above the guest without knowing what is under
 * the cursor.
 *
 * The result comes back through `executeJavaScript`, which resolves whatever
 * promise the injected script returns. That is the whole channel: no preload,
 * no IPC into the guest, nothing left behind in the page once a pick ends.
 *
 * Everything it returns is page-controlled data and is treated as such — see
 * `clean()` in shared/claude.ts, which every field passes through before it can
 * reach a terminal.
 */

import type { PickedElement } from '../../../shared/browser'
import type { WebviewElement } from './webview'

/** Caps applied inside the page, so a huge subtree never crosses the boundary. */
const MAX_TEXT = 400
const MAX_HTML = 4000

/**
 * The properties worth arguing about when something is the wrong shape or in
 * the wrong place. Deliberately not the full computed set: that is six hundred
 * declarations, nearly all of them defaults, and it would bury the answer.
 */
const STYLE_PROPS = [
  'display',
  'position',
  'top',
  'left',
  'width',
  'height',
  'margin',
  'padding',
  'box-sizing',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'color',
  'background-color',
  'border',
  'border-radius',
  'overflow',
  'opacity',
  'transform',
  'z-index'
]

/**
 * The injected script, as source.
 *
 * Written in plain ES5-flavoured JavaScript on purpose: it is evaluated in
 * whatever page the pane happens to be on, which may be an old build with its
 * own idea of what the language is, and it must not depend on anything the
 * page provides beyond the DOM.
 */
function pickerSource(maxText: number, maxHtml: number, props: string[]): string {
  return `(function () {
  if (window.__gridPickCancel) { try { window.__gridPickCancel() } catch (e) {} }

  return new Promise(function (resolve) {
    var STYLE_PROPS = ${JSON.stringify(props)};
    var MAX_TEXT = ${maxText};
    var MAX_HTML = ${maxHtml};

    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:1px solid #e5372a;background:rgba(229,55,42,0.14)';
    var tag = document.createElement('div');
    tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#e5372a;color:#fff;padding:2px 6px;white-space:nowrap;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace';

    var root = document.documentElement;
    root.appendChild(box);
    root.appendChild(tag);
    var previousCursor = root.style.cursor;
    root.style.cursor = 'crosshair';

    var current = null;

    function brief(el) {
      var s = el.tagName.toLowerCase();
      if (el.id) return s + '#' + el.id;
      if (el.classList && el.classList.length) {
        s += '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.');
      }
      return s;
    }

    function selectorFor(el) {
      if (el.id) return '#' + el.id;
      var parts = [];
      var node = el;
      var depth = 0;
      while (node && node.nodeType === 1 && depth < 6) {
        if (node.id) { parts.unshift('#' + node.id); break }
        var s = node.tagName.toLowerCase();
        if (node.classList && node.classList.length) {
          s += '.' + Array.prototype.slice.call(node.classList, 0, 2).join('.');
        }
        var parent = node.parentElement;
        if (parent) {
          var same = Array.prototype.filter.call(parent.children, function (c) {
            return c.tagName === node.tagName;
          });
          if (same.length > 1) {
            s += ':nth-of-type(' + (Array.prototype.indexOf.call(same, node) + 1) + ')';
          }
        }
        parts.unshift(s);
        node = parent;
        depth += 1;
      }
      return parts.join(' > ');
    }

    function draw(el) {
      var r = el.getBoundingClientRect();
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
      box.style.width = r.width + 'px';
      box.style.height = r.height + 'px';
      tag.textContent = brief(el) + '  ' + Math.round(r.width) + '\\u00d7' + Math.round(r.height);
      var ty = r.top - 21;
      if (ty < 0) ty = r.bottom + 2;
      tag.style.left = Math.max(0, r.left) + 'px';
      tag.style.top = ty + 'px';
    }

    function describe(el) {
      var r = el.getBoundingClientRect();
      var cs = window.getComputedStyle(el);
      var styles = {};
      for (var i = 0; i < STYLE_PROPS.length; i += 1) {
        var v = cs.getPropertyValue(STYLE_PROPS[i]);
        if (v) styles[STYLE_PROPS[i]] = String(v).trim();
      }
      var chain = [];
      var p = el.parentElement;
      var n = 0;
      while (p && p !== root && n < 4) { chain.unshift(brief(p)); p = p.parentElement; n += 1 }
      return {
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: el.classList ? Array.prototype.slice.call(el.classList) : [],
        text: String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, MAX_TEXT),
        html: String(el.outerHTML || '').slice(0, MAX_HTML),
        rect: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          width: Math.round(r.width),
          height: Math.round(r.height)
        },
        styles: styles,
        ancestors: chain,
        url: String(location.href)
      };
    }

    function cleanup() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onCancel);
      if (box.parentNode) box.parentNode.removeChild(box);
      if (tag.parentNode) tag.parentNode.removeChild(tag);
      root.style.cursor = previousCursor;
      window.__gridPickCancel = null;
    }

    function onMove(e) {
      var el = e.target;
      if (!el || el.nodeType !== 1 || el === box || el === tag) return;
      current = el;
      draw(el);
    }

    // The page must not act on the click that chooses an element, so it is
    // stopped at mousedown as well — a button that fires on mousedown would
    // otherwise navigate out from under the pick.
    function onDown(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var el = current || e.target;
      var picked = null;
      try { picked = describe(el) } catch (err) { picked = null }
      cleanup();
      resolve(picked);
    }

    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      resolve(null);
    }

    function onCancel() { cleanup(); resolve(null) }

    window.__gridPickCancel = onCancel;

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  });
})()`
}

/**
 * Put the page into pick mode and wait for a click.
 *
 * Resolves with null when the user pressed Escape, clicked away, or the page
 * navigated out from under the pick — all of which are ordinary, so none of
 * them are errors.
 */
export async function pickElement(view: WebviewElement): Promise<PickedElement | null> {
  try {
    const result = await view.executeJavaScript(pickerSource(MAX_TEXT, MAX_HTML, STYLE_PROPS))
    return isPicked(result) ? result : null
  } catch {
    // A navigation mid-pick rejects the evaluation; nothing was picked.
    return null
  }
}

/** Take the page back out of pick mode from the outside. */
export function cancelPick(view: WebviewElement): void {
  void view
    .executeJavaScript('window.__gridPickCancel && window.__gridPickCancel(), 0')
    .catch(() => {
      /* the page is gone, which is its own kind of cancelled */
    })
}

/**
 * The guest can return anything at all, so the shape is checked rather than
 * asserted — this crosses a process boundary from a page GRID does not own.
 */
function isPicked(value: unknown): value is PickedElement {
  if (!value || typeof value !== 'object') return false
  const el = value as Partial<PickedElement>
  return (
    typeof el.selector === 'string' &&
    typeof el.tag === 'string' &&
    typeof el.html === 'string' &&
    typeof el.rect === 'object' &&
    el.rect !== null
  )
}
