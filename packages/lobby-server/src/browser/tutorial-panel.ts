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
  const progress = view.tutorial;
  if (!progress) {
    renderBubbles([]);
    return;
  }
  // Only render inside a game screen (the board is the marker element).
  if (!document.getElementById('visual-board')) return;

  const panel = document.createElement('div');
  panel.id = 'tutorial-panel';
  panel.className = progress.done ? 'tutorial-panel tutorial-panel--done' : 'tutorial-panel';

  const header = document.createElement('div');
  header.className = 'tutorial-panel-header';

  const title = document.createElement('span');
  title.className = 'tutorial-panel-title';
  title.textContent = progress.title;
  header.appendChild(title);

  const step = document.createElement('span');
  step.className = 'tutorial-panel-progress';
  step.textContent = progress.done
    ? 'Complete!'
    : `Step ${progress.stepIndex + 1} of ${progress.stepCount}`;
  header.appendChild(step);

  panel.appendChild(header);

  // Optional card illustration on the left, instruction text on the right.
  const main = document.createElement('div');
  main.className = 'tutorial-panel-main';
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
      const figure = document.createElement('div');
      figure.className = 'tutorial-panel-card';
      figure.appendChild(img);
      const highlight = progress.card.highlight;
      if (highlight) {
        const circle = document.createElement('div');
        circle.className = 'tutorial-card-highlight';
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

  const text = document.createElement('div');
  text.className = 'tutorial-panel-text';
  main.appendChild(text);

  const body = document.createElement('div');
  body.className = 'tutorial-panel-body';
  renderBodyText(body, progress.body);
  text.appendChild(body);

  if (progress.concepts?.length) {
    const concepts = document.createElement('div');
    concepts.className = 'tutorial-panel-concepts';
    for (const concept of progress.concepts) {
      const entry = document.createElement('div');
      entry.className = 'tutorial-concept';
      const term = document.createElement('span');
      term.className = 'tutorial-concept-term';
      term.textContent = concept.term;
      entry.appendChild(term);
      entry.appendChild(document.createTextNode(' — '));
      renderBodyText(entry, concept.explanation);
      concepts.appendChild(entry);
    }
    text.appendChild(concepts);
  }

  if (progress.footer) {
    const footer = document.createElement('div');
    footer.className = 'tutorial-panel-footer';
    footer.textContent = progress.footer;
    text.appendChild(footer);
  }

  // Continue gate: the script is holding a dramatic Mentor beat. Dim the
  // board and offer the panel's own Continue button — the Mentor acts only
  // once the player has read the step and clicked.
  document.getElementById('tutorial-dim')?.remove();
  if (progress.awaitingContinue) {
    const dim = document.createElement('div');
    dim.id = 'tutorial-dim';
    document.body.appendChild(dim);

    const cont = document.createElement('button');
    cont.type = 'button';
    cont.className = 'tutorial-continue-btn';
    cont.textContent = 'Continue ➜';
    cont.addEventListener('click', () => {
      const msg: ClientMessage = { type: 'tutorial-continue' };
      appState.ws?.send(JSON.stringify(msg));
    });
    panel.appendChild(cont);
  }

  document.body.appendChild(panel);

  renderBubbles(progress.done ? [] : progress.pointers ?? []);
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
      const chip = document.createElement('span');
      chip.className = 'tutorial-inline-button';
      chip.textContent = part;
      parent.appendChild(chip);
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
    const bubble = document.createElement('div');
    bubble.className = 'tutorial-bubble';
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
  for (const el of document.querySelectorAll<HTMLElement>(`img[data-card-id="${defId}"]`)) {
    const r = el.getBoundingClientRect();
    const onScreen = r.width > 0 && r.height > 0
      && r.bottom > 0 && r.top < window.innerHeight
      && r.right > 0 && r.left < window.innerWidth;
    const area = r.width * r.height;
    if (onScreen && area > bestArea) {
      best = el;
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
