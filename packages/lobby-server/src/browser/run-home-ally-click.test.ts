/**
 * @module run-home-ally-click.test
 *
 * Regression test for bug report f86305505c589477 (game mv9ymggk-sjj4u0, seq
 * 1095): "Wanted to discard [Bill the Pony] for go to nearest haven."
 *
 * At the end of turn 18, Bill the Pony (tw-198) was with a two-character
 * company at Barrow-downs. Its nearest haven, Rivendell, was under a sibling
 * company, and the engine offered `run-home` for the whole end-of-turn
 * phase (seq 1091-1095). But `buildHazardClick` in company-block.ts only
 * routed `activate-granted-action` entries to an attached ally, so the Bill
 * card had no click affordance. The option was reachable only from the
 * debug action panel.
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
  RunHomeAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getGrantedActions } from './company-actions.js';

const pool = loadCardPool();

const HOST_CHARACTER = 'tw-156' as CardDefinitionId; // any hero character will do
const BILL_THE_PONY = 'tw-198' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const HOST_INST = 'p1-2' as CardInstanceId;
const BILL_INST = 'p1-103' as CardInstanceId;

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
    { instanceId: BILL_INST, definitionId: BILL_THE_PONY, status: CardStatus.Inverted },
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

const runHome = (): RunHomeAction => ({
  type: 'run-home',
  player: PLAYER,
  companyId: COMPANY_ID,
  allyInstanceId: BILL_INST,
} as unknown as RunHomeAction);

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
    phaseState: { phase: 'end-of-turn', step: 'signal-end' },
    legalActions,
  } as unknown as PlayerView;
}

const findBillImg = (block: StubEl): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (BILL_INST as string));

describe('Bill the Pony run-home click', () => {
  test('clicking the ally card dispatches the offered run-home action', () => {
    const onAction = vi.fn();
    const view = boardView([runHome()]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findBillImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--transfer-source')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(runHome());
  });

  test('the ally card is not clickable when no run-home action is offered', () => {
    const view = boardView([]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction: vi.fn(),
      grantedActions: getGrantedActions(view),
    }) as unknown as StubEl;

    const img = findBillImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--transfer-source')).toBe(false);
  });
});
