/**
 * @module keyboard-shortcuts
 *
 * Global keyboard shortcuts for faster play:
 * - Digits 1..9,0 click hand cards 1..10 (left-to-right, playable only).
 * - Letters a..z extend the hand past 10 cards first, then address clickable
 *   board targets (characters / companies / drafted cards in a targeting flow).
 *   Example: a hand of 4 uses keys 1-4; target letters start at 'a'.
 *   A hand of 12 uses keys 1-9,0,a,b; target letters start at 'c'.
 * - Enter / Backspace / Delete: click the 1st / 2nd / 3rd bottom-right
 *   button (visual view: pass button + `.enter-site-btn` siblings).
 *   Backspace and Delete require exactly 2 or 3 buttons respectively so
 *   they can't fire accidentally.
 * - Home: toggle single-company ↔ all-companies view.
 * - Tab, then q/w/e/r/t: open own pile browser (q=eliminated, w=sideboard,
 *   e=sites, r=deck, t=discard). The letter must be pressed within a short
 *   window after Tab; any other key (or timeout / Escape) cancels.
 *   Letters were chosen over digits so the hand shortcuts 1..9,0 stay free.
 * - Shift (held): overlay the assigned key on every shortcut target.
 */

/** Digit keys in the order 1..9,0 — first 10 hand-card slots. */
const DIGIT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Letters for slots beyond 10 (hand overflow) and for board targets. */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

/** Board-target selectors: elements that accept a click during a targeting mode. */
const BOARD_TARGET_SELECTOR = [
  '.company-block--target',
  '.company-block--clickable',
  '.cc-pending',
  '.company-card--influence-target',
  '.company-card--influence-selected',
  '.company-card--influence-source',
  '.company-card--transfer-target',
  '.company-card--transfer-selected',
  '.company-card--transfer-source',
  '.company-card--movable',       // current site — click to pick destination
  '.company-card--cancelable',    // destination site — click to cancel movement
  '.on-guard-card--revealable',   // on-guard card — click to reveal
  '.combat-card--assignable',
  '.combat-card--supportable',
  '.drafted-card-selectable',
  '.drafted-card-target',
].map(s => `#visual-board ${s}`).join(', ');

/**
 * After Tab is pressed, these letter keys (QWERTY top row) open the
 * corresponding own pile. Digit keys remain reserved for playing hand cards
 * so Tab doesn't block the hand shortcuts.
 */
const TAB_PILE_BINDINGS: ReadonlyArray<{ key: string; id: string }> = [
  { key: 'q', id: 'self-victory-pile' },    // eliminated
  { key: 'w', id: 'self-sideboard-pile' },  // sideboard
  { key: 'e', id: 'self-site-pile' },       // sites
  { key: 'r', id: 'self-deck-pile' },       // deck
  { key: 't', id: 'self-discard-pile' },    // discard
];

/** All clickable hand-card img elements, in visual (left-to-right) order. */
function getHandTargets(): HTMLElement[] {
  const arc = document.getElementById('hand-arc');
  if (!arc) return [];
  return Array.from(arc.querySelectorAll<HTMLElement>(
    'img.hand-card-playable, img.hand-card-selected',
  ));
}

/** All clickable board-target elements in DOM order. */
function getBoardTargets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(BOARD_TARGET_SELECTOR));
}

/** The enabled action buttons in the debug panel (may be empty in visual view). */
function getActionButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(
    '#actions button:not([disabled])',
  ));
}

/**
 * The primary pass/Done button visible in the visual view (`#pass-btn`),
 * or null if not active. Used so Enter fires Done during draft, etc.
 */
function getPassButton(): HTMLButtonElement | null {
  const btn = document.getElementById('pass-btn') as HTMLButtonElement | null;
  if (!btn) return null;
  if (btn.classList.contains('hidden')) return null;
  return btn;
}

/**
 * The bottom-right button stack in visual view, ordered from the bottom
 * (primary `#pass-btn`) upward (secondary and tertiary `.enter-site-btn`
 * siblings — "Pass", "Enter Site", "Call Council", "Hazards to Discard",
 * "Hazard to Deck", etc.). Empty list when the pass button is hidden.
 */
