/**
 * @module ba-83.test
 *
 * Card test: Ancient Deep-hold (ba-83)
 * Type: balrog-site (ruins-and-lairs, under-deeps), unique
 *
 * Text:
 *   Adjacent Sites: no surface site, one Under-deeps Ruins & Lairs [{R}]
 *     chosen by you when playing this card (8)
 *   Playable: Information, Items (minor, major, greater, gold ring)
 *   Automatic-attacks (3):
 *     (1st) Undead — 4 strikes with 7 prowess
 *     (2nd) Undead — 3 strikes with 8 prowess
 *     (3rd) Undead — 2 strikes with 10 prowess
 *     Each character wounded must make a corruption check modified by -2.
 *   Special: Any Undead and Spider creatures may be keyed to this site.
 *     This site is never discarded or returned to its location deck.
 *
 * Rules interpretation / data encoding (this pass):
 *   - "one Under-deeps Ruins & Lairs chosen by you when playing this card (8)"
 *     is a *dynamic* adjacency: the site has no fixed `adjacentSites`. Modeled
 *     by the new `site-rule: dynamic-under-deeps-adjacency`
 *     (`siteTypes: [ruins-and-lairs]`, `roll: 8`) — the site is Under-deeps-
 *     adjacent, at roll 8, to any *other* Under-deeps Ruins & Lairs. Because the
 *     connected site must carry the `under-deeps` keyword, no *surface* site is
 *     ever adjacent ("no surface site"). Consulted by `isUnderDeepsAdjacent`
 *     (org-phase plan-movement / M/H declare-path) and
 *     `getUnderDeepsRequiredRoll`.
 *   - "Each character wounded must make a corruption check modified by -2" is the
 *     already-certified `on-event: character-wounded-by-self` → `force-check`
 *     (modifier -2) machinery (le-353 Barrow-downs), which fires per wounded
 *     character after the site's automatic attacks resolve.
 *   - "Any Undead and Spider creatures may be keyed to this site" is two
 *     `allow-creature-by-race` rules ("undead", "spider"): each grants a keying
 *     bypass for normal hazard-creature play against a company here.
 *   - "This site is never discarded or returned to its location deck" is
 *     `site-rule: always-return-to-deck` — M/H step 8 always returns the site to
 *     the owner's location deck (even when tapped), never the discard pile.
 *   - `playableResources` / `automaticAttacks` were empty in the imported data
 *     (the recurring BA-site bug) and are filled from cards.json this pass.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                          |
 * | 4 | playableResources | OK     | [information, minor, major, greater, gold-ring]|
 * | 5 | automaticAttacks  | OK     | 3 Undead attacks (4/7, 3/8, 2/10)              |
 * | 6 | resourceDraws     | OK     | 2                                              |
 * | 7 | hazardDraws       | OK     | 2                                              |
 * | 8 | keywords          | OK     | ["under-deeps"]                                |
 * | 9 | effects           | OK     | dynamic-under-deeps-adjacency + always-return-to-deck + allow-creature-by-race (undead, spiders) + on-event character-wounded-by-self (force-check -2) |
 *
 * Playable: YES
 * Certified: 2026-07-13
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  resetMint, pool, CardStatus,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, viableFor, dispatch,
  findCharInstanceId, runAutoAttackCombatMulti,
  expectCharNotInPlay,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isUnderDeepsAdjacent } from '../../engine/legal-actions/organization-companies.js';
import { getUnderDeepsRequiredRoll } from '../../engine/mh-steps.js';
import type { CardDefinitionId, GameState, SiteCard, PlanMovementAction } from '../../index.js';

const ANCIENT_DEEP_HOLD = 'ba-83' as CardDefinitionId;   // R&L, under-deeps (this card)
const THE_UNDER_GROTTOS = 'ba-101' as CardDefinitionId;  // R&L, under-deeps (a qualifying neighbour)
const REMAINS_OF_THANGORODRIM = 'ba-95' as CardDefinitionId; // R&L, under-deeps (another neighbour)
const THE_IRON_DEEPS = 'ba-91' as CardDefinitionId;      // Dark-hold, under-deeps (wrong type)
const BARROW_DOWNS = 'le-353' as CardDefinitionId;        // R&L, NOT under-deeps (surface site)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId;  // haven, under-deeps (siteDeck filler)

const THE_BALROG = 'ba-3' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;     // Orc, prowess 3, body 7
const AZOG = 'ba-2' as CardDefinitionId;                 // Orc, prowess 6, body 9
const UMAGAUR = 'ba-9' as CardDefinitionId;              // Troll, prowess 7, body 9
const THE_MOUTH = 'le-24' as CardDefinitionId;           // Man, prowess 6, body 8
const IRON_CROWN = 'le-314' as CardDefinitionId;         // greater item, 5 CP, no combat bonus

const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // minor minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater minion item
const GHOSTS = 'le-72' as CardDefinitionId;              // Undead, keyed shadow-hold/dark-hold (NOT R&L)
const GIANT_SPIDERS = 'le-75' as CardDefinitionId;       // Spiders, keyed 2 wildernesses (NOT R&L)
const WATCHER_IN_THE_WATER = 'le-99' as CardDefinitionId; // Animals, keyed wilderness/coastal (not undead/spider, not R&L)

/** A throwaway state (just to supply a populated cardPool to the adjacency helpers). */
function anyState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GROTTOS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

