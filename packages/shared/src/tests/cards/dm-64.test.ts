/**
 * @module dm-64.test
 *
 * Card test: Helms of Iron (dm-64)
 * Type: hazard-event (permanent), non-unique
 *
 * Text:
 *   "Playable only if you have a Nazgûl permanent-event in play. Discard the
 *    Nazgûl when this card is brought into play. All Orc, Troll, and Man
 *    attacks with body have their body modified by +1; and all Orc, Troll,
 *    and Man attacks with no body have 4 body."
 *
 * Effects (4):
 *   - play-target: "nazgul-permanent-event" — one `play-hazard` action per
 *     Nazgûl permanent-event in the hazard player's own cardsInPlay
 *     (`isNazgulPermanentEvent`), riding on `targetNazgulInstanceId`. With
 *     none in play, no action is emitted — structurally implementing
 *     "Playable only if you have a Nazgûl permanent-event in play."
 *   - on-event self-enters-play → move (select target, in-play → discard):
 *     discards the chosen Nazgûl to its own owner's discard pile.
 *   - stat-modifier body +1, target all-attacks, when enemy.race in
 *     [orc, troll, man]: additive, applies only when the attack already has
 *     a printed body (resolveAttackBody skips additive modifiers on a null
 *     base).
 *   - stat-modifier body op:set value:4, target all-attacks, same race gate:
 *     applies only when the base body is null (resolveAttackBody's new
 *     null-base branch collects only `op: "set"` modifiers).
 *
 * New reusable DSL/engine primitives (see docs/card-effects-dsl.md and
 * docs/certification-engine-support.md):
 *   - `play-target: "nazgul-permanent-event"` (movement-hazard.ts).
 *   - `resolveAttackBody` giving a default body to bodyless attacks via an
 *     `op: "set"` stat-modifier (engine/effects/resolver.ts).
 *
 * Fixtures:
 *   - AKHORAHIL (tw-4): Nazgûl-keyword hazard-creature (dual-mode).
 *   - DWAR_OF_WAW (tw-31): Nazgûl-keyword hazard-creature (dual-mode).
 *   - NAZGUL_ARE_ABROAD (tw-96): permanent hazard-event WITHOUT the Nazgûl
 *     keyword — decoy to prove the play-target filters correctly.
 *   - MORIA_MINION (le-392): shadow-hold with an Orc automatic-attack
 *     printed with NO body (4 strikes, 7 prowess) — exercises the
 *     "no body → 4 body" branch in real combat.
 *   - TROLLS_FROM_MOUNTAINS (as-22): Troll hazard-creature, body 5, keyed to
 *     three Wildernesses — exercises the "+1 to a printed body" branch in
 *     real combat.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, buildSitePhaseState,
  makeMHState, playCreatureHazardAndResolve, setupAutoAttackStep,
  addCardInPlay, handCardId, companyIdAt,
  viableActions, dispatch, resolveChain,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, Race } from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import { resolveAttackBody } from '../../engine/effects/index.js';
import { buildInPlayNames } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const HELMS_OF_IRON = 'dm-64' as CardDefinitionId;
const AKHORAHIL = 'tw-4' as CardDefinitionId; // Nazgûl-keyword hazard-creature
const DWAR_OF_WAW = 'tw-31' as CardDefinitionId; // Nazgûl-keyword hazard-creature
const NAZGUL_ARE_ABROAD = 'tw-96' as CardDefinitionId; // permanent event, no Nazgûl keyword
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold, Orc auto-attack, no body
const TROLLS_FROM_MOUNTAINS = 'as-22' as CardDefinitionId; // troll, body 5, {w}{w}{w}

const TRIPLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

function makeTripleWildernessMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
}

/** Movement/hazard state with Helms of Iron in the hazard player's hand. */
function mhStateWithHelmsInHand(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HELMS_OF_IRON], siteDeck: [MORIA] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** A plain Organization-phase state with no companies of interest, used to test resolveAttackBody in isolation. */
function bareState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('Helms of Iron (dm-64)', () => {
  beforeEach(() => resetMint());

  // ─── play-target: nazgul-permanent-event ("Playable only if...") ─────────

  test('NOT playable with no Nazgûl permanent-event in play', () => {
    const state = mhStateWithHelmsInHand();
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when only a non-Nazgûl permanent-event is in play (decoy)', () => {
    const state = addCardInPlay(mhStateWithHelmsInHand(), HAZARD_PLAYER, NAZGUL_ARE_ABROAD);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('playable with one Nazgûl permanent-event in play — action carries its instance id', () => {
    let state = mhStateWithHelmsInHand();
    state = addCardInPlay(state, HAZARD_PLAYER, AKHORAHIL);
    const nazgulInstanceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetNazgulInstanceId?: CardInstanceId }).targetNazgulInstanceId)
      .toBe(nazgulInstanceId);
  });

  test('two Nazgûl permanent-events in play — one action per candidate', () => {
    let state = mhStateWithHelmsInHand();
    state = addCardInPlay(state, HAZARD_PLAYER, AKHORAHIL);
    state = addCardInPlay(state, HAZARD_PLAYER, DWAR_OF_WAW);
    const [first, second] = state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId);

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(2);
    const targets = actions.map(a => (a.action as { targetNazgulInstanceId?: CardInstanceId }).targetNazgulInstanceId);
    expect(targets.sort()).toEqual([first, second].sort());
  });

  test('a non-Nazgûl decoy alongside a real Nazgûl only offers the Nazgûl as target', () => {
    let state = mhStateWithHelmsInHand();
    state = addCardInPlay(state, HAZARD_PLAYER, NAZGUL_ARE_ABROAD);
    state = addCardInPlay(state, HAZARD_PLAYER, AKHORAHIL);
    const nazgulInstanceId = state.players[HAZARD_PLAYER].cardsInPlay.find(
      c => c.definitionId === AKHORAHIL,
    )!.instanceId;

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetNazgulInstanceId?: CardInstanceId }).targetNazgulInstanceId)
      .toBe(nazgulInstanceId);
  });

  // ─── self-enters-play: discards the chosen Nazgûl ────────────────────────

  test('resolving the card discards the chosen Nazgûl and keeps Helms of Iron in play', () => {
    let state = mhStateWithHelmsInHand();
    state = addCardInPlay(state, HAZARD_PLAYER, AKHORAHIL);
    const nazgulInstanceId = state.players[HAZARD_PLAYER].cardsInPlay[0].instanceId;

    const helmsId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: helmsId,
      targetCompanyId: companyId,
      targetNazgulInstanceId: nazgulInstanceId,
    }));

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === nazgulInstanceId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === nazgulInstanceId)).toBe(true);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === HELMS_OF_IRON)).toBe(true);
  });

  test('with two Nazgûl in play, only the chosen one is discarded', () => {
    let state = mhStateWithHelmsInHand();
    state = addCardInPlay(state, HAZARD_PLAYER, AKHORAHIL);
    state = addCardInPlay(state, HAZARD_PLAYER, DWAR_OF_WAW);
    const [chosen, other] = state.players[HAZARD_PLAYER].cardsInPlay.map(c => c.instanceId);

    const helmsId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: helmsId,
      targetCompanyId: companyId,
      targetNazgulInstanceId: chosen,
    }));

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === chosen)).toBe(false);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === other)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === chosen)).toBe(true);
  });

  // ─── body modifier: resolver-level coverage of both branches ─────────────

  test('resolveAttackBody: Orc/Troll/Man attack with a printed body gets +1', () => {
    const state = addCardInPlay(bareState(), HAZARD_PLAYER, HELMS_OF_IRON);
    const inPlayNames = buildInPlayNames(state);

    expect(resolveAttackBody(state, 8, inPlayNames, Race.Orc)).toBe(9);
    expect(resolveAttackBody(state, 8, inPlayNames, Race.Troll)).toBe(9);
    expect(resolveAttackBody(state, 8, inPlayNames, Race.Man)).toBe(9);
  });

  test('resolveAttackBody: a non-Orc/Troll/Man attack with a printed body is unmodified', () => {
    const state = addCardInPlay(bareState(), HAZARD_PLAYER, HELMS_OF_IRON);
    const inPlayNames = buildInPlayNames(state);

    expect(resolveAttackBody(state, 8, inPlayNames, Race.Wolf)).toBe(8);
  });

  test('resolveAttackBody: Orc/Troll/Man attack with no printed body becomes 4', () => {
    const state = addCardInPlay(bareState(), HAZARD_PLAYER, HELMS_OF_IRON);
    const inPlayNames = buildInPlayNames(state);

    expect(resolveAttackBody(state, null, inPlayNames, Race.Orc)).toBe(4);
    expect(resolveAttackBody(state, null, inPlayNames, Race.Troll)).toBe(4);
    expect(resolveAttackBody(state, null, inPlayNames, Race.Man)).toBe(4);
  });

  test('resolveAttackBody: a non-Orc/Troll/Man attack with no printed body stays bodyless', () => {
    const state = addCardInPlay(bareState(), HAZARD_PLAYER, HELMS_OF_IRON);
    const inPlayNames = buildInPlayNames(state);

    expect(resolveAttackBody(state, null, inPlayNames, Race.Wolf)).toBeNull();
  });

  test('resolveAttackBody: without the card in play, nothing changes (baseline)', () => {
    const state = bareState();
    const inPlayNames = buildInPlayNames(state);

    expect(resolveAttackBody(state, 8, inPlayNames, Race.Orc)).toBe(8);
    expect(resolveAttackBody(state, null, inPlayNames, Race.Orc)).toBeNull();
  });

  // ─── body modifier: real combat integration ──────────────────────────────

  test('Moria Orc auto-attack (no printed body) becomes body 4 in real combat', () => {
    const base = buildSitePhaseState({ site: MORIA_MINION, characters: [ARAGORN] });
    const withCard = addCardInPlay(base, HAZARD_PLAYER, HELMS_OF_IRON);
    const attackState = setupAutoAttackStep(withCard);

    const result = reduce(attackState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.creatureBody).toBe(4);
  });

  test('Moria Orc auto-attack has no body check without the card', () => {
    const base = buildSitePhaseState({ site: MORIA_MINION, characters: [ARAGORN] });
    const attackState = setupAutoAttackStep(base);

    const result = reduce(attackState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat!.creatureBody).toBeNull();
  });

  test('a Troll creature attack (printed body 5) gets +1 body in real combat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [TROLLS_FROM_MOUNTAINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const withCard = addCardInPlay(state, HAZARD_PLAYER, HELMS_OF_IRON);
    const ready: GameState = { ...withCard, phaseState: makeTripleWildernessMHState() };
    const trollId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, trollId, companyId, TRIPLE_WILDERNESS_KEYING);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('troll');
    expect(after.combat!.creatureBody).toBe(6);
  });

  test('the same Troll creature attack has unmodified body 5 without the card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [TROLLS_FROM_MOUNTAINS],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeTripleWildernessMHState() };
    const trollId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(ready, PLAYER_2, trollId, companyId, TRIPLE_WILDERNESS_KEYING);
    expect(after.combat!.creatureBody).toBe(5);
  });
});
