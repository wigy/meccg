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

import type { CardDefinition, PlayerView, TutorialAnchorId, TutorialPointer } from '@meccg/shared';
import { cardImageProxyPath } from '@meccg/shared';

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
  'hazard-limit': 'opponent-hazard-limit',
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
 * step introduces, overall progress, and — when the script is waiting on
 * the Mentor — a watching note instead of a prompt. Also renders the step's
 * pointer bubbles over the UI elements they reference, and — when the step
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
  body.textContent = progress.body;
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
      entry.appendChild(document.createTextNode(` — ${concept.explanation}`));
      concepts.appendChild(entry);
    }
    text.appendChild(concepts);
  }

  if (!progress.done && !progress.yourTurn) {
    const waiting = document.createElement('div');
    waiting.className = 'tutorial-panel-waiting';
    waiting.textContent = 'Watch — the Mentor is acting…';
    text.appendChild(waiting);
  }

  if (progress.footer) {
    const footer = document.createElement('div');
    footer.className = 'tutorial-panel-footer';
    footer.textContent = progress.footer;
    text.appendChild(footer);
  }

  document.body.appendChild(panel);

  renderBubbles(progress.done ? [] : progress.pointers ?? []);
}

/**
 * Remove the panel and its pointer bubbles. Both live on `document.body`,
 * outside the game screen, so leaving a game must clear them explicitly —
 * hiding `#game` or wiping the board no longer takes them along.
 */
export function clearTutorialPanel(): void {
  document.getElementById('tutorial-panel')?.remove();
  document.getElementById('tutorial-bubbles')?.remove();
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
    bubble.dataset.anchor = ANCHOR_ELEMENT_IDS[pointer.anchor];
    bubble.textContent = pointer.label;
    container.appendChild(bubble);
  }
  document.body.appendChild(container);
  requestAnimationFrame(positionBubbles);

  if (!repositionListenersRegistered) {
    repositionListenersRegistered = true;
    window.addEventListener('resize', () => positionBubbles());
    document.addEventListener('click', () => requestAnimationFrame(positionBubbles));
  }
}

/** Place every current bubble beside its anchor; hide those without one. */
function positionBubbles(): void {
  const container = document.getElementById('tutorial-bubbles');
  if (!container) return;
  for (const bubble of container.querySelectorAll<HTMLElement>('.tutorial-bubble')) {
    const target = document.getElementById(bubble.dataset.anchor ?? '');
    const rect = target?.getBoundingClientRect();
    const visible = target !== null && target !== undefined
      && !target.classList.contains('hidden')
      && rect !== undefined && (rect.width > 0 || rect.height > 0);
    if (!visible || !rect) {
      bubble.classList.remove('tutorial-bubble--visible');
      continue;
    }
    // Prefer sitting above the anchor (arrow pointing down at it); flip
    // below when the anchor hugs the top of the viewport.
    const bubbleRect = bubble.getBoundingClientRect();
    const above = rect.top - bubbleRect.height - 14;
    const placeAbove = above >= 8;
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
