/**
 * @module as-47.test
 *
 * Card test: Drughu (as-47)
 * Type: hero-resource-event (short)
 *
 * Text:
 *   "Playable on a hero company during your organization phase if you discard
 *    a ranger character from your hand. All characters in the company this
 *    turn receive +2 prowess against attacks keyed to Wilderness [{w}] and
 *    during combat at Ruins & Lairs [{R}]. Cannot be duplicated on a given
 *    company."
 *
 * Engine Support:
 * | # | Rule (card text)                                        | Status      | Mechanism                                             |
 * |---|----------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Playable on a hero company during the organization phase | IMPLEMENTED | play-window phase:organization + play-target company   |
 * | 2 | Cost: discard a ranger character from hand                | IMPLEMENTED | play-discard-cost (source hand, skills includes ranger) |
 * | 3 | +2 prowess to every character in the company              | IMPLEMENTED | add-constraint company-stat-modifier, scope turn        |
 * | 4 | ...against attacks keyed to Wilderness [{w}]              | IMPLEMENTED | constraintWhen: attack.keying includes "wilderness"     |
 * | 5 | ...and during combat at Ruins & Lairs [{R}]                | IMPLEMENTED | constraintWhen: site.siteType == "ruins-and-lairs"      |
 * | 6 | Cannot be duplicated on a given company                   | IMPLEMENTED | duplication-limit scope:company max:1                   |
 *
 * The `constraintWhen` clause on the `company-stat-modifier` constraint is a
 * new engine primitive built for this card: unlike the pre-existing flat
 * Miruvor/Orc-draughts-style company bonus, Drughu is played proactively
 * during the organization phase (before any attack is known) yet its bonus
 * only applies against a *later*, matching attack — so the condition must be
 * re-evaluated at combat-prowess resolution time (`computeCombatProwess`),
 * never baked in at play time. `computeCombatProwess` was extended to expose
 * `attack.keying` / `site.siteType` to this resolution path (previously only
 * the `all-attacks`/`cancel-attack` contexts saw these facts). Playing the
 * card during the organization phase, off the combat window entirely, also
 * required extending `play-discard-cost` — previously wired only for hazard
 * plays (`mh-hazard-play.ts`) — to the company-targeted resource short-event
 * path (`organization.ts` / `reducer-events.ts`).
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 * Certified: 2026-09-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, FARAMIR, ANBORN, BILBO,
  EAGLES_EYRIE, BANDIT_LAIR,
  companyIdAt, findCharInstanceId, findHandCardId,
  viableActions, dispatch, executeAction, makeMHState,
  getCharacter, expectInDiscardPile, expectNotInHand,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState, PlayShortEventAction,
} from '../../index.js';
import { Race, RegionType } from '../../index.js';

const DRUGHU = 'as-47' as CardDefinitionId;

/**
 * Organization-phase state: a hero company (Aragorn + Gimli) at `site`, with
 * Drughu and a ranger (Faramir) in hand so the card is playable.
 */
function orgState(site: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [ARAGORN, GIMLI] }],
        hand: [DRUGHU, FARAMIR],
        siteDeck: [EAGLES_EYRIE],
      },
      { id: PLAYER_2, companies: [], hand: [], siteDeck: [BANDIT_LAIR] },
    ],
  });
}

/** Play Drughu (discarding Faramir as the ranger cost) and return the result. */
function playDrughu(state: GameState): GameState {
  const plays = viableActions(state, PLAYER_1, 'play-short-event') as { action: PlayShortEventAction }[];
  expect(plays).toHaveLength(1);
  expect(plays[0].action.costDiscardInstanceId).toBe(findHandCardId(state, RESOURCE_PLAYER, FARAMIR));
  return dispatch(state, plays[0].action);
}

/**
 * Attach a synthetic resolve-strike combat against `characterDefId`, with an
 * optional region-type keying, and switch the phase state to M/H so
 * `resolve-strike` is offered.
 */
