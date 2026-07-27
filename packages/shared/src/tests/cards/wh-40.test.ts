/**
 * @module wh-40.test
 *
 * Card test: Wild Hounds (wh-40)
 * Type: minion-resource-faction (dual, non-unique, 1 MP, influence # 12, Animal)
 *
 * Card text: "Playable at any tapped or untapped Ruins & Lairs [{R}] in a
 * Wilderness [{w}] if the influence check is greater than 11. Standard
 * Modifications: if Radagast is your Wizard (+3). Discard this faction to
 * cancel an automatic-attack at a Ruins & Lairs [{R}] or an attack keyed to
 * Wilderness [{w}] or Ruins & Lairs [{R}]. May also be used as a minion
 * resource card that is only playable by a character in a covert company."
 *
 * Effects:
 *   1. play-flag "playable-at-tapped-site" — the influence attempt may be made
 *      at a tapped Ruins & Lairs.
 *   2. check-modifier influence +3 when the player's Wizard is Radagast
 *      (`controller.wizard`, populated from the player's avatar in play).
 *   3. cancel-attack, cost `{ discard: "self" }`, `handModeRequiresCovert` —
 *      the dual-faction cancel. Two sources: the controlled faction in play
 *      (discarded, no covert/alignment gate) and the card in hand played as a
 *      minion resource (covert company + minion player). The `when` filter
 *      qualifies an automatic-attack at a Ruins & Lairs, or an attack keyed to
 *      Wilderness or Ruins & Lairs.
 *
 * Playability gating lives in `siteMatchesEntry` (site-type + region-type via a
 * new `site.regionType` `when` context). The two cancel sources are emitted in
 * `cancelAttackActions` (combat.ts) and applied by `handleCancelAttack` /
 * `handleCancelAttackByInPlayFaction` (combat-cancel.ts).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  makeSitePhase, makeCancelWindowCombat, setCompanySiteStatus,
  firstFactionInfluenceAttempt, viableActions, dispatch, resolveChain,
  findCharInstanceId, expectInDiscardPile,
} from '../test-helpers.js';
import { Alignment, RegionType, SiteType, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  InfluenceAttemptAction, CancelAttackAction,
} from '../../index.js';

const WILD_HOUNDS = 'wh-40' as CardDefinitionId;
const RADAGAST = 'tw-178' as CardDefinitionId;              // hero wizard avatar
const LEGOLAS = 'tw-168' as CardDefinitionId;               // hero elf, DI 2 (no Wild Hounds bonus)

const LONELY_MOUNTAIN = 'le-387' as CardDefinitionId;       // ruins-and-lairs in Northern Rhovanion (wilderness)
const MORIA = 'tw-413' as CardDefinitionId;                 // shadow-hold in Redhorn Gate (wilderness)
const BANDIT_LAIR = 'le-351' as CardDefinitionId;           // ruins-and-lairs in Brown Lands (shadow-land)
const RIVENDELL = 'tw-421' as CardDefinitionId;             // hero haven (site-deck filler)
const LORIEN = 'tw-408' as CardDefinitionId;                // hero haven (opponent site)
const ARAGORN = 'tw-120' as CardDefinitionId;               // hero dunadan (opponent filler)

const HADOR = 'le-14' as CardDefinitionId;                  // dunadan (covert — not orc/troll)
const LAGDUF = 'le-18' as CardDefinitionId;                 // orc (makes a company overt)
const DOL_GULDUR = 'le-367' as CardDefinitionId;            // minion haven (site-deck filler)

/** The influence-attempt for a specific influencing character against a faction. */
function attemptBy(state: GameState, factionId: CardInstanceId, charId: CardInstanceId): InfluenceAttemptAction | undefined {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === charId);
}

