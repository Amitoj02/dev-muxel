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
 * There are two ways in, and they inject the same script: `pickElement`, which
 * arms straight away and is what the comments panel's button calls, and
 * `holdPick`, which leaves a watcher in the page that only wakes while Ctrl is
 * held over it. They cannot both own the page, so each cancels the other by
 * its own hook — see `pickerSource`.
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
 *
 * Two modes out of one script, because they are the same picker with different
 * triggers:
 *
 *   - `hold: false` — armed the moment it lands and stays armed until it gets
 *     a click, an Escape or a blur. This is the button in the comments panel.
 *   - `hold: true` — armed only while Ctrl is down over the page, and passive
 *     the rest of the time. It sits in the page for as long as the document
 *     does, so pointing at something is a modifier away rather than a trip to
 *     a panel and back.
 *
 * The hold mode reads the modifier off `mousemove` rather than off `keydown`,
 * and that is the whole trick: a guest is only sent key events when it has the
 * keyboard, but it is sent mouse events whenever the pointer is over it — and
 * every one of them carries `ctrlKey`. "Hold Ctrl while hovering" is therefore
 * exactly the question the page can answer, focused or not.
 */
function pickerSource(
  maxText: number,
  maxHtml: number,
  props: string[],
  hold: boolean
): string {
  return `(function () {
  ${
    hold
      ? // A watcher installed over a pick already in flight would take the page
        // out from under it. The panel's picker outranks the modifier.
        `if (window.__devlobbyHoldCancel) { try { window.__devlobbyHoldCancel() } catch (e) {} }
  if (window.__devlobbyPickCancel) return Promise.resolve(null);`
      : `if (window.__devlobbyPickCancel) { try { window.__devlobbyPickCancel() } catch (e) {} }
  if (window.__devlobbyHoldCancel) { try { window.__devlobbyHoldCancel() } catch (e) {} }`
  }

  return new Promise(function (resolve) {
    var STYLE_PROPS = ${JSON.stringify(props)};
    var MAX_TEXT = ${maxText};
    var MAX_HTML = ${maxHtml};
    var HOLD = ${hold ? 'true' : 'false'};

    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;border:1px solid #e5372a;background:rgba(229,55,42,0.14)';
    var tag = document.createElement('div');
    tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#e5372a;color:#fff;padding:2px 6px;white-space:nowrap;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace';

    var root = document.documentElement;
    var previousCursor = '';
    var armed = false;
    var current = null;

    // Drawn only while armed. A hold watcher spends nearly all of its life
    // doing nothing, and must leave no mark on the page while it is.
    function show() {
      if (armed) return;
      armed = true;
      root.appendChild(box);
      root.appendChild(tag);
      previousCursor = root.style.cursor;
      root.style.cursor = 'crosshair';
    }

    function hide() {
      if (!armed) return;
      armed = false;
      current = null;
      if (box.parentNode) box.parentNode.removeChild(box);
      if (tag.parentNode) tag.parentNode.removeChild(tag);
      root.style.cursor = previousCursor;
    }

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
      if (HOLD) {
        document.removeEventListener('keyup', onKeyUp, true);
        document.removeEventListener('mouseleave', onLeave, true);
        window.__devlobbyHoldCancel = null;
      } else {
        window.removeEventListener('blur', onCancel);
        window.__devlobbyPickCancel = null;
      }
      hide();
    }

    function onMove(e) {
      // The modifier is read off the pointer, so it is answered whether or not
      // the page has the keyboard. Ctrl+click is spent on this rather than on
      // the browser's own open-in-a-new-tab, which a pane has nowhere to put.
      if (HOLD) {
        if (e.ctrlKey) show(); else hide();
      }
      if (!armed) return;
      var el = e.target;
      if (!el || el.nodeType !== 1 || el === box || el === tag) return;
      current = el;
      draw(el);
    }

    // The page must not act on the click that chooses an element, so it is
    // stopped at mousedown as well — a button that fires on mousedown would
    // otherwise navigate out from under the pick.
    function onDown(e) {
      if (!armed) return;
      e.preventDefault();
      e.stopPropagation();
    }

    function onClick(e) {
      if (!armed) return;
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
      // Escape puts the crosshair away in both modes, but only ends the pick
      // in the one that was asked for. A hold watcher is what makes Ctrl work
      // at all, and ending it would take the gesture with it.
      if (HOLD) {
        if (!armed) return;
        e.preventDefault();
        e.stopPropagation();
        hide();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      resolve(null);
    }

    // Letting go without moving the mouse again, which is the ordinary way to
    // change your mind. It only arrives when the page has the keyboard; the
    // next pointer move answers it either way.
    function onKeyUp(e) {
      if (e.key === 'Control' || !e.ctrlKey) hide();
    }

    function onLeave() { hide() }

    function onCancel() { cleanup(); resolve(null) }

    if (HOLD) {
      window.__devlobbyHoldCancel = onCancel;
    } else {
      window.__devlobbyPickCancel = onCancel;
      show();
    }

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    if (HOLD) {
      document.addEventListener('keyup', onKeyUp, true);
      document.addEventListener('mouseleave', onLeave, true);
    } else {
      window.addEventListener('blur', onCancel);
    }
  });
})()`
}

