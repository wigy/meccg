/**
 * @module tw-34.test
 *
 * Card test: Fell Turtle (tw-34)
 * Type: hazard-creature (Animal), non-unique
 * Base stats: 1 strike, prowess 15, body — (no body check for the creature),
 * kill MP 1.
 *
 * Text:
 *   "Animals. One strike. If any strike is successful, the defending company
 *    must return to its site of origin (defending characters are wounded
 *    normally)."
 *
 * Canonical cost (`data/cards.json` TW-34 `attributes.playable`): `{c}` — one
 * coastal-sea in the site path.
 *
 * REGRESSION: the card's `keyedTo` previously read `regionTypes: ["coastal-sea"]`,
 * but the engine's `RegionType` enum value for this region is `"coastal"` —
 * `regionTypesMatch` (reducer-utils.ts) keys strictly off the enum, so the
 * mismatched string meant the creature could never actually be keyed to any
 * real site path and was unplayable. Fixed to `regionTypes: ["coastal"]`
 * (verified by the keying tests below).
 *
 * Effects:
 * | # | Rule                                             | Encoding                                              |
 * |---|---------------------------------------------------|--------------------------------------------------------|
 * | 1 | One strike at prowess 15, no body                  | base stats — combat                                     |
 * | 2 | Keyed to a coastal-sea {c}                          | keyedTo regionTypes [coastal]                           |
 * | 3 | If any strike is successful, defending company must| on-event: attack-strike-successful →                    |
 * |   | return to its site of origin (chars wounded normal)| company-return-to-origin                                |
 *
 * A successful strike still wounds the defending character normally (body
 * check etc. — the "return to origin" is an additional consequence, not a
 * replacement for the wound). This is CoE rule 2.IV.4's mechanism, the same
 * one used by the short-event `company-return-to-origin` effect (Beorning
 * Skin-changers ba-10) and `agent-discard-return-to-origin` (Baduila dm-2),
 * but triggered here by the creature's own strike succeeding rather than by a
 * separate short-event or agent action.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt,
  viableActions, expectCharStatus, expectInPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType, CardStatus, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const FELL_TURTLE = 'tw-34' as CardDefinitionId;

const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

/**
 * A game state with a P1 (Wizard) company at Lórien moving to Moria via a
 * coastal-sea region, and Fell Turtle in the P2 hazard hand.
 */
function movingStateWithFellTurtle(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: LORIEN, characters: [ARAGORN], destinationSite: MORIA }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [FELL_TURTLE],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Bay of Belfalas'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    }),
  };
}

describe('Fell Turtle (tw-34)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: 1 strike at prowess 15, no body ────────────────────────

  test('combat initiates with 1 strike at prowess 15 and no body', () => {
    const ready = movingStateWithFellTurtle();
    const turtleId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, turtleId, companyId, COASTAL_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.creatureBody).toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('animal');
  });

  // ─── Keying: playable on a coastal-sea path ─────────────────────────────

  test('playable on a coastal-sea path via region-type keying', () => {
    const ready = movingStateWithFellTurtle();
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });

  // ─── Keying: NOT playable without a coastal-sea in the path ─────────────

  test('NOT playable on a pure-wilderness path (REGRESSION: coastal-sea token mismatch)', () => {
    const state = movingStateWithFellTurtle();
    const wildernessOnly: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Anórien'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    expect(viableActions(wildernessOnly, PLAYER_2, 'play-hazard')).toHaveLength(0);
    const all = computeLegalActions(wildernessOnly, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Successful strike: character wounded normally + company returns ────

  test('successful strike wounds the character normally AND forces the company back to its site of origin', () => {
    const ready = movingStateWithFellTurtle();
    const turtleId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, turtleId, companyId, COASTAL_KEYING);

    // Aragorn prowess 6 + low roll 2 = 8 <= creature prowess 15 -> strike hits.
    // Body check: Aragorn body 9, roll 5 <= 9 -> survives, stays wounded.
    const afterWound = runCreatureCombat(afterChain, ARAGORN, 2, 5);

    expect(afterWound.combat).toBeNull();

    // "Defending characters are wounded normally" — Aragorn ends up Inverted.
    expectCharStatus(afterWound, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);

    // The creature's strike succeeded -> defended company must return to origin.
    expect((afterWound.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBe(true);

    // Rule 2.IV.4: a site-phase-do-nothing constraint blocks the company's
    // upcoming site phase, sourced from Fell Turtle.
    expect(afterWound.activeConstraints.some(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company' && c.target.companyId === companyId
        && c.sourceDefinitionId === FELL_TURTLE,
    )).toBe(true);

    // The creature's one strike wounded (not defeated), so combat did not
    // end with "all strikes defeated" — the creature goes to the attacking
    // (hazard) player's discard pile rather than the defender's kill pile.
    expectInPile(afterWound, HAZARD_PLAYER, 'discardPile', FELL_TURTLE);
  });

  // ─── Parried strike: creature auto-defeated (no body), company unaffected ─

  test('parried strike defeats the creature and does NOT force a return to origin', () => {
    const ready = movingStateWithFellTurtle();
    const turtleId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, turtleId, companyId, COASTAL_KEYING);

    // Aragorn taps to fight (full prowess 6) + high roll 12 = 18 > creature
    // prowess 15 -> strike parried. Fell Turtle has no body -> auto-defeated,
    // no body check.
    const afterStrike = runCreatureCombat(afterChain, ARAGORN, 12, null, true);

    expect(afterStrike.combat).toBeNull();
    expectCharStatus(afterStrike, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    // No successful strike -> no forced return to origin.
    expect((afterStrike.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBeFalsy();
    expect(afterStrike.activeConstraints.some(c => c.kind.type === 'site-phase-do-nothing')).toBe(false);

    // All strikes defeated -> creature goes to the defender's kill pile.
    expectInPile(afterStrike, RESOURCE_PLAYER, 'killPile', FELL_TURTLE);
  });
});
