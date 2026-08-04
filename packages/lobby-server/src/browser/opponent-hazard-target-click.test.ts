/**
 * @module opponent-hazard-target-click.test
 *
 * Regression test for bug report 52da4471b1c4b786 (game msf4fvol-ef68ab, seq
 * 895): "Unable to play Alone and Unadvised from the grid view. Adrazar is
 * highlighted, but clicking on him does nothing."
 *
 * The engine correctly offered `play-hazard` targeting the opponent's Adrazar
 * (as-24 requires a non-Wizard, non-Ringwraith character target), and
 * `buildCombinedClick` in company-block.ts highlights the character and wires
 * a click handler for it via `options?.onAction?.(hazardAction)`. But
 * `renderAllCompaniesView` in company-views.ts — the "grid view" — rendered
 * opponent company blocks without passing `onAction` in `renderCompanyBlock`'s
 * options (unlike the self-company loop, which always passes it). So the
 * handler ran, cleared the targeting selection, and silently dropped the
 * dispatch: highlighted but inert, exactly as reported.
 */

import './test-dom-bootstrap.js'; // must precede the company-views import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  PlayHazardAction,
  GameAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderAllCompaniesView } from './company-views.js';
import { setLastOnAction, setLastCardPool, setLastView, setCachedInstanceLookup } from './company-view-state.js';
import { setSelectedHazardForPlay, clearHazardPlaySelection } from './render-selection-state.js';

const pool = loadCardPool();

const ALONE_AND_UNADVISED = 'as-24' as CardDefinitionId;
const ADRAZAR = 'tw-116' as CardDefinitionId;

const P1 = 'p1' as PlayerId;
const HAZARD_INST = 'p1-94' as CardInstanceId;
const ADRAZAR_INST = 'p2-98' as CardInstanceId;
const OPPONENT_COMPANY_ID = 'company-p2-3';

// --- Minimal DOM stub (same shape as company-attachments/granted-action tests) ---

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
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = () => 0;
});

afterEach(() => {
  clearHazardPlaySelection();
  setLastOnAction(null);
  setLastView(null);
  setLastCardPool(null);
  delete (globalThis as unknown as { document?: unknown }).document;
  delete (globalThis as unknown as { requestAnimationFrame?: unknown }).requestAnimationFrame;
});

// --- View fixtures -----------------------------------------------------------

const selfCompany = {
  id: 'company-p1-0',
  characters: [],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const adrazar: CharacterInPlay = {
  instanceId: ADRAZAR_INST,
  definitionId: ADRAZAR,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 3, body: 6, directInfluence: 1, corruptionPoints: 0 },
} as unknown as CharacterInPlay;

const opponentCompany = {
  id: OPPONENT_COMPANY_ID,
  characters: [ADRAZAR_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const hazardAction: PlayHazardAction = {
  type: 'play-hazard',
  player: P1,
  cardInstanceId: HAZARD_INST,
  targetCompanyId: OPPONENT_COMPANY_ID,
  targetCharacterId: ADRAZAR_INST,
} as unknown as PlayHazardAction;

function boardView(legalActionsRaw: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = legalActionsRaw.map(action => ({ action, viable: true }));
  return {
    self: {
      id: 'p1',
      companies: [selfCompany],
      characters: {},
      cardsInPlay: [],
      agents: [],
    },
    opponent: {
      id: 'p2',
      companies: [opponentCompany],
      characters: { [ADRAZAR_INST as string]: adrazar },
      cardsInPlay: [],
      agents: [],
    },
    activePlayer: 'p1',
    phaseState: { phase: 'movement-hazard', step: null },
    legalActions,
  } as unknown as PlayerView;
}

const findAdrazarImg = (root: StubEl): StubEl | undefined =>
  root.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (ADRAZAR_INST as string));

describe('playing a character-targeting hazard on an opponent from the all-companies grid view', () => {
  test('Adrazar is highlighted and clicking him dispatches play-hazard', () => {
    const onAction = vi.fn();
    const view = boardView([hazardAction]);
    setLastOnAction(onAction);
    setLastView(view);
    setLastCardPool(pool);
    setCachedInstanceLookup((id) => (id === ADRAZAR_INST ? ADRAZAR : id === HAZARD_INST ? ALONE_AND_UNADVISED : undefined));
    setSelectedHazardForPlay(HAZARD_INST);

    const container = new StubEl('div') as unknown as HTMLElement;
    renderAllCompaniesView(container, view, pool);

    const img = findAdrazarImg(container as unknown as StubEl);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-target')).toBe(true);

    img!.click();
    expect(onAction).toHaveBeenCalledWith(hazardAction);
  });
});
