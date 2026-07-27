/**
 * @module as-76.test
 *
 * Card test: Regiment of Black Crows (as-76)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 *
 * Card text:
 *   "Playable at a tapped or untapped non-Under-deeps Ruins & Lairs [{R}].
 *    Its controlling character's company is overt.
 *    May not be attacked.
 *    Discard this ally if its controlling character is wounded.
 *    Tap this ally to cancel a hazard creature attack against his company
 *    not keyed to a site and to put the creature's card back into its
 *    player's hand.
 *    Cannot be duplicated in a given company."
 *
 * Effects:
 *   1. play-target: site (siteType ruins-and-lairs, not under-deeps), requireTapped:false
 *   2. play-flag: no-attack — ally may not be assigned strikes
 *   3. company-overt — controlling character's company is overt
 *   4. on-event: bearer-wounded → discard-self
 *   5. cancel-attack: cost tap:self, when attack.source=creature
 *   6. duplication-limit: scope=company, max=1
 *
 * | # | Rule                                                  | Status | Notes                                           |
 * |---|-------------------------------------------------------|--------|-------------------------------------------------|
 * | 1 | Playable at non-under-deeps R&L (tapped or untapped)  | OK     | play-target site filter + requireTapped:false   |
 * | 2 | May not be attacked                                   | OK     | play-flag: no-attack in combat.ts               |
 * | 3 | Company is overt                                      | OK     | company-overt via reducer-utils isCovertCompany |
 * | 4 | Discard when bearer is wounded                        | OK     | on-event bearer-wounded → discard-self          |
 * | 5 | Tap to cancel creature attack (not keyed to site)     | OK     | cancel-attack with attack.source=creature       |
 * | 6 | Cannot be duplicated in a given company               | OK     | duplication-limit scope=company in org-events   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, attachAllyToChar,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, companyIdAt, dispatch,
  makeMHState, expectInDiscardPile, executeAction,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInstance, CombatState, CancelAttackAction, PlayHeroResourceAction, GameState } from '../../index.js';

const REGIMENT = 'as-76' as CardDefinitionId;

// Minion characters (use LE pool — ringwraith alignment, no inherent effects)
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5, body 7, mind 5
const LUITPRAND = 'le-23' as CardDefinitionId; // man, prowess 3, body 7, mind 1

// Minion sites
const DIMRILL_DALE = 'le-365' as CardDefinitionId;  // minion ruins-and-lairs (not under-deeps)
const WHITE_TOWERS = 'le-412' as CardDefinitionId;   // minion ruins-and-lairs (not under-deeps)
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven (not ruins-and-lairs)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven
const MORIA_MINION = 'le-392' as CardDefinitionId;   // minion shadow-hold (not ruins-and-lairs)
// Under-deeps R&L — balrog-site with `keywords: ["under-deeps"]`
const DROWNING_DEEPS = 'ba-89' as CardDefinitionId;

// Hazard creature for cancel-attack and bearer-wounded tests.
// Cave-drake is a Drake (wilderness-keyed, no site type keying) — source = "creature".
const CAVE_DRAKE = 'tw-082' as CardDefinitionId; // race "drake", prowess 9

// Not Slay Needlessly — minion short event that cancels if defender.covert, else -2 prowess
const NSN = 'le-212' as CardDefinitionId;

// Elf-lord Revealed in Wrath — "elf" race creature, for NSN + overt test
const ELF_LORD = 'le-69' as CardDefinitionId;

/**
 * Build a CombatState with the given hazard creature attacking the resource
 * player's first company. Puts the creature in the hazard player's cardsInPlay
 * so cancel-attack resolution can discard it.
 */
