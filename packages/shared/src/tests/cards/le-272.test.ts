/**
 * @module le-272.test
 *
 * Card test: Misty Mountain Wargs (le-272)
 * Type: minion-resource-faction (wolf, unique, 2 MP, influence # 10, in-play # 0)
 *
 * "Unique. Playable at Ettenmoors if the influence check is greater than 9.
 *  Once in play, the number required to influence this faction is 0. If this
 *  influence attempt is made by an Orc or Troll leader, you may place this
 *  faction under the control of that leader and not tap the site. Discard the
 *  faction if the leader moves or leaves play. Three or more factions controlled
 *  by the same leader give 2 extra marshalling points. Standard Modifications:
 *  Goblins of Goblin-gate (+2), Wargs of Forochel (+2)."
 *
 * Effects:
 *   1. leader-control: Orc/Troll Leader may take control (site untapped),
 *      discarded if the leader moves/leaves play, group bonus 3→+2 faction MP.
 *   2. check-modifier influence +2 when controller has Goblins of Goblin-gate.
 *   3. check-modifier influence +2 when controller has Wargs of the Forochel.
 *
 * Note: the printed "Wargs of Forochel" names the faction whose actual card name
 * is "Wargs of the Forochel" (le-293), so the check-modifier gates on that name.
 * Because this faction is a `wolf` faction (not orc), the leaders' "+DI vs orc
 * faction" bonuses do NOT apply, so the baseline need is `influence# - DI`.
 *
 * Engine support table:
 * | # | Rule                                              | Status      | Notes                                            |
 * |---|---------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Playable only at Ettenmoors                       | IMPLEMENTED | `playableAt.site` match in site.ts               |
 * | 2 | Influence # 10 (greater than 9)                   | IMPLEMENTED | shared faction-influence machinery               |
 * | 3 | Once in play, influence # 0                        | IMPLEMENTED | `inPlayInfluenceNumber` (CoE rule 8.3)           |
 * | 4 | Orc/Troll leader may take control; site untapped  | IMPLEMENTED | `leader-control` effect + `placeUnderLeaderControl` |
 * | 5 | Control NOT offered to a non-leader               | IMPLEMENTED | `leaderControlEligibility` (race + Leader)       |
 * | 6 | Discard the faction if the leader moves           | IMPLEMENTED | M/H step 8 discard (reducer-movement-hazard.ts)  |
 * | 7 | Discard the faction if the leader leaves play     | IMPLEMENTED | `discardOrphanedControlledFactions` (postReduce) |
 * | 8 | 3+ factions under one leader → +2 MP               | IMPLEMENTED | group bonus in recompute-derived.ts              |
 * | 9 | Standard Modifications (+2 / +2)                   | IMPLEMENTED | `check-modifier` on `controller.inPlay`          |
 *
 * Playable: CERTIFIED
 *
 * Fixtures:
 *   ORC_CAPTAIN (le-31)            — minion orc Leader, DI 0 (no bonus vs a wolf faction)
 *   LIEUTENANT_DOL_GULDUR (le-21)  — minion troll Leader, DI 3 (no bonus vs a wolf faction)
 *   LAGDUF (le-18)                 — minion orc, NOT a Leader (no effects)
 *   GOBLINS_OF_GOBLIN_GATE (le-265)— faction named in the first +2 standard modification
 *   WARGS_OF_FOROCHEL (le-293)     — faction named in the second +2 standard modification
 *   ETTENMOORS (le-373)            — ruins-and-lairs (the only playable site)
 *   MORIA_LE (le-392)              — shadow-hold (a different site, for the negative test)
 *   DOL_GULDUR (le-367)            — minion haven (opponent / move destination)
 *   MINAS_MORGUL (le-390)          — minion haven (site-deck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, makeMHState,
  firstFactionInfluenceAttempt, viableActions, dispatch, resolveChain,
  recomputeDerived,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState, InfluenceAttemptAction,
} from '../../index.js';

const MISTY_MOUNTAIN_WARGS = 'le-272' as CardDefinitionId;
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;            // orc Leader, DI 0
const LIEUTENANT_DOL_GULDUR = 'le-21' as CardDefinitionId;  // troll Leader, DI 3
const LAGDUF = 'le-18' as CardDefinitionId;                 // orc, NOT a Leader
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const WARGS_OF_FOROCHEL = 'le-293' as CardDefinitionId;

const ETTENMOORS = 'le-373' as CardDefinitionId;            // ruins-and-lairs
const MORIA_LE = 'le-392' as CardDefinitionId;              // shadow-hold (not Ettenmoors)
const DOL_GULDUR = 'le-367' as CardDefinitionId;            // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;          // minion haven

/** Find the faction influence-attempt with the control variant flag set. */
function controlVariants(state: GameState, factionInstanceId: CardInstanceId): InfluenceAttemptAction[] {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .filter(a => a.factionInstanceId === factionInstanceId && a.placeUnderLeaderControl === true);
}

