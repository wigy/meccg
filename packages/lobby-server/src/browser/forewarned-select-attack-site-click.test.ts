/**
 * @module forewarned-select-attack-site-click.test
 *
 * Regression test for bug report ad0a8e0b9572f02a (game mt6uxumo-c34bum, seq
 * 204): "Beorn tries to enter Moria (Balrog is out), but screen freezes" —
 * with Forewarned Is Forearmed (dm-132) in play, Moria's two automatic
 * attacks (Orcs, and Balrog from Balrog of Moria tw-12) collapse to one of
 * the hazard player's choosing (confirmed by `dm-132.test.ts`). The engine
 * correctly offered `select-forewarned-attack` to the hazard player, but
 * `renderSiteArea` never checked for the `forewarned-select-attack` step —
 * unlike every other step that hands the resource player's opponent a
 * one-off choice (`extra-mh-move-offer`, `character-tap-mh-offer`), no
 * widget rendered the option anywhere, so neither player had anything to
 * click and the site phase stalled forever.
 *
 * `renderSiteArea` now lists the offered `select-forewarned-attack` actions
 * as clickable buttons under the entering company's site area during the
 * `forewarned-select-attack` step, mirroring the existing `extra-mh-move`
 * choice list.
 */

import './test-dom-bootstrap.js'; // must precede the render import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, Company, EvaluatedAction, GameAction, PlayerView } from '@meccg/shared';
import { renderSiteArea } from './company-site.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const MORIA_DEF = 'tw-413' as CardDefinitionId; // Moria
const MORIA_INSTANCE = 'p2-72' as CardInstanceId;
const COMPANY_ID = 'company-p2-1';

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === MORIA_INSTANCE) return MORIA_DEF;
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

function companyAtMoria(): Company {
  return {
    id: COMPANY_ID,
    characters: [],
    currentSite: { instanceId: MORIA_INSTANCE, definitionId: MORIA_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: true,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  } as unknown as Company;
}

function forewarnedAction(attackIndex: number): GameAction {
  return { type: 'select-forewarned-attack', player: 'p1', attackIndex } as GameAction;
}

/**
 * The company entering Moria (`company-p2-1`) belongs to the active/resource
 * player p2; the hazard player p1 (whose view this is) is not active, so
 * `renderSiteArea` must resolve the entering company via `view.opponent`.
 */
function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { companies: [companyAtMoria()] },
    phaseState: { phase: Phase.Site, step: 'forewarned-select-attack', activeCompanyIndex: 0 },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find rendered buttons offering an automatic-attack choice. */
function attackButtons(area: HTMLElement): StubEl[] {
  return (area as unknown as StubEl).all()
    .filter(el => el.className.includes('char-action-tooltip__btn'));
}

describe('forewarned-select-attack choice list (Forewarned Is Forearmed)', () => {
  test('lists the offered automatic-attacks as clickable buttons for the hazard player', () => {
    const actions = [forewarnedAction(0), forewarnedAction(1)];
    const view = viewWithLegalActions(actions);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyAtMoria(), view, pool, {
      onAction: (a) => { dispatched = a; },
    });

    const buttons = attackButtons(area);
    expect(buttons.length).toBe(2);
    expect(buttons[0].children[0].textContent).toContain('auto-attack 0');
    expect(buttons[1].children[0].textContent).toContain('auto-attack 1');

    buttons[1].click();
    expect(dispatched).toBe(actions[1]);
  });

  test('renders no choice list when no select-forewarned-attack action is offered', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtMoria(), view, pool, {
      onAction: () => { /* no-op */ },
    });

    expect(attackButtons(area).length).toBe(0);
  });
});
