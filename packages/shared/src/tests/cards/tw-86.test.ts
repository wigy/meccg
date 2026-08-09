/**
 * @module tw-86.test
 *
 * Card test: Shelob (tw-86)
 * Type: hazard-creature (dual creature / permanent-event)
 * Unique. Spider. Spawn. One strike at prowess 18, body 9, 6 kill MP.
 *
 * Card text:
 *   "Unique. Spider. Spawn. May be played as a hazard creature (with one
 *    strike) or as a permanent-event. As a creature, may be played at any
 *    site in Imlad Morgul or Gorgoroth.
 *    If Doors of Night is in play, Shelob may be played as a permanent-event
 *    that gives +1 prowess and +1 strikes to all Spider and Animal attacks.
 *    She may opt to attack from a permanent-event state and receive these
 *    bonuses, but her attack counts as one against the hazard limit. Discard
 *    when Shelob attacks or if Doors of Night is not in play."
 *
 * Engine support:
 * | # | Feature                                            | Status      | Notes                                                    |
 * |---|-----------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | One strike, prowess 18, body 9, 6 kill MP           | IMPLEMENTED | structural data                                           |
 * | 2 | Keying: any site in Imlad Morgul or Gorgoroth       | IMPLEMENTED | keyedTo regionNames                                       |
 * | 3 | Permanent-event mode only if Doors of Night in play | IMPLEMENTED | new `creature-alt-event.when` gate (inPlay context)       |
 * | 4 | +1 prowess/+1 strikes to all Spider/Animal attacks  | IMPLEMENTED | stat-modifier target:"all-attacks", enemy.race $in        |
 * | 5 | Attack from permanent-event state, receiving bonuses | IMPLEMENTED | new `creature-alt-event.attacksAsCreature` + attack-alt-permanent-event action |
 * | 6 | That attack counts one against the hazard limit     | IMPLEMENTED | handleAttackFromAltPermanentEvent hazard-limit accounting |
 * | 7 | Discard when Shelob attacks                         | IMPLEMENTED | standard finalizeCombat creature disposal (card stays in cardsInPlay through the attack) |
 * | 8 | Discard if Doors of Night is not in play            | IMPLEMENTED | discard-self-when $not inPlayAnywhere (Will of Sauron tw-100 precedent) |
 *
 * Playable: YES. The dual creature/permanent-event shape reuses
 * `creature-alt-event`, extended with two new fields for this card: `when`
 * gates the permanent-event mode's availability on a game-wide `inPlay`
 * condition (Doors of Night), and `attacksAsCreature` marks the permanent-event
 * as convertible into a full creature attack (rather than a short-event) via
 * the new `attack-alt-permanent-event` action — the card is deliberately left
 * in `cardsInPlay` through the attack's initiation so its own passive
 * `stat-modifier` (Spider/Animal boost) still applies to its own attack, and
 * `finalizeCombat`'s existing creature-attack disposal (discard, or the
 * defender's kill pile if defeated) removes it once the attack resolves.
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DOORS_OF_NIGHT,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId,
  viableActions, dispatch, resolveChain, executeAction,
  companyIdAt, findCharInstanceId,
  addCardInPlay,
  expectInDiscardPile,
  HAZARD_PLAYER, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const SHELOB = 'tw-86' as CardDefinitionId;

/** Two-company M/H setup with Shelob in the hazard player's hand. */
function setup() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SHELOB], siteDeck: [RIVENDELL] },
    ],
  });
}

/** Shelob already sitting in the hazard player's cardsInPlay as a permanent-event, with Doors of Night in play so `discard-self-when` does not sweep her away first. */
function setupShelobInPlayWithDoorsOfNight() {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const withDon = addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);
  const withShelob = addCardInPlay(withDon, HAZARD_PLAYER, SHELOB);
  return { ...withShelob, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
}