function withStrike(
  state: GameState,
  characterDefId: CardDefinitionId,
  attackKeying?: readonly RegionType[],
): GameState {
  const characterId = findCharInstanceId(state, RESOURCE_PLAYER, characterDefId);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-creature' as CardInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 13,
    creatureBody: 10,
    creatureRace: Race.Orc,
    ...(attackKeying ? { attackKeying } : {}),
    strikeAssignments: [{ characterId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, phaseState: makeMHState(), combat };
}

describe('Drughu (as-47)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1 & 2: play eligibility and the ranger discard-cost ──────────

  test('playable on a hero company during the organization phase when a ranger is in hand', () => {
    const state = orgState(EAGLES_EYRIE);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable when hand holds no ranger character', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: EAGLES_EYRIE, characters: [ARAGORN, GIMLI] }], hand: [DRUGHU, BILBO], siteDeck: [EAGLES_EYRIE] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [BANDIT_LAIR] },
      ],
    });
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
  });

  test('NOT offered outside the organization phase', () => {
    const state: GameState = { ...orgState(EAGLES_EYRIE), phaseState: makeMHState() };
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
  });

  test('playing the card discards both itself and the chosen ranger from hand', () => {
    const state = orgState(EAGLES_EYRIE);
    const faramirId = findHandCardId(state, RESOURCE_PLAYER, FARAMIR);
    const after = playDrughu(state);

    expectInDiscardPile(after, RESOURCE_PLAYER, DRUGHU);
    expectInDiscardPile(after, RESOURCE_PLAYER, FARAMIR);
    expectNotInHand(after, RESOURCE_PLAYER, faramirId);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('installs a turn-scoped company-stat-modifier constraint (not baked into non-combat effective prowess)', () => {
    const state = orgState(EAGLES_EYRIE);
    const after = playDrughu(state);

    const constraint = after.activeConstraints.find(c => c.kind.type === 'company-stat-modifier');
    expect(constraint).toBeDefined();
    expect(constraint!.scope.kind).toBe('turn');
    expect(constraint!.target).toEqual({ kind: 'company', companyId: companyIdAt(after, RESOURCE_PLAYER) });

    // The bonus is conditional on facing a specific kind of attack — outside
    // combat resolution neither `attack.keying` nor `site.siteType` are
    // populated, so the constraint contributes nothing to ordinary effective
    // stats.
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(6);
    expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(5);
  });

  // ─── Rule 6: cannot be duplicated on a given company ─────────────────────

  test('NOT offered a second time against the same company', () => {
    const state = orgState(EAGLES_EYRIE);
    const after = playDrughu(state);

    const withSecondCopy: GameState = {
      ...after,
      players: [
        {
          ...after.players[RESOURCE_PLAYER],
          hand: [
            { instanceId: 'drughu-2' as CardInstanceId, definitionId: DRUGHU },
            { instanceId: 'anborn-2' as CardInstanceId, definitionId: ANBORN },
          ],
        },
        after.players[1],
      ],
    };
    const morePlays = viableActions(withSecondCopy, PLAYER_1, 'play-short-event');
    expect(morePlays).toHaveLength(0);
  });

  // ─── Rules 3 & 4: +2 prowess against attacks keyed to Wilderness [{w}] ───

  describe('+2 prowess against attacks keyed to Wilderness [{w}]', () => {
    // strikeProwess 13, roll 6, tap: base 6(Aragorn)/5(Gimli) + roll 6 fails
    // (12/11 < 13); +2 clears it (14 ≥ 13 / 13 = 13 tie, both succeed).
    test('a Wilderness-keyed strike that would wound Aragorn instead succeeds', () => {
      const played = playDrughu(orgState(EAGLES_EYRIE));
      const state = withStrike(played, ARAGORN, [RegionType.Wilderness]);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Tapped);
    });

    test('control: without the card in play, the same Wilderness-keyed strike wounds Aragorn', () => {
      const state = withStrike(orgState(EAGLES_EYRIE), ARAGORN, [RegionType.Wilderness]);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Inverted);
    });

    test('applies to every character in the company, not just one (Gimli also survives)', () => {
      const played = playDrughu(orgState(EAGLES_EYRIE));
      const state = withStrike(played, GIMLI, [RegionType.Wilderness]);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(after, RESOURCE_PLAYER, GIMLI).status).toBe(CardStatus.Tapped);
    });
  });

  // ─── Rules 3 & 5: +2 prowess during combat at Ruins & Lairs [{R}] ────────

  describe('+2 prowess during combat at Ruins & Lairs [{R}]', () => {
    test('a non-Wilderness-keyed strike at a Ruins & Lairs site still gets the bonus', () => {
      const played = playDrughu(orgState(BANDIT_LAIR));
      // No region-type keying at all (e.g. keyed purely to the site) —
      // the site-type clause alone must carry the bonus.
      const state = withStrike(played, ARAGORN);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Tapped);
    });

    test('control: the same strike at a non-Ruins-and-Lairs site (no keying either) wounds Aragorn', () => {
      const played = playDrughu(orgState(EAGLES_EYRIE));
      const state = withStrike(played, ARAGORN);
      const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
      expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Inverted);
    });
  });

  // ─── Neither condition: no bonus ─────────────────────────────────────────

  test('a Shadow-keyed strike at a non-Ruins-and-Lairs site gets no bonus', () => {
    const played = playDrughu(orgState(EAGLES_EYRIE));
    const state = withStrike(played, ARAGORN, [RegionType.Shadow]);
    const after = executeAction(state, PLAYER_1, 'resolve-strike', 6, true);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Inverted);
  });
});