/** Balrog company (The Balrog) at `site` in the organization phase, `dest` in the site deck. */
function orgAt(site: CardDefinitionId, deck: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site, characters: [THE_BALROG] }], hand: [], siteDeck: deck },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
}

/** Balrog company at Ancient Deep-hold in the site phase, given hand. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: ANCIENT_DEEP_HOLD, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Balrog company (4 chars) at Ancient Deep-hold sitting at the automatic-attacks step. */
function autoAttackStep(orcItems: CardDefinitionId[] = []): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: ANCIENT_DEEP_HOLD, characters: [{ defId: CROOK_LEGGED_ORC, items: orcItems }, AZOG, UMAGAUR, THE_MOUTH] }],
        hand: [],
        siteDeck: [THE_UNDER_GATES_BA],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/** Balrog company at Ancient Deep-hold in the M/H phase (destination R&L, no region path). */
function mhAtDeepHold(hazardHand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: ANCIENT_DEEP_HOLD, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: hazardHand, siteDeck: [] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ancient Deep-hold',
    }),
  };
}

describe('Ancient Deep-hold (ba-83)', () => {
  beforeEach(() => resetMint());

  // ─── Dynamic Under-deeps adjacency (roll 8, Ruins & Lairs, no surface) ──────

  test('Under-deeps-adjacent (roll 8) to an Under-deeps Ruins & Lairs (The Under-grottos)', () => {
    const state = anyState();
    const deepHold = pool[ANCIENT_DEEP_HOLD as string] as SiteCard;
    const grottos = pool[THE_UNDER_GROTTOS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, grottos, deepHold)).toBe(true);
    // Descent and ascent both require the printed roll of 8.
    expect(getUnderDeepsRequiredRoll(state, grottos, deepHold)).toBe(8);
    expect(getUnderDeepsRequiredRoll(state, deepHold, grottos)).toBe(8);
  });

  test('also adjacent to a second Under-deeps Ruins & Lairs (Remains of Thangorodrim)', () => {
    const state = anyState();
    const deepHold = pool[ANCIENT_DEEP_HOLD as string] as SiteCard;
    const remains = pool[REMAINS_OF_THANGORODRIM as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, deepHold, remains)).toBe(true);
    expect(getUnderDeepsRequiredRoll(state, remains, deepHold)).toBe(8);
  });

  test('NOT adjacent to an Under-deeps site of the wrong type (The Iron-deeps, Dark-hold)', () => {
    const state = anyState();
    const deepHold = pool[ANCIENT_DEEP_HOLD as string] as SiteCard;
    const ironDeeps = pool[THE_IRON_DEEPS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, deepHold, ironDeeps)).toBe(false);
    expect(isUnderDeepsAdjacent(state, ironDeeps, deepHold)).toBe(false);
  });

  test('NOT adjacent to a surface Ruins & Lairs — "no surface site" (Barrow-downs)', () => {
    const state = anyState();
    const deepHold = pool[ANCIENT_DEEP_HOLD as string] as SiteCard;
    const barrow = pool[BARROW_DOWNS as string] as SiteCard;
    expect(isUnderDeepsAdjacent(state, deepHold, barrow)).toBe(false);
    expect(isUnderDeepsAdjacent(state, barrow, deepHold)).toBe(false);
  });

  test('plan-movement offers descent from an Under-deeps R&L to Ancient Deep-hold', () => {
    const state = orgAt(THE_UNDER_GROTTOS, [ANCIENT_DEEP_HOLD]);
    const deepHoldInst = state.players[0].siteDeck.find(s => s.definitionId === ANCIENT_DEEP_HOLD)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === deepHoldInst)).toBe(true);
  });

  test('plan-movement offers ascent from Ancient Deep-hold back to an Under-deeps R&L', () => {
    const state = orgAt(ANCIENT_DEEP_HOLD, [THE_UNDER_GROTTOS]);
    const grottosInst = state.players[0].siteDeck.find(s => s.definitionId === THE_UNDER_GROTTOS)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === grottosInst)).toBe(true);
  });

  test('plan-movement does NOT offer descent from a Dark-hold Under-deeps site', () => {
    const state = orgAt(THE_IRON_DEEPS, [ANCIENT_DEEP_HOLD]);
    const deepHoldInst = state.players[0].siteDeck.find(s => s.definitionId === ANCIENT_DEEP_HOLD)!.instanceId;
    const moves = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'plan-movement') as { action: PlanMovementAction }[];
    expect(moves.some(a => a.action.destinationSite === deepHoldInst)).toBe(false);
  });

  // ─── Automatic attacks (three sequential Undead attacks) ────────────────────

  test('first automatic attack is Undead — 4 strikes with 7 prowess', () => {
    const state = autoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('undead');
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    // Own R&L site: the attack is a normal attack, not detainment.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Wound → corruption check modified by -2 ────────────────────────────────

  test('each character wounded by the auto-attack makes a corruption check modified by -2', () => {
    // Crook-legged Orc (prow 3, tap-to-fight → 3+2=5<7) and The Mouth (prow 6,
    // NOT tapping → 3+2=5<7) are both wounded; Azog and Umagaur win their strikes.
    const state = autoAttackStep();
    const result = runAutoAttackCombatMulti(state, [
      { characterDefId: CROOK_LEGGED_ORC, roll: 2, tapToFight: true, bodyRoll: 5 },
      { characterDefId: THE_MOUTH, roll: 2, tapToFight: false, bodyRoll: 5 },
      { characterDefId: AZOG, roll: 12, tapToFight: true },
      { characterDefId: UMAGAUR, roll: 12, tapToFight: true },
    ]);
    expect(result.state.combat).toBeNull();

    const checks = result.state.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(checks).toHaveLength(2);

    const orcId = findCharInstanceId(result.state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);
    const mouthId = findCharInstanceId(result.state, RESOURCE_PLAYER, THE_MOUTH);
    const targeted = new Set(checks.map(c => c.kind.type === 'corruption-check' ? c.kind.characterId : null));
    expect(targeted.has(orcId)).toBe(true);
    expect(targeted.has(mouthId)).toBe(true);
    for (const c of checks) {
      if (c.kind.type !== 'corruption-check') continue;
      expect(c.kind.modifier).toBe(-2);
      expect(c.kind.reason).toBe('Ancient Deep-hold');
    }
  });

  test('a failed wound corruption check (Iron Crown, 5 CP) removes the character from play', () => {
    // Only Crook-legged Orc (bearing the Iron Crown, +5 CP, no combat bonus) is
    // wounded; the others win their strikes.
    const state = autoAttackStep([IRON_CROWN]);
    const result = runAutoAttackCombatMulti(state, [
      { characterDefId: CROOK_LEGGED_ORC, roll: 2, tapToFight: true, bodyRoll: 5 },
      { characterDefId: AZOG, roll: 12, tapToFight: true },
      { characterDefId: UMAGAUR, roll: 12, tapToFight: true },
      { characterDefId: THE_MOUTH, roll: 12, tapToFight: true },
    ]);

    const cc = viableActions(result.state, PLAYER_1, 'corruption-check');
    expect(cc.length).toBeGreaterThan(0);
    const orcId = findCharInstanceId(result.state, RESOURCE_PLAYER, CROOK_LEGGED_ORC);

    // Roll 2 with -2 → 0 vs 5 CP → the corruption check fails.
    const after = dispatch({ ...result.state, cheatRollTotal: 2 }, cc[0].action);
    expectCharNotInPlay(after, RESOURCE_PLAYER, orcId);
  });

  // ─── Item playability (greater / gold-ring allowed here) ────────────────────

  test('a minor item is playable at Ancient Deep-hold', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('a greater item is playable at Ancient Deep-hold (greater is in its playable list)', () => {
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('baseline: the same greater item is NOT playable at The Iron-deeps (minor/major only)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_IRON_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [SCROLL_OF_ISILDUR], siteDeck: [THE_UNDER_GATES_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const withPhase = { ...state, phaseState: makeSitePhase() };
    expect(viableActions(withPhase, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Special: any Undead and Spider creatures may be keyed here ─────────────

  test('an Undead creature not keyed to R&L (Ghosts) is a viable hazard play via keying-bypass', () => {
    const state = mhAtDeepHold([GHOSTS]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe('undead');
  });

  test('a Spider creature not keyed to R&L (Giant Spiders) is a viable hazard play via keying-bypass', () => {
    const state = mhAtDeepHold([GIANT_SPIDERS]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe('spider');
  });

  test('a non-Undead/non-Spider creature not keyed to R&L (Watcher in the Water) is NOT a viable hazard play', () => {
    const state = mhAtDeepHold([WATCHER_IN_THE_WATER]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Permanence: never discarded or returned to its location deck ───────────

  test('tapped Ancient Deep-hold (site of origin) returns to the location deck, not the discard pile', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: ANCIENT_DEEP_HOLD, characters: [THE_BALROG] }], hand: [], siteDeck: [THE_UNDER_GROTTOS] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: BARROW_DOWNS, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const company = built.players[0].companies[0];
    const grottosSite = built.players[0].siteDeck.find(c => c.definitionId === THE_UNDER_GROTTOS)!;
    const deepHoldOriginId = company.currentSite!.instanceId;

    // Model a company that moved from Ancient Deep-hold (tapped) to The Under-grottos.
    const state: GameState = {
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: { instanceId: grottosSite.instanceId, definitionId: grottosSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: deepHoldOriginId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const afterResource = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBoth = dispatch(afterResource, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBoth.players[0];
    expect(p1.siteDeck.some(c => c.instanceId === deepHoldOriginId)).toBe(true);
    expect(p1.siteDiscardPile.some(c => c.instanceId === deepHoldOriginId)).toBe(false);
  });
});
