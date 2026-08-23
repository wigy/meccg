/**
 * @module tw-33.test
 *
 * Card test: Fell Beast (tw-33)
 * Type: hazard-event (short), non-unique, Neutral
 *
 * Card text:
 *   "The number of strikes of one Nazgûl hazard creature is increased by one
 *    and its prowess is decreased by 2. Attacker chooses defending
 *    characters. Additionally, target Nazgûl may be played keyed to a
 *    Shadow-land [{s}] or Shadow-hold [{S}]. Cannot be duplicated on a given
 *    Nazgûl."
 *
 * CRF ruling: "Fell Beast can be played and resolved before any Nazgûl is
 * played with it. A Nazgûl must be played as the first declared action in the
 * chain of effects following the resolution of Fell Beast, or else this card
 * is returned to its player's hand. This card can be played on an existing
 * Nazgûl attack, but the extra playability this card provides would not
 * apply."
 *
 * Effects:
 *   Mode A (played standalone, before any Nazgûl) — `on-event self-enters-play`
 *     → `add-constraint nazgul-boost-pending` (scope company-mh-phase, race
 *     ringwraith, strikesModifier +1, prowessModifier -2,
 *     grantAttackerChoosesDefenders, keyingRegionTypes ["shadow"],
 *     keyingSiteTypes ["shadow-hold"]). Consumed by the next ringwraith
 *     hazard-creature played against the same company: its strikes/prowess/
 *     attacker-chooses-defenders are boosted and it may additionally be keyed
 *     via the granted region/site types, on top of its own printed `keyedTo`.
 *     If the company's M/H phase ends unconsumed, the source card returns
 *     from discard to hand instead of just dropping the constraint.
 *   Mode B (played on an existing Nazgûl attack) — `modify-attack fromHand`,
 *     player "attacker", strikesModifier +1, prowessModifier -2,
 *     grantAttackerChoosesDefenders, gated on `enemy.race === "ringwraith"`.
 *     No keying grant (moot — the creature is already in play).
 *   `duplication-limit` scope "attack" — cannot stack two copies on the same
 *     attack (Mode B). "Cannot be duplicated on a given Nazgûl" for Mode A is
 *     enforced by a permanent (`until-cleared`) `nazgul-boost-used` marker,
 *     keyed by the boosted creature's definition id, checked before the
 *     pending boost is offered or consumed again.
 *
 * Playable: YES
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, CAVE_DRAKE,
  makeMHState, makeCancelWindowCombat,
  playHazardAndResolve,
  findHandCardId, companyIdAt,
  viableActions, dispatch, resolveChain,
} from '../test-helpers.js';
import { Race, RegionType, SiteType } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';
import type { CardDefinitionId, GameState, PlayHazardAction, ModifyAttackAction } from '../../index.js';

const FELL_BEAST = 'tw-33' as CardDefinitionId;
// Dwar of Waw (tw-31): Nazgûl, race ringwraith, strikes 1 / prowess 15 / body
// 10. Its own printed keyedTo is region "dark" / site "dark-hold" / named
// regions Harondor, Imlad Morgul, Gorgoroth, Ithilien — none of which match a
// Shadow-hold, so a play keyed to Moria can only come from Fell Beast's grant.
const DWAR_OF_WAW = 'tw-31' as CardDefinitionId;
// Cave-drake (dragon race, keyed to Wilderness x2 / Ruins & Lairs — no
// Shadow-hold) is used as a non-Nazgûl control to prove the grant/boost never
// leaks to another race.

/** M/H state: PLAYER_1 (resource) at Moria (Shadow-hold); PLAYER_2 holds `hand`. */
function buildState(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      destinationSiteName: 'Moria',
      destinationSiteType: SiteType.ShadowHold,
    }),
  };
}