describe('Wild Hounds (wh-40)', () => {
  beforeEach(() => resetMint());

  // ── Playability: Ruins & Lairs in a Wilderness, influence check > 11 ──

  test('influence-attempt is legal at a Ruins & Lairs in a Wilderness (need = 12 - DI)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const attempt = attemptBy(state, factionId, legolasId);
    expect(attempt).toBeDefined();
    // influence # 12, Legolas DI 2, no Wild Hounds-specific bonus → need 10.
    expect(attempt!.need).toBe(10);
  });

  test('NOT playable at a non-Ruins & Lairs site in a Wilderness (wrong site type)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a Ruins & Lairs NOT in a Wilderness (wrong region type)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('playable at a TAPPED Ruins & Lairs (playable-at-tapped-site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const tapped = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const state = { ...tapped, phaseState: makeSitePhase() };

    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(attemptBy(state, factionId, legolasId)).toBeDefined();
  });

  // ── Standard Modification: Radagast is your Wizard (+3) ──

  test('Radagast as your Wizard lowers the required roll by 3', () => {
    const withoutRadagast = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const stateA = { ...withoutRadagast, phaseState: makeSitePhase() };
    const factionIdA = stateA.players[0].hand[0].instanceId;
    const legolasA = findCharInstanceId(stateA, RESOURCE_PLAYER, LEGOLAS);
    const needWithout = attemptBy(stateA, factionIdA, legolasA)!.need;

    const withRadagast = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS, RADAGAST] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const stateB = { ...withRadagast, phaseState: makeSitePhase() };
    const factionIdB = stateB.players[0].hand[0].instanceId;
    const legolasB = findCharInstanceId(stateB, RESOURCE_PLAYER, LEGOLAS);
    const needWith = attemptBy(stateB, factionIdB, legolasB)!.need;

    // Same influencer (Legolas); Radagast avatar in play → +3 to the check → need 3 lower.
    expect(needWithout).toBe(10);
    expect(needWith).toBe(7);
  });

  // ── Discard the controlled faction in play to cancel ──

  /** Hero player with Wild Hounds already in play as a controlled faction. */
  function factionInPlayState(site: CardDefinitionId): GameState {
    const wildHounds: CardInPlay = {
      instanceId: 'wh40-inplay' as CardInstanceId, definitionId: WILD_HOUNDS, status: CardStatus.Untapped,
    };
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL], cardsInPlay: [wildHounds] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  }

  test('offered against an automatic-attack at a Ruins & Lairs', () => {
    const base = factionInPlayState(LONELY_MOUNTAIN);
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('offered against an attack keyed to Wilderness (even at a non-R&L site)', () => {
    const base = factionInPlayState(MORIA); // shadow-hold, so only the wilderness-keying clause can fire
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeying: [RegionType.Wilderness],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('offered against an attack keyed to Ruins & Lairs (site-type keying)', () => {
    const base = factionInPlayState(MORIA); // shadow-hold, so only the R&L-site-keying clause can fire
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc, attackSourceType: 'creature', attackSiteKeyingTypes: [SiteType.RuinsAndLairs],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('NOT offered against a non-qualifying attack (automatic-attack at a non-R&L site)', () => {
    const base = factionInPlayState(MORIA); // shadow-hold automatic attack
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered against a creature keyed only to a Shadow-land', () => {
    const base = factionInPlayState(MORIA);
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc, attackSourceType: 'creature', attackKeying: [RegionType.Shadow],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('discarding the in-play faction cancels the attack immediately and moves it to the discard pile', () => {
    const base = factionInPlayState(LONELY_MOUNTAIN);
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });

    const action = viableActions(state, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const after = dispatch(state, action);

    // Combat cancelled immediately (in-play source, no chain).
    expect(after.combat).toBeNull();
    // Faction left play and is in the discard pile — no instance lost.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === WILD_HOUNDS)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, WILD_HOUNDS);
  });

  // ── Minion resource card, only playable by a character in a covert company ──

  /** Minion player holding Wild Hounds in hand; company covert unless an orc is added. */
  function minionHandState(chars: CardDefinitionId[]): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LONELY_MOUNTAIN, characters: chars }], hand: [WILD_HOUNDS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
  }

  test('a minion covert company may play it from hand against a qualifying attack', () => {
    const base = minionHandState([HADOR]); // dunadan → covert
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('NOT playable from hand by an OVERT minion company (has an Orc)', () => {
    const base = minionHandState([HADOR, LAGDUF]); // orc present → overt
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT playable from hand by a non-minion (hero) player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Hero player, covert company, Wild Hounds in hand — the minion resource mode is unavailable.
        { id: PLAYER_1, companies: [{ site: LONELY_MOUNTAIN, characters: [LEGOLAS] }], hand: [WILD_HOUNDS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('playing it from hand discards the card and cancels the attack via the chain', () => {
    const base = minionHandState([HADOR]);
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });

    const action = viableActions(state, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const declared = dispatch(state, action);

    // Card discarded from hand; combat cancels once the chain resolves.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, WILD_HOUNDS);
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });
});
