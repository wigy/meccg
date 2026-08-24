/**
 * @module character-tap-mh-offer-click.test
 *
 * Regression test for bug reports 1da6ff7a47f12ea9 / c63df62964ac0701 (game
 * mszuhgu5-94d5zb): "Still trying to figure out how and when to trigger his
 * 2nd M/H ability" / "The extra 2nd untap button didn't show up" — the
 * engine legally offers `character-tap-extra-mh-phase` (Carambor le-5) every
 * turn the log shows Carambor untapped in an active company (confirmed by
 * `le-5.test.ts`), so the player can tap him to send the company on another
 * movement/hazard phase. But `renderSiteArea` never checked for the
 * `character-tap-mh-offer` step, so the board gave no way to trigger it —
 * the only visible control was the generic "Pass" button, indistinguishable
 * from declining the option, and the tap was only reachable from the debug
 * action panel.
 *
 * `renderSiteArea` now lists the offered `character-tap-extra-mh-phase`
 * action as a clickable button under the company's site area during the
 * `character-tap-mh-offer` step, mirroring the existing `extra-mh-move`
 * choice list used during `extra-mh-move-offer`.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const CURRENT_SITE_DEF = 'le-390' as CardDefinitionId; // Minas Morgul
const CURRENT_SITE_INSTANCE = 'p1-78' as CardInstanceId;
const CARAMBOR_DEF = 'le-5' as CardDefinitionId;
const CARAMBOR_INSTANCE = 'p1-126' as CardInstanceId;
const COMPANY_ID = 'company-p1-0';

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === CURRENT_SITE_INSTANCE) return CURRENT_SITE_DEF;
  if (id === CARAMBOR_INSTANCE) return CARAMBOR_DEF;
  return undefined;
});

// --- Minimal DOM stub, mirroring extra-mh-move-site-click.test.ts ----------

class StubEl {
  tagName: string;
  parent: StubEl | null = null;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
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
    characters: [CARAMBOR_INSTANCE],
    currentSite: { instanceId: CURRENT_SITE_INSTANCE, definitionId: CURRENT_SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: true,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

function characterTapAction(): GameAction {
  return {
    type: 'character-tap-extra-mh-phase',
    player: 'p1',
    companyId: COMPANY_ID,
    characterInstanceId: CARAMBOR_INSTANCE,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p1',
    self: { id: 'p1', companies: [companyAtSite()] },
    opponent: { companies: [] },
    phaseState: { phase: Phase.MovementHazard, step: 'character-tap-mh-offer', activeCompanyIndex: 0 },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find rendered buttons offering a character tap. */
function tapButtons(area: HTMLElement): StubEl[] {
  return (area as unknown as StubEl).all()
    .filter(el => el.className.includes('char-action-tooltip__btn'));
}

describe('character-tap-mh-offer choice list (Carambor)', () => {
  test('lists the offered tap as a clickable button', () => {
    const action = characterTapAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: (a) => { dispatched = a; },
    });

    const buttons = tapButtons(area);
    expect(buttons.length).toBe(1);
    expect(buttons[0].children[0].textContent).toContain('Carambor');

    buttons[0].click();
    expect(dispatched).toBe(action);
  });

  test('renders no choice list when no character-tap-extra-mh-phase action is offered', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: () => { /* no-op */ },
    });

    expect(tapButtons(area).length).toBe(0);
  });
});