function getBottomRightButtons(): HTMLButtonElement[] {
  const passBtn = getPassButton();
  if (!passBtn) return [];
  const result: HTMLButtonElement[] = [passBtn];
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.enter-site-btn')) {
    if (!btn.classList.contains('hidden')) result.push(btn);
  }
  return result;
}

/**
 * Unified "primary action buttons" list. In visual view this is the bottom-
 * right stack; in debug view it falls back to enabled buttons in `#actions`.
 */
function getPrimaryButtons(): HTMLButtonElement[] {
  const bottom = getBottomRightButtons();
  if (bottom.length > 0) return bottom;
  return getActionButtons();
}

/** True when a text input is focused and typing should take priority. */
function isTyping(): boolean {
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * True when a <button> holds focus — only relevant for the Enter key, which
 * the browser would natively click on the focused button. We skip our Enter
 * handler in that case to avoid a double-click.
 */
function isButtonFocused(): boolean {
  return (document.activeElement?.tagName ?? '').toLowerCase() === 'button';
}

/**
 * True when the game root container is visible. `#game` is `.hidden` on the
 * lobby, auth, and connect-form screens, so gating on it prevents shortcuts
 * from firing on stale game DOM (e.g. a leftover `#pass-btn` from a prior
 * session while the user is in the Continue-game dialog).
 */
function isGameActive(): boolean {
  const game = document.getElementById('game');
  return game !== null && !game.classList.contains('hidden');
}

/**
 * Click an element with a brief flash for feedback. Dispatches a real
 * `MouseEvent` with `clientX/clientY` at the element's visible center —
 * some click handlers (e.g. the hand-card hazard-keying popup) position
 * tooltips from `event.clientX/clientY`, and the zero-value default from
 * `HTMLElement.click()` would place them off-screen.
 */
function clickWithFlash(el: HTMLElement): void {
  el.classList.add('btn--flash');
  setTimeout(() => el.classList.remove('btn--flash'), 300);
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  el.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: cx,
    clientY: cy,
    button: 0,
  }));
}

// ---- Tab combo state ----

/** How long after Tab we wait for the digit key before canceling, in ms. */
const TAB_COMBO_TIMEOUT_MS = 2000;

/** True while we are waiting for the second key of a Tab-digit combo. */
let tabArmed = false;
let tabArmTimer: number | null = null;
/**
 * Remembered "was the deck box compact before we armed Tab?" so we can
 * restore the original state on disarm. Null when we didn't touch it.
 */
let tabCompactWasOn: boolean | null = null;

/** Show the deck-box piles by removing the compact collapse. */
function expandDeckBox(): void {
  const box = document.getElementById('self-deck-box');
  if (!box) return;
  if (tabCompactWasOn === null) {
    tabCompactWasOn = box.classList.contains('deck-box--compact');
  }
  box.classList.remove('deck-box--compact');
}

/** Restore the deck-box's pre-arm compact state if we changed it. */
function restoreDeckBox(): void {
  if (tabCompactWasOn === null) return;
  const box = document.getElementById('self-deck-box');
  if (box && tabCompactWasOn) box.classList.add('deck-box--compact');
  tabCompactWasOn = null;
}

/** Cancel tab-armed state and hide any pile labels it was showing. */
function disarmTab(): void {
  tabArmed = false;
  if (tabArmTimer !== null) {
    clearTimeout(tabArmTimer);
    tabArmTimer = null;
  }
  restoreDeckBox();
  // Tab-combo labels are drawn alongside regular labels — refresh both.
  if (shiftLabelsShown) showShortcutLabels();
  else clearShortcutLabels();
}

/** Arm tab-combo mode: the next 1..5 keypress opens a pile browser. */
function armTab(): void {
  tabArmed = true;
  if (tabArmTimer !== null) clearTimeout(tabArmTimer);
  tabArmTimer = window.setTimeout(disarmTab, TAB_COMBO_TIMEOUT_MS);
  // Make sure the pile cells are actually visible before labeling them.
  expandDeckBox();
  // Show the pile shortcut labels so the user sees 1..5 mappings immediately.
  if (shiftLabelsShown) showShortcutLabels();
  else showPileLabelsOnly();
}

/** Place labels on the five piles addressable by Tab+letter. */
function showPileLabelsOnly(): void {
  clearShortcutLabels();
  for (const { key, id } of TAB_PILE_BINDINGS) {
    const el = document.getElementById(id);
    if (!el) continue;
    placeLabel(el, key.toUpperCase());
  }
}

