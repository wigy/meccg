/**
 * @module overview-opponent-hazard-target-click.test
 *
 * Regression test for bug report a4feae659ce2e14e (game msewu2v3-p8eovx, seq
 * 952): "Cannot target Celeborn with Lure of Expedience - card is highlighted,
 * but clicking does nothing."
 *
 * The engine correctly offered `play-hazard` for Lure of Expedience (le-122)
 * targeting Celeborn (tw-136, in the moving player's company) — the action
 * was fully viable, no `reason` attached. `renderAllCompaniesView`
 * (company-views.ts) renders the opponent's companies without ever passing
 * `onAction` in its `renderCompanyBlock` options, so the character-targeting
 * hazard branch inside `buildCombinedClick` (company-block.ts) still applied
 * the `company-card--influence-target` highlight class (matching the "card is
 * highlighted" report) but its click handler's `options?.onAction?.(...)`
 * silently did nothing, since `onAction` was `undefined`.
 *
 * `renderAllCompaniesView` now passes `onAction: lastOnAction` for opponent
 * company blocks too, matching `renderSingleView` (which already passed it
 * unconditionally for both owners).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, EvaluatedAction, GameAction, PlayerView, CharacterInPlay, Company,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { setSelectedHazardForPlay, clearHazardPlaySelection } from './render-selection-state.js';

const pool = loadCardPool();

const CELEBORN = 'tw-136' as CardDefinitionId;

const LURE_INSTANCE = 'p1-47' as CardInstanceId;
const CELEBORN_INSTANCE = 'p2-107' as CardInstanceId;
const COMPANY_ID = 'company-p2-3' as CompanyId;

// --- Minimal DOM stub, mirroring on-guard-discard-target-click.test.ts ------

class StubEl {
  tagName: string;
  parent: StubEl | null = null;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    add: (...cls: string[]): void => {
      const existing = this.className.split(' ').filter(Boolean);
      for (const c of cls) if (!existing.includes(c)) existing.push(c);
      this.className = existing.join(' ');
    },
    contains: (c: string): boolean => this.className.split(' ').filter(Boolean).includes(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
  getElementById: () => null,
};

afterEach(() => {
  clearHazardPlaySelection();
});

// --- Fixtures ----------------------------------------------------------------

function opponentCompany(): Company {
  return {
    id: COMPANY_ID,
    characters: [CELEBORN_INSTANCE],
    currentSite: null,
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

function opponentCharacters(): Readonly<Record<string, CharacterInPlay>> {
  return {
    [CELEBORN_INSTANCE]: {
      instanceId: CELEBORN_INSTANCE,
      definitionId: CELEBORN,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy: 'general',
      effectiveStats: { prowess: 6, body: 9, directInfluence: 1 },
    } as unknown as CharacterInPlay,
  };
}

function playHazardOnCeleborn(): GameAction {
  return {
    type: 'play-hazard',
    player: 'p1',
    cardInstanceId: LURE_INSTANCE,
    targetCompanyId: COMPANY_ID,
    targetCharacterId: CELEBORN_INSTANCE,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p2',
    self: { id: 'p1', companies: [], cardsInPlay: [] },
    opponent: { id: 'p2', companies: [], cardsInPlay: [] },
    phaseState: { phase: Phase.MovementHazard, step: 'play-hazards', activeCompanyIndex: 0 },
    legalActions,
  } as unknown as PlayerView;
}

/** Find the character's own card image (not an item/ally/hazard attachment). */
function characterImg(block: HTMLElement): StubEl | undefined {
  return (block as unknown as StubEl).all()
    .find(el => el.tagName === 'img' && el.dataset.instanceId === CELEBORN_INSTANCE
      && el.className.split(' ').includes('company-card'));
}

describe('character-targeting hazard on an opponent company (Lure of Expedience → Celeborn)', () => {
  test('with onAction wired (the fix), clicking the highlighted target dispatches play-hazard', () => {
    setSelectedHazardForPlay(LURE_INSTANCE);
    const action = playHazardOnCeleborn();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const block = renderCompanyBlock(opponentCompany(), opponentCharacters(), view, pool, 'opponent', {
      onAction: (a) => { dispatched = a; },
    });

    const img = characterImg(block);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--influence-target');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('without onAction (the historical bug), the card is still highlighted but clicking does nothing', () => {
    setSelectedHazardForPlay(LURE_INSTANCE);
    const view = viewWithLegalActions([playHazardOnCeleborn()]);

    const block = renderCompanyBlock(opponentCompany(), opponentCharacters(), view, pool, 'opponent', {});

    const img = characterImg(block);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--influence-target');

    // Reproduces the report: highlighted, but the click is a silent no-op.
    expect(() => img!.click()).not.toThrow();
  });
});
