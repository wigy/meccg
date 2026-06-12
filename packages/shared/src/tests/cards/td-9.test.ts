/**
 * @module td-9.test
 *
 * Card test: Cruel Caradhras (td-9)
 * Type: hazard-event (short)
 *
 * "Playable on a company using region movement to move through (not stopping at
 *  a site therein) or leave one of the following regions: High Pass, Redhorn
 *  Gate, Angmar, Gundabad, Grey Mountain Narrows, or Imlad Morgul. Each
 *  character in target company must face one strike (not an attack) of 8 prowess
 *  which cannot be canceled. Any resulting body check is modified by +1."
 *
 * Effects (data):
 *   - play-condition requires=region-through-or-leave (the six named regions)
 *   - company-strike prowess=8, uncancelable, bodyCheckModifier=+1
 *
 * Engine support:
 * | # | Rule                                                      | Status |
 * |---|-----------------------------------------------------------|--------|
 * | 1 | Playable only on region movement leaving a named region   | OK     |
 * | 2 | Playable on region movement passing through a named region | OK     |
 * | 3 | NOT playable when the named region is the destination     | OK     |
 * | 4 | NOT playable for starter movement                         | OK     |
 * | 5 | NOT playable when no named region is left/passed through  | OK     |
 * | 6 | Each character faces one 8-prowess strike (not an attack) | OK     |
 * | 7 | The strikes cannot be canceled                            | OK     |
 * | 8 | A resulting body check is modified by +1                  | OK     |
 *
 * Characters used (hero target company — Cruel Caradhras is a Neutral hazard
 * playable against any moving company):
 *   - tw-120 Aragorn II  (prowess 6, body 9)
 *   - tw-168 Legolas     (prowess 5, body 8)
 *   - tw-159 Gimli       (prowess 5, body 8)
 *   - tw-124 Bard Bowman (prowess 3, body 6) — low prowess/body for the body check
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, BARD_BOWMAN,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  viableActions, executeAction,
  handCardId, findCharInstanceId, companyIdAt,
  playHazardAndResolve,
  expectCharInPlay, expectCharNotInPlay, expectCharStatus,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { GameState, CardDefinitionId, CardInstanceId } from '../../index.js';

const CRUEL_CARADHRAS = 'td-9' as CardDefinitionId;

// ─── Helpers (inline state builders) ─────────────────────────────────────────

/** Build a hero moving company (P1) and a hazard player (P2) holding Cruel Caradhras. */
function buildState(p1Chars: CardDefinitionId[]): GameState {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: p1Chars }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [CRUEL_CARADHRAS], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Cruel Caradhras (td-9)', () => {
  beforeEach(() => resetMint());

  // ── Playability: region-through-or-leave ───────────────────────────────────

  test('playable when leaving a named region via region movement (origin region)', () => {
    // Path: leaves Angmar (origin, named), stops at a site in Forochel (destination, not named).
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Angmar', 'Forochel'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('playable when moving through a named region without stopping (intermediate region)', () => {
    // Path: Eriador → High Pass (passed through, named) → Anduin Vales (destination, not named).
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Eriador', 'High Pass', 'Anduin Vales'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });

  test('NOT playable when a named region is only the destination (company stops at a site there)', () => {
    // Path stops at a site in Angmar (named, but destination) — neither left nor passed through.
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Eriador', 'Angmar'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable for starter (non-region) movement even across a named region', () => {
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Starter,
        resolvedSitePathNames: ['Angmar', 'Forochel'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when no named region is left or passed through', () => {
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Eriador', 'Gondor'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when the path is a single region (origin equals destination)', () => {
    // Staying within Angmar (moving between two of its sites) neither leaves nor passes through it.
    const s: GameState = {
      ...buildState([ARAGORN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Angmar'],
      }),
    };
    expect(viableActions(s, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ── Each character faces one strike (not an attack) ────────────────────────

  test('each character in the company faces one 8-prowess strike', () => {
    const s0: GameState = {
      ...buildState([ARAGORN, LEGOLAS, GIMLI]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Gundabad', 'Forochel'],
      }),
    };
    const cardId = handCardId(s0, HAZARD_PLAYER);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playHazardAndResolve(s0, PLAYER_2, cardId, companyId);

    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(8);
    // One strike per character: total strikes equals the company size (3).
    expect(s.combat!.strikesTotal).toBe(3);

    // The defender may assign a strike to each of the three characters.
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
    const gimliId = findCharInstanceId(s, RESOURCE_PLAYER, GIMLI);
    const assignTargets = new Set(
      viableActions(s, PLAYER_1, 'assign-strike')
        .map(a => (a.action as { characterId: CardInstanceId }).characterId as string),
    );
    expect(assignTargets).toEqual(new Set([aragornId as string, legolasId as string, gimliId as string]));
  });

  test('the strikes cannot be canceled', () => {
    const s0: GameState = {
      ...buildState([ARAGORN, LEGOLAS]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Redhorn Gate', 'Anduin Vales'],
      }),
    };
    const cardId = handCardId(s0, HAZARD_PLAYER);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playHazardAndResolve(s0, PLAYER_2, cardId, companyId);

    expect(s.combat).not.toBeNull();
    expect(s.combat!.uncancelable).toBe(true);
    // No cancel-attack action is offered to the defending player.
    expect(viableActions(s, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ── Resulting body check is modified by +1 ─────────────────────────────────

  test('a resulting body check is modified by +1 (roll equal to body eliminates)', () => {
    // Bard Bowman: prowess 3, body 6. Strike (8) vs prowess 3 + roll 2 = 5 → wounded.
    // Body check roll 6: 6 + 1 (attack modifier) = 7 > body 6 → eliminated.
    // Without the +1, a roll of 6 equals body 6 and would only wound.
    const s0: GameState = {
      ...buildState([BARD_BOWMAN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Grey Mountain Narrows', 'Anduin Vales'],
      }),
    };
    const cardId = handCardId(s0, HAZARD_PLAYER);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playHazardAndResolve(s0, PLAYER_2, cardId, companyId);
    const bardId = findCharInstanceId(s, RESOURCE_PLAYER, BARD_BOWMAN);

    // Defender (P1) assigns the single strike to Bard and resolves it as a wound.
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    expect(s.combat!.phase).toBe('body-check');

    // Attacking player (P2) rolls the body check; roll 6 + 1 modifier eliminates.
    s = executeAction(s, PLAYER_2, 'body-check-roll', 6);

    expect(s.combat).toBeNull();
    expectCharNotInPlay(s, RESOURCE_PLAYER, bardId);
    // An eliminated character goes to the out-of-play pile.
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.map(c => c.definitionId)).toContain(BARD_BOWMAN);
  });

  test('body check boundary: a roll one below body survives (wounded, not eliminated)', () => {
    // Body check roll 5: 5 + 1 = 6, which equals body 6 (not greater) → wounded, survives.
    const s0: GameState = {
      ...buildState([BARD_BOWMAN]),
      phaseState: makeMHState({
        movementType: MovementType.Region,
        resolvedSitePathNames: ['Imlad Morgul', 'Gorgoroth'],
      }),
    };
    const cardId = handCardId(s0, HAZARD_PLAYER);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playHazardAndResolve(s0, PLAYER_2, cardId, companyId);
    const bardId = findCharInstanceId(s, RESOURCE_PLAYER, BARD_BOWMAN);

    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    expect(s.combat!.phase).toBe('body-check');

    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);

    expect(s.combat).toBeNull();
    expectCharInPlay(s, RESOURCE_PLAYER, bardId);
    // A wounded survivor is left tapped/inverted, not eliminated.
    expectCharStatus(s, RESOURCE_PLAYER, BARD_BOWMAN, CardStatus.Inverted);
  });
});
