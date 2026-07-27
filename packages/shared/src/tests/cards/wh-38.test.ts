/**
 * @module wh-38.test
 *
 * Card test: Beasts of the Wood (wh-38)
 * Type: minion-resource-faction (dual, non-unique, 1 MP, influence # 12, Animal)
 *
 * Card text: "Playable at any tapped or untapped non-Haven, non-Darkhaven,
 * non-Dark-hold site in Woodland Realm, Western Mirkwood, Heart of Mirkwood,
 * Southern Mirkwood, Fangorn, or Cardolan if the influence check is greater
 * than 11. Standard Modifications: if Radagast is your Wizard (+3). Tap this
 * faction to cancel an attack keyed by name to one of the regions listed above.
 * May also be used as a minion resource card that is only playable by a
 * character in a covert company."
 *
 * Effects:
 *   1. play-flag "playable-at-tapped-site" — the influence attempt may be made
 *      at a tapped site.
 *   2. check-modifier influence +3 when the player's Wizard is Radagast
 *      (`controller.wizard`, populated from the player's avatar in play).
 *   3. cancel-attack, cost `{ tap: "self" }`, `handModeRequiresCovert` — the
 *      dual-faction cancel. Two sources: the controlled faction in play (TAPPED
 *      in place, not discarded; no covert/alignment gate) and the card in hand
 *      played as a minion resource (covert company + minion player). The `when`
 *      filter qualifies an attack keyed *by name* to one of the six regions
 *      (`attack.keyingRegionNames $includes <name>`).
 *
 * Playability gating lives in `siteMatchesEntry` via a `playableAt` `{ any: true,
 * when }` entry (any non-Haven, non-Dark-hold site in one of the six named
 * regions). The two cancel sources are emitted in `cancelAttackActions`
 * (combat.ts) and applied by `handleCancelAttack` /
 * `handleCancelAttackByInPlayFaction` (combat-cancel.ts), which taps the in-play
 * faction rather than discarding it. Region-name keying is threaded through
 * `combat.attackKeyingRegionNames` (populated in chain-reducer.ts).
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
import { Alignment, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  InfluenceAttemptAction, CancelAttackAction,
} from '../../index.js';

const BEASTS = 'wh-38' as CardDefinitionId;
const RADAGAST = 'tw-178' as CardDefinitionId;             // hero wizard avatar
const LEGOLAS = 'tw-168' as CardDefinitionId;              // hero elf, DI 2 (no Beasts-specific bonus)

const SARN_GORIWING = 'tw-423' as CardDefinitionId;        // shadow-hold in Heart of Mirkwood (in-region, valid type)
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;         // border-hold in Western Mirkwood (in-region, valid type)
const BARROW_DOWNS = 'tw-375' as CardDefinitionId;         // ruins-and-lairs in Cardolan (in-region, valid type)
const DOL_GULDUR_DARK = 'tw-387' as CardDefinitionId;      // dark-hold in Southern Mirkwood (excluded type)
const DOL_GULDUR_HAVEN = 'le-367' as CardDefinitionId;     // haven in Southern Mirkwood (excluded type)
const MORIA = 'tw-413' as CardDefinitionId;                // shadow-hold in Redhorn Gate (out of region)
const RIVENDELL = 'tw-421' as CardDefinitionId;            // hero haven (site-deck filler)
const LORIEN = 'tw-408' as CardDefinitionId;               // hero haven (opponent site)
const ARAGORN = 'tw-120' as CardDefinitionId;              // hero dunadan (opponent filler)

const HADOR = 'le-14' as CardDefinitionId;                 // dunadan (covert — not orc/troll)
const LAGDUF = 'le-18' as CardDefinitionId;                // orc (makes a company overt)

const IN_LIST = 'Fangorn';                                 // one of the six named regions
const NOT_IN_LIST = 'Gorgoroth';                           // a region NOT on the card

/** The influence-attempt for a specific influencing character against the faction. */
function attemptBy(state: GameState, factionId: CardInstanceId, charId: CardInstanceId): InfluenceAttemptAction | undefined {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === charId);
}