describe('Shelob (tw-86)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying (regionNames) ────────────────────────────────────

  test('playable as a creature keyed to a site in Imlad Morgul', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Minas Morgul',
    });
    const ready = { ...state, phaseState: mhState };
    const shelobId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === shelobId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a site in Gorgoroth', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const shelobId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === shelobId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable as a creature outside Imlad Morgul/Gorgoroth', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const shelobId = handCardId(ready, HAZARD_PLAYER);
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === shelobId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  test('creature combat initiates with one strike at prowess 18 (no Doors of Night boost)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const shelobId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, shelobId, companyId,
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(18);
  });

  // ─── Permanent-event mode gated on Doors of Night ──────────────────────────

  test('permanent-event mode NOT offered without Doors of Night in play', () => {
    const state = setup();
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(false);
  });

  test('permanent-event mode offered and enters play untapped with Doors of Night in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SHELOB], siteDeck: [RIVENDELL] },
      ],
    });
    const withDon = addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const ready = { ...withDon, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const shelobId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: shelobId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === shelobId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  // ─── Attacking from the permanent-event state ──────────────────────────────

  test('offers attack-alt-permanent-event instead of tap-alt-permanent-event once in play', () => {
    const state = setupShelobInPlayWithDoorsOfNight();
    const shelobId = state.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === SHELOB)!.instanceId;

    const tapActions = viableActions(state, PLAYER_2, 'tap-alt-permanent-event')
      .filter(a => a.action.type === 'tap-alt-permanent-event' && a.action.cardInstanceId === shelobId);
    expect(tapActions).toHaveLength(0);

    const attackActions = viableActions(state, PLAYER_2, 'attack-alt-permanent-event')
      .filter(a => a.action.type === 'attack-alt-permanent-event' && a.action.cardInstanceId === shelobId && a.viable);
    expect(attackActions).toHaveLength(1);
  });

  test('attacking from the permanent-event state receives +1 prowess/+1 strikes and counts against the hazard limit', () => {
    const state = setupShelobInPlayWithDoorsOfNight();
    const shelobId = state.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === SHELOB)!.instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterChain = resolveChain(dispatch(state, {
      type: 'attack-alt-permanent-event', player: PLAYER_2, cardInstanceId: shelobId, targetCompanyId: companyId,
    }));

    expect(afterChain.combat).not.toBeNull();
    // 18 + 1 (own Spider/Animal boost) = 19; 1 + 1 = 2 strikes.
    expect(afterChain.combat!.strikeProwess).toBe(19);
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect((afterChain.phaseState as { hazardsPlayedThisCompany: number }).hazardsPlayedThisCompany).toBe(1);

    // The card was never removed from cardsInPlay before combat init — it
    // must appear exactly once, not duplicated.
    const shelobEntries = afterChain.players[HAZARD_PLAYER].cardsInPlay
      .filter(c => c.instanceId === shelobId);
    expect(shelobEntries).toHaveLength(1);
  });

  test('discards Shelob once her attack from the permanent-event state resolves', () => {
    const state = setupShelobInPlayWithDoorsOfNight();
    const shelobId = state.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === SHELOB)!.instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const inCombat = resolveChain(dispatch(state, {
      type: 'attack-alt-permanent-event', player: PLAYER_2, cardInstanceId: shelobId, targetCompanyId: companyId,
    }));
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.strikesTotal).toBe(2);

    // The boosted attack carries 2 strikes (1 + 1), both facing Aragorn (the
    // company's only character). Assign, then resolve, each in turn: Aragorn's
    // untapped prowess (6-3=3) + roll 2 = 5, far below Shelob's boosted prowess
    // 19 → wounded both times. Body check roll 5 ≤ body 9 → survives each time.
    const aragornId = findCharInstanceId(inCombat, RESOURCE_PLAYER, ARAGORN);
    let afterCombat = inCombat;
    while (afterCombat.combat) {
      if (afterCombat.combat.phase === 'assign-strikes') {
        afterCombat = dispatch(afterCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
      } else if (afterCombat.combat.phase === 'body-check') {
        const roller = afterCombat.combat.bodyCheckTarget === 'creature' ? PLAYER_1 : PLAYER_2;
        afterCombat = executeAction(afterCombat, roller, 'body-check-roll', 5);
      } else {
        afterCombat = executeAction(afterCombat, PLAYER_1, 'resolve-strike', 2);
      }
    }

    expect(afterCombat.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === shelobId)).toBe(false);
    expectInDiscardPile(afterCombat, HAZARD_PLAYER, SHELOB);
  });

  // ─── Discard if Doors of Night is not in play ──────────────────────────────

  test('is discarded once Doors of Night is not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withShelob = addCardInPlay(state, HAZARD_PLAYER, SHELOB);

    const after = dispatch(withShelob, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SHELOB)).toBe(false);
    expectInDiscardPile(after, HAZARD_PLAYER, SHELOB);
  });

  test('stays in play while Doors of Night remains in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const withShelob = addCardInPlay(withDon, HAZARD_PLAYER, SHELOB);

    const after = dispatch(withShelob, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SHELOB)).toBe(true);
  });
});
