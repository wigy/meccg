/**
 * @module render-hand-declare-burglary.test
 *
 * Regression test for bug report 1559d4018415ea85 (game mu72bs09-fobneu, seq
 * 768, turn 19, phase site): "the Burglary card wasn't highlighted and if I
 * clicked on it nothing happened."
 *
 * The engine correctly offered `declare-burglary` for the Burglary (td-103)
 * card in hand at the automatic-attacks step (confirmed in the game log's
 * legalActions at seq 765) — the earlier engine-only investigation (bug
 * 6ef9fdbeb2e6171f) had already established the rule was followed correctly.
 * But `company-block.ts` only wires `declare-burglary` into the *character's*
 * click handler (see `declare-burglary-click.test.ts`); `render-hand.ts` never
 * checked for the action type on the hand card itself, so the card fell
 * through to the final `else` branch — rendered `hand-card-dimmed` with no
 * click listener at all, indistinguishable from a genuinely dead card.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { renderHand } from './render-hand.js';
import { resetState } from './company-view-state.js';

const pool = loadCardPool();

const BURGLARY = 'td-103' as CardDefinitionId;
const BURGLARY_INST = 'p1-36' as CardInstanceId;
const BURGLARY_INST_B = 'p1-37' as CardInstanceId;
const BILBO = 'tw-131' as CardDefinitionId;
const BILBO_INST = 'p1-188' as CardInstanceId;
const SAM = 'tw-131' as CardDefinitionId;
const SAM_INST = 'p1-189' as CardInstanceId;

function declareBurglary(cardInstanceId: CardInstanceId, characterInstanceId: CardInstanceId): GameAction {
  return {
    type: 'declare-burglary',
    player: 'p1',
    cardInstanceId,
    characterInstanceId,
  } as GameAction;
}

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  title = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }
  remove(): void { /* no-op */ }
  dispatch(type: string, event: unknown = { clientX: 0, clientY: 0, stopPropagation() { /* no-op */ } }): void {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let handArc: StubEl;
let body: StubEl;

beforeEach(() => {
  handArc = new StubEl('div');
  body = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id === 'hand-arc' ? handArc : null),
    querySelector: () => null,
    body,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  resetState();
});

/** A player view mid site-phase automatic-attacks step, holding Burglary. */
function siteView(
  legalActions: GameAction[],
  extraCharacters: Record<string, unknown> = {},
  hand: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[] =
    [{ instanceId: BURGLARY_INST, definitionId: BURGLARY }],
): PlayerView {
  const emptySide = {
    hand: [] as unknown[], playDeck: [], siteDeck: [], discardPile: [], siteDiscardPile: [],
    sideboard: [], killPile: [], outOfPlayPile: [], cardsInPlay: [], characters: {}, companies: [], agents: [],
  };
  return {
    self: {
      ...emptySide,
      id: 'p1',
      hand,
      characters: {
        [BILBO_INST as string]: {
          instanceId: BILBO_INST, definitionId: BILBO, status: CardStatus.Untapped,
          items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
        },
        ...extraCharacters,
      },
      companies: [{ id: 'company-p1-0', currentSite: null, destinationSite: null, onGuardCards: [] }],
    },
    opponent: { ...emptySide, id: 'p2' },
    activePlayer: 'p1',
    selfIndex: 0,
    phaseState: { phase: Phase.Site, step: 'automatic-attacks' },
    legalActions: legalActions.map(action => ({ action, viable: true })),
  } as unknown as PlayerView;
}

describe('Burglary hand card is clickable during the automatic-attacks step (Burglary, td-103)', () => {
  test('with a single character eligible, clicking the hand card dispatches the action directly', () => {
    let sent: GameAction | null = null;
    const action = declareBurglary(BURGLARY_INST, BILBO_INST);
    renderHand(siteView([action]), pool, a => { sent = a; });

    const cardImgs = handArc.children[0]?.children ?? [];
    const burglaryImg = cardImgs.find(img => img.dataset.instanceId === (BURGLARY_INST as string));
    expect(burglaryImg).toBeDefined();
    expect(burglaryImg?.className).toBe('hand-card hand-card-playable');

    burglaryImg?.dispatch('click');
    expect(sent).toEqual(action);
  });

  test('with two characters eligible, clicking the hand card opens a menu naming each', () => {
    let sent: GameAction | null = null;
    const actionA = declareBurglary(BURGLARY_INST, BILBO_INST);
    const actionB = declareBurglary(BURGLARY_INST, SAM_INST);
    const view = siteView([actionA, actionB], {
      [SAM_INST as string]: {
        instanceId: SAM_INST, definitionId: SAM, status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [], controlledBy: 'general',
      },
    });
    renderHand(view, pool, a => { sent = a; });

    const cardImgs = handArc.children[0]?.children ?? [];
    const burglaryImg = cardImgs.find(img => img.dataset.instanceId === (BURGLARY_INST as string));
    expect(burglaryImg).toBeDefined();
    expect(burglaryImg?.className).toBe('hand-card hand-card-playable');

    burglaryImg?.dispatch('click');

    const tooltip = body.all().find(e => e.className === 'chain-target-tooltip');
    expect(tooltip).toBeDefined();
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons).toHaveLength(2);

    buttons[0].dispatch('click');
    expect(sent).toEqual(actionA);
  });

  test('a second Burglary copy in hand does not affect the first copy\'s single-target action', () => {
    let sent: GameAction | null = null;
    const actionA = declareBurglary(BURGLARY_INST, BILBO_INST);
    const actionB = declareBurglary(BURGLARY_INST_B, BILBO_INST);
    const view = siteView([actionA, actionB], {}, [
      { instanceId: BURGLARY_INST, definitionId: BURGLARY },
      { instanceId: BURGLARY_INST_B, definitionId: BURGLARY },
    ]);
    renderHand(view, pool, a => { sent = a; });

    const cardImgs = handArc.children[0]?.children ?? [];
    const firstImg = cardImgs.find(img => img.dataset.instanceId === (BURGLARY_INST as string));
    expect(firstImg?.className).toBe('hand-card hand-card-playable');

    firstImg?.dispatch('click');
    expect(sent).toEqual(actionA);
  });
});
