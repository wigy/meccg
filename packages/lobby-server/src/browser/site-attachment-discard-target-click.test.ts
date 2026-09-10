/**
 * @module site-attachment-discard-target-click.test
 *
 * Regression test for bug report d54d4ce72b3107a2 (game mtukrmxa-asilf1, turn
 * 12, movement-hazard phase): playing The Cock Crows (tw-342) to discard a
 * hazard permanent-event requires clicking the target card, but Siege
 * (tw-87) — bound to the company's current site via `attachedToSite` — never
 * lit up or accepted the click, so the player could not select it even
 * though the engine offered the discard as a legal action.
 *
 * `renderInPlayCardImage` in company-block.ts already highlights cards as
 * discard targets when a `play-short-event` short event with a matching
 * `discardTargetInstanceId` is selected from hand, but site-bound cards are
 * rendered separately in `renderSiteArea` (company-site.ts) via a plain
 * `createCardImageFromDefId` call that never consulted that selection — so
 * the click affordance was silently missing whenever the bound site was
 * occupied by a company (the only case where the attachment strip renders
 * at all; see `cardsAttachedToSite`/`isAttachedToPresentSite`).
 *
 * `renderSiteArea` now renders site-attached cards through
 * `renderInPlayCardImage`, the same helper used by the flat cards-in-play row
 * and the company-attachments strip, so the discard-target highlight + click
 * wiring (and every other affordance that helper provides) applies here too.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect, afterEach } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';
import { setSelectedShortEvent, clearShortEventSelection } from './render-selection-state.js';

const pool = loadCardPool();

const SITE_DEF = 'tw-430' as CardDefinitionId; // has a proxy image
const SITE_INSTANCE = 'p1-70' as CardInstanceId;
const SIEGE_DEF = 'tw-87' as CardDefinitionId;
const SIEGE_INSTANCE = 'p1-173' as CardInstanceId;
const THE_COCK_CROWS = 'p1-29' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === SITE_INSTANCE) return SITE_DEF;
  if (id === SIEGE_INSTANCE) return SIEGE_DEF;
  return undefined;
});

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
  // Mirrors the real DOM's live relationship between `className` and
  // `classList` — renderInPlayCardImage sets the base class via `className`
  // directly, then adds highlight classes via `classList.add`.
  classList = {
    add: (...cs: string[]) => {
      const set = new Set(this.className.split(' ').filter(Boolean));
      for (const c of cs) set.add(c);
      this.className = [...set].join(' ');
    },
    contains: (c: string) => this.className.split(' ').includes(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  replaceWith(replacement: StubEl): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx === -1) return;
    this.parent.children[idx] = replacement;
    replacement.parent = this.parent;
    this.parent = null;
  }
  querySelectorAll(selector: string): StubEl[] {
    const cls = selector.replace('.', '');
    return this.all().filter(el => el.className.split(' ').includes(cls));
  }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  get childElementCount(): number { return this.children.length; }
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

function companyAtSiegedSite(): Company {
  return {
    id: 'company-p1-0',
    characters: [],
    currentSite: { instanceId: SITE_INSTANCE, definitionId: SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

function discardTargetAction(): GameAction {
  return {
    type: 'play-short-event',
    player: 'p1',
    cardInstanceId: THE_COCK_CROWS,
    discardTargetInstanceId: SIEGE_INSTANCE,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p1',
    self: { id: 'p1' },
    phaseState: { phase: Phase.MovementHazard, step: 'play-hazards' },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find the Siege card image within a rendered site area. */
function siegeImg(area: HTMLElement): StubEl | undefined {
  return (area as unknown as StubEl).all()
    .find(el => el.className.includes('company-card--site-attachment'));
}

describe('site-attached hazard-event discard-target click (Siege, The Cock Crows)', () => {
  test('lights up and dispatches the discard action when a matching short event is selected', () => {
    setSelectedShortEvent(THE_COCK_CROWS);
    const action = discardTargetAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyAtSiegedSite(), view, pool, {
      onAction: (a) => { dispatched = a; },
      cardsInPlay: [{ instanceId: SIEGE_INSTANCE, definitionId: SIEGE_DEF, status: CardStatus.Untapped, attachedToSite: SITE_DEF }],
    });

    const img = siegeImg(area);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--influence-target');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('does not highlight the site-attached card when no short event is selected', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtSiegedSite(), view, pool, {
      onAction: () => { /* no-op */ },
      cardsInPlay: [{ instanceId: SIEGE_INSTANCE, definitionId: SIEGE_DEF, status: CardStatus.Untapped, attachedToSite: SITE_DEF }],
    });

    const img = siegeImg(area);
    expect(img).toBeDefined();
    expect(img!.className).not.toContain('company-card--influence-target');
  });
});
