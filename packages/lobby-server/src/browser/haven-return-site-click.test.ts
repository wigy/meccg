/**
 * @module haven-return-site-click.test
 *
 * Regression test for bug report 302cd8c89b32f226 (game msbyme1n-63ygzx, seq
 * 647): "je n'ai pas la possibilité de cliquer sur la carte en phase de fin
 * de tour pour retourner au havre" — Great-road (tw-249) legally offers a
 * `haven-return` action during the end-of-turn phase (confirmed by replaying
 * the exact game state through `computeLegalActions`), but `renderSiteArea`
 * never checked for it, so the current site card had no click affordance to
 * trigger the option — it was only reachable from the debug action panel.
 *
 * `renderSiteArea` now looks up a viable `haven-return` action for the
 * company and, when present, highlights the current site card (reusing the
 * `company-card--movable` glow) and dispatches the action on click.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const SITE_DEF = 'tw-430' as CardDefinitionId; // has a proxy image
const SITE_INSTANCE = 'p1-70' as CardInstanceId;
const COMPANY_ID = 'company-p1-0';

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === SITE_INSTANCE) return SITE_DEF;
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
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
  getElementById: () => null,
};

// --- Fixtures ----------------------------------------------------------------

function companyAtSite(): Company {
  return {
    id: COMPANY_ID,
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

function havenReturnAction(): GameAction {
  return {
    type: 'haven-return',
    player: 'p1',
    companyId: COMPANY_ID,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p1',
    self: { id: 'p1' },
    phaseState: { phase: Phase.EndOfTurn, step: 'signal-end' },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find the current site card image within a rendered site area. */
function siteImg(area: HTMLElement): StubEl | undefined {
  return (area as unknown as StubEl).all()
    .find(el => el.className.includes('company-card--site'));
}

describe('haven-return site-card click (Great-road)', () => {
  test('highlights the current site card and dispatches haven-return on click', () => {
    const action = havenReturnAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: (a) => { dispatched = a; },
    });

    const img = siteImg(area);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--movable');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('does not highlight the site card when no haven-return action is offered', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: () => { /* no-op */ },
    });

    const img = siteImg(area);
    expect(img).toBeDefined();
    expect(img!.className).not.toContain('company-card--movable');
  });
});
