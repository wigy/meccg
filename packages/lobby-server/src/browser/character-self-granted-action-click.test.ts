/**
 * @module character-self-granted-action-click.test
 *
 * Regression test for bug report fc78a8d628bece9d (game ms91qumb-t6en5f, seq
 * 973): "No option to tap to test a gold ring" for Gandalf (tw-156).
 *
 * The engine correctly offered `activate-granted-action` (test-gold-ring) with
 * `sourceCardId` set to Gandalf's own instance ID — grant-actions declared
 * directly on a character card (as opposed to on an attached item or hazard)
 * are keyed by the character's own instance ID in the `grantedActions` map
 * built by `getGrantedActions`. But `buildCombinedClick` in company-block.ts
 * only ever consulted that map for attached items/hazards (`buildItemClick`,
 * `buildHazardClick`) — never for the character's own instance ID — so the
 * option was silently invisible on the board: no click affordance, no tooltip
 * entry, even though the server offered valid targets.
 *
 * Uses the same hand-rolled DOM stub as company-attachments-render.test.ts
 * (the package runs vitest in the default node environment, with no jsdom),
 * extended with `body`/`querySelector`/`getBoundingClientRect` so the tooltip
 * menu path (`showTooltipMenu`) can run end-to-end.
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
  ActivateGrantedAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getGrantedActions } from './company-actions.js';

const pool = loadCardPool();

const GANDALF = 'tw-156' as CardDefinitionId;
const GOLD_RING = 'tw-196' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const GANDALF_INST = 'p1-2' as CardInstanceId;
const RING_A = 'p1-3' as CardInstanceId;
const RING_B = 'p1-5' as CardInstanceId;

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

const gandalf: CharacterInPlay = {
  instanceId: GANDALF_INST,
  definitionId: GANDALF,
  status: CardStatus.Untapped,
  items: [
    { instanceId: RING_A, definitionId: GOLD_RING, status: CardStatus.Untapped },
    { instanceId: RING_B, definitionId: GOLD_RING, status: CardStatus.Untapped },
  ],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 8, body: 9, directInfluence: 10, corruptionPoints: 3 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [GANDALF_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const testGoldRing = (targetCardId: CardInstanceId): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: PLAYER,
  characterId: GANDALF_INST,
  sourceCardId: GANDALF_INST,
  sourceCardDefinitionId: GANDALF,
  actionId: 'test-gold-ring',
  rollThreshold: 0,
  targetCardId,
} as unknown as ActivateGrantedAction);

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [GANDALF_INST as string]: gandalf },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions,
  } as unknown as PlayerView;
}

const findGandalfImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (GANDALF_INST as string));

describe('a grant-action declared on a character card itself (Gandalf test-gold-ring)', () => {
  test('with a single target, clicking the character fires the action directly', () => {
    const onAction = vi.fn();
    const view = boardView([testGoldRing(RING_A)]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findGandalfImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--transfer-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(testGoldRing(RING_A));
  });

  test('with two targets (two Beautiful Gold Rings), clicking the character opens a menu with both', () => {
    const onAction = vi.fn();
    const view = boardView([testGoldRing(RING_A), testGoldRing(RING_B)]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findGandalfImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--transfer-source')).toBe(true);

    img!.click();

    const tooltip = bodyStub.all().find(e => e.className === 'char-action-tooltip');
    expect(tooltip).toBeDefined();
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons).toHaveLength(2);

    buttons[0].click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
