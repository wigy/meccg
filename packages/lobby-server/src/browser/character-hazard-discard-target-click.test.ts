/**
 * @module character-hazard-discard-target-click.test
 *
 * Regression test for bug report 2fd37e5fc884babb (game mu5vwq3e-6q8jxj, turn
 * 27, movement-hazard phase): playing The Cock Crows (tw-342) to discard a
 * hazard permanent-event, with Gates of Morning in play, correctly offered
 * both Balrog of Moria (a free-standing `cardsInPlay` entry) and Lure of
 * Expedience (a hazard attached to the reporter's own character Balin) as
 * legal `discardTargetInstanceId` targets — confirmed directly against the
 * engine's `computeLegalActions` output for the logged state. But only the
 * Balrog lit up in the browser; the character-attached Lure never did, and
 * clicking it did nothing.
 *
 * `buildHazardClick` in company-block.ts checked `CHARACTER_TARGETING_MODES`
 * (which matches a selected short event's `targetScoutInstanceId`) *before*
 * `buildDiscardTargetClick` (which matches `discardTargetInstanceId`). A
 * hazard's own instance id is never a valid `targetScoutInstanceId`, so that
 * targeting-mode check always found zero matches and returned `undefined`
 * immediately — short-circuiting before the discard-target click was ever
 * considered. `buildItemClick` already checked `buildDiscardTargetClick`
 * first for the identical reason (see its docstring); `buildHazardClick` now
 * does the same.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, afterEach } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { setSelectedShortEvent, clearShortEventSelection } from './render-selection-state.js';
import { setLastView } from './company-view-state.js';

const pool = loadCardPool();

const BALIN = 'tw-123' as CardDefinitionId;
const LURE_OF_EXPEDIENCE = 'le-122' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BALIN_INST = 'p1-134' as CardInstanceId;
const LURE_INST = 'p2-50' as CardInstanceId;
const COCK_CROWS_INST = 'p1-14' as CardInstanceId;

const COMPANY_ID = 'company-p1-0';

// --- Minimal DOM stub, mirroring site-attachment-discard-target-click.test.ts

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    add: (...cs: string[]) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      for (const c of cs) set.add(c);
      this.className = [...set].join(' ');
    },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  get childElementCount(): number { return this.children.length; }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
  getElementById: () => null,
};

afterEach(() => {
  clearShortEventSelection();
  setLastView(null);
});

// --- Fixtures ----------------------------------------------------------------

const balin: CharacterInPlay = {
  instanceId: BALIN_INST,
  definitionId: BALIN,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [{ instanceId: LURE_INST, definitionId: LURE_OF_EXPEDIENCE, status: CardStatus.Untapped }],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 6, body: 6, directInfluence: 6, corruptionPoints: 3 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [BALIN_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

function discardTargetAction(): GameAction {
  return {
    type: 'play-short-event',
    player: PLAYER,
    cardInstanceId: COCK_CROWS_INST,
    discardTargetInstanceId: LURE_INST,
  } as GameAction;
}

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [BALIN_INST as string]: balin },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard', step: 'play-hazards' },
    legalActions,
  } as unknown as PlayerView;
}

const findLureImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (LURE_INST as string));

describe('character-attached hazard discard-target click (Lure of Expedience, The Cock Crows)', () => {
  test('lights up and dispatches the discard action when a matching short event is selected', () => {
    setSelectedShortEvent(COCK_CROWS_INST);
    const action = discardTargetAction();
    const view = boardView([action]);
    setLastView(view);
    let dispatched: GameAction | undefined;

    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction: (a) => { dispatched = a; },
    }) as unknown as StubEl;

    const img = findLureImg(block);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--influence-target');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('does not highlight the hazard when no short event is selected', () => {
    const view = boardView([]);
    setLastView(view);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction: () => { /* no-op */ },
    }) as unknown as StubEl;

    const img = findLureImg(block);
    expect(img).toBeDefined();
    expect(img!.className).not.toContain('company-card--influence-target');
  });
});
