/**
 * @module tutorial-panel
 *
 * The guided tutorial's instruction panel (specs/2026-07-30-tutorial-plan.md).
 *
 * Renders entirely from {@link PlayerView.tutorial}, which the game-server's
 * TutorialController attaches to every state broadcast of a tutorial game —
 * the browser never tracks the script cursor itself. The panel is a managed
 * `#tutorial-panel` element rebuilt on every render and absent outside
 * tutorial games. It lives on `document.body` as a fixed overlay (docked on
 * the left below the opponent deck box by CSS), deliberately outside
 * `#visual-board` so its size never reflows the company layout.
 *
 * When the chapter's last beat has been played the docked panel is replaced
 * by a centered completion card — the recap plus the "Exit Tutorial" button,
 * which is the only control left once the script gates every action off.
 *
 * Besides the instruction, a step may carry glossary entries (rendered under
 * the instruction body) and UI pointers — callout bubbles attached to the
 * on-screen element a concept lives at (the GI counter, the phase meter, …).
 * Anchors are abstract names from the shared script; this module owns the
 * mapping to concrete element ids and silently skips anchors whose element
 * is absent or hidden in the current layout.
 */

import type { CardDefinition, ClientMessage, PlayerView, RegionType, TutorialAnchorId, TutorialPointer } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';
import { createRegionTypeIcon } from './render-utils.js';
import { appState } from './app-state.js';

/** Concrete element id each abstract pointer anchor attaches to. */
const ANCHOR_ELEMENT_IDS: Record<TutorialAnchorId, string> = {
  'general-influence': 'self-gi',
  'marshalling-points': 'self-mp',
  'score-box': 'self-score',
  'phase-meter': 'phase-meter',
  'hand': 'hand-arc',
  'play-deck': 'self-deck-pile',
  'discard-pile': 'self-discard-pile',
  'sideboard': 'self-sideboard-pile',
  'site-deck': 'self-site-pile',
  'dice': 'self-dice-tray',
  'opponent-dice': 'opponent-dice-tray',
  'hazard-limit': 'opponent-hazard-limit',
  'player-name': 'self-name',
  'map': 'map-radar',
  'text-log': 'game-log-panel',
  'view-toggle': 'company-view-toggle',
};

/**
 * Reposition on window resize and after any click (client-side toggles like
 * expanding the deck box show/hide anchors without a state broadcast);
 * registered once, acts on current bubbles.
 */
let repositionListenersRegistered = false;

/**
 * Callback behind the completion card's "Exit Tutorial" button. Registered
 * by game-connection.ts (its `disconnect()`) at module load — a forward
 * reference like `setReplayExit`, so this module never imports
 * game-connection.js and creates a cycle (game-connection.ts already imports
 * {@link renderTutorialPanel}).
 */
let exitTutorialFn: (() => void) | null = null;

/** Register the handler for the completion card's exit button. */
export function setExitTutorial(fn: () => void): void {
  exitTutorialFn = fn;
}

/** Create an element with the given class and optional text content. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Append the `#tutorial-dim` backdrop to `document.body` (any previous one is
 * removed by the caller). An optional class selects a heavier variant.
 */
function dimBackdrop(className?: string): void {
  const dim = document.createElement('div');
  dim.id = 'tutorial-dim';
  if (className !== undefined) dim.className = className;
  document.body.appendChild(dim);
}

/**
 * Render (or remove) the tutorial panel for the current view. Shows the
 * active step's title and instruction, glossary entries for concepts the
 * step introduces, and overall progress (steps narrate the Mentor's turns
 * in their own body text — "Watch: …"). Also renders the step's pointer
 * bubbles over the UI elements they reference, and — when the step
 * illustrates a card — the card image beside the instruction with a red
 * circle over the highlighted attribute.
 */
