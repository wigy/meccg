/**
 * @module as-40.test
 *
 * Card test: Trouble on All Borders (as-40)
 * Type: hazard-event (permanent), non-unique
 *
 * "Playable on a unique faction in play. Any company moving through the
 *  region containing a site where the faction is playable, or through any
 *  region adjacent to this one, faces an attack. The attack is the same type
 *  as the faction and has 4 strikes with 8 prowess. The attack is detainment
 *  if the company and faction are both minion or both hero. Cannot be
 *  duplicated on a given faction. Discard when any play deck is exhausted."
 *
 * Effects (4):
 *   - play-target (faction, filter: unique only) — targets the resource
 *     player's own in-play faction (hazard events target the opponent's
 *     entities, CoE 2.IV.vii.3).
 *   - ahunt-attack: regionsFromAttachedFaction + raceFromAttachedFaction +
 *     detainmentMatchesAttachedFactionAlignment, 4 strikes / 8 prowess.
 *   - duplication-limit (scope: faction, max 1).
 *   - on-event play-deck-exhausted — self-discard.
 *
 * Every rule is exercised against the engine below (no tautological assertions).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GANDALF, LEGOLAS, EDHELLOND, LORIEN, MINAS_TIRITH, RANGERS_OF_THE_NORTH,
  viableActions, dispatch, resolveChain, findHandCardId,
} from '../test-helpers.js';
import { Phase, CardStatus, Alignment, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, EndOfTurnPhaseState, CombatState,
  PlayHazardAction,
} from '../../index.js';

const TROUBLE_ON_ALL_BORDERS = 'as-40' as CardDefinitionId;

// Minion factions (Long Grievous Siege ba-40 / Tribute Garnered as-104 fixtures).
const MEN_OF_DORWINION = 'le-271' as CardDefinitionId; // unique, minion, man, @ Shrel-Kain (region Dorwinion)
const EASTERLINGS = 'le-264' as CardDefinitionId;      // unique, minion, man, @ Easterling Camp (Horse Plains)
const SNAGA_HAI = 'le-286' as CardDefinitionId;        // non-unique — excluded target

// Minion sites/characters.
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const CIRYAHER = 'le-6' as CardDefinitionId; // minion dúnadan
const LAGDUF = 'le-18' as CardDefinitionId; // minion orc

/** A CardInPlay entry with an explicit instance id (for stable prev/next diffs). */
const cip = (definitionId: CardDefinitionId, instanceId: string, extra: Partial<CardInPlay> = {}): CardInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped, ...extra });

/** M/H play-hazard state: PLAYER_2 (hazard, minion) holds the card; PLAYER_1 (resource) has the given own factions in play. */
function buildPlayState(resourceCardsInPlay: CardInPlay[] = []): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
        hand: [], siteDeck: [DOL_GULDUR],
        cardsInPlay: resourceCardsInPlay,
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
        hand: [TROUBLE_ON_ALL_BORDERS], siteDeck: [MINAS_MORGUL],
      },
    ],
  });
  return { ...base, phaseState: makeMHState() };
}

/**
 * M/H order-effects state: PLAYER_1 (mover) holds the target faction in
 * cardsInPlay (the natural location for the resource player's own faction);
 * PLAYER_2 (hazard) holds Trouble on All Borders, already attached to it via
 * `attachedTo`. The mover's declared site path is `pathNames`/`pathTypes`.
 */
function buildOrderEffectsState(opts: {
  factionDefId: CardDefinitionId;
  pathNames: string[];
  pathTypes: RegionType[];
  moverAlignment?: Alignment;
}): GameState {
  const factionInstanceId = 'faction-901' as CardInstanceId;
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1, alignment: opts.moverAlignment ?? Alignment.Wizard,
        companies: [{ site: EDHELLOND, characters: [ARAGORN, GANDALF] }],
        hand: [], siteDeck: [],
        cardsInPlay: [cip(opts.factionDefId, 'faction-901')],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        cardsInPlay: [cip(TROUBLE_ON_ALL_BORDERS, 'toab-901', { attachedTo: factionInstanceId })],
      },
    ],
  });
  return {
    ...base,
    phaseState: makeMHState({
      step: 'order-effects' as const,
      resolvedSitePathNames: opts.pathNames,
      resolvedSitePath: opts.pathTypes,
    }),
  };
}

