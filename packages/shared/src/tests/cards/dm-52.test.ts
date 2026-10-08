/**
 * @module dm-52.test
 *
 * Card test: Drums (dm-52)
 * Type: hazard-event (long)
 *
 * Card text:
 *   "For each company at or moving to an Under-deeps site, the hazard limit is
 *    increased by one and the prowess of all attacks is increased by one. All
 *    automatic-attacks at sites in the following regions have their number of
 *    strikes and prowess increased by one (by two if Doors of Night is in
 *    play): Angmar, Gap of Isen, Gorgoroth, Gundabad, High Pass, Redhorn Gate,
 *    Rohan, Southern Mirkwood, and Udûn. Cannot be duplicated."
 *
 * Effects:
 *   1. hazard-limit-environment +1, appliesTo "all", gated on
 *      `company.atOrMovingToUnderDeeps` — stationary companies at an
 *      Under-deeps site count too.
 *   2. stat-modifier prowess +1, target all-attacks, gated on
 *      `attack.atOrMovingToUnderDeeps` (the defending company's status).
 *   3–4. stat-modifier strikes/prowess +1, target all-automatic-attacks, gated
 *      on `site.region` ∈ the nine regions and Doors of Night NOT in play.
 *   5–6. the same at +2 while Doors of Night is in play.
 *   7. duplication-limit scope game max 1.
 *
 * "At or moving to": a moving company is judged by its destination only, so a
 * company leaving an Under-deeps site for the surface gets no bonus. The
 * Under-galleries (dm-37 / as-164 / ba-99) print their region as "Ûdun", so the
 * region list carries that spelling alongside "Udûn".
 *
 * | # | Effect                                     | Status | Notes                                 |
 * |---|--------------------------------------------|--------|---------------------------------------|
 * | 1 | hazard-limit-environment (+1, Under-deeps) | OK     | snapshotHazardLimit (mh-steps.ts)     |
 * | 2 | stat-modifier prowess +1 all-attacks       | OK     | resolver withDefendingCompanyFacts    |
 * | 3 | stat-modifier strikes +1 auto-attacks      | OK     | `site.region` in attack context       |
 * | 4 | stat-modifier prowess +1 auto-attacks      | OK     | `site.region` in attack context       |
 * | 5 | stat-modifier strikes +2 (Doors of Night)  | OK     | inPlay gate                           |
 * | 6 | stat-modifier prowess +2 (Doors of Night)  | OK     | inPlay gate                           |
 * | 7 | duplication-limit (game, max 1)            | OK     | movement-hazard duplication check     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  ORC_PATROL, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, ISENGARD,
  CardStatus,
  buildTestState, resetMint,
  Phase,
  viableActions,
  makeMHState,
  snapshotHazardLimitAtSites, setupCreatureCombatAtSites, firstAutoAttackCombatAt,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';

const DRUMS = 'dm-52' as CardDefinitionId;
const GOBLIN_GATE = 'tw-398' as CardDefinitionId; // High Pass — Orcs 3 strikes, 6 prowess
const ETTENMOORS = 'tw-395' as CardDefinitionId; // Rhudaur (not listed) — Trolls 1 strike, 9 prowess
const UNDER_VAULTS = 'dm-41' as CardDefinitionId; // Under-deeps, Angmar — Undead 3 strikes, 8 prowess
const UNDER_GALLERIES = 'dm-37' as CardDefinitionId; // Under-deeps, "Ûdun" — Trolls 4 strikes, 9 prowess
const MOUNT_GRAM = 'tw-415' as CardDefinitionId; // surface site adjacent to The Under-vaults

const drumsInPlay: CardInPlay = {
  instanceId: 'drums-1' as CardInstanceId,
  definitionId: DRUMS,
  status: CardStatus.Untapped,
};

describe('Drums (dm-52)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: hazard limit +1 for companies at or moving to an Under-deeps site ───

  test('a company moving to an Under-deeps site has its hazard limit increased by one', () => {
    expect(snapshotHazardLimitAtSites(MOUNT_GRAM, UNDER_VAULTS)).toBe(2);
    expect(snapshotHazardLimitAtSites(MOUNT_GRAM, UNDER_VAULTS, [DRUMS])).toBe(3);
  });

  test('a stationary company at an Under-deeps site has its hazard limit increased by one', () => {
    expect(snapshotHazardLimitAtSites(UNDER_VAULTS, null)).toBe(2);
    expect(snapshotHazardLimitAtSites(UNDER_VAULTS, null, [DRUMS])).toBe(3);
  });

  test('companies neither at nor moving to an Under-deeps site are unaffected', () => {
    // Surface → surface.
    expect(snapshotHazardLimitAtSites(RIVENDELL, MORIA, [DRUMS])).toBe(2);
    // Leaving an Under-deeps site for the surface: not "at or moving to".
    expect(snapshotHazardLimitAtSites(UNDER_VAULTS, MOUNT_GRAM, [DRUMS])).toBe(2);
  });

  // ─── Rule 2: +1 prowess to all attacks against such companies ───

  test('a hazard creature attacking a company moving to an Under-deeps site gets +1 prowess', () => {
    expect(setupCreatureCombatAtSites({ site: MOUNT_GRAM, destination: UNDER_VAULTS, creatureDefId: ORC_PATROL }).combat!.strikeProwess).toBe(6);
    const combat = setupCreatureCombatAtSites({ site: MOUNT_GRAM, destination: UNDER_VAULTS, creatureDefId: ORC_PATROL, hazardCardsInPlay: [drumsInPlay] }).combat!;
    expect(combat.strikeProwess).toBe(7);
    expect(combat.strikesTotal).toBe(3); // strikes unchanged — only prowess for Under-deeps
  });

  test('a hazard creature attacking a company moving between surface sites is unaffected', () => {
    expect(setupCreatureCombatAtSites({ site: RIVENDELL, destination: MORIA, creatureDefId: ORC_PATROL, hazardCardsInPlay: [drumsInPlay] }).combat!.strikeProwess).toBe(6);
  });

  test('a hazard creature attacking a company leaving an Under-deeps site is unaffected', () => {
    expect(setupCreatureCombatAtSites({ site: UNDER_VAULTS, destination: MOUNT_GRAM, creatureDefId: ORC_PATROL, hazardCardsInPlay: [drumsInPlay] }).combat!.strikeProwess).toBe(6);
  });

  test('an automatic-attack at an Under-deeps site in a listed region gets both bonuses', () => {
    // The Under-vaults (Angmar): Undead 3 strikes, 8 prowess.
    // +1 prowess (Under-deeps) and +1 strike / +1 prowess (Angmar) → 4 strikes, 10 prowess.
    const base = firstAutoAttackCombatAt(UNDER_VAULTS);
    expect(base.strikesTotal).toBe(3);
    expect(base.strikeProwess).toBe(8);
    const boosted = firstAutoAttackCombatAt(UNDER_VAULTS, [DRUMS]);
    expect(boosted.strikesTotal).toBe(4);
    expect(boosted.strikeProwess).toBe(10);
  });

  // ─── Rule 3: automatic-attacks in the listed regions +1 strike / +1 prowess ───

  test('an automatic-attack at a High Pass site gets +1 strike and +1 prowess', () => {
    // Goblin-gate: Orcs 3 strikes, 6 prowess → 4 strikes, 7 prowess.
    const combat = firstAutoAttackCombatAt(GOBLIN_GATE, [DRUMS]);
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(7);
  });

  test('an automatic-attack at a Gap of Isen site gets +1 strike and +1 prowess', () => {
    // Isengard: Wolves 3 strikes, 7 prowess → 4 strikes, 8 prowess.
    const combat = firstAutoAttackCombatAt(ISENGARD, [DRUMS]);
    expect(combat.strikesTotal).toBe(4);
    expect(combat.strikeProwess).toBe(8);
  });

  test('an automatic-attack at The Under-galleries ("Ûdun" spelling of Udûn) is boosted', () => {
    // Trolls 4 strikes, 9 prowess → +1 strike, +1 prowess (region) +1 prowess (Under-deeps).
    const combat = firstAutoAttackCombatAt(UNDER_GALLERIES, [DRUMS]);
    expect(combat.strikesTotal).toBe(5);
    expect(combat.strikeProwess).toBe(11);
  });

  test('an automatic-attack at a site outside the listed regions is unaffected', () => {
    // Ettenmoors (Rhudaur): Trolls 1 strike, 9 prowess.
    const combat = firstAutoAttackCombatAt(ETTENMOORS, [DRUMS]);
    expect(combat.strikesTotal).toBe(1);
    expect(combat.strikeProwess).toBe(9);
  });

  test('with Doors of Night in play the region bonus is +2 strikes and +2 prowess', () => {
    // Goblin-gate: 3 strikes, 6 prowess → 5 strikes, 8 prowess (not 6/9 — the +1 is replaced).
    const combat = firstAutoAttackCombatAt(GOBLIN_GATE, [DRUMS, DOORS_OF_NIGHT]);
    expect(combat.strikesTotal).toBe(5);
    expect(combat.strikeProwess).toBe(8);
    // Doors of Night alone does not modify the attack.
    const noDrums = firstAutoAttackCombatAt(GOBLIN_GATE, [DOORS_OF_NIGHT]);
    expect(noDrums.strikesTotal).toBe(3);
    expect(noDrums.strikeProwess).toBe(6);
  });

  test('Doors of Night does not double the Under-deeps prowess bonus', () => {
    // The Under-vaults: +2/+2 (Angmar, Doors of Night) and +1 prowess (Under-deeps) → 5 strikes, 11 prowess.
    const combat = firstAutoAttackCombatAt(UNDER_VAULTS, [DRUMS, DOORS_OF_NIGHT]);
    expect(combat.strikesTotal).toBe(5);
    expect(combat.strikeProwess).toBe(11);
  });

  test('the region bonus applies only to automatic-attacks, not hazard creatures', () => {
    // Orc-patrol against a company moving to Goblin-gate (High Pass): no bonus.
    const combat = setupCreatureCombatAtSites({ site: RIVENDELL, destination: GOBLIN_GATE, creatureDefId: ORC_PATROL, hazardCardsInPlay: [drumsInPlay] }).combat!;
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(6);
  });

  // ─── Rule 4: cannot be duplicated ───

  test('cannot be played while another Drums is in play', () => {
    for (const [inPlay, expected] of [[[], 1], [[drumsInPlay], 0]] as const) {
      const state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
          { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DRUMS], siteDeck: [MINAS_TIRITH], cardsInPlay: [...inPlay] },
        ],
      });
      const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
      const playable = viableActions(ready, PLAYER_2, 'play-hazard')
        .filter(a => a.action.type === 'play-hazard' && a.viable);
      expect(playable).toHaveLength(expected);
    }
  });
});
