/**
 * @module as-14.test
 *
 * Card test: Lord of the Carrock (as-14)
 * Type: hazard-creature (dual creature/permanent-event). Unique. Man.
 * Manifestation of Beorn (tw-126, via `manifestId`).
 * Base creature stats: one strike, prowess 16, body 9, kill MP 2*.
 *
 * Card text:
 *   "Unique. Man. Manifestation of Beorn. One strike. Detainment against hero
 *    companies. As a creature, may be played keyed to Anduin Vales, Woodland
 *    Realm, Western Mirkwood, Wold & Foothills, High Pass, or Redhorn Gate; or
 *    at sites in these regions. As a permanent-event, all influence attempts
 *    against Man factions are modified by -2. Discard when any play deck is
 *    exhausted."
 *
 * Rule coverage:
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Manifestation of Beorn — g.man.1 both directions              | IMPLEMENTED |
 * | 2 | One strike / prowess 16 creature combat                       | IMPLEMENTED |
 * | 3 | Detainment against hero companies (not minion)                | IMPLEMENTED |
 * | 4 | Keyed to the six named regions / at sites in these regions     | IMPLEMENTED |
 * | 5 | Permanent-event mode: enters play, stays (no tap conversion)   | IMPLEMENTED |
 * | 6 | -2 to influence attempts to PLAY a Man faction                 | IMPLEMENTED |
 * | 7 | -2 to influence attempts against an opponent's Man faction     | IMPLEMENTED |
 * | 8 | Non-Man factions are unaffected                                | IMPLEMENTED |
 * | 9 | Discard when any play deck is exhausted                        | IMPLEMENTED |
 * |10 | Unique — a second copy is unplayable while one is in play      | IMPLEMENTED |
 *
 * Effects: play-flag playable-as-event (½-creature deck weight, tw-2
 * precedent), creature-alt-event (permanent-event, persistent — as-13 shape),
 * combat-detainment (hero / covert fallen-wizard defenders), check-modifier
 * influence -2 `target: "all-in-play"` gated on a Man faction in either the
 * `faction-influence-check` or the `opponent-influence-check` context (the
 * glossary defines an influence attempt as "trying to influence a faction or an
 * opponent's card", so both arms are in scope), and an `on-event
 * play-deck-exhausted` self-discard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeSitePhase,
  playCreatureHazardAndResolve,
  addCardInPlay,
  handCardId, companyIdAt,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  viableActions, nonViableOfType, dispatch, dispatchResult, resolveChain, reduce,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  computeLegalActions, Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  MovementHazardPhaseState, EndOfTurnPhaseState, FactionInfluenceRollAction,
} from '../../index.js';

const LORD = 'as-14' as CardDefinitionId;
const BEORN = 'tw-126' as CardDefinitionId;

// Influence fixtures. Bergil is a Dúnadan with 0 direct influence and no
// effects, so neither faction's race-gated "Standard Modifications" fire and
// the printed influence number is the whole need.
const BERGIL = 'tw-129' as CardDefinitionId;
const WOODMEN = 'tw-368' as CardDefinitionId;          // Man faction, influence # 8
const WOODMEN_TOWN = 'tw-438' as CardDefinitionId;     // its playable site (Western Mirkwood)
const IRON_HILL_DWARVES = 'tw-261' as CardDefinitionId; // Dwarf faction, influence # 9
const IRON_HILL_HOLD = 'tw-403' as CardDefinitionId;   // its playable site

// Minion fixtures, for the "no detainment against minion companies" arm.
const MIONID = 'as-3' as CardDefinitionId;
const THE_MOUTH = 'le-24' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

const STRANGE_RATIONS = 'le-345' as CardDefinitionId;  // filler discard-pile card

/** The six regions the creature mode may be keyed to. */
const KEYED_REGIONS = [
  'Anduin Vales', 'Woodland Realm', 'Western Mirkwood',
  'Wold & Foothills', 'High Pass', 'Redhorn Gate',
];