describe('Trouble on All Borders (as-40)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: play-target — unique faction only, opponent's own ───────────

  test('offers a target for each of the resource player\'s own UNIQUE in-play factions', () => {
    const state = buildPlayState([cip(MEN_OF_DORWINION, 'f1'), cip(SNAGA_HAI, 'f2')]);
    const cardId = findHandCardId(state, HAZARD_PLAYER, TROUBLE_ON_ALL_BORDERS);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
      const act = a.action as PlayHazardAction;
      return act.cardInstanceId === cardId && a.viable;
    });
    expect(plays.map(a => (a.action as PlayHazardAction).targetFactionInstanceId)).toEqual(['f1']);
  });

  test('NOT playable when the resource player has no faction in play', () => {
    const state = buildPlayState([]);
    const cardId = findHandCardId(state, HAZARD_PLAYER, TROUBLE_ON_ALL_BORDERS);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
    );
    expect(plays).toHaveLength(0);
  });

  // ─── Rule 4: cannot be duplicated on a given faction ──────────────────────

  test('a second copy cannot target a faction already carrying one, but another unique faction is fine', () => {
    const state = buildPlayState([
      cip(MEN_OF_DORWINION, 'f1'),
      cip(EASTERLINGS, 'f2'),
    ]);
    const already: CardInPlay = cip(TROUBLE_ON_ALL_BORDERS, 'toab-existing', { attachedTo: 'f1' as CardInstanceId });
    const withExisting: GameState = {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], cardsInPlay: [already] },
      ] as typeof state.players,
    };
    const cardId = findHandCardId(withExisting, HAZARD_PLAYER, TROUBLE_ON_ALL_BORDERS);
    const plays = viableActions(withExisting, PLAYER_2, 'play-hazard').filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
    );
    expect(plays.map(a => (a.action as PlayHazardAction).targetFactionInstanceId)).toEqual(['f2']);
  });

  // ─── Resolution binds the card to the chosen faction via attachedTo ──────

  test('resolution binds the card to the chosen faction via attachedTo', () => {
    const state = buildPlayState([cip(MEN_OF_DORWINION, 'f1')]);
    const cardId = findHandCardId(state, HAZARD_PLAYER, TROUBLE_ON_ALL_BORDERS);
    const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
      const act = a.action as PlayHazardAction;
      return act.cardInstanceId === cardId && act.targetFactionInstanceId === 'f1' && a.viable;
    });
    expect(play).toBeDefined();
    const after = resolveChain(dispatch(state, play!.action));
    const host = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === TROUBLE_ON_ALL_BORDERS);
    expect(host).toBeDefined();
    expect(host!.attachedTo).toBe('f1');
  });

  // ─── Rule 2: region attack — own region, adjacent region, elsewhere ──────

  test('a company moving through the faction\'s own playable-site region faces the attack (4 strikes / 8 prowess, faction\'s race)', () => {
    // Men of Dorwinion are playable at Shrel-Kain, region Dorwinion.
    const state = buildOrderEffectsState({
      factionDefId: MEN_OF_DORWINION,
      pathNames: ['Dorwinion'],
      pathTypes: [RegionType.Border],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(8);
    expect(combat.creatureRace).toBe('man');
  });

  test('a company moving through a region ADJACENT to the faction\'s playable-site region also faces the attack', () => {
    // Dorwinion is adjacent to Northern Rhovanion (and Southern Rhovanion).
    const state = buildOrderEffectsState({
      factionDefId: MEN_OF_DORWINION,
      pathNames: ['Northern Rhovanion'],
      pathTypes: [RegionType.Wilderness],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(8);
  });

  test('a company moving through an unrelated region faces no attack', () => {
    const state = buildOrderEffectsState({
      factionDefId: MEN_OF_DORWINION,
      pathNames: ['Southern Mirkwood'],
      pathTypes: [RegionType.Shadow],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  // ─── Rule 3: detainment iff company and faction share hero/minion side ───

  test('detainment: a MINION company vs a minion faction', () => {
    const state = buildOrderEffectsState({
      factionDefId: MEN_OF_DORWINION,
      pathNames: ['Dorwinion'],
      pathTypes: [RegionType.Border],
      moverAlignment: Alignment.Ringwraith,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect((next.combat as CombatState).detainment).toBe(true);
  });

  test('normal attack: a HERO company vs a minion faction', () => {
    const state = buildOrderEffectsState({
      factionDefId: MEN_OF_DORWINION,
      pathNames: ['Dorwinion'],
      pathTypes: [RegionType.Border],
      moverAlignment: Alignment.Wizard,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect((next.combat as CombatState).detainment).toBe(false);
  });

  test('detainment: a HERO company vs a hero faction', () => {
    // Rangers of the North are playable at Bree, region Arthedain.
    const state = buildOrderEffectsState({
      factionDefId: RANGERS_OF_THE_NORTH,
      pathNames: ['Arthedain'],
      pathTypes: [RegionType.Wilderness],
      moverAlignment: Alignment.Wizard,
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    const combat = next.combat as CombatState;
    expect(combat.creatureRace).toBe('dunadan');
    expect(combat.detainment).toBe(true);
  });

  // ─── Rule 5: discard when any play deck is exhausted ──────────────────────

  test('discards when active player deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [CIRYAHER] }],
          hand: [], siteDeck: [DOL_GULDUR],
          playDeck: [],
          discardPile: [MEN_OF_DORWINION],
          cardsInPlay: [
            cip(MEN_OF_DORWINION, 'f1'),
            cip(TROUBLE_ON_ALL_BORDERS, 'toab-1', { attachedTo: 'f1' as CardInstanceId }),
          ],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }],
          hand: [], siteDeck: [MINAS_MORGUL],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };

    const afterExhaust = dispatch(resetHandState, { type: 'deck-exhaust', player: PLAYER_1 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === TROUBLE_ON_ALL_BORDERS,
    )).toBe(false);
    // CRF 22 "Exhausted": discarded before the reshuffle, so it lands in the
    // new play deck rather than staying in discardPile (as-104 precedent).
    expect(afterPass.players[RESOURCE_PLAYER].playDeck.some(
      c => c.definitionId === TROUBLE_ON_ALL_BORDERS,
    )).toBe(true);
  });
});