/**
 * Every word this file says to a guest, said safely.
 *
 * `executeJavaScript` is not the async call it looks like. Like every
 * `<webview>` method that reaches the guest, it starts by asking the element
 * for the guest's id — and that *throws*, synchronously, whenever there is no
 * guest to name: before the tag has attached, and again the moment the element
 * leaves the document. The exception happens before there is a promise, so a
 * `.catch()` hung off the call never sees it.
 *
 * Which is exactly the shape that took the window down. React runs a deleted
 * component's effect cleanups *after* it has removed the node, so a browser
 * pane being torn down was cancelling its Ctrl watcher against an element
 * whose guest had already gone — and an exception in a cleanup is one React
 * has nowhere to put. With no error boundary above it, it unmounts the root:
 * every pane in the app replaced by an empty black window, a few seconds after
 * closing one pane, which is the reopen window running out and taking the
 * grid with it.
 *
 * So nothing here calls the element directly. An `async` function turns that
 * synchronous throw back into a rejection, which is the thing the rest of this
 * file already knew how to ignore.
 */
async function inject(view: WebviewElement, source: string): Promise<unknown> {
  try {
    return await view.executeJavaScript(source)
  } catch {
    // A navigation mid-pick, a guest that has gone, or a pane on its way out.
    // None of them are errors: they are all "nothing was picked".
    return null
  }
}

/**
 * Put the page into pick mode and wait for a click.
 *
 * Resolves with null when the user pressed Escape, clicked away, or the page
 * navigated out from under the pick — all of which are ordinary, so none of
 * them are errors.
 */
export async function pickElement(view: WebviewElement): Promise<PickedElement | null> {
  const result = await inject(view, pickerSource(MAX_TEXT, MAX_HTML, STYLE_PROPS, false))
  return isPicked(result) ? result : null
}

/**
 * Leave a picker in the page that only wakes while Ctrl is held.
 *
 * The promise is the whole of the gesture: it is outstanding for as long as
 * the document lives, and resolves with an element the first time somebody
 * holds Ctrl over the page and clicks. That is one comment, not a run of them
 * — nothing is left armed afterwards, which is the difference between this and
 * the button in the panel.
 *
 * Null means it never got that far: the page navigated, or the panel's picker
 * asked for the page and got it.
 */
export async function holdPick(view: WebviewElement): Promise<PickedElement | null> {
  const result = await inject(view, pickerSource(MAX_TEXT, MAX_HTML, STYLE_PROPS, true))
  return isPicked(result) ? result : null
}

/**
 * Take the page back out of pick mode from the outside.
 *
 * A page that is already gone is its own kind of cancelled, and so is a pane
 * that is being unmounted as this is called — which is the ordinary case, not
 * the exceptional one. See `inject`.
 */
export function cancelPick(view: WebviewElement): void {
  void inject(view, 'window.__devlobbyPickCancel && window.__devlobbyPickCancel(), 0')
}

/** The same, for the Ctrl watcher — separately, so one cannot cancel the other. */
export function cancelHold(view: WebviewElement): void {
  void inject(view, 'window.__devlobbyHoldCancel && window.__devlobbyHoldCancel(), 0')
}

/**
 * The guest can return anything at all, so the shape is checked rather than
 * asserted — this crosses a process boundary from a page DevLobby does not own.
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
