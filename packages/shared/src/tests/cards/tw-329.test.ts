/**
 * @module tw-329.test
 *
 * Card test: Southrons (tw-329)
 * Type: hero-resource-faction (man, unique, 5 MP, influence # 9)
 *
 * "Unique. Playable at Southron Oasis if the influence check is greater than 8.
 *  Standard Modifications: Dúnedain (-2), Elves (-2), Dwarves (-2)."
 *
 * "Greater than 8" is encoded as `influenceNumber: 9` — the engine succeeds on
 * `roll + modifier >= influenceNumber`, so a need of 9 means the total must
 * exceed 8. The card is playable only at Southron Oasis (tw-426); its
 * `playableAt` names that site exactly (site matching is by full name).
 *
 * The Standard Modifications are per the CoE glossary applied when the *race of
 * the influencing character* matches, so they are modeled as three
 * `check-modifier` (check: influence) effects gated on `bearer.race`:
 * Dúnadan/Elf/Dwarf each subtract 2 from the check, raising the roll needed.
 * A plain Man influencer takes no such penalty.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, makeSitePhase, firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';

const SOUTHRONS = 'tw-329' as CardDefinitionId;

const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId; // playable site
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;   // not a playable site

const BEORN = 'tw-126' as CardDefinitionId;    // Man, DI 2 (no race penalty)
const ARAGORN_II = 'tw-120' as CardDefinitionId; // Dúnadan, DI 3
const LEGOLAS = 'tw-168' as CardDefinitionId;  // Elf, DI 2
const GIMLI = 'tw-159' as CardDefinitionId;    // Dwarf, DI 2

describe('Southrons (tw-329)', () => {
  beforeEach(() => resetMint());

  test('influenceable at Southron Oasis; a Man influencer takes no race penalty (need 7)', () => {
    // Beorn DI 2, no standard-modification race → need = 9 - 2 = 7
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS, characters: [BEORN], hand: [SOUTHRONS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('Standard Modification: a Dúnadan influencer is -2 (Aragorn II DI 3 → need 8)', () => {
    // Aragorn DI 3, Dúnadan -2 → modifier 1 → need = 9 - 1 = 8
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS, characters: [ARAGORN_II], hand: [SOUTHRONS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(8);
  });

  test('Standard Modification: an Elf influencer is -2 (Legolas DI 2 → need 9)', () => {
    // Legolas DI 2, Elf -2 → modifier 0 → need = 9 - 0 = 9
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS, characters: [LEGOLAS], hand: [SOUTHRONS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(9);
  });

  test('Standard Modification: a Dwarf influencer is -2 (Gimli DI 2 → need 9)', () => {
    // Gimli DI 2, Dwarf -2 → modifier 0 → need = 9 - 0 = 9
    const state = buildSitePhaseState({ site: SOUTHRON_OASIS, characters: [GIMLI], hand: [SOUTHRONS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)!.need).toBe(9);
  });

  test('NOT influenceable at a site other than Southron Oasis (Minas Tirith)', () => {
    const state = buildSitePhaseState({ site: MINAS_TIRITH, characters: [BEORN], hand: [SOUTHRONS] });
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });

  test('Unique: no influence attempt is offered while a copy is already in play', () => {
    const inPlay: CardInPlay = { instanceId: 'south-1' as CardInstanceId, definitionId: SOUTHRONS, status: CardStatus.Untapped };
    const base = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Site, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: SOUTHRON_OASIS, characters: [BEORN] }], hand: [SOUTHRONS], siteDeck: [MINAS_TIRITH], cardsInPlay: [inPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionInstanceId)).toBeUndefined();
  });
});
