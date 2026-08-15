/**
 * @module haven-restore-character-click.test
 *
 * Regression test for bug report 8d30b8d55208c736 (game mst6nid7-0t6edg, seq
 * 768): "No UI option to activate Hall of Fire to untap characters during
 * Movement/Hazard phase or during beginning of Site phase. Unable to untap
 * characters."
 *
 * The engine correctly offers `restore-character-by-effect` (one per
 * tapped/wounded character in the company) once a `haven-restore-character`
 * pending resolution is enqueued — see `dm-134.test.ts` in
 * `@meccg/shared`. But nothing in the lobby-server browser UI ever consulted
 * that action type: `company-actions.ts` had no getter for it, and
 * `buildCombinedClick` in company-block.ts never checked for it, so the
 * option was invisible on the board — clicking a tapped character did
 * nothing, leaving the player only able to `pass` and forfeit the untap/heal.
 *
 * Uses the same hand-rolled DOM stub as character-self-granted-action-click.test.ts
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
  RestoreCharacterByEffectAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getRestoreCharacterActions } from './company-actions.js';

const pool = loadCardPool();

const SARUMAN = 'wh-9' as CardDefinitionId;
const VOTELI = 'tw-185' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const SARUMAN_INST = 'p1-0' as CardInstanceId;
const VOTELI_INST = 'p1-110' as CardInstanceId;

const COMPANY_ID = 'company-p1-0';

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

const saruman: CharacterInPlay = {
  instanceId: SARUMAN_INST,
  definitionId: SARUMAN,
  status: CardStatus.Tapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [VOTELI_INST],
  controlledBy: 'general',
  effectiveStats: { prowess: 6, body: 9, directInfluence: 12, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const voteli: CharacterInPlay = {
  instanceId: VOTELI_INST,
  definitionId: VOTELI,
  status: CardStatus.Tapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: SARUMAN_INST,
  effectiveStats: { prowess: 3, body: 6, directInfluence: 1, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [SARUMAN_INST, VOTELI_INST],
  currentSite: null,
  siteCardOwned: false,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const restoreSaruman: RestoreCharacterByEffectAction = {
  type: 'restore-character-by-effect',
  player: PLAYER,
  characterInstanceId: SARUMAN_INST,
} as unknown as RestoreCharacterByEffectAction;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [SARUMAN_INST as string]: saruman, [VOTELI_INST as string]: voteli },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'site' },
    legalActions,
  } as unknown as PlayerView;
}

const findImg = (block: StubEl, instanceId: CardInstanceId): StubEl | undefined =>
  [block, ...block.children].flatMap(function collect(e: StubEl): StubEl[] { return [e, ...e.children.flatMap(collect)]; })
    .find(e => e.tagName === 'img' && e.dataset.instanceId === (instanceId as string));

describe('Hall of Fire restore-character-by-effect on a company at Isengard', () => {
  test('clicking a tapped character with a pending restore offer fires the action directly', () => {
    const onAction = vi.fn();
    const view = boardView([restoreSaruman]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      restoreCharacterActions: getRestoreCharacterActions(view),
    }) as unknown as StubEl;

    const img = findImg(block, SARUMAN_INST);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(restoreSaruman);
  });

  test('a character with no pending restore offer is unaffected', () => {
    const onAction = vi.fn();
    const view = boardView([restoreSaruman]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      restoreCharacterActions: getRestoreCharacterActions(view),
    }) as unknown as StubEl;

    const img = findImg(block, VOTELI_INST);
    // No action offered for Vôteli — clicking should not invoke onAction.
    if (img) img.click();
    expect(onAction).not.toHaveBeenCalled();
  });
});
