/**
 * @module ally-granted-action-click.test
 *
 * Regression test for bug report 51afedff283493eb (game mskidoss-noauyv, seq
 * 1026): "Cannot use [Tom Bombadil] to stop a Lure being played against a
 * character in his company (as per last line of his text)".
 *
 * The engine correctly offered `activate-granted-action` (cancel-chain-entry)
 * with `sourceCardId` set to Tom Bombadil's own ally instance ID — grant-
 * actions declared on an in-play ally are keyed by the ally's instance ID in
 * the `grantedActions` map built by `getGrantedActions`. But
 * `renderCharacterColumn` in company-character.ts only ever routed attached
 * cards to a click handler when they were an item (`itemClickBuilder`) or a
 * hazard (`hazardClickBuilder`) — an attached ally fell through to
 * `undefined`, so the card was rendered with no click affordance at all, even
 * though the server offered a valid target.
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

const HOST_CHARACTER = 'tw-156' as CardDefinitionId; // Gandalf — any hero character will do
const TOM_BOMBADIL = 'tw-350' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const HOST_INST = 'p1-1' as CardInstanceId;
const TOM_INST = 'p1-12' as CardInstanceId;

const COMPANY_ID = 'company-p1-2';

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

const hostCharacter: CharacterInPlay = {
  instanceId: HOST_INST,
  definitionId: HOST_CHARACTER,
  status: CardStatus.Untapped,
  items: [],
  allies: [
    { instanceId: TOM_INST, definitionId: TOM_BOMBADIL, status: CardStatus.Untapped },
  ],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 8, body: 9, directInfluence: 10, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const company = {
  id: COMPANY_ID,
  characters: [HOST_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const cancelChainEntry = (): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: PLAYER,
  characterId: HOST_INST,
  sourceCardId: TOM_INST,
  sourceCardDefinitionId: TOM_BOMBADIL,
  actionId: 'cancel-chain-entry',
  rollThreshold: 0,
} as unknown as ActivateGrantedAction);

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: { [HOST_INST as string]: hostCharacter },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard' },
    legalActions,
  } as unknown as PlayerView;
}

const findTomImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (TOM_INST as string));

describe('a grant-action declared on an in-play ally (Tom Bombadil cancel-chain-entry)', () => {
  test('clicking the ally card fires its granted action', () => {
    const onAction = vi.fn();
    const view = boardView([cancelChainEntry()]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findTomImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--transfer-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(cancelChainEntry());
  });
});
