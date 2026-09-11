/**
 * @module untap-site-granted-action-click.test
 *
 * Regression test for bug report fbb19343d21026d8: "I don't recall the UI
 * giving me an option to untap The Worthy Hills. The game state may record
 * such an option existing, but there was no UI interface allowing me to
 * choose that option." The Worthy Hills (as-142) grants `activate-granted-
 * action` with `sourceCardId` set to the site card itself (tap a sage and a
 * scout to untap the site) — confirmed viable by `computeLegalActions` in
 * `as-142.test.ts` — but `renderSiteArea` never checked `options.grantedActions`
 * for the current site's own instance ID: only constraint cards, items, and
 * characters were wired to their granted actions, so the site card had no
 * click affordance and the option was only reachable from the debug action
 * panel.
 *
 * `renderSiteArea` now looks up granted actions sourced from the current
 * site's instance ID and, when present, highlights the site card (reusing
 * the `company-card--movable` glow) and dispatches the action on click.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { ActivateGrantedAction, CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const SITE_DEF = 'as-142' as CardDefinitionId; // The Worthy Hills
const SITE_INSTANCE = 'p1-167' as CardInstanceId;
const SAGE_INSTANCE = 'p1-10' as CardInstanceId;
const SCOUT_INSTANCE = 'p1-11' as CardInstanceId;
const COMPANY_ID = 'company-p1-0';

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === SITE_INSTANCE) return SITE_DEF;
  return undefined;
});

// --- Minimal DOM stub, mirroring haven-return-site-click.test.ts -----------

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

function companyAtTappedSite(): Company {
  return {
    id: COMPANY_ID,
    characters: [],
    currentSite: { instanceId: SITE_INSTANCE, definitionId: SITE_DEF, status: CardStatus.Tapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

function untapSiteAction(): ActivateGrantedAction {
  return {
    type: 'activate-granted-action',
    player: 'p1',
    characterId: SAGE_INSTANCE,
    secondCharacterId: SCOUT_INSTANCE,
    sourceCardId: SITE_INSTANCE,
    sourceCardDefinitionId: SITE_DEF,
    actionId: 'untap-site',
    rollThreshold: 0,
  } as unknown as ActivateGrantedAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p1',
    self: { id: 'p1' },
    phaseState: { phase: Phase.Site, step: 'select-company' },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find the current site card image within a rendered site area. */
function siteImg(area: HTMLElement): StubEl | undefined {
  return (area as unknown as StubEl).all()
    .find(el => el.className.includes('company-card--site'));
}

describe('untap-site granted-action site-card click (The Worthy Hills)', () => {
  test('highlights the tapped site card and dispatches untap-site on click', () => {
    const action = untapSiteAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const grantedActions = new Map<string, ActivateGrantedAction[]>([[SITE_INSTANCE as string, [action]]]);
    const area = renderSiteArea(companyAtTappedSite(), view, pool, {
      onAction: (a) => { dispatched = a; },
      grantedActions,
    });

    const img = siteImg(area);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--movable');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('does not highlight the site card when no untap-site action is offered', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtTappedSite(), view, pool, {
      onAction: () => { /* no-op */ },
      grantedActions: new Map(),
    });

    const img = siteImg(area);
    expect(img).toBeDefined();
    expect(img!.className).not.toContain('company-card--movable');
  });
});
