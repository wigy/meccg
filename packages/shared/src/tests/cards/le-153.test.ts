/**
 * @module le-153.test
 *
 * Card test: Last Child of Ungoliant (le-153)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 *
 * Card text:
 *   "Unique. Playable at Shelob's Lair. Manifestation of Shelob. Its
 *    controlling character's company is overt. Tap this ally to either:
 *    cancel one hazard creature attack against a company moving to a site
 *    in Imlad Morgul, Ithilien, or Gorgoroth or to discard one hazard
 *    permanent-event on such a company or on a character in such a company.
 *    Discard this card if her company moves to a site that is not in
 *    Gorgoroth, Imlad Morgul, or Ithilien. Return her to your hand if
 *    Shelob is played."
 *
 * Effects:
 *   1. company-overt — controlling character's company is overt
 *
 * Rule coverage:
 *
 * | # | Rule                                                     | Status          | Notes                                                 |
 * |---|----------------------------------------------------------|-----------------|-------------------------------------------------------|
 * | 1 | Unique                                                   | OK              | unique:true (deck-build limit)                        |
 * | 2 | Playable at Shelob's Lair                                | OK              | playableAt site filter (siteMatchesEntry by name)     |
 * | 3 | Manifestation of Shelob                                  | n/a             | manifestation grouping, no separate engine effect     |
 * | 4 | Controlling character's company is overt                 | OK              | company-overt via reducer-utils isCovertCompany       |
 * | 5 | Tap to cancel a hazard creature attack vs a company      | NOT IMPLEMENTED | cancel-attack combat context lacks the moving         |
 * |   |   moving to Imlad Morgul / Ithilien / Gorgoroth          |                 | company's destination region                          |
 * | 6 | Tap to discard a hazard permanent-event on such a        | NOT IMPLEMENTED | no tap-to-discard-hazard-permanent-event apply         |
 * |   |   company or character                                   |                 |                                                       |
 * | 7 | Discard if company moves to a site not in Gorgoroth /    | NOT IMPLEMENTED | on-event triggers globally stubbed (matchesTrigger)   |
 * |   |   Imlad Morgul / Ithilien                                |                 |                                                       |
 * | 8 | Return to hand if Shelob is played                       | NOT IMPLEMENTED | on-event triggers globally stubbed (matchesTrigger)   |
 *
 * Playable: PARTIALLY — NOT CERTIFIED. Rules 5–8 have no engine support
 * (destination-region-gated cancel-attack, tap-to-discard hazard permanent-
 * events, and two on-event triggers that depend on the stubbed trigger
 * system). This test exercises the implemented rules only (playability and
 * company-overt); the unimplemented rules are intentionally not asserted.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  attachAllyToChar,
  RESOURCE_PLAYER,
  viableActions, makeCancelWindowCombat,
  type BuildTestStateOpts,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, ModifyAttackAction, PlayHeroResourceAction } from '../../index.js';

const LAST_CHILD = 'le-153' as CardDefinitionId;

// Minion characters (LE pool — ringwraith alignment, no inherent effects).
const ASTERNAK = 'le-1' as CardDefinitionId;   // man, prowess 5, body 7, mind 5 → covert alone
const LUITPRAND = 'le-23' as CardDefinitionId; // man, prowess 3, body 7, mind 1

// Minion sites.
const SHELOBS_LAIR = 'le-402' as CardDefinitionId; // minion shadow-hold, Imlad Morgul (the card's site)
const MORIA_MINION = 'le-392' as CardDefinitionId;  // minion shadow-hold, Redhorn Gate (different site)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven

// Not Slay Needlessly — minion short event: cancels if defender.covert, else -2 prowess.
const NSN = 'le-212' as CardDefinitionId;
// Elf-lord Revealed in Wrath — "elves" race creature, for the NSN + overt test.
const ELF_LORD = 'le-69' as CardDefinitionId;

/** Base two-player M/H state: Asternak at Shelob's Lair, NSN in the resource player's hand. */
const NSN_OPTS: BuildTestStateOpts = {
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  recompute: true,
  players: [
    { id: PLAYER_1, companies: [{ site: SHELOBS_LAIR, characters: [ASTERNAK] }], hand: [NSN], siteDeck: [DOL_GULDUR] },
    { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LUITPRAND] }], hand: [] as CardDefinitionId[], siteDeck: [DOL_GULDUR] },
  ],
};

describe('Last Child of Ungoliant (le-153)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: playable at Shelob's Lair ────────────────────────────────────

  test('IS playable at Shelob’s Lair', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: SHELOBS_LAIR,
      hand: [LAST_CHILD],
    });
    const allyInstanceId = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInstanceId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a different Shadow-hold (Moria, not Shelob’s Lair)', () => {
    // Moria is also a shadow-hold, so playability is gated on the site NAME,
    // not the site type — proving the playableAt entry is a named-site filter.
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA_MINION,
      hand: [LAST_CHILD],
    });
    const allyInstanceId = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInstanceId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 4: controlling character's company is overt ─────────────────────

  test('company with Last Child of Ungoliant is overt (NSN does -2 prowess, not cancel)', () => {
    // Not Slay Needlessly cancels vs covert companies, gives -2 prowess vs overt.
    // ASTERNAK (man, no Orc/Troll) → covert without the ally.
    // With LAST_CHILD ally → overt (company-overt effect).
    const base = buildTestState(NSN_OPTS);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, LAST_CHILD);
    const combatState = makeCancelWindowCombat(withAlly, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikesTotal: 1,
      strikeProwess: 15,
    });

    const nsnInstanceId = withAlly.players[RESOURCE_PLAYER].hand[0].instanceId;
    // Overt company → NSN's cancel-attack mode is unavailable.
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);

    // NSN's -2 prowess mode (modify-attack from hand) IS available against the overt company.
    const modifyActions = viableActions(combatState, PLAYER_1, 'modify-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as ModifyAttackAction).cardInstanceId === nsnInstanceId);
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });

  test('company without the ally and no Orc/Troll is covert (NSN cancels)', () => {
    const base = buildTestState(NSN_OPTS);
    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ELF_LORD,
      creatureRace: 'elves',
      strikesTotal: 1,
      strikeProwess: 15,
    });

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });
});