export function renderTutorialPanel(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  document.getElementById('tutorial-panel')?.remove();
  document.getElementById('tutorial-complete')?.remove();
  const progress = view.tutorial;
  if (!progress) {
    renderBubbles([]);
    document.getElementById('tutorial-dim')?.remove();
    return;
  }
  // Only render inside a game screen (the board is the marker element).
  if (!document.getElementById('visual-board')) return;

  // The chapter is over: the docked instruction panel gives way to a card in
  // the middle of the board recapping the chapter. Every human action is
  // gated off from here on (see gateHumanActions), so its button is the
  // player's only way out.
  if (progress.done) {
    renderBubbles([]);
    renderCompletionCard(progress);
    return;
  }

  const panel = el('div', 'tutorial-panel');
  panel.id = 'tutorial-panel';

  const header = el('div', 'tutorial-panel-header');
  header.appendChild(el('span', 'tutorial-panel-title', progress.title));
  header.appendChild(el('span', 'tutorial-panel-progress', `Step ${progress.stepIndex + 1} of ${progress.stepCount}`));
  panel.appendChild(header);

  // Optional card illustration on the left, instruction text on the right.
  const main = el('div', 'tutorial-panel-main');
  panel.appendChild(main);

  if (progress.card) {
    // Built by hand rather than via createCardImageFromDefId: the element must
    // carry NO data-card-id/data-instance-id, or the FLIP animation would
    // match it to the same card in the hand/draft and slide it across the
    // screen on every render.
    const def = cardPool[progress.card.cardDefId as string];
    const imgPath = def ? cardImageProxyPath(def) : undefined;
    const img = def && imgPath ? document.createElement('img') : null;
    if (img && def && imgPath) {
      img.src = imgPath;
      img.alt = def.name;
      img.className = 'tutorial-panel-card-img';
      const figure = el('div', 'tutorial-panel-card');
      figure.appendChild(img);
      const highlight = progress.card.highlight;
      if (highlight) {
        const circle = el('div', 'tutorial-card-highlight');
        circle.style.left = `${(highlight.x - highlight.r) * 100}%`;
        circle.style.top = `${highlight.y * 100}%`;
        circle.style.width = `${highlight.r * 2 * 100}%`;
        // Height set from the rendered box via aspect-ratio in CSS.
        circle.style.transform = 'translateY(-50%)';
        figure.appendChild(circle);
      }
      main.appendChild(figure);
    }
  }

  const text = el('div', 'tutorial-panel-text');
  main.appendChild(text);

  const body = el('div', 'tutorial-panel-body');
  renderBodyText(body, progress.body);
  text.appendChild(body);

  if (progress.concepts?.length) {
    const concepts = el('div', 'tutorial-panel-concepts');
    for (const concept of progress.concepts) {
      const entry = el('div', 'tutorial-concept');
      entry.appendChild(el('span', 'tutorial-concept-term', concept.term));
      entry.appendChild(document.createTextNode(' — '));
      renderBodyText(entry, concept.explanation);
      concepts.appendChild(entry);
    }
    text.appendChild(concepts);
  }

  if (progress.footer) {
    text.appendChild(el('div', 'tutorial-panel-footer', progress.footer));
  }

  // Continue gate: the script is holding a dramatic Mentor beat. Dim the
  // board and offer the panel's own Continue button — the Mentor acts only
  // once the player has read the step and clicked.
  document.getElementById('tutorial-dim')?.remove();
  if (progress.awaitingContinue) {
    dimBackdrop();

    const cont = el('button', 'tutorial-continue-btn', 'Continue ➜');
    cont.type = 'button';
    cont.addEventListener('click', () => {
      const msg: ClientMessage = { type: 'tutorial-continue' };
      appState.ws?.send(JSON.stringify(msg));
    });
    panel.appendChild(cont);
  }

  document.body.appendChild(panel);

  renderBubbles(progress.pointers ?? []);
}

/**
 * Draw the end-of-chapter card over a dimmed board: what the chapter taught,
 * one line per lesson, and the single button that leaves the tutorial. Uses
 * the continue gate's `#tutorial-dim` backdrop, so the board behind it stays
 * visible but plainly out of play.
 */