describe('Misty Mountain Wargs (le-272)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: playable at Ettenmoors, influence # 10 ─────────────────────

  test('influence-attempt is legal at Ettenmoors; baseline need = 10 - DI', () => {
    // Orc Captain DI 0 with no bonus vs a wolf faction → need = 10 - 0 = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('a troll leader (DI 3) lowers the need to 7', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [LIEUTENANT_DOL_GULDUR] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('faction is NOT influence-able at a site other than Ettenmoors', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_LE, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  // ── Rule 9: standard modifications (both +2) ──────────────────────────────

  test('+2 standard modification when controller also has Goblins of Goblin-gate', () => {
    // modifier = DI 0 + check bonus 2 = 2; need = 10 - 2 = 8.
    const goblins: CardInPlay = {
      instanceId: 'gob-1' as CardInstanceId, definitionId: GOBLINS_OF_GOBLIN_GATE, status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR], cardsInPlay: [goblins] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+2 standard modification when controller also has Wargs of the Forochel', () => {
    // modifier = DI 0 + check bonus 2 = 2; need = 10 - 2 = 8.
    const wargs: CardInPlay = {
      instanceId: 'war-1' as CardInstanceId, definitionId: WARGS_OF_FOROCHEL, status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR], cardsInPlay: [wargs] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  // ── Rule 4/5: leader-control option offered only to an eligible leader ─────

  test('control variant offered when an Orc leader makes the attempt', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(1);
  });

  test('control variant offered when a Troll leader makes the attempt', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [LIEUTENANT_DOL_GULDUR] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(1);
  });

  test('control variant NOT offered to a non-leader orc (a normal attempt still is)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [LAGDUF] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;

    expect(controlVariants(state, factionInstanceId)).toHaveLength(0);
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeDefined();
  });

  // ── Rule 4: resolving with / without control ──────────────────────────────

  test('taking control: faction enters play controlledBy the leader and the site stays untapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);

    const controlAction = controlVariants(state, factionInstanceId)[0];
    const afterChain = resolveChain(dispatch(state, controlAction));
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, rollAction);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInstanceId);
    expect(faction).toBeDefined();
    expect(faction!.controlledBy).toBe(leaderId);
    // Site untapped — control leaves it usable.
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('declining control: faction enters play with no controller and the site is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [MISTY_MOUNTAIN_WARGS], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;

    // The normal (non-control) attempt: placeUnderLeaderControl is falsy.
    const normal = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.factionInstanceId === factionInstanceId && !a.placeUnderLeaderControl)!;
    const afterChain = resolveChain(dispatch(state, normal));
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, rollAction);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInstanceId);
    expect(faction).toBeDefined();
    expect(faction!.controlledBy).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  // ── Rule 6: discard when the controlling leader moves ─────────────────────

  test('faction is discarded when the controlling leader moves (M/H step 8)', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [] },
      ],
    });
    const leaderId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const faction: CardInPlay = {
      instanceId: 'mmw-1' as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped, controlledBy: leaderId,
    };
    const company = built.players[0].companies[0];
    const destSite = built.players[0].siteDeck.find(c => c.definitionId === DOL_GULDUR)!;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
      players: [
        {
          ...built.players[0],
          cardsInPlay: [faction],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: destSite.instanceId, definitionId: destSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
        },
        built.players[1],
      ] as typeof built.players,
    };

    const afterMove = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    // Leader moved; faction discarded.
    expect(afterMove.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === faction.instanceId)).toBe(false);
    expect(afterMove.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === faction.instanceId)).toBe(true);
  });

  // ── Rule 7: discard when the controlling leader leaves play ───────────────

  test('faction is discarded when its controlling leader is no longer in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [LAGDUF] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [] },
      ],
    });
    const faction: CardInPlay = {
      instanceId: 'mmw-1' as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped,
      controlledBy: 'ghost-leader' as CardInstanceId, // an instance not present in PLAYER_1.characters
    };
    const state: GameState = {
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
      players: [
        { ...built.players[0], cardsInPlay: [faction] },
        built.players[1],
      ] as typeof built.players,
    };

    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === faction.instanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === faction.instanceId)).toBe(true);
  });

  test('faction survives while its controlling leader is still in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [] },
      ],
    });
    const leaderId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const faction: CardInPlay = {
      instanceId: 'mmw-1' as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped, controlledBy: leaderId,
    };
    const state: GameState = {
      ...built,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: false, hazardPlayerPassed: false }),
      players: [
        { ...built.players[0], cardsInPlay: [faction] },
        built.players[1],
      ] as typeof built.players,
    };

    // A reduction that does not move or remove the leader leaves the faction in play.
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === faction.instanceId)).toBe(true);
  });

  // ── Rule 8: group marshalling-point bonus ─────────────────────────────────

  test('a leader controlling three factions earns +2 faction marshalling points', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const leaderId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const factions: CardInPlay[] = [0, 1, 2].map(i => ({
      instanceId: `mmw-${i}` as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped, controlledBy: leaderId,
    }));
    const state = recomputeDerived({
      ...built,
      players: [{ ...built.players[0], cardsInPlay: factions }, built.players[1]] as typeof built.players,
    });

    // 3 factions × 2 MP each (6) + group bonus (2) = 8.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(8);
  });

  test('a leader controlling only two factions earns no bonus', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const leaderId = findCharInstanceId(built, RESOURCE_PLAYER, ORC_CAPTAIN);
    const factions: CardInPlay[] = [0, 1].map(i => ({
      instanceId: `mmw-${i}` as CardInstanceId, definitionId: MISTY_MOUNTAIN_WARGS, status: CardStatus.Untapped, controlledBy: leaderId,
    }));
    const state = recomputeDerived({
      ...built,
      players: [{ ...built.players[0], cardsInPlay: factions }, built.players[1]] as typeof built.players,
    });

    // 2 factions × 2 MP each = 4; no group bonus below the threshold of 3.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(4);
  });
});