// ---- Shift-key label viewer ----

let shiftLabelsShown = false;

/** Remove any existing shortcut labels from the DOM and stop peeking the hand. */
function clearShortcutLabels(): void {
  document.querySelectorAll('.kbd-shortcut-label').forEach(l => l.remove());
  document.getElementById('hand-arc')?.classList.remove('kbd-peek');
  // Restore the deck-box compact state if Shift expanded it (Tab-armed uses
  // its own restore path, guarded by tabArmed).
  if (!tabArmed) restoreDeckBox();
  shiftLabelsShown = false;
}

/** Absolute screen position where a label should appear for an element. */
interface LabelPoint { readonly x: number; readonly y: number }

/**
 * For rotated, fanned hand cards, `getBoundingClientRect().top` sits at the
 * axis-aligned bbox corner — usually far above/beside the actual card face.
 * Compute the visual top-center instead by applying the element's transform
 * matrix to the local top-center point, around the transform-origin.
 */
function visualTopCenter(el: HTMLElement): LabelPoint {
  const parent = el.offsetParent as HTMLElement | null;
  const cs = window.getComputedStyle(el);
  const w = el.offsetWidth;
  const m = cs.transform && cs.transform !== 'none'
    ? new DOMMatrix(cs.transform)
    : new DOMMatrix();
  const [ox, oy] = cs.transformOrigin.split(' ').map((v) => parseFloat(v));
  // Local top-center (w/2, 0), applied as M(p - origin) + origin.
  const dx = w / 2 - ox;
  const dy = -oy;
  const localX = m.a * dx + m.c * dy + m.e + ox;
  const localY = m.b * dx + m.d * dy + m.f + oy;
  if (!parent) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top };
  }
  const pr = parent.getBoundingClientRect();
  return {
    x: pr.left + el.offsetLeft + localX,
    y: pr.top + el.offsetTop + localY,
  };
}

/** Fallback anchor: top-center of the axis-aligned bounding box. */
function bboxTopCenter(el: HTMLElement): LabelPoint {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top };
}

/** Place a label element, horizontally centered on the given point. */
function placeLabelAt(point: LabelPoint, text: string): void {
  const label = document.createElement('span');
  label.className = 'kbd-shortcut-label';
  label.textContent = text;
  label.style.left = `${point.x}px`;
  label.style.top = `${point.y}px`;
  label.style.transform = 'translate(-50%, -50%)';
  document.body.appendChild(label);
}

/** Place a label near the top-left of an untransformed target's bbox. */
function placeLabel(el: HTMLElement, text: string): void {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  placeLabelAt({ x: rect.left + 12, y: rect.top + 12 }, text);
}

/** Show shortcut-key labels on every clickable target currently in the DOM. */
function showShortcutLabels(): void {
  clearShortcutLabels();
  shiftLabelsShown = true;

  // Raise the hand arc from its resting offscreen position so card labels
  // land on visible pixels. A single frame is enough for the CSS transition.
  document.getElementById('hand-arc')?.classList.add('kbd-peek');
  // Expand the deck box so pile labels land on visible pile cells.
  expandDeckBox();

  const hand = getHandTargets();
  const labelHandCard = (el: HTMLElement, key: string): void => {
    placeLabelAt(visualTopCenter(el), key);
  };
  // First 10 hand cards use digits
  for (let i = 0; i < Math.min(10, hand.length); i++) {
    labelHandCard(hand[i], DIGIT_KEYS[i]);
  }
  // Hand overflow uses letters starting at 'a'
  const handOverflow = Math.max(0, hand.length - 10);
  for (let i = 0; i < handOverflow && i < LETTERS.length; i++) {
    labelHandCard(hand[10 + i], LETTERS[i].toUpperCase());
  }

  // Board targets use letters starting after the hand overflow
  const board = getBoardTargets();
  for (let i = 0; i < board.length; i++) {
    const letterIdx = handOverflow + i;
    if (letterIdx >= LETTERS.length) break;
    placeLabelAt(bboxTopCenter(board[i]), LETTERS[letterIdx].toUpperCase());
  }

  // Mirror the handler precedence: visual-view bottom-right stack (pass +
  // secondaries) takes priority over the debug action list.
  const primaries = getPrimaryButtons();
  const passBtn = getPassButton();
  if (passBtn) {
    // Visual view — pass always fires Enter, regardless of button count.
    placeLabel(passBtn, 'Enter');
    if (primaries.length === 2) placeLabel(primaries[1], 'Bksp');
    if (primaries.length === 3) {
      placeLabel(primaries[1], 'Bksp');
      placeLabel(primaries[2], 'Del');
    }
  } else if (primaries.length === 1) {
    placeLabel(primaries[0], 'Enter');
  } else if (primaries.length === 2) {
    placeLabel(primaries[0], 'Enter');
    placeLabel(primaries[1], 'Bksp');
  } else if (primaries.length === 3) {
    placeLabel(primaries[0], 'Enter');
    placeLabel(primaries[1], 'Bksp');
    placeLabel(primaries[2], 'Del');
  }

  const toggle = document.querySelector<HTMLElement>('.company-view-toggle');
  if (toggle) placeLabel(toggle, 'Home');

  // Own piles get Tab+letter labels.
  for (const { key, id } of TAB_PILE_BINDINGS) {
    const el = document.getElementById(id);
    if (el) placeLabel(el, `Tab ${key.toUpperCase()}`);
  }
}