/** An M/H state whose resolved site path crosses the named region. */
const pathThrough = (regionName: string): MovementHazardPhaseState => makeMHState({
  resolvedSitePath: [RegionType.Wilderness],
  resolvedSitePathNames: [regionName],
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Goblin-gate',
});

/**
 * M/H fixture: the Lord in P2's hand as the hazard player, P1's single company
 * moving with the given phase state and alignment/character.
 */
const readyState = (
  alignment: Alignment,
  characterId: CardDefinitionId,
  phaseState = pathThrough('Anduin Vales'),
): GameState => {
  const site = alignment === Alignment.Ringwraith ? DOL_GULDUR : LORIEN;
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site, characters: [characterId] }],
        hand: [],
        siteDeck: [alignment === Alignment.Ringwraith ? BARAD_DUR : MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [LORD],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...state, phaseState };
};

/**
 * Site-phase fixture: P1 (Bergil) sits at the faction's playable site with the
 * faction in hand, ready to make a first-play influence attempt. `lordOwner`
 * puts the Lord into that player's `cardsInPlay` as a permanent-event.
 */
const factionPlayState = (
  faction: CardDefinitionId,
  site: CardDefinitionId,
  lordOwner?: 0 | 1,
): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [BERGIL] }],
        hand: [faction], siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [], siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  const withPhase = { ...base, phaseState: makeSitePhase() };
  return lordOwner === undefined ? withPhase : addCardInPlay(withPhase, lordOwner, LORD);
};

/**
 * Site-phase fixture for an opponent-influence attempt: both companies stand at
 * the faction's playable site, P2 already controls the faction, and P1's Bergil
 * is untapped and free to reach for it (turn 3 clears the first-turn guard).
 */
const reInfluenceState = (
  faction: CardDefinitionId,
  site: CardDefinitionId,
  withLord: boolean,
): { state: GameState; factionInstanceId: CardInstanceId } => {
  const factionInPlay: CardInPlay = {
    instanceId: 'faction-1' as CardInstanceId,
    definitionId: faction,
    status: CardStatus.Untapped,
  };
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [BERGIL] }],
        hand: [], siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site, characters: [LEGOLAS] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        cardsInPlay: [factionInPlay],
      },
    ],
  });
  const withPhase = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };
  return {
    state: withLord ? addCardInPlay(withPhase, 1, LORD) : withPhase,
    factionInstanceId: factionInPlay.instanceId,
  };
};

/** End-of-turn reset-hand state with the Lord in P1's `cardsInPlay`. */
const exhaustState = (exhaustingPlayer: 0 | 1): GameState => {
  const emptyDeckSide = {
    playDeck: [] as CardDefinitionId[],
    discardPile: [STRANGE_RATIONS],
  };
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.EndOfTurn,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [], siteDeck: [MINAS_TIRITH],
        ...(exhaustingPlayer === 0 ? emptyDeckSide : {}),
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
        hand: [], siteDeck: [BARAD_DUR],
        ...(exhaustingPlayer === 1 ? emptyDeckSide : {}),
      },
    ],
  });
  const resetHandState = {
    ...base,
    phaseState: {
      ...(base.phaseState as EndOfTurnPhaseState),
      step: 'reset-hand' as const,
      discardDone: [true, true] as [boolean, boolean],
      resetHandDone: (exhaustingPlayer === 0 ? [false, true] : [true, false]) as [boolean, boolean],
    } as EndOfTurnPhaseState,
  };
  return addCardInPlay(resetHandState, 0, LORD);
};

