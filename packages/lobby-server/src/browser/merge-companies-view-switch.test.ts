/**
 * @module merge-companies-view-switch.test
 *
 * Regression test for bug report 636f124f00dc4d12 (game msdfe1fe-2pnv8f, seq
 * 77): "Dans cette situation je veux changer d'avis et remettre Ioreth avec
 * Pallando. Je n'y arrive pas." ("I want to change my mind and put Ioreth
 * back with Pallando. I can't manage to.")
 *
 * At the reported state, Ioreth (td-93) sat alone in her own company while
 * Pallando's company and a third company were also at the same site — a
 * legal `merge-companies` action existed to fold Ioreth's company into
 * Pallando's. But with two candidate target companies, clicking Ioreth
 * entered merge-targeting mode (`setMergeSourceCompanyId`) without ever
 * calling `switchToAllCompanies()`, unlike the analogous "move to company"
 * and "influence opponent" flows. If the player was focused on a single
 * company view, the target companies were never rendered, so there was
 * nothing to click — the merge was unreachable even though it was legal.
 *
 * Uses the same hand-rolled DOM stub as company-attachments-render.test.ts
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
  MergeCompaniesAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getMergeCompaniesActions } from './company-actions.js';
import { getAllCompaniesOverride, resetState } from './company-view-state.js';

const pool = loadCardPool();

const IORETH = 'td-93' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const IORETH_INST = 'p1-187' as CardInstanceId;

const SOLO_COMPANY_ID = 'company-p1-1';
const PALLANDO_COMPANY_ID = 'company-p1-0';
const ARAGORN_COMPANY_ID = 'company-p1-2';

// --- Minimal DOM stub (same as character-self-granted-action-click.test.ts) -

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
  resetState();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  resetState();
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
  effectiveStats: { prowess: 0, body: 7, directInfluence: 1, corruptionPoints: 1 },
} as unknown as CharacterInPlay;

const soloCompany = {
  id: SOLO_COMPANY_ID,
  characters: [IORETH_INST],
  currentSite: null,
  siteCardOwned: false,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const mergeIntoPallando: MergeCompaniesAction = {
  type: 'merge-companies',
  player: PLAYER,
  sourceCompanyId: SOLO_COMPANY_ID,
  targetCompanyId: PALLANDO_COMPANY_ID,
  regress: true,
} as unknown as MergeCompaniesAction;

const mergeIntoAragorn: MergeCompaniesAction = {
  type: 'merge-companies',
  player: PLAYER,
  sourceCompanyId: SOLO_COMPANY_ID,
  targetCompanyId: ARAGORN_COMPANY_ID,
} as unknown as MergeCompaniesAction;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [soloCompany],
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

describe('clicking a solo character with multiple merge-companies targets', () => {
  test('switches to the all-companies view so the target companies become clickable', () => {
    const onAction = vi.fn();
    const view = boardView([mergeIntoPallando, mergeIntoAragorn]);
    const block = renderCompanyBlock(soloCompany, view.self.characters, view, pool, 'self', {
      onAction,
      mergeActions: getMergeCompaniesActions(view),
    }) as unknown as StubEl;

    expect(getAllCompaniesOverride()).toBe(false);

    const img = findIorethImg(block);
    expect(img).toBeDefined();

    img!.click();

    expect(onAction).not.toHaveBeenCalled();
    expect(getAllCompaniesOverride()).toBe(true);
  });
});