// ---- Pile browser navigation ----

const PILE_BROWSER_MARKER_CLASS = 'pile-browser--marked';

/** Selectable cards currently rendered in the pile browser grid. */
function getPileBrowserSelectables(): HTMLImageElement[] {
  const grid = document.getElementById('pile-browser-grid');
  if (!grid) return [];
  return Array.from(grid.querySelectorAll<HTMLImageElement>(
    'img.site-selectable, img.site-in-play-selectable',
  ));
}

/** True when the pile-browser modal is currently visible. */
function isPileBrowserOpen(): boolean {
  const modal = document.getElementById('pile-browser-modal');
  return modal !== null && !modal.classList.contains('hidden');
}

/** Replace the current marker with `el` (or clear if null). */
function setPileBrowserMarker(el: HTMLImageElement | null): void {
  document.querySelectorAll(`.${PILE_BROWSER_MARKER_CLASS}`)
    .forEach(e => e.classList.remove(PILE_BROWSER_MARKER_CLASS));
  if (el) el.classList.add(PILE_BROWSER_MARKER_CLASS);
}

/** The card currently marked, if it still lives in the selectables list. */
function getPileBrowserMarker(items: readonly HTMLImageElement[]): HTMLImageElement | null {
  const marked = document.querySelector<HTMLImageElement>(`.${PILE_BROWSER_MARKER_CLASS}`);
  return marked && items.includes(marked) ? marked : null;
}

/**
 * Given a starting card and a cardinal direction, find the selectable card
 * whose center is nearest in that direction (geometry-based, because the
 * pile browser lays out via flex-wrap and rows vary by screen width).
 */
function findPileBrowserNeighbour(
  items: readonly HTMLImageElement[],
  from: HTMLImageElement,
  dir: 'left' | 'right' | 'up' | 'down',
): HTMLImageElement | null {
  const fromRect = from.getBoundingClientRect();
  const fx = fromRect.left + fromRect.width / 2;
  const fy = fromRect.top + fromRect.height / 2;

  let best: HTMLImageElement | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    if (item === from) continue;
    const r = item.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fx;
    const dy = cy - fy;
    const sameRow = Math.abs(dy) < fromRect.height * 0.5;
    if (dir === 'left' && !(dx < -1 && sameRow)) continue;
    if (dir === 'right' && !(dx > 1 && sameRow)) continue;
    if (dir === 'up' && !(dy < -1)) continue;
    if (dir === 'down' && !(dy > 1)) continue;
    // Prefer the axis-aligned neighbour: weight the off-axis distance more.
    const primary = Math.abs(dir === 'up' || dir === 'down' ? dy : dx);
    const secondary = Math.abs(dir === 'up' || dir === 'down' ? dx : dy);
    const dist = primary + secondary * 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = item;
    }
  }
  return best;
}

/**
 * Arrow / Enter / Escape handling for the open pile browser. Returns true
 * when the key was consumed — caller should stop processing other shortcuts.
 */
