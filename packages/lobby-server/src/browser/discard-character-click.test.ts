/**
 * @module discard-character-click.test
 *
 * Regression test for bug reports 1c4ad76dd2be293d / c875f68028fadb84 (game
 * msxnlp2t-ovz3nh, turn 16, organization phase): "Can not discard Ioreth" /
 * "I am not sure were to look for a discard option... where is the Discard
 * button?"
 *
 * The engine correctly offers `discard-character` (CoE rule 3.22 — the
 * resource player may discard a non-avatar character while organizing if its
 * company is at a haven or the character's home site) — see
 * `discardCharacterActions` in `organization-characters.ts`. But nothing in
 * the lobby-server browser UI ever consulted that action type:
 * `company-actions.ts` had no getter for it, `buildCombinedClick` in
 * company-block.ts never checked for it, and `showCharacterActionTooltip`
 * never listed it as a menu option. A character alone in her own company with
 * no split/move/merge/sideboard/corruption-check action available (like
 * Ioreth here) was therefore not even clickable, leaving the player with no
 * way to discard her.
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
  DiscardCharacterOrgAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock('./dialog.js', () => ({ showConfirm }));

// Vitest hoists the vi.mock call above to the top of the module (before these
// static imports run), so company-block picks up the mocked showConfirm.
import { renderCompanyBlock } from './company-block.js';
import { getDiscardCharacterActions } from './company-actions.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const IORETH = 'td-93' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const IORETH_INST = 'p1-112' as CardInstanceId;

const COMPANY_ID = 'company-p1-3';

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
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
  };
  showConfirm.mockReset();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const ioreth: CharacterInPlay = {
  instanceId: IORETH_INST,
  definitionId: IORETH,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 0, body: 7, directInfluence: 1, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

// Alone in her own company at a haven — no split/move/merge action exists,
// so discard-character is the only action type offered for her.
const company = {
  id: COMPANY_ID,
  characters: [IORETH_INST],
  currentSite: { instanceId: 'p1-71', definitionId: 'wh-58', status: 'untapped' },
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const discardIoreth: DiscardCharacterOrgAction = {
  type: 'discard-character',
  player: PLAYER,
  characterInstanceId: IORETH_INST,
};

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [IORETH_INST as string]: ioreth },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions,
  } as unknown as PlayerView;
}

const findIorethImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (IORETH_INST as string));

describe('a character whose only organization-phase action is discard-character', () => {
  test('clicking the character asks for confirmation before dispatching the discard', async () => {
    setCachedInstanceLookup((id: CardInstanceId) => (id === IORETH_INST ? IORETH : undefined));
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(true);
    const view = boardView([discardIoreth]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      discardCharacterActions: getDiscardCharacterActions(view),
    }) as unknown as StubEl;

    const img = findIorethImg(block);
    expect(img).toBeDefined();

    img!.click();

    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(showConfirm.mock.calls[0][0]).toBe('Discard Ioreth?');
    expect(onAction).not.toHaveBeenCalled();

    await Promise.resolve(); // flush the mocked showConfirm promise
    expect(onAction).toHaveBeenCalledWith(discardIoreth);
  });

  test('declining the confirmation does not dispatch the discard', async () => {
    setCachedInstanceLookup((id: CardInstanceId) => (id === IORETH_INST ? IORETH : undefined));
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(false);
    const view = boardView([discardIoreth]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      discardCharacterActions: getDiscardCharacterActions(view),
    }) as unknown as StubEl;

    findIorethImg(block)!.click();

    await Promise.resolve();
    expect(onAction).not.toHaveBeenCalled();
  });

  test('a character with no discard action offered is unaffected', () => {
    setCachedInstanceLookup((id: CardInstanceId) => (id === IORETH_INST ? IORETH : undefined));
    const onAction = vi.fn();
    const view = boardView([]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      discardCharacterActions: getDiscardCharacterActions(view),
    }) as unknown as StubEl;

    findIorethImg(block)!.click();
    expect(onAction).not.toHaveBeenCalled();
    expect(showConfirm).not.toHaveBeenCalled();
  });
});
