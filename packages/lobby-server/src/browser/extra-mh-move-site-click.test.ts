/**
 * @module extra-mh-move-site-click.test
 *
 * Regression test for bug report eecff416fed01ab2 (game msenn577-l8lz3n, seq
 * 313/314): "remains very unclear when you are supposed to play a new site.
 * I cannot identify a prompt or opportunity" — after playing Forced March
 * (le-185) and the company's move to a Darkhaven commits, the engine legally
 * offers `extra-mh-move` actions (confirmed by `le-185.test.ts`) so the
 * player can send the company on another movement to an additional site.
 * But `renderSiteArea` never checked for this step, so the board gave no way
 * to trigger it — the only visible control was the generic "Pass" button,
 * indistinguishable from declining the option, and the extra move was only
 * reachable from the debug action panel.
 *
 * `renderSiteArea` now lists the offered `extra-mh-move` destinations as
 * clickable buttons under the company's site area during the
 * `extra-mh-move-offer` step, mirroring the existing `declare-path` choice
 * list used during `reveal-new-site`.
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
const DEST_SITE_DEF = 'le-372' as CardDefinitionId; // Edoras
const DEST_SITE_INSTANCE = 'p1-72' as CardInstanceId;
const COMPANY_ID = 'company-p1-2';

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === CURRENT_SITE_INSTANCE) return CURRENT_SITE_DEF;
  if (id === DEST_SITE_INSTANCE) return DEST_SITE_DEF;
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
    characters: [],
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

function extraMHMoveAction(): GameAction {
  return {
    type: 'extra-mh-move',
    player: 'p1',
    companyId: COMPANY_ID,
    destinationSite: DEST_SITE_INSTANCE,
  } as GameAction;
}

function viewWithLegalActions(actions: GameAction[]): PlayerView {
  const legalActions: EvaluatedAction[] = actions.map(action => ({ action, viable: true }));
  return {
    activePlayer: 'p1',
    self: { id: 'p1', companies: [companyAtSite()] },
    opponent: { companies: [] },
    phaseState: { phase: Phase.MovementHazard, step: 'extra-mh-move-offer', activeCompanyIndex: 0 },
    activeConstraints: [],
    legalActions,
  } as unknown as PlayerView;
}

/** Find rendered buttons offering an extra movement. */
function moveButtons(area: HTMLElement): StubEl[] {
  return (area as unknown as StubEl).all()
    .filter(el => el.className.includes('char-action-tooltip__btn'));
}

describe('extra-mh-move choice list (Forced March et al.)', () => {
  test('lists the offered destination as a clickable button', () => {
    const action = extraMHMoveAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: (a) => { dispatched = a; },
    });

    const buttons = moveButtons(area);
    expect(buttons.length).toBe(1);
    expect(buttons[0].children[0].textContent).toContain('Edoras');

    buttons[0].click();
    expect(dispatched).toBe(action);
  });

  test('renders no choice list when no extra-mh-move action is offered', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyAtSite(), view, pool, {
      onAction: () => { /* no-op */ },
    });

    expect(moveButtons(area).length).toBe(0);
  });
});