function handlePileBrowserKey(e: KeyboardEvent): boolean {
  if (!isPileBrowserOpen()) return false;
  const items = getPileBrowserSelectables();

  if (e.key === 'Escape') {
    e.preventDefault();
    document.getElementById('pile-browser-backdrop')?.click();
    return true;
  }

  if (items.length === 0) {
    // Still swallow keys so no underlying shortcut fires behind the modal.
    if (e.key === 'Enter' || e.key.startsWith('Arrow')) e.preventDefault();
    return e.key === 'Enter' || e.key.startsWith('Arrow');
  }

  let marked = getPileBrowserMarker(items);
  if (!marked) {
    marked = items[0];
    setPileBrowserMarker(marked);
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    marked.click();
    return true;
  }

  const dir: 'left' | 'right' | 'up' | 'down' | null =
    e.key === 'ArrowLeft' ? 'left'
    : e.key === 'ArrowRight' ? 'right'
    : e.key === 'ArrowUp' ? 'up'
    : e.key === 'ArrowDown' ? 'down'
    : null;

  if (dir) {
    e.preventDefault();
    const next = findPileBrowserNeighbour(items, marked, dir);
    if (next) setPileBrowserMarker(next);
    return true;
  }

  // Swallow other keys so hand/pile shortcuts don't fire beneath the modal.
  e.preventDefault();
  return true;
}

// ---- Popup menu navigation ----

/**
 * Find the menu / choice-list currently receiving keyboard navigation.
 * Returns both the container and whether it's a floating popup (which
 * hijacks every key) or an embedded list (which only handles its own
 * arrow/Enter/Escape so other shortcuts stay active elsewhere).
 */
function findActiveChoiceMenu(): { menu: HTMLElement; modal: boolean } | null {
  // Floating popups: hand-card tooltips etc. Always hijack when present.
  const popup = document.querySelector<HTMLElement>('.chain-target-tooltip');
  if (popup) return { menu: popup, modal: true };

  // Embedded choice lists (movement type / region selection). Only hijack
  // when focus is already inside the list — otherwise the player can keep
  // using other shortcuts in the same step.
  const focused = document.activeElement;
  const choiceList = focused instanceof HTMLElement
    ? focused.closest<HTMLElement>('.path-choice-list')
    : null;
  if (choiceList) return { menu: choiceList, modal: false };

  return null;
}

/**
 * Arrow / Enter / Escape handling for any active choice menu. Returns true
 * when the key has been consumed; caller should stop processing shortcuts.
 */
function handlePopupMenuKey(e: KeyboardEvent): boolean {
  const active = findActiveChoiceMenu();
  if (!active) return false;
  const { menu, modal } = active;

  const btns = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('.char-action-tooltip__btn'),
  );
  if (btns.length === 0) return false;

  const focused = document.activeElement instanceof HTMLButtonElement
    ? document.activeElement : null;
  const currentIdx = focused ? btns.indexOf(focused) : -1;

  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    const next = currentIdx < 0 ? 0 : (currentIdx + 1) % btns.length;
    btns[next].focus();
    return true;
  }
  if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
    e.preventDefault();
    const prev = currentIdx <= 0 ? btns.length - 1 : currentIdx - 1;
    btns[prev].focus();
    return true;
  }
  if (e.key === 'Escape' && modal) {
    e.preventDefault();
    const backdrop = document.querySelector<HTMLElement>('.chain-target-backdrop');
    backdrop?.click();
    return true;
  }
  if (e.key === 'Enter') {
    // If nothing is focused yet, focus the first option so the next Enter
    // fires it. If a button is already focused, native Enter handles it.
    if (currentIdx < 0) {
      e.preventDefault();
      btns[0].focus();
      return true;
    }
    return false;
  }
  // Floating popup hijacks every key; embedded lists let other shortcuts
  // keep working elsewhere in the UI.
  if (modal) {
    e.preventDefault();
    return true;
  }
  return false;
}

// ---- Main installer ----

let installed = false;

/**
 * Auto-focus the first option when a popup or embedded choice list appears
 * so Enter/Up/Down work immediately, whether it was opened by a click or
 * by a keyboard shortcut.
 */
