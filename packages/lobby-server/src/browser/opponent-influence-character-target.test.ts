/**
 * @module opponent-influence-character-target.test
 *
 * Regression test for bug report aa0a56dc6934dd67 (game mtshu1di-oucedg, seq
 * 219, turn 5 site phase): the resource player had `opponent-influence-attempt`
 * actions offered by the engine (Gandalf, Influencer DI 10, targeting the
 * opponent's Boromir-bearer, mind 6, and their attached Quickbeam ally, mind
 * 3) but reported "nothing highlights, nothing seems to react to clicking"
 * once the opponent's company came into view.
 *
 * Root cause: `addOpponentInfluenceTargets` walks the rendered opponent
 * company block twice — once for `.character-column[data-instance-id]`
 * (resolving to the nested `.company-card` image), and once generically for
 * every `[data-instance-id]` element (covering attached allies/items). The
 * character column `<div>` carries the *same* `data-instance-id` as the
 * character's own `<img>` nested inside it, and — because the column
 * precedes its own image in document order — the generic walk matched the
 * column `<div>` first and marked that instance id `handled`, so the
 * dedicated column-resolution loop's own redirect to the real `<img>` was a
 * no-op (already handled) and the actual card image never got the
 * `company-card--influence-target` highlight class or its click listener.
 * A character target was therefore invisible and unclickable, while an
 * attached ally (a bare `<img>`, no such id-sharing ancestor) worked fine —
 * which is why Gandalf's Quickbeam target still worked but the character
 * targets around it looked dead.
 *
 * Fixed by resolving `.character-column` matches to their nested image
 * *before* the generic walk, and having the generic walk skip anything
 * that isn't actually an `<img>` (the column divs match the same attribute
 * selector, but the type parameter on `querySelectorAll<HTMLImageElement>`
 * doesn't make that true at runtime).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool, Phase, CardStatus } from '@meccg/shared';
import type {
  CardDefinitionId, CardInstanceId, CharacterInPlay, Company, GameAction, PlayerView,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { addOpponentInfluenceTargets } from './company-modals.js';

const pool = loadCardPool();

const TARGET_CHAR = 'tw-136' as CardDefinitionId; // any hero character definition
const QUICKBEAM = 'tw-307' as CardDefinitionId;

const TARGET_CHAR_INSTANCE = 'p2-107' as CardInstanceId;
const QUICKBEAM_INSTANCE = 'p2-26' as CardInstanceId;
const INFLUENCER_INSTANCE = 'p1-1' as CardInstanceId;
const COMPANY_ID = 'company-p2-0';

// --- Minimal DOM stub, mirroring stealth-ally-target-click.test.ts, with a
// real (if narrow) querySelectorAll so addOpponentInfluenceTargets' DOM walk
// can be exercised. `classList` is kept in sync with `className` the way a
// real browser does, since production code (and createCardImage) sets
// `.className` directly rather than always going through `classList.add`. --

class StubEl {
  tagName: string;
  parent: StubEl | null = null;
  children: StubEl[] = [];
  #className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  get className(): string { return this.#className; }
  set className(value: string) { this.#className = value; }
  classList = {
    contains: (c: string): boolean => this.#className.split(/\s+/).filter(Boolean).includes(c),
    add: (...cs: string[]): void => {
      const set = new Set(this.#className.split(/\s+/).filter(Boolean));
      for (const c of cs) set.add(c);
      this.#className = [...set].join(' ');
    },
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
  matchesSelector(sel: string): boolean {
    // Supports the selector shapes addOpponentInfluenceTargets actually uses:
    // '[data-instance-id]', '.character-column[data-instance-id]',
    // '.company-card[data-instance-id="X"]'.
    const classMatch = sel.match(/^\.([a-zA-Z0-9_-]+)/);
    if (classMatch && !this.classList.contains(classMatch[1])) return false;
    if (sel.includes('[data-instance-id]') && !this.dataset.instanceId) return false;
    const valMatch = sel.match(/data-instance-id="([^"]+)"/);
    if (valMatch && this.dataset.instanceId !== valMatch[1]) return false;
    return true;
  }
  querySelectorAll(sel: string): StubEl[] {
    return this.all().filter(el => el !== this && el.matchesSelector(sel));
  }
  querySelector(sel: string): StubEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
}

(globalThis as unknown as { document: unknown }).document = {
  createElement: (tag: string) => new StubEl(tag),
  getElementById: () => null,
};

function company(): Company {
  return {
    id: COMPANY_ID,
    characters: [TARGET_CHAR_INSTANCE],
    currentSite: null,
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    onGuardCards: [],
    moved: false,
    hazards: [],
  } as unknown as Company;
}

/** The opponent's character carrying the attached Quickbeam ally, mirroring p2-107 in the reported game. */
function targetCharWithAlly(): CharacterInPlay {
  return {
    instanceId: TARGET_CHAR_INSTANCE,
    definitionId: TARGET_CHAR,
    status: CardStatus.Untapped,
    items: [],
    allies: [{ instanceId: QUICKBEAM_INSTANCE, definitionId: QUICKBEAM, status: CardStatus.Untapped }],
    hazards: [],
    followers: [],
    controlledBy: 'general',
    effectiveStats: { prowess: 1, body: 9, directInfluence: 1, corruptionPoints: 0 },
  } as unknown as CharacterInPlay;
}

