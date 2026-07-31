/**
 * @module le-81.test
 *
 * Card test: Landroval (le-81)
 * Type: hazard-creature (Animal)
 *
 * Text:
 *   "Unique. Animal. Two strikes (playable only against an overt minion
 *   company). Attacker chooses defending characters."
 *
 * Base stats: strikes 2, prowess 12, body 6, kill MP 2, race animal, unique.
 *
 * Canonical cost (`attributes.playable`): {w}{w}{b}{s} — encoded as a
 * single `keyedTo` entry whose fields are alternatives (OR'd, per-type
 * count): `regionTypes: [wilderness, wilderness, border, shadow]` (two
 * wilderness OR one border OR one shadow region in the site path).
 *
 * Effects:
 * | # | Effect Type                       | Status | Notes                          |
 * |---|------------------------------------|--------|--------------------------------|
 * | 1 | play-condition (target-company)   | OK     | minion (non-hero) AND overt    |
 * | 2 | combat-attacker-chooses-defenders  | OK     | cancel-window, attacker assigns |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, PELARGIR,
  buildTestState, resetMint,
  makeBorderMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions, viableFor,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const LANDROVAL = 'le-81' as CardDefinitionId;
// Mauhúr (as-2): minion character, race orc — makes its company overt.
const MAUHUR = 'as-2' as CardDefinitionId;
// Mîonid (as-3): minion character, race man — its company stays covert.
const MIONID = 'as-3' as CardDefinitionId;

const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };

function stateWithDefenderCompany(
  alignment: Alignment,
  characters: CardDefinitionId[],
): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment,
        companies: [{ site: MORIA, characters }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [LANDROVAL],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Landroval (le-81)', () => {
  beforeEach(() => resetMint());

  // ─── Play restriction: overt minion companies only ───────────────────────

  test('NOT playable against a hero (Wizard) company', () => {
    const state = stateWithDefenderCompany(Alignment.Wizard, [ARAGORN]);
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable against a covert minion (Ringwraith) company', () => {
    // Mîonid is a minion character (man) — no Orc/Troll present, so the
    // company stays covert.
    const state = stateWithDefenderCompany(Alignment.Ringwraith, [MIONID]);
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('playable against an overt minion (Ringwraith) company via border-land', () => {
    // Mauhúr is an Orc, making the company overt.
    const state = stateWithDefenderCompany(Alignment.Ringwraith, [MAUHUR]);
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === BORDER_KEYING.method && a.keyedBy?.value === BORDER_KEYING.value;
    })).toBe(true);
  });

  // ─── Base stats + combat-attacker-chooses-defenders ──────────────────────

  test('attack uses 2 strikes at prowess 12, body 6, race animal', () => {
    const state = stateWithDefenderCompany(Alignment.Ringwraith, [MAUHUR]);
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const landrovalId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, landrovalId, companyId, BORDER_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(12);
    expect(after.combat!.creatureRace).toBe('animal');
    expect(after.combat!.creatureBody).toBe(6);
  });

  test('combat opens with a cancel-window, then the attacker (hazard player) assigns strikes', () => {
    const state = stateWithDefenderCompany(Alignment.Ringwraith, [MAUHUR]);
    const ready: GameState = { ...state, phaseState: makeBorderMHState() };
    const landrovalId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, landrovalId, companyId, BORDER_KEYING,
    );

    expect(after.combat!.phase).toBe('assign-strikes');
    expect(after.combat!.assignmentPhase).toBe('cancel-window');

    // During the cancel-window the defender (P1) cannot assign strikes;
    // with nothing to cancel, the only defender action is to pass.
    expect(viableActions(after, PLAYER_1, 'assign-strike')).toHaveLength(0);
    expect(viableActions(after, PLAYER_1, 'pass')).toHaveLength(1);
    expect(viableFor(after, PLAYER_2)).toHaveLength(0);

    // After the defender passes, the attacker (hazard player) assigns strikes.
    const afterPass = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
    expect(viableActions(afterPass, PLAYER_1, 'assign-strike')).toHaveLength(0);
  });
});