function renderCompletionCard(progress: NonNullable<PlayerView['tutorial']>): void {
  document.getElementById('tutorial-dim')?.remove();
  // Heavier than the continue gate's backdrop: the game is over, and a
  // half-lit board behind the card still reads as a game in progress.
  dimBackdrop('tutorial-dim--complete');

  const card = el('div', 'tutorial-complete');
  card.id = 'tutorial-complete';

  card.appendChild(el('div', 'tutorial-complete-title', progress.title));

  const text = el('div', 'tutorial-complete-body');
  renderBodyText(text, progress.body);
  card.appendChild(text);

  if (progress.learned?.length) {
    const list = el('ul', 'tutorial-complete-learned');
    for (const lesson of progress.learned) {
      const item = document.createElement('li');
      renderBodyText(item, lesson);
      list.appendChild(item);
    }
    card.appendChild(list);
  }

  if (progress.footer) {
    card.appendChild(el('div', 'tutorial-panel-footer', progress.footer));
  }

  const exit = el('button', 'tutorial-exit-btn', 'Exit Tutorial');
  exit.type = 'button';
  exit.addEventListener('click', () => exitTutorialFn?.());
  card.appendChild(exit);

  document.body.appendChild(card);
}

/** Region types the `{{...}}` icon token accepts. */
const REGION_TOKEN_TYPES = new Set(['wilderness', 'shadow', 'dark', 'coastal', 'free', 'border']);

/**
 * Render a step's instruction text into `parent`. Plain text except for two
 * inline tokens: `[[Label]]` names an on-screen button the step asks the
 * player to press (e.g. "Press [[Done]].") and renders as a chip styled like
 * the real button, and `{{region-type}}` (e.g. `{{wilderness}}`) renders the
 * original MECCG region symbol icon inline.
 */