/** Both `opponent-influence-attempt` targets Gandalf's DI offers in the reported state: the bearer and its ally. */
function opponentInfluenceActions(): GameAction[] {
  return [
    { type: 'opponent-influence-attempt', player: 'p1', influencingCharacterId: INFLUENCER_INSTANCE, targetPlayer: 'p2', targetInstanceId: TARGET_CHAR_INSTANCE, targetKind: 'character' } as GameAction,
    { type: 'opponent-influence-attempt', player: 'p1', influencingCharacterId: INFLUENCER_INSTANCE, targetPlayer: 'p2', targetInstanceId: QUICKBEAM_INSTANCE, targetKind: 'ally' } as GameAction,
  ];
}

function view(): PlayerView {
  return {
    self: { id: 'p1', companies: [], characters: {}, cardsInPlay: [] },
    opponent: { id: 'p2', companies: [company()], characters: { [TARGET_CHAR_INSTANCE]: targetCharWithAlly() }, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Site, step: 'play-resources' },
    legalActions: [],
  } as unknown as PlayerView;
}

/** Find a rendered `<img>` (not its enclosing `.character-column`) by instance id. */
function cardImage(block: HTMLElement, instanceId: CardInstanceId): StubEl | undefined {
  return (block as unknown as StubEl).all().find(
    el => el.tagName.toUpperCase() === 'IMG' && el.dataset.instanceId === (instanceId as string),
  );
}

describe('opponent-influence-attempt targeting a character (not just its attached ally)', () => {
  test('the character\'s own card image is highlighted and clickable, not just its column wrapper', () => {
    const v = view();
    let dispatched: GameAction | undefined;
    const block = renderCompanyBlock(company(), v.opponent.characters, v, pool, 'opponent', {
      onAction: (a) => { dispatched = a; },
    });
    addOpponentInfluenceTargets(block as unknown as HTMLElement, opponentInfluenceActions() as never[], (a) => { dispatched = a; });

    const charImg = cardImage(block, TARGET_CHAR_INSTANCE);
    expect(charImg).toBeDefined();
    expect(charImg!.classList.contains('company-card--influence-target')).toBe(true);

    charImg!.click();
    expect(dispatched).toBeDefined();
    expect((dispatched as { targetInstanceId?: string }).targetInstanceId).toBe(TARGET_CHAR_INSTANCE);
  });

  test('the attached ally target still works alongside the character target', () => {
    const v = view();
    let dispatched: GameAction | undefined;
    const block = renderCompanyBlock(company(), v.opponent.characters, v, pool, 'opponent', {
      onAction: (a) => { dispatched = a; },
    });
    addOpponentInfluenceTargets(block as unknown as HTMLElement, opponentInfluenceActions() as never[], (a) => { dispatched = a; });

    const allyImg = cardImage(block, QUICKBEAM_INSTANCE);
    expect(allyImg).toBeDefined();
    expect(allyImg!.classList.contains('company-card--influence-target')).toBe(true);

    allyImg!.click();
    expect(dispatched).toBeDefined();
    expect((dispatched as { targetInstanceId?: string }).targetInstanceId).toBe(QUICKBEAM_INSTANCE);
  });
});
