/**
 * @module declare-burglary-click.test
 *
 * Regression test for bug report af3da1d4a9e037a6 (game mt91bhx6-8nxbt0, seq
 * 755): "Game provided no UI option to play Burglary on Bilbo to bypass the
 * automatic-attack at Tolfalas."
 *
 * The engine correctly offered `declare-burglary` for Bilbo (tw-131) during
 * the site phase's `automatic-attacks` step — confirmed in the game log's
 * legalActions at seq 754. But nothing in the browser board wired that
 * action type to a character click: `getDeclareBurglaryActions` didn't
 * exist, `company-block.ts`'s click dispatcher never consulted it, and
 * `DeclareBurglaryAction`/`BurglaryAttemptRollAction` weren't even
 * re-exported from `@meccg/shared`'s public `actions.ts` (only imported
 * internally for the `GameAction` union), so no client code could import
 * the type to begin with.
 *
 * Uses the same hand-rolled DOM stub as
 * character-self-granted-action-click.test.ts (the package runs vitest in
 * the default node environment, with no jsdom).
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
  DeclareBurglaryAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getDeclareBurglaryActions } from './company-actions.js';

const pool = loadCardPool();

const BILBO = 'tw-131' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const BILBO_INST = 'p1-188' as CardInstanceId;
const BURGLARY_INST_A = 'p1-32' as CardInstanceId;
const BURGLARY_INST_B = 'p1-33' as CardInstanceId;

const COMPANY_ID = 'company-p1-0';

// --- Minimal DOM stub, extended with body/querySelector/getBoundingClientRect
// so showTooltipMenu (used by the multi-target menu path) can run. ----------

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
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  get childElementCount(): number { return this.children.length; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let bodyStub: StubEl;

beforeEach(() => {
  bodyStub = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    body: bodyStub,
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

// --- View fixtures ----------------------------------------------------------

const bilbo: CharacterInPlay = {
  instanceId: BILBO_INST,
  definitionId: BILBO,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 1, body: 2, directInfluence: 1, corruptionPoints: 1 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [BILBO_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const declareBurglary = (cardInstanceId: CardInstanceId): DeclareBurglaryAction => ({
  type: 'declare-burglary',
  player: PLAYER,
  cardInstanceId,
  characterInstanceId: BILBO_INST,
} as unknown as DeclareBurglaryAction);

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [BILBO_INST as string]: bilbo },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'site', step: 'automatic-attacks' },
    legalActions,
  } as unknown as PlayerView;
}

const findBilboImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (BILBO_INST as string));

describe('declare-burglary offered during the automatic-attacks step (Burglary, td-103)', () => {
  test('with a single Burglary in hand, clicking the character fires the action directly', () => {
    const onAction = vi.fn();
    const view = boardView([declareBurglary(BURGLARY_INST_A)]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      declareBurglaryActions: getDeclareBurglaryActions(view),
    }) as unknown as StubEl;

    const img = findBilboImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(declareBurglary(BURGLARY_INST_A));
  });

  test('with two copies of Burglary in hand, clicking the character opens a menu with both', () => {
    const onAction = vi.fn();
    const view = boardView([declareBurglary(BURGLARY_INST_A), declareBurglary(BURGLARY_INST_B)]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      declareBurglaryActions: getDeclareBurglaryActions(view),
    }) as unknown as StubEl;

    const img = findBilboImg(block);
    expect(img).toBeDefined();

    img!.click();

    const tooltip = bodyStub.all().find(e => e.className === 'char-action-tooltip');
    expect(tooltip).toBeDefined();
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons).toHaveLength(2);

    buttons[0].click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
