/**
 * @module stealth-ally-target-click.test
 *
 * Regression test for bug report 8bebc0daa5155208 (game mtrk1rru-t2szjt, seq
 * 611): the server's legal actions for Stealth already offered Gollum — an
 * ally with the scout skill, attached to a non-scout character — as a valid
 * `targetScoutInstanceId` (per CoE 2.V.2.2, allies count as characters for
 * "skill only" cards), but clicking Gollum's card on the board did nothing.
 *
 * `appendAttachmentCards` in company-character.ts wires an ally's click
 * handler through `hazardClickBuilder` (i.e. `buildHazardClick` in
 * company-block.ts), which only ever checked `discardTargetInstanceId` and
 * granted actions — never the "selected card is looking for a character
 * target" flow that `buildCombinedClick` already ran for top-level
 * characters and followers via `CHARACTER_TARGETING_MODES`. So an ally could
 * never be selected as a Stealth (or any other scout-skill) target, even
 * though the engine considered it legal.
 *
 * Fixed by extracting that priority check into `buildTargetingModeClick` and
 * running it from `buildHazardClick` too, so allies get the same "does the
 * selected card target this instance?" treatment as characters.
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type {
  CardDefinitionId, CardInstanceId, CharacterInPlay, Company, EvaluatedAction, GameAction, PlayerView,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { setSelectedShortEvent, clearShortEventSelection } from './render-selection-state.js';

const pool = loadCardPool();

// Legolas (tw-168): warrior/diplomat, no scout skill of his own.
const LEGOLAS = 'tw-168' as CardDefinitionId;
// Gollum (tw-246): scout-skilled ally.
const GOLLUM = 'tw-246' as CardDefinitionId;

const LEGOLAS_INSTANCE = 'p1-0' as CardInstanceId;
const GOLLUM_INSTANCE = 'p1-16' as CardInstanceId;
const STEALTH_INSTANCE = 'p1-9' as CardInstanceId;
const COMPANY_ID = 'company-p1-0';

// --- Minimal DOM stub, mirroring on-guard-discard-target-click.test.ts -----

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
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  querySelectorAll(): StubEl[] { return []; }
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
  clearShortEventSelection();
});

// --- Fixtures ----------------------------------------------------------------

function company(): Company {
  return {
    id: COMPANY_ID,
    characters: [LEGOLAS_INSTANCE],
    currentSite: null,
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    onGuardCards: [],
    moved: false,
    hazards: [],
  } as unknown as Company;
}

function legolasWithGollum(): CharacterInPlay {
  return {
    instanceId: LEGOLAS_INSTANCE,
    definitionId: LEGOLAS,
    status: CardStatus.Untapped,
    items: [],
    allies: [{ instanceId: GOLLUM_INSTANCE, definitionId: GOLLUM, status: CardStatus.Untapped }],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: { prowess: 1, body: 9, directInfluence: 1, corruptionPoints: 3 },
  } as unknown as CharacterInPlay;
}

function stealthOnGollumAction(): GameAction {
  return {
    type: 'play-short-event',
    player: 'p1',
    cardInstanceId: STEALTH_INSTANCE,
    targetScoutInstanceId: GOLLUM_INSTANCE,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    self: { id: 'p1', companies: [company()], characters: { [LEGOLAS_INSTANCE]: legolasWithGollum() }, cardsInPlay: [] },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Organization, step: null },
    legalActions,
  } as unknown as PlayerView;
}

/** Find Gollum's rendered card image within a rendered company block. */
function gollumImg(block: HTMLElement): StubEl | undefined {
  return (block as unknown as StubEl).all().find(el => el.dataset.instanceId === (GOLLUM_INSTANCE as string));
}

describe('Stealth targeting a scout ally (Gollum) attached to a non-scout character', () => {
  test('Gollum is highlighted and clickable when Stealth is selected and targets him', () => {
    setSelectedShortEvent(STEALTH_INSTANCE);
    const action = stealthOnGollumAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const block = renderCompanyBlock(company(), view.self.characters, view, pool, 'self', {
      onAction: (a) => { dispatched = a; },
    });

    const img = gollumImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-target')).toBe(true);

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('Gollum is not highlighted when no scout-targeting short event is selected', () => {
    const view = viewWithLegalActions([]);

    const block = renderCompanyBlock(company(), view.self.characters, view, pool, 'self', {
      onAction: () => { /* no-op */ },
    });

    const img = gollumImg(block);
    expect(img).toBeDefined();
    expect(img!.classList.contains('company-card--influence-target')).toBe(false);
  });
});