describe('Beasts of the Wood (wh-38)', () => {
  beforeEach(() => resetMint());

  // ── Playability: non-Haven/non-Dark-hold site in a named region, check > 11 ──

  test('influence-attempt is legal at a Shadow-hold in Heart of Mirkwood (need = 12 - DI)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const attempt = attemptBy(state, factionId, legolasId);
    expect(attempt).toBeDefined();
    // influence # 12, Legolas DI 2, no Beasts-specific bonus → need 10.
    expect(attempt!.need).toBe(10);
  });

  test('also legal at a Border-hold (Western Mirkwood) and a Ruins & Lairs (Cardolan) — any valid site type', () => {
    for (const site of [WOODMEN_TOWN, BARROW_DOWNS]) {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        recompute: true,
        players: [
          { id: PLAYER_1, companies: [{ site, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      });
      const state = { ...base, phaseState: makeSitePhase() };
      const factionId = state.players[0].hand[0].instanceId;
      const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
      expect(attemptBy(state, factionId, legolasId)).toBeDefined();
    }
  });

  test('NOT playable at a site OUTSIDE the named regions (Moria in Redhorn Gate)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a Dark-hold in a named region (excluded site type)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR_DARK, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a Haven in a named region (excluded site type)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR_HAVEN, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('playable at a TAPPED valid site (playable-at-tapped-site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
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
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
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
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS, RADAGAST] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
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

  // ── Tap the controlled faction in play to cancel a region-name-keyed attack ──

  /** Hero player with Beasts of the Wood already in play as a controlled faction. */
  function factionInPlayState(status: CardStatus = CardStatus.Untapped): GameState {
    const beasts: CardInPlay = {
      instanceId: 'beasts-inplay' as CardInstanceId, definitionId: BEASTS, status,
    };
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL], cardsInPlay: [beasts] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  }

  test('offered against an attack keyed by name to one of the six regions', () => {
    const base = factionInPlayState();
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('NOT offered against an attack keyed by name to a region NOT on the card', () => {
    const base = factionInPlayState();
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc, attackSourceType: 'creature', attackKeyingRegionNames: [NOT_IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered against an automatic-attack (no region-name keying)', () => {
    const base = factionInPlayState();
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT offered when the in-play faction is already tapped', () => {
    const base = factionInPlayState(CardStatus.Tapped);
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('tapping the in-play faction cancels the attack immediately and leaves it TAPPED in play (not discarded)', () => {
    const base = factionInPlayState();
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });

    const action = viableActions(state, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const after = dispatch(state, action);

    // Combat cancelled immediately (in-play source, no chain).
    expect(after.combat).toBeNull();
    // Faction stays in play but is now tapped — not discarded (no instance lost).
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === BEASTS);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BEASTS)).toBe(false);
  });

  // ── Minion resource card, only playable by a character in a covert company ──

  /** Minion player holding Beasts of the Wood in hand; company covert unless an orc is added. */
  function minionHandState(chars: CardDefinitionId[]): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: SARN_GORIWING, characters: chars }], hand: [BEASTS], siteDeck: [DOL_GULDUR_HAVEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [DOL_GULDUR_HAVEN] },
      ],
    });
  }

  test('a minion covert company may play it from hand against a region-name-keyed attack', () => {
    const base = minionHandState([HADOR]); // dunadan → covert
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('NOT playable from hand by an OVERT minion company (has an Orc)', () => {
    const base = minionHandState([HADOR, LAGDUF]); // orc present → overt
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT playable from hand by a non-minion (hero) player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Hero player, covert company, Beasts in hand — the minion resource mode is unavailable.
        { id: PLAYER_1, companies: [{ site: SARN_GORIWING, characters: [LEGOLAS] }], hand: [BEASTS], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('playing it from hand discards the card and cancels the attack via the chain', () => {
    const base = minionHandState([HADOR]);
    const state = makeCancelWindowCombat(base, {
      creatureRace: Race.Wolf, attackSourceType: 'creature', attackKeyingRegionNames: [IN_LIST],
    });

    const action = viableActions(state, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const declared = dispatch(state, action);

    // Card discarded from hand; combat cancels once the chain resolves.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, BEASTS);
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });
});