function setupCombat(
  state: GameState,
  creatureDefId: CardDefinitionId,
  creatureRace: Race,
): GameState {
  const creatureInstanceId = `creature-${creatureRace}-1` as CardInstanceId;
  const creatureCard: CardInstance = { instanceId: creatureInstanceId, definitionId: creatureDefId };
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const updatedHazardPlayer = {
    ...hazardPlayer,
    cardsInPlay: [
      ...hazardPlayer.cardsInPlay,
      { instanceId: creatureCard.instanceId, definitionId: creatureCard.definitionId, status: CardStatus.Untapped },
    ],
  };
  const players = [
    state.players[RESOURCE_PLAYER],
    updatedHazardPlayer,
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 9,
    creatureBody: null,
    creatureRace,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('Regiment of Black Crows (as-76)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at non-under-deeps Ruins & Lairs (tapped or untapped) ──

  test('IS playable at an untapped non-under-deeps Ruins & Lairs site', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DIMRILL_DALE,
      hand: [REGIMENT],
    });
    const regInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === regInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('IS playable at a tapped non-under-deeps Ruins & Lairs site', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DIMRILL_DALE,
      hand: [REGIMENT],
      siteStatus: CardStatus.Tapped,
    });
    const regInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === regInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-Ruins-and-Lairs site (shadow-hold)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [REGIMENT],
    });
    const regInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const viable = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === regInstanceId);
    expect(viable).toHaveLength(0);
  });

  test('NOT playable at an under-deeps Ruins & Lairs site', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DROWNING_DEEPS,
      hand: [REGIMENT],
    });
    const regInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const viable = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === regInstanceId);
    expect(viable).toHaveLength(0);
  });

  // ─── Rule 2: may not be attacked ──────────────────────────────────────────

  test('ally is NOT offered as a defender strike target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);

    // Only ASTERNAK should be offerable; the ally has no-attack flag.
    const assignActions = viableActions(combatState, PLAYER_1, 'assign-strike');
    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const allyAssigned = assignActions.some(a =>
      'characterId' in a.action && a.action.characterId === allyId,
    );
    expect(allyAssigned).toBe(false);
  });

  test('attacker cannot assign strike to the ally', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    // Detainment-style (attacker chooses): ally still excluded.
    const combatState: GameState = {
      ...setupCombat(withAlly, CAVE_DRAKE, Race.Drake),
      combat: {
        ...setupCombat(withAlly, CAVE_DRAKE, Race.Drake).combat!,
        assignmentPhase: 'attacker',
      },
    };
    const assignActions = viableActions(combatState, PLAYER_2, 'assign-strike');
    const allyId = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0].instanceId;
    const allyAssigned = assignActions.some(a =>
      'characterId' in a.action && a.action.characterId === allyId,
    );
    expect(allyAssigned).toBe(false);
  });

  // ─── Rule 3: company is overt ─────────────────────────────────────────────

  test('company with Regiment is overt (NSN does -2 prowess, not cancel)', () => {
    // Not Slay Needlessly cancels vs covert companies, gives -2 prowess vs overt.
    // ASTERNAK (man, no Orc/Troll) → covert without ally.
    // With REGIMENT ally → overt (company-overt effect).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [NSN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);

    // Build a cancel-window combat state with the Elf-lord (race "elf").
    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const updatedHazardPlayer = {
      ...withAlly.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...withAlly.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const stateWithCreature: GameState = {
      ...withAlly,
      players: [withAlly.players[RESOURCE_PLAYER], updatedHazardPlayer] as unknown as typeof withAlly.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(withAlly, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: Race.Elf,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    // With overt company: NSN's cancel-attack should NOT be available — NSN requires covert.
    // The Regiment's own cancel-attack (tap self) is unrelated to covert/overt and would
    // still be available, so filter to only the hand card (NSN) cancel-attack actions.
    const nsnInstanceId = withAlly.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(stateWithCreature, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);
    const modifyActions = viableActions(stateWithCreature, PLAYER_1, 'modify-attack');
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });

  test('company without Regiment and no Orc/Troll is covert (NSN cancels)', () => {
    // Without the ally, just ASTERNAK (man) → covert → NSN cancels.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [NSN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const updatedHazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const stateWithCreature: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], updatedHazardPlayer] as unknown as typeof base.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(base, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: Race.Elf,
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    // Covert → NSN's cancel-attack should be available.
    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(stateWithCreature, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 4: discard ally when bearer is wounded ──────────────────────────

  test('ally is discarded when its bearer is wounded in combat', () => {
    // Asternak: prowess 5, body 7. Strike prowess 9.
    // Roll 2: 2 + 5 = 7 < 9 → wounded.
    // Body check roll 7: 7 >= body 7 → survives as wounded (not eliminated).
    // bearer-wounded event fires → Regiment goes to discard pile.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);

    const asternakId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: asternakId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);     // roll 2: 2+5=7 < 9 → wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 7);    // roll 7: 7 >= 7 → survives wounded

    expect(s.combat).toBeNull();

    // Asternak should still be in play (wounded, not eliminated)
    expect(s.players[RESOURCE_PLAYER].characters[asternakId]).toBeDefined();
    // Regiment should be discarded to resource player's discard pile
    expectInDiscardPile(s, RESOURCE_PLAYER, REGIMENT);
    // Ally must not still be attached to Asternak
    const asternakChar = s.players[RESOURCE_PLAYER].characters[asternakId];
    expect(asternakChar.allies).toHaveLength(0);
  });

  test('ally is NOT discarded when bearer wins the strike (not wounded)', () => {
    // Roll 12: 12 + 5 = 17 > 9 → Asternak wins, no wound.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);

    const asternakId = findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: asternakId });
    // Cave-drake has no body → no creature body check needed after success
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);    // roll 12: 12+5=17 > 9 → success

    expect(s.combat).toBeNull();
    // Ally should still be attached
    const asternakChar = s.players[RESOURCE_PLAYER].characters[asternakId];
    expect(asternakChar.allies).toHaveLength(1);
    expect(asternakChar.allies[0].definitionId).toBe(REGIMENT);
  });

  // ─── Rule 5: tap to cancel hazard creature attack (not keyed to site) ──────

  test('tap-to-cancel is available against a hazard creature attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);

    const cancelAction = cancelActions[0].action as CancelAttackAction;
    const ally = combatState.players[RESOURCE_PLAYER]
      .characters[findCharInstanceId(combatState, RESOURCE_PLAYER, ASTERNAK)]
      .allies[0];
    expect(cancelAction.cardInstanceId).toBe(ally.instanceId);
  });

  test('tap-to-cancel is NOT available against an automatic-attack (keyed to site)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'site-1' as CardInstanceId, attackIndex: 0 },
      companyId: companyIdAt(withAlly, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [],
      currentStrikeIndex: 0,
      phase: 'assign-strikes',
      assignmentPhase: 'defender',
      bodyCheckTarget: null,
      detainment: false,
    };
    const combatState: GameState = { ...withAlly, phaseState: makeMHState(), combat };

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    // Only ally-sourced cancel-attack is checked; the ally's when condition
    // requires attack.source === 'creature', so no cancel for auto-attack.
    const allyCancelActions = cancelActions.filter(a => {
      const ally = withAlly.players[RESOURCE_PLAYER]
        .characters[findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK)]
        .allies[0];
      return 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === ally.instanceId;
    });
    expect(allyCancelActions).toHaveLength(0);
  });

  test('executing tap-to-cancel taps the ally and discards the creature', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions.length).toBe(1);
    const after = dispatch(combatState, cancelActions[0].action);

    // Combat is canceled (no follow-up chain for ally cancels)
    expect(after.combat).toBeNull();

    // Regiment ally is now tapped
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    const ally = after.players[RESOURCE_PLAYER].characters[charId].allies[0];
    expect(ally.status).toBe(CardStatus.Tapped);

    // Cave-drake creature is in the hazard player's discard pile
    expectInDiscardPile(after, HAZARD_PLAYER, CAVE_DRAKE);
  });

  test('tap-to-cancel is NOT available when the ally is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DIMRILL_DALE, characters: [ASTERNAK] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);
    const charId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const char = withAlly.players[RESOURCE_PLAYER].characters[charId];
    const updatedChars = {
      ...withAlly.players[RESOURCE_PLAYER].characters,
      [charId as string]: {
        ...char,
        allies: char.allies.map(a => ({ ...a, status: CardStatus.Tapped })),
      },
    };
    withAlly = {
      ...withAlly,
      players: [
        { ...withAlly.players[RESOURCE_PLAYER], characters: updatedChars },
        withAlly.players[HAZARD_PLAYER],
      ] as unknown as typeof withAlly.players,
    };

    const combatState = setupCombat(withAlly, CAVE_DRAKE, Race.Drake);
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack').filter(a => {
      const ally = withAlly.players[RESOURCE_PLAYER].characters[charId].allies[0];
      return 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === ally.instanceId;
    });
    expect(cancelActions).toHaveLength(0);
  });

  // ─── Rule 6: cannot be duplicated in a given company ─────────────────────

  test('second copy in same company is not playable while first is attached', () => {
    // Give the player two copies of REGIMENT in hand.
    const base = buildSitePhaseState({
      characters: [ASTERNAK],
      site: WHITE_TOWERS,
      hand: [REGIMENT, REGIMENT],
    });
    // Attach one copy directly
    const withFirstAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, REGIMENT);

    // The second copy in hand should not be playable (company duplication limit)
    const secondAllyInst = withFirstAlly.players[RESOURCE_PLAYER].hand[0].instanceId;
    const actions = computeLegalActions(withFirstAlly, PLAYER_1);
    const viablePlay = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === secondAllyInst);
    expect(viablePlay).toHaveLength(0);
  });

  test('Regiment CAN be played when no copy is already in the company', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: WHITE_TOWERS,
      hand: [REGIMENT],
    });
    const regInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const playActions = actions
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === regInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });
});
