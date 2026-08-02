/**
 * @module on-guard-discard-target-click.test
 *
 * Regression test for bug report 57ce381d7e10a4df (game msbu4uvh-d0jcus, seq
 * 310): playing Withdrawn to Mordor's "discard an on-guard card" alternative
 * requires clicking the on-guard card as the discard target, but the on-guard
 * overlay never lit up or accepted the click — only its reveal-on-guard
 * handling was wired.
 *
 * `renderInPlayCardImage` in company-block.ts already highlights items and
 * hazards as discard targets when a `play-short-event` short event with a
 * matching `discardTargetInstanceId` is selected from hand, but on-guard
 * cards are rendered separately in `renderSiteArea` (company-site.ts), which
 * never consulted that selection — so the engine offered the action (it's in
 * `legalActions`) but nothing in the UI could dispatch it.
 *
 * `renderSiteArea` now also checks for a selected short event naming the
 * on-guard card as `discardTargetInstanceId` and wires up the same
 * `company-card--influence-target` highlight + click-to-play behavior.
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
const ON_GUARD_DEF = 'td-158' as CardDefinitionId;
const ON_GUARD_INSTANCE = 'p2-31' as CardInstanceId;
const WITHDRAWN_TO_MORDOR = 'p1-34' as CardInstanceId;

setCachedInstanceLookup((id: CardInstanceId) => {
  if (id === SITE_INSTANCE) return SITE_DEF;
  if (id === ON_GUARD_INSTANCE) return ON_GUARD_DEF;
  return undefined;
});

// --- Minimal DOM stub, mirroring shared-site-instance-id.test.ts -----------

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

afterEach(() => {
  clearShortEventSelection();
});

// --- Fixtures ----------------------------------------------------------------

function companyWithOnGuardCard(): Company {
  return {
    id: 'company-p1-0',
    characters: [],
    currentSite: { instanceId: SITE_INSTANCE, definitionId: SITE_DEF, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [{ instanceId: ON_GUARD_INSTANCE, definitionId: ON_GUARD_DEF, revealed: false }],
    hazards: [],
  } as unknown as Company;
}

function discardTargetAction(): GameAction {
  return {
    type: 'play-short-event',
    player: 'p1',
    cardInstanceId: WITHDRAWN_TO_MORDOR,
    discardTargetInstanceId: ON_GUARD_INSTANCE,
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

/** Find the on-guard card image within a rendered site area. */
function onGuardImg(area: HTMLElement): StubEl | undefined {
  return (area as unknown as StubEl).all()
    .find(el => el.className.includes('on-guard-card'));
}

describe('on-guard card discard-target click (Withdrawn to Mordor)', () => {
  test('lights up and dispatches the discard action when a matching short event is selected', () => {
    setSelectedShortEvent(WITHDRAWN_TO_MORDOR);
    const action = discardTargetAction();
    const view = viewWithLegalActions([action]);
    let dispatched: GameAction | undefined;

    const area = renderSiteArea(companyWithOnGuardCard(), view, pool, {
      onAction: (a) => { dispatched = a; },
    });

    const img = onGuardImg(area);
    expect(img).toBeDefined();
    expect(img!.className).toContain('company-card--influence-target');

    img!.click();
    expect(dispatched).toBe(action);
  });

  test('does not highlight the on-guard card when no short event is selected', () => {
    const view = viewWithLegalActions([]);
    const area = renderSiteArea(companyWithOnGuardCard(), view, pool, {
      onAction: () => { /* no-op */ },
    });

    const img = onGuardImg(area);
    expect(img).toBeDefined();
    expect(img!.className).not.toContain('company-card--influence-target');
  });
});