describe('Fell Beast (tw-33)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: standalone play installs the pending boost ────────────────────

  test('Mode A: playable standalone (no target) during the M/H phase', () => {
    const state = buildState([FELL_BEAST]);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === fbId);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('Mode A: resolving it installs a company-scoped nazgul-boost-pending constraint and discards the card', () => {
    const state = buildState([FELL_BEAST]);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playHazardAndResolve(state, PLAYER_2, fbId, companyId);

    const constraint = after.activeConstraints.find(c => c.kind.type === 'nazgul-boost-pending');
    expect(constraint).toBeDefined();
    if (constraint?.kind.type !== 'nazgul-boost-pending') throw new Error('unreachable');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
    expect(constraint.kind.race).toBe(Race.Ringwraith);
    expect(constraint.kind.strikesModifier).toBe(1);
    expect(constraint.kind.prowessModifier).toBe(-2);
    expect(constraint.kind.grantAttackerChoosesDefenders).toBe(true);
    expect(constraint.kind.keyingRegionTypes).toEqual([RegionType.Shadow]);
    expect(constraint.kind.keyingSiteTypes).toEqual([SiteType.ShadowHold]);

    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === FELL_BEAST)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_BEAST)).toBe(true);
  });

  // ─── Mode A: the grant lets an otherwise-unkeyable Nazgûl be played ─────────

  test('Mode A: grants extra keying (site-type shadow-hold) to a Nazgûl not otherwise keyable here', () => {
    const state = buildState([FELL_BEAST, DWAR_OF_WAW]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const afterFB = playHazardAndResolve(state, PLAYER_2, fbId, companyId);

    const dwarId = findHandCardId(afterFB, HAZARD_PLAYER, DWAR_OF_WAW);
    const dwarPlays = viableActions(afterFB, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === dwarId);
    const keyedPlay = dwarPlays.find(a => a.keyedBy?.method === 'site-type' && a.keyedBy.value === SiteType.ShadowHold);
    expect(keyedPlay).toBeDefined();
    // No other keying route exists at a Shadow-hold — the grant is the only reason it's offered.
    expect(dwarPlays.every(a => a.keyedBy?.method === 'site-type' || a.keyedBy === undefined)).toBe(true);
  });

  test('Mode A: control — the grant never applies to a non-Nazgûl creature', () => {
    const state = buildState([FELL_BEAST, CAVE_DRAKE]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const afterFB = playHazardAndResolve(state, PLAYER_2, fbId, companyId);

    const drakeId = findHandCardId(afterFB, HAZARD_PLAYER, CAVE_DRAKE);
    const drakePlays = viableActions(afterFB, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === drakeId);
    expect(drakePlays.some(a => a.keyedBy?.method === 'site-type' && a.keyedBy.value === SiteType.ShadowHold)).toBe(false);
  });

  test('Mode A: playing the boosted Nazgûl applies +1 strike / -2 prowess / attacker-chooses-defenders and consumes the constraint', () => {
    const state = buildState([FELL_BEAST, DWAR_OF_WAW]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const afterFB = playHazardAndResolve(state, PLAYER_2, fbId, companyId);

    const dwarId = findHandCardId(afterFB, HAZARD_PLAYER, DWAR_OF_WAW);
    const keyedPlay = viableActions(afterFB, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .find(a => a.cardInstanceId === dwarId && a.keyedBy?.method === 'site-type')!;

    const after = resolveChain(dispatch(afterFB, keyedPlay));

    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe(Race.Ringwraith);
    expect(after.combat!.strikesTotal).toBe(2);   // 1 + 1
    expect(after.combat!.strikeProwess).toBe(13); // 15 - 2
    expect(after.combat!.attackerChoosesDefenders).toBe(true);

    expect(after.activeConstraints.some(c => c.kind.type === 'nazgul-boost-pending')).toBe(false);
    const used = after.activeConstraints.find(c => c.kind.type === 'nazgul-boost-used');
    expect(used).toBeDefined();
    if (used?.kind.type !== 'nazgul-boost-used') throw new Error('unreachable');
    expect(used.kind.creatureDefinitionId).toBe(DWAR_OF_WAW);
  });

  test('Mode A: control — an unboosted Nazgûl play (no Fell Beast) gets neither bonus nor attacker-chooses-defenders', () => {
    // Without Fell Beast's grant, Dwar of Waw simply cannot be keyed to a
    // Shadow-hold at all — confirms the bonus in the previous test came from
    // the grant, not from Dwar's own printed keying.
    const state = buildState([DWAR_OF_WAW]);
    const dwarId = findHandCardId(state, HAZARD_PLAYER, DWAR_OF_WAW);
    const keyedPlays = viableActions(state, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === dwarId && a.keyedBy?.method === 'site-type' && a.keyedBy.value === SiteType.ShadowHold);
    expect(keyedPlays).toHaveLength(0);
  });

  // ─── Mode A: "cannot be duplicated on a given Nazgûl" ───────────────────────

  test('Mode A: once used on a given Nazgûl, a later Fell Beast cannot grant/boost it again', () => {
    const state = buildState([FELL_BEAST, DWAR_OF_WAW]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const marked = addConstraint(state, {
      source: 'used-src' as import('../../index.js').CardInstanceId,
      sourceDefinitionId: FELL_BEAST,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_2 },
      kind: { type: 'nazgul-boost-used', creatureDefinitionId: DWAR_OF_WAW },
    });

    const fbId = findHandCardId(marked, HAZARD_PLAYER, FELL_BEAST);
    const afterFB = playHazardAndResolve(marked, PLAYER_2, fbId, companyId);

    const dwarId = findHandCardId(afterFB, HAZARD_PLAYER, DWAR_OF_WAW);
    const dwarKeyedPlays = viableActions(afterFB, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === dwarId && a.keyedBy?.method === 'site-type' && a.keyedBy.value === SiteType.ShadowHold);
    expect(dwarKeyedPlays).toHaveLength(0);
  });

  // ─── Mode A: unconsumed boost returns the card to hand ──────────────────────

  test('Mode A: if no Nazgûl is played this company\'s M/H phase, Fell Beast returns to hand', () => {
    const state = buildState([FELL_BEAST]); // no Nazgûl available to consume it
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const fbId = findHandCardId(state, HAZARD_PLAYER, FELL_BEAST);
    const afterFB = playHazardAndResolve(state, PLAYER_2, fbId, companyId);
    expect(afterFB.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_BEAST)).toBe(true);

    let finished = dispatch(afterFB, { type: 'pass', player: PLAYER_1 });
    finished = dispatch(finished, { type: 'pass', player: PLAYER_2 });

    expect(finished.players[HAZARD_PLAYER].hand.some(c => c.definitionId === FELL_BEAST)).toBe(true);
    expect(finished.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_BEAST)).toBe(false);
    expect(finished.activeConstraints.some(c => c.kind.type === 'nazgul-boost-pending')).toBe(false);
  });

  // ─── Mode B: played on an existing Nazgûl attack ────────────────────────────

  function ringwraithAttack(hazardHand: CardDefinitionId[]): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [RIVENDELL] },
      ],
    });
    return makeCancelWindowCombat(base, {
      creatureDefId: DWAR_OF_WAW,
      creatureRace: Race.Ringwraith,
      strikesTotal: 1,
      strikeProwess: 15,
    });
  }

  test('Mode B: attacker may play it on an existing Nazgûl attack', () => {
    const combat = ringwraithAttack([FELL_BEAST]);
    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions.length).toBeGreaterThan(0);
    expect((actions[0].action as ModifyAttackAction).player).toBe(PLAYER_2);
  });

  test('Mode B: playing it applies +1 strike / -2 prowess / attacker-chooses-defenders and discards the card', () => {
    const combat = ringwraithAttack([FELL_BEAST]);
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);   // 1 + 1
    expect(after.combat!.strikeProwess).toBe(13); // 15 - 2
    expect(after.combat!.attackerChoosesDefenders).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FELL_BEAST)).toBe(true);
  });

  test('Mode B: not offered against a non-Nazgûl attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FELL_BEAST], siteDeck: [RIVENDELL] },
      ],
    });
    const combat = makeCancelWindowCombat(base, { creatureRace: Race.Orc, strikesTotal: 2, strikeProwess: 6 });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B: the defending player cannot play it — attacker-only', () => {
    const combat = ringwraithAttack([]);
    const withDefenderHand = {
      ...combat,
      players: [
        { ...combat.players[RESOURCE_PLAYER], hand: [{ instanceId: 'fb-1' as import('../../index.js').CardInstanceId, definitionId: FELL_BEAST }] },
        combat.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    expect(viableActions(withDefenderHand, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('Mode B: duplication-limit — cannot stack two copies on the same attack', () => {
    const combat = ringwraithAttack([FELL_BEAST, FELL_BEAST, FELL_BEAST]);
    const first = dispatch(combat, viableActions(combat, PLAYER_2, 'modify-attack')[0].action);
    expect(viableActions(first, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });
});