function renderBodyText(parent: HTMLElement, text: string): void {
  const parts = text.split(/\[\[(.+?)\]\]|\{\{(.+?)\}\}/);
  // split() with two capture groups cycles [text, button, region, text, …];
  // the group that did not match is undefined.
  parts.forEach((part, i) => {
    if (part === undefined) return;
    const kind = i % 3;
    if (kind === 0) {
      if (part) parent.appendChild(document.createTextNode(part));
    } else if (kind === 1) {
      parent.appendChild(el('span', 'tutorial-inline-button', part));
    } else if (REGION_TOKEN_TYPES.has(part)) {
      parent.appendChild(createRegionTypeIcon(part as RegionType, 14));
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

/**
 * Remove the panel and its pointer bubbles. Both live on `document.body`,
 * outside the game screen, so leaving a game must clear them explicitly —
 * hiding `#game` or wiping the board no longer takes them along.
 */
export function clearTutorialPanel(): void {
  document.getElementById('tutorial-panel')?.remove();
  document.getElementById('tutorial-bubbles')?.remove();
  document.getElementById('tutorial-dim')?.remove();
  document.getElementById('tutorial-complete')?.remove();
}

/**
 * Rebuild the pointer bubbles: one fixed-position callout per pointer whose
 * anchor element is present and visible. Bubbles are measured and placed in
 * a rAF so they see the post-render layout (this renderer runs last in the
 * broadcast render pass, but sizes are only final once in the DOM).
 */
function renderBubbles(pointers: readonly TutorialPointer[]): void {
  document.getElementById('tutorial-bubbles')?.remove();
  if (pointers.length === 0) return;

  const container = document.createElement('div');
  container.id = 'tutorial-bubbles';
  for (const pointer of pointers) {
    const bubble = el('div', 'tutorial-bubble');
    if (pointer.anchor) bubble.dataset.anchor = ANCHOR_ELEMENT_IDS[pointer.anchor];
    if (pointer.cardDefId) bubble.dataset.cardDef = pointer.cardDefId as string;
    if (pointer.side) bubble.dataset.side = pointer.side;
    bubble.textContent = pointer.label;
    container.appendChild(bubble);
  }
  document.body.appendChild(container);
  requestAnimationFrame(positionBubbles);
  // Cards may still be mid-FLIP (up to ~800ms) when the first pass measures
  // them; a settle pass re-anchors bubbles at the cards' final positions.
  setTimeout(positionBubbles, 900);

  if (!repositionListenersRegistered) {
    repositionListenersRegistered = true;
    window.addEventListener('resize', () => positionBubbles());
    document.addEventListener('click', () => requestAnimationFrame(positionBubbles));
  }
}

/**
 * The largest on-screen card image with the given definition id, or null
 * when none is visible in the viewport.
 */
function largestVisibleCard(defId: string): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const img of document.querySelectorAll<HTMLElement>(`img[data-card-id="${defId}"]`)) {
    const r = img.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0
      && r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth;
    const area = r.width * r.height;
    if (onScreen && area > bestArea) {
      best = img;
      bestArea = area;
    }
  }
  return best;
}

/** Place every current bubble beside its anchor; hide those without one. */
function positionBubbles(): void {
  const container = document.getElementById('tutorial-bubbles');
  if (!container) return;
  for (const bubble of container.querySelectorAll<HTMLElement>('.tutorial-bubble')) {
    // Card-anchored bubbles pick the LARGEST on-screen card image with the
    // definition id — the same card may also appear as a small thumbnail in
    // piles, the log, or the hand arc, and DOM order would pick arbitrarily.
    // Element-anchored bubbles resolve their fixed id.
    const target = bubble.dataset.cardDef !== undefined
      ? largestVisibleCard(bubble.dataset.cardDef)
      : document.getElementById(bubble.dataset.anchor ?? '');
    const rect = target?.getBoundingClientRect();
    const visible = target !== null && target !== undefined
      && !target.classList.contains('hidden')
      && rect !== undefined && (rect.width > 0 || rect.height > 0);
    if (!visible || !rect) {
      bubble.classList.remove('tutorial-bubble--visible');
      continue;
    }
    const bubbleRect = bubble.getBoundingClientRect();

    // A 'right'/'left' placement hint sits the bubble beside the anchor
    // (arrow on the edge facing it), leaving the space above free for the
    // anchor's own hover tooltip (e.g. the GI breakdown) or fitting anchors
    // that hug a screen edge (e.g. the map radar).
    if (bubble.dataset.side === 'right' || bubble.dataset.side === 'left') {
      const toRight = bubble.dataset.side === 'right';
      bubble.classList.remove('tutorial-bubble--above', 'tutorial-bubble--below');
      bubble.classList.toggle('tutorial-bubble--right', toRight);
      bubble.classList.toggle('tutorial-bubble--left', !toRight);
      const top = rect.top + rect.height / 2 - bubbleRect.height / 2;
      bubble.style.top = `${Math.max(8, Math.min(top, window.innerHeight - bubbleRect.height - 8))}px`;
      const left = toRight ? rect.right + 14 : rect.left - bubbleRect.width - 14;
      bubble.style.left = `${Math.max(8, Math.min(left, window.innerWidth - bubbleRect.width - 8))}px`;
      bubble.classList.add('tutorial-bubble--visible');
      continue;
    }

    // Prefer sitting above the anchor (arrow pointing down at it); flip
    // below when the anchor hugs the top of the viewport, or always when
    // the pointer carries a 'below' placement hint.
    const above = rect.top - bubbleRect.height - 14;
    const placeAbove = bubble.dataset.side !== 'below' && above >= 8;
    bubble.classList.toggle('tutorial-bubble--above', placeAbove);
    bubble.classList.toggle('tutorial-bubble--below', !placeAbove);
    bubble.style.top = `${placeAbove ? above : rect.bottom + 14}px`;
    const centered = rect.left + rect.width / 2 - bubbleRect.width / 2;
    const left = Math.max(8, Math.min(centered, window.innerWidth - bubbleRect.width - 8));
    bubble.style.left = `${left}px`;
    // Keep the arrow on the anchor even when the bubble was clamped.
    const arrowX = rect.left + rect.width / 2 - left;
    bubble.style.setProperty('--bubble-arrow-x', `${Math.max(12, Math.min(arrowX, bubbleRect.width - 12))}px`);
    bubble.classList.add('tutorial-bubble--visible');
  }
}