describe('Lord of the Carrock (as-14)', () => {
  beforeEach(() => resetMint());

  // ─── #4: creature keying — six named regions ──────────────────────────────

  for (const region of KEYED_REGIONS) {
    test(`keyable by region name to ${region}`, () => {
      const ready = readyState(Alignment.Wizard, ARAGORN, pathThrough(region));
      const plays = viableActions(ready, PLAYER_2, 'play-hazard');
      expect(plays.some(p => {
        const a = p.action as { keyedBy?: { method: string; value: string } };
        return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === region;
      })).toBe(true);
    });
  }

  test('not keyable as a creature on a path that avoids all six regions', () => {
    // A generic wilderness is NOT enough — the keying is by region name only.
    const ready = readyState(Alignment.Wizard, ARAGORN, pathThrough('Rhudaur'));
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => (p.action as { keyedBy?: unknown }).keyedBy !== undefined)).toBe(false);
  });

  // ─── #2/#3: one strike at prowess 16; detainment vs hero, not vs minion ───

  test('attack on a hero company: 1 strike at prowess 16, detainment', () => {
    const ready = readyState(Alignment.Wizard, ARAGORN);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, {
      method: 'region-name', value: 'Anduin Vales',
    });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(16);
    expect(after.combat!.detainment).toBe(true);
  });

  test('attack on a minion company: normal attack (no detainment)', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID);
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, {
      method: 'region-name', value: 'Anduin Vales',
    });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(16);
    expect(after.combat!.detainment).toBe(false);
  });

  // ─── #5: permanent-event mode — enters play and simply stays ──────────────

  test('played as a permanent-event it enters play and has NO tap conversion', () => {
    const ready = readyState(Alignment.Ringwraith, MIONID, pathThrough('Rhudaur'));
    const lordId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    // The permanent-event mode is offered even though the creature cannot key here.
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: lordId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    const inPlay = afterPlay.players[1].cardsInPlay.find(c => c.instanceId === lordId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);

    // Persistent (as-13 shape): no Nazgûl-style tap-to-short-event offer…
    expect(viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event')).toHaveLength(0);

    // …and a forged tap action is rejected, leaving the Lord in play.
    const forged = reduce(afterPlay, {
      type: 'tap-alt-permanent-event', player: PLAYER_2, cardInstanceId: lordId,
    });
    expect(forged.error).toBeDefined();
    expect(forged.state.players[1].cardsInPlay.some(c => c.instanceId === lordId)).toBe(true);
  });

  // ─── #6: -2 to influence attempts to PLAY a Man faction ───────────────────

  test('baseline: playing Woodmen (Man, influence # 8) needs 8 with no Lord in play', () => {
    const state = factionPlayState(WOODMEN, WOODMEN_TOWN);
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('Lord in the OPPONENT play area raises the Woodmen need from 8 to 10', () => {
    const state = factionPlayState(WOODMEN, WOODMEN_TOWN, 1);
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('"all influence attempts": the -2 also hits the Lord owner\'s own Man faction play', () => {
    const state = factionPlayState(WOODMEN, WOODMEN_TOWN, 0);
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  // ─── #8: non-Man factions are unaffected ──────────────────────────────────

  test('a Dwarf faction (Iron Hill Dwarves, influence # 9) is unaffected by the Lord', () => {
    const without = factionPlayState(IRON_HILL_DWARVES, IRON_HILL_HOLD);
    const withoutInst = without.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(without, withoutInst)!.need).toBe(9);

    const withLord = factionPlayState(IRON_HILL_DWARVES, IRON_HILL_HOLD, 1);
    const withInst = withLord.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(withLord, withInst)!.need).toBe(9);
  });

  // ─── #6 (resolution): the -2 is applied to the actual roll ────────────────

  test('the -2 is applied at roll resolution: a raw 8 that would pass fails at need 10', () => {
    const state = factionPlayState(WOODMEN, WOODMEN_TOWN, 1);
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    // The paused faction-influence-roll shows the penalised need too.
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(10);

    cur = { ...cur, cheatRollTotal: 8 };
    cur = dispatch(cur, rollActions[0].action);

    // 8 + (-2) = 6 < 8 → the attempt fails and the faction never enters play.
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(WOODMEN);
  });

  test('control: the same raw 8 brings Woodmen into play with no Lord around', () => {
    const state = factionPlayState(WOODMEN, WOODMEN_TOWN);
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(8);

    cur = { ...cur, cheatRollTotal: 8 };
    cur = dispatch(cur, rollActions[0].action);

    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(WOODMEN);
  });

  // ─── #7: -2 against an opponent's Man faction already in play ─────────────

  test('an influence attempt against an opponent\'s Man faction carries the -2', () => {
    const { state, factionInstanceId } = reInfluenceState(WOODMEN, WOODMEN_TOWN, true);
    const attempt = firstOpponentInfluenceAttempt(state, factionInstanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier).toBe(-2);
  });

  test('control: no Lord in play → no modifier on the same attempt', () => {
    const { state, factionInstanceId } = reInfluenceState(WOODMEN, WOODMEN_TOWN, false);
    const attempt = firstOpponentInfluenceAttempt(state, factionInstanceId, PLAYER_1);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
  });

  test('an attempt against a non-Man faction is unmodified even with the Lord in play', () => {
    const { state, factionInstanceId } = reInfluenceState(IRON_HILL_DWARVES, IRON_HILL_HOLD, true);
    const attempt = firstOpponentInfluenceAttempt(state, factionInstanceId, PLAYER_1);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no pending defend');
    expect(pending.kind.attempt.boostModifier ?? 0).toBe(0);
  });

  // ─── #9: discard when ANY play deck is exhausted ──────────────────────────

  test('discards when the opponent\'s (minion) play deck exhausts', () => {
    const state = exhaustState(1);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_2 });
    // Still in play until the exhaust completes.
    expect(afterExhaust.players[0].cardsInPlay.some(c => c.definitionId === LORD)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.players[0].cardsInPlay.some(c => c.definitionId === LORD)).toBe(false);
    expect(afterPass.players[0].discardPile.some(c => c.definitionId === LORD)).toBe(true);
  });

  test('discards when the owner\'s own play deck exhausts ("any play deck")', () => {
    const state = exhaustState(0);
    const afterExhaust = dispatch(state, { type: 'deck-exhaust', player: PLAYER_1 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[0].cardsInPlay.some(c => c.definitionId === LORD)).toBe(false);
    expect(afterPass.players[0].discardPile.some(c => c.definitionId === LORD)).toBe(true);
  });

  // ─── #1: manifestation of Beorn (g.man.1, both directions) ────────────────

  test('not playable in either mode while the character Beorn is in play', () => {
    const withBeorn = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [MIONID] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [BEORN] }],
          hand: [LORD],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const ready = { ...withBeorn, phaseState: pathThrough('Anduin Vales') };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(ready, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  test('Beorn cannot be played while the Lord is in play as a permanent-event', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [BEORN], siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [THE_MOUTH] }],
          hand: [], siteDeck: [BARAD_DUR],
        },
      ],
    });

    // Control: with no Lord in play, Beorn is playable at Lórien (a haven).
    expect(viableActions(base, PLAYER_1, 'play-character').length).toBeGreaterThanOrEqual(1);

    // With the Lord in play on P2's side, g.man.1 blocks the character play.
    const withLord = addCardInPlay(base, 1, LORD);
    expect(viableActions(withLord, PLAYER_1, 'play-character')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withLord, PLAYER_1), 'play-character');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('manifestation');
  });

  // ─── #10: unique — no second play while one copy is in play ───────────────

  test('unplayable in either mode while a copy is already in play as a permanent-event', () => {
    const base = readyState(Alignment.Ringwraith, MIONID, pathThrough('High Pass'));
    const withLordInPlay = addCardInPlay(base, 1, LORD);

    expect(viableActions(withLordInPlay, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const blocked = nonViableOfType(computeLegalActions(withLordInPlay, PLAYER_2), 'play-hazard');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0].reason).toContain('unique');
  });
});
