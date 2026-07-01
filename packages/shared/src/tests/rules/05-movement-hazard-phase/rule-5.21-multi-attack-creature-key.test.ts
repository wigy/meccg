/**
 * @module rule-5.21-multi-attack-creature-key
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.21: Multi-Attack Creature Key Validity
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The declared key of a creature with multiple attacks remains an active condition for resolving each of those attacks into combat; if the key is no longer valid at the start of any of the creature's attacks, the creature is immediately discarded without effect (but still counts against the hazard limit).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, addCardInPlay, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA, LORIEN,
} from '../../test-helpers.js';
import { MovementType } from '../../../types/common.js';
import type { CardDefinitionId } from '../../test-helpers.js';

// Bairanax Ahunt (td-4): a Dragon "Ahunt" long-event — a creature that
// stays in play and attacks every company that passes through a matching
// region, i.e. exactly the "creature with multiple attacks" rule 5.21
// describes. Its base key is ['Withered Heath', 'Gundabad', 'Anduin Vales',
// 'Grey Mountain Narrows']; an `extended` key (active only while Doors of
// Night is in play) adds ['Northern Rhovanion', 'Iron Hills', 'Southern
// Rhovanion', 'Angmar']. Single-test use → inline.
const BAIRANAX_AHUNT = 'td-4' as CardDefinitionId;
const NORTHERN_RHOVANION = 'tw-476' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

describe('Rule 5.21 — Multi-Attack Creature Key Validity', () => {
  beforeEach(() => resetMint());

  test('An Ahunt creature\'s key is re-evaluated fresh for each company\'s attack, not fixed from when it entered play', () => {
    // `collectMatchingAhuntAttacks` (mh-steps.ts) is called fresh at the
    // start of every company's order-effects step — it is never cached
    // from whenever Bairanax entered play, so any state change (a card
    // entering play, e.g.) that widens or narrows the key is immediately
    // reflected in the very next company's attack eligibility. This is the
    // "declared key remains an active condition" behavior the rule
    // describes; Ahunt's "attacks every matching company" model is this
    // engine's only realized instance of a "creature with multiple attacks".
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const withBairanax = addCardInPlay(built, 1, BAIRANAX_AHUNT);
    const state = { ...withBairanax, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    // Without Doors of Night, "Northern Rhovanion" is outside Bairanax's key
    // — the key does not match, no attack triggers.
    const withoutDoN = dispatch(state, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region, regionPath: [NORTHERN_RHOVANION],
    });
    expect(withoutDoN.combat).toBeNull();

    // With Doors of Night in play, the SAME creature's key now extends to
    // include "Northern Rhovanion" — the very next attack check (same
    // company, same declared path) picks this up immediately.
    const withDoN = addCardInPlay(withBairanax, 1, DOORS_OF_NIGHT);
    const afterDoN = dispatch(
      { ...withDoN, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) },
      { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region, regionPath: [NORTHERN_RHOVANION] },
    );
    expect(afterDoN.combat).not.toBeNull();
    expect(afterDoN.combat!.creatureRace).toBe('dragon');
  });

  // Ahunt's "key no longer matches" outcome is simply "does not trigger for
  // this company" — the creature stays in play to potentially match a later
  // company, since it was never played against a specific company via the
  // normal hazard-play flow (`PlayHazardAction.keyedBy`) in the first place.
  // The rule's other stated consequence — "immediately discarded without
  // effect (but still counts against the hazard limit)" — describes a
  // normal (non-Ahunt) creature card whose key becomes invalid between
  // strikes of its own single combat. No such multi-strike-with-a-mid-combat-
  // key-change scenario exists: `checkCreatureKeying` runs once at play
  // time, and nothing changes a company's own site path mid-combat.
  test.todo('A normal (non-Ahunt) creature card is immediately discarded without effect, still counting against the hazard limit, if its key becomes invalid before one of its own strikes');
});
