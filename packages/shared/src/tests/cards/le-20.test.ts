/**
 * @module le-20.test
 *
 * Card test: Lieutenant of Angmar (le-20)
 * Type: minion-character (ringwraith alignment)
 *
 * "Unique. Olog-hai. Leader. Manifestation of Rogrog. Discard on a body check
 *  result of 9. +4 direct influence against Trolls, Orcs, Troll factions, and
 *  Orc factions. When he is at Carn Dûm, you may keep one more card than normal
 *  in your hand."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 * race troll, keywords ["leader", "olog-hai"], prowess 8, body 9, mind 9,
 * directInfluence 1, marshallingPoints 3, skills warrior/scout, homesite
 * "Carn Dûm", discardBodyCheck [9]. Unique. Near-exact twin of the certified
 * Lieutenant of Dol Guldur (le-21), differing only in the DI bonus (+4 vs +2)
 * and the homesite (Carn Dûm vs Dol Guldur).
 *
 * Engine support table:
 * | # | Rule (card text)                                        | Status | Notes                                                                 |
 * |---|---------------------------------------------------------|--------|-----------------------------------------------------------------------|
 * | 1 | "Unique."                                               | OK     | unique: true                                                          |
 * | 2 | "Olog-hai."                                             | OK     | keywords includes "olog-hai" (structural keyword)                     |
 * | 3 | "Leader."                                               | OK     | keywords includes "leader" (structural keyword)                       |
 * | 4 | "Manifestation of Rogrog."                              | OK     | Rogrog (tw-85) is a hazard CREATURE — never persists in a character/  |
 * |   |                                                         |        | ally/agent in-play zone, so g.man.1 has no reachable conflict. Same   |
 * |   |                                                         |        | treatment as certified siblings le-21/le-22/ba-9: no manifestId.      |
 * | 5 | "Discard on a body check result of 9."                  | OK     | discardBodyCheck [9]; combat body check                               |
 * | 6 | "+4 direct influence against Trolls..."                 | OK     | stat-modifier, influence-check, target.race=troll                    |
 * | 7 | "...Orcs..."                                            | OK     | stat-modifier, influence-check, target.race=orc                      |
 * | 8 | "...Troll factions..."                                  | OK     | stat-modifier, faction-influence-check, faction.race=troll           |
 * | 9 | "...and Orc factions."                                  | OK     | stat-modifier, faction-influence-check, faction.race=orc             |
 * |10 | "When he is at Carn Dûm, you may keep one more card..." | OK     | hand-size-modifier +1 when self.location is Carn Dûm                  |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/AS).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, companyIdAt, dispatch, viableActions,
  makeBodyCheckCombat, makeShadowMHState, setCharStatus,
  RESOURCE_PLAYER, CardStatus,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, GameState, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const LIEUTENANT_OF_ANGMAR = 'le-20' as CardDefinitionId;

// Minion candidate characters for influence-check tests
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // orc, mind 5
const WULUAG = 'as-6' as CardDefinitionId;                 // troll, mind 4
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId; // man, mind 4

// Minion sites
const CARN_DUM = 'le-359' as CardDefinitionId;     // haven (Lieutenant's homesite)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (Goblins of Goblin-gate's site)

// Minion orc faction with positive influenceNumber
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9

describe('Lieutenant of Angmar (le-20)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[LIEUTENANT_OF_ANGMAR as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(1);
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effects 6 & 7: +4 DI during influence-check (character control) ──────────

  test('+4 DI vs Orcs allows Lieutenant (base DI 1) to control Orc Captain (mind 5) as a follower', () => {
    // Lieutenant base DI = 1. Orc Captain is an orc with mind 5.
    // Without the +4 DI bonus against Orcs: DI 1 < mind 5 → cannot control.
    // With the bonus: DI 5 >= mind 5 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }],
          hand: [ORC_CAPTAIN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcCaptainUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(orcCaptainUnderLieutenant.length).toBeGreaterThanOrEqual(1);
  });

  test('+4 DI vs Trolls allows Lieutenant (base DI 1) to control Wûluag (mind 4) as a follower', () => {
    // Lieutenant base DI = 1. Wûluag is a troll with mind 4.
    // Without the +4 DI bonus against Trolls: DI 1 < mind 4 → cannot control.
    // With the bonus: DI 5 >= mind 4 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }],
          hand: [WULUAG],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const wuluagUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(wuluagUnderLieutenant.length).toBeGreaterThanOrEqual(1);
  });

  test('+4 DI bonus does NOT apply to non-Orc/non-Troll characters', () => {
    // Horseman in the Night is race "man" with mind 4. Lieutenant's +4 DI bonus
    // is race-gated (orc/troll only), so DI stays at 1 < mind 4 → Lieutenant
    // cannot take Horseman as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }],
          hand: [HORSEMAN_IN_THE_NIGHT],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const horsemanUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(horsemanUnderLieutenant).toHaveLength(0);
  });

  // ─── Effect 9: +4 DI during faction-influence-check (orc factions) ───────────

  test('+4 DI bonus applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Lieutenant (troll, base DI 1) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate.
    // With the +4 DI bonus vs Orc factions: modifier = DI 1 + 4 = 5 → need 9 - 5 = 4.
    const state = buildSitePhaseState({
      characters: [LIEUTENANT_OF_ANGMAR],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const lieutenantAttempt = influenceActions.find(
      a => a.influencingCharacterId === lieutenantId,
    );
    expect(lieutenantAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(1) - diBonusVsOrcFaction(4) = 4
    expect(lieutenantAttempt!.need).toBe(4);
  });

  // ─── Effect 10: hand-size-modifier +1 at Carn Dûm ────────────────────────────

  test('hand size is base + 1 when Lieutenant is at Carn Dûm', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // PLAYER_2 has no Lieutenant → base hand size
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is base when Lieutenant is NOT at Carn Dûm', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_ANGMAR] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  // ─── Effect 5: "Discard on a body check result of 9." (discardBodyCheck [9]) ──

  test('body check roll of exactly 9 discards Lieutenant (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: lieutenantId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === lieutenantId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === lieutenantId)).toBe(false);
  });

  test('body check roll above 9 (10) eliminates Lieutenant', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LIEUTENANT_OF_ANGMAR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, LIEUTENANT_OF_ANGMAR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: lieutenantId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === lieutenantId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === lieutenantId)).toBe(false);
  });
});
