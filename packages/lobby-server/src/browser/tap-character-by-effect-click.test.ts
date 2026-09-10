/**
 * @module tap-character-by-effect-click.test
 *
 * Regression test for bug report 5c4a0e9c3293d7df (game mtuihznt-inn090, seq
 * 749): "doesnt want to finish the companies MH" — a company revealed
 * Tolfalas (as-162) as its new site, which is overt-mandatory: "An overt
 * company must tap an untapped character (if available) if this site is
 * revealed as its new site." The engine correctly enqueues a
 * `tap-one-character` pending resolution and offers one
 * `tap-character-by-effect` action per untapped character (confirmed by
 * `as-162.test.ts`), and `pass` is deliberately withheld while an untapped
 * character remains — but nothing in the lobby-server browser UI ever
 * consulted that action type: `company-actions.ts` had no getter for it, and
 * `buildCombinedClick` in company-block.ts never checked for it, so clicking
 * a character did nothing and the phase could never advance from the board.
 *
 * Uses the same hand-rolled DOM stub as haven-restore-character-click.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  TapCharacterByEffectAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getTapCharacterByEffectActions } from './company-actions.js';

const pool = loadCardPool();

const GORBAG = 'le-11' as CardDefinitionId;
const SHAGRAT = 'le-39' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const GORBAG_INST = 'p1-4' as CardInstanceId;
const SHAGRAT_INST = 'p1-127' as CardInstanceId;

const COMPANY_ID = 'company-p1-1';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: () => void } = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ }, currentTarget: this, target: this });
  }
  get childElementCount(): number { return this.children.length; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

// --- View fixtures ----------------------------------------------------------

const gorbag: CharacterInPlay = {
  instanceId: GORBAG_INST,
  definitionId: GORBAG,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 6, body: 6, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const shagrat: CharacterInPlay = {
  instanceId: SHAGRAT_INST,
  definitionId: SHAGRAT,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 6, body: 9, directInfluence: 0, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [GORBAG_INST, SHAGRAT_INST],
  currentSite: null,
  siteCardOwned: false,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: true,
} as unknown as Company;

const tapGorbag: TapCharacterByEffectAction = {
  type: 'tap-character-by-effect',
  player: PLAYER,
  characterInstanceId: GORBAG_INST,
} as unknown as TapCharacterByEffectAction;

const tapShagrat: TapCharacterByEffectAction = {
  type: 'tap-character-by-effect',
  player: PLAYER,
  characterInstanceId: SHAGRAT_INST,
} as unknown as TapCharacterByEffectAction;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [GORBAG_INST as string]: gorbag, [SHAGRAT_INST as string]: shagrat },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard', step: 'draw-cards' },
    legalActions,
  } as unknown as PlayerView;
}

const findImg = (block: StubEl, instanceId: CardInstanceId): StubEl | undefined =>
  [block, ...block.children].flatMap(function collect(e: StubEl): StubEl[] { return [e, ...e.children.flatMap(collect)]; })
    .find(e => e.tagName === 'img' && e.dataset.instanceId === (instanceId as string));

describe('Tolfalas mandatory-tap tap-character-by-effect on a company that revealed the site', () => {
  test('clicking an untapped character with a pending mandatory tap fires the action directly', () => {
    const onAction = vi.fn();
    const view = boardView([tapGorbag, tapShagrat]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      tapCharacterByEffectActions: getTapCharacterByEffectActions(view),
    }) as unknown as StubEl;

    const img = findImg(block, GORBAG_INST);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(tapGorbag);
  });

  test('a character with no legal action map wired in is unaffected', () => {
    const onAction = vi.fn();
    const view = boardView([tapGorbag, tapShagrat]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      // tapCharacterByEffectActions intentionally omitted — reproduces the bug
    }) as unknown as StubEl;

    const img = findImg(block, GORBAG_INST);
    if (img) img.click();
    expect(onAction).not.toHaveBeenCalled();
  });
});