function installPopupMenuAutoFocus(): void {
  const SELECTOR = '.chain-target-tooltip, .path-choice-list';
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (!(added instanceof HTMLElement)) continue;
        const menu = added.matches(SELECTOR)
          ? added
          : added.querySelector<HTMLElement>(SELECTOR);
        if (!menu) continue;
        const first = menu.querySelector<HTMLButtonElement>('.char-action-tooltip__btn');
        first?.focus();
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/** Install the global keyboard-shortcut listener. Safe to call more than once. */
export function installKeyboardShortcuts(): void {
  if (installed) return;
  installed = true;
  installPopupMenuAutoFocus();

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (isTyping()) return;
    if (!isGameActive()) return;

    // Pile-browser modal takes keyboard focus when visible: arrows move the
    // marker, Enter picks, Escape closes. Other shortcuts are suppressed.
    if (handlePileBrowserKey(e)) return;

    // Popup menus (hazard keying, short-event target, character action tooltip)
    // capture arrow / Enter / Escape. Other shortcuts are suppressed while a
    // menu is open so they can't fire by accident.
    if (handlePopupMenuKey(e)) return;

    if (e.key === 'Shift') {
      if (!shiftLabelsShown) showShortcutLabels();
      return;
    }

    // Tab-digit combo: first press arms, second digit opens a pile.
    if (e.key === 'Tab') {
      e.preventDefault();
      if (tabArmed) disarmTab();
      else armTab();
      return;
    }

    if (tabArmed) {
      if (e.code.startsWith('Key') && e.code.length === 4) {
        const letter = String.fromCharCode(e.code.charCodeAt(3) + 32);
        const binding = TAB_PILE_BINDINGS.find(b => b.key === letter);
        if (binding) {
          const el = document.getElementById(binding.id);
          if (el) {
            e.preventDefault();
            clickWithFlash(el);
          }
          disarmTab();
          return;
        }
      }
      // Escape or any other key cancels the armed combo.
      if (e.key === 'Escape') {
        e.preventDefault();
      }
      disarmTab();
      return;
    }

    if (e.key === 'Enter') {
      // A focused <button> already activates on Enter natively; don't double-click.
      if (isButtonFocused()) return;
      const buttons = getPrimaryButtons();
      // Visual view: always fire the pass button regardless of total count.
      // Debug view: fire only when a single action exists (conservative).
      const passBtn = getPassButton();
      if (passBtn) {
        e.preventDefault();
        clickWithFlash(passBtn);
      } else if (buttons.length === 1) {
        e.preventDefault();
        clickWithFlash(buttons[0]);
      }
      return;
    }

    if (e.key === 'Backspace') {
      const buttons = getPrimaryButtons();
      if (buttons.length === 2) {
        e.preventDefault();
        clickWithFlash(buttons[1]);
      }
      return;
    }

    if (e.key === 'Delete') {
      const buttons = getPrimaryButtons();
      if (buttons.length === 3) {
        e.preventDefault();
        clickWithFlash(buttons[2]);
      }
      return;
    }

    if (e.key === 'Home') {
      const toggle = document.querySelector<HTMLElement>('.company-view-toggle');
      if (toggle) {
        e.preventDefault();
        clickWithFlash(toggle);
      }
      return;
    }

    const hand = getHandTargets();
    const board = getBoardTargets();

    // Digits address only hand slots 0..9
    if (e.code.startsWith('Digit') && e.code.length === 6) {
      const d = e.code.charCodeAt(5) - 48;
      let idx: number;
      if (d >= 1 && d <= 9) idx = d - 1;
      else if (d === 0) idx = 9;
      else return;
      if (idx < hand.length) {
        e.preventDefault();
        clickWithFlash(hand[idx]);
      }
      return;
    }

    // Letters address hand overflow first, then board targets
    if (e.code.startsWith('Key') && e.code.length === 4) {
      const c = e.code.charCodeAt(3);
      if (c < 65 || c > 90) return;
      const letterIdx = c - 65;
      const handOverflow = Math.max(0, hand.length - 10);
      if (letterIdx < handOverflow) {
        e.preventDefault();
        clickWithFlash(hand[10 + letterIdx]);
        return;
      }
      const boardIdx = letterIdx - handOverflow;
      if (boardIdx < board.length) {
        e.preventDefault();
        clickWithFlash(board[boardIdx]);
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') clearShortcutLabels();
  });

  window.addEventListener('blur', clearShortcutLabels);
}
