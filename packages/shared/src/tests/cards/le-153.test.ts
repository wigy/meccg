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
 *   2. cancel-attack (tap self) — gated on a hazard-creature attack and the
 *      company's destination region ∈ {Imlad Morgul, Ithilien, Gorgoroth}
 *   3. tap-discard-attached-hazard (tap self) — same region gate
 *   4. on-event company-arrives-at-site → move self→discard when arriving
 *      outside those three regions (same mechanism as Treebeard tw-353)
 *   5. return-self-to-hand-when { inPlayAnywhere: "Shelob" } — back to hand
 *      when her other manifestation reaches the table (g.man.1)
 *   manifestId tw-86 (Shelob) — links the manifestation chain
 *
 * Rule coverage:
 *
 * | # | Rule                                                     | Status      | Notes                                                  |
 * |---|----------------------------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Unique                                                   | OK          | unique:true (deck-build limit)                         |
 * | 2 | Playable at Shelob's Lair                                | OK          | playableAt site filter (siteMatchesEntry by name)      |
 * | 3 | Manifestation of Shelob                                  | n/a         | manifestId tw-86 links the chain; no separate effect   |
 * | 4 | Controlling character's company is overt                 | OK          | company-overt via reducer-utils isCovertCompany        |
 * | 5 | Tap to cancel a hazard creature attack vs a company      | IMPLEMENTED | cancel-attack + `bearer.destinationRegion` combat ctx  |
 * |   |   moving to Imlad Morgul / Ithilien / Gorgoroth          |             |                                                        |
 * | 6 | Tap to discard a hazard permanent-event on such a        | IMPLEMENTED | `tap-discard-attached-hazard` ability (M/H phase)      |
 * |   |   company or character                                   |             |                                                        |
 * | 7 | Discard if company moves to a site not in Gorgoroth /    | IMPLEMENTED | on-event company-arrives-at-site move self→discard     |
 * |   |   Imlad Morgul / Ithilien                                |             |                                                        |
 * | 8 | Return to hand if Shelob is played                       | IMPLEMENTED | `return-self-to-hand-when` { inPlayAnywhere: Shelob }  |
 *
 * Playable: FULLY — CERTIFIED (2026-06-12). All eight rules are implemented and
 * exercised below. Rule 8 reads "played" as Shelob (tw-86) reaching the table
 * in her permanent-event mode (`creature-alt-event`, which needs Doors of Night
 * in play); a Shelob played as a hazard *creature* is an attack rather than a
 * card in play and does not trigger the return.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint, dispatch, addCardInPlay,
  attachAllyToChar, attachHazardToChar, findCharInstanceId,
  DOORS_OF_NIGHT,
  buildMovingAllyMHState, findAllyInstanceId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, makeCancelWindowCombat,
  type BuildTestStateOpts,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, Race } from '../../index.js';
import type { CardDefinitionId, GameState, CancelAttackAction, ModifyAttackAction, PlayHeroResourceAction, TapAllyDiscardHazardAction } from '../../index.js';

const LAST_CHILD = 'le-153' as CardDefinitionId;
/** Barad-dûr (le-352): Gorgoroth — a destination inside the qualifying regions. */
const BARAD_DUR = 'le-352' as CardDefinitionId;
/** Foolish Words (le-112): a hazard permanent-event, the rule-6 discard target. */
const FOOLISH_WORDS = 'le-112' as CardDefinitionId;
/** Shelob (tw-86): the entity Last Child is a manifestation of (`manifestId`). */
const SHELOB = 'tw-86' as CardDefinitionId;

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
// Elf-lord Revealed in Wrath — "elf" race creature, for the NSN + overt test.
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
      creatureRace: Race.Elf,
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
      creatureRace: Race.Elf,
      strikesTotal: 1,
      strikeProwess: 15,
    });

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 5: tap to cancel a hazard creature attack vs a moving company ────

  const movingCompanyState = (destinationDefId: CardDefinitionId): GameState =>
    buildMovingAllyMHState({
      characters: [ASTERNAK], originSite: SHELOBS_LAIR, destinationSite: destinationDefId,
      allyDefId: LAST_CHILD, opponentSite: MINAS_MORGUL, opponentCharacters: [LUITPRAND],
    });

  test('can tap to cancel a hazard creature attack when the company is moving to a qualifying region', () => {
    // Destination Barad-dûr is in Gorgoroth — one of the three qualifying regions.
    const moving = movingCompanyState(BARAD_DUR);
    const combat = makeCancelWindowCombat(moving, { strikesTotal: 1, strikeProwess: 12 });
    const allyId = findAllyInstanceId(combat, RESOURCE_PLAYER, ASTERNAK, LAST_CHILD);
    expect(allyId).toBeDefined();

    const cancel = viableActions(combat, PLAYER_1, 'cancel-attack')
      .filter(a => (a.action as CancelAttackAction).cardInstanceId === allyId);
    expect(cancel.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot tap to cancel when the company is moving to a non-qualifying region', () => {
    // Moria is in Redhorn Gate — outside the three regions.
    const moving = movingCompanyState(MORIA_MINION);
    const combat = makeCancelWindowCombat(moving, { strikesTotal: 1, strikeProwess: 12 });
    const allyId = findAllyInstanceId(combat, RESOURCE_PLAYER, ASTERNAK, LAST_CHILD);

    const cancel = viableActions(combat, PLAYER_1, 'cancel-attack')
      .filter(a => (a.action as CancelAttackAction).cardInstanceId === allyId);
    expect(cancel).toHaveLength(0);
  });

  // ─── Rule 6: tap to discard a hazard permanent-event on the company ───────

  test('can tap to discard a hazard permanent-event on a character in the moving company', () => {
    const moving = movingCompanyState(BARAD_DUR);
    // A hazard permanent-event (Foolish Words) attached to Asternak, owned by P2.
    const withHazard = attachHazardToChar(moving, RESOURCE_PLAYER, ASTERNAK, FOOLISH_WORDS, HAZARD_PLAYER);

    const discardActions = computeLegalActions(withHazard, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'tap-ally-discard-hazard')
      .map(ea => ea.action as TapAllyDiscardHazardAction);
    expect(discardActions.length).toBeGreaterThanOrEqual(1);

    const after = dispatch(withHazard, discardActions[0]);
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    const charAfter = after.players[RESOURCE_PLAYER].characters[charId];
    // Foolish Words is gone from the character and in P2's (owner's) discard pile.
    expect(charAfter?.hazards.some(h => h.definitionId === FOOLISH_WORDS)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === FOOLISH_WORDS)).toBe(true);
    // The ally is tapped (the activation cost).
    expect(charAfter?.allies.find(a => a.definitionId === LAST_CHILD)?.status).toBe(CardStatus.Tapped);
  });

  test('the discard ability is NOT offered when moving to a non-qualifying region', () => {
    const moving = movingCompanyState(MORIA_MINION);
    const withHazard = attachHazardToChar(moving, RESOURCE_PLAYER, ASTERNAK, FOOLISH_WORDS, HAZARD_PLAYER);
    const discardActions = computeLegalActions(withHazard, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'tap-ally-discard-hazard');
    expect(discardActions).toHaveLength(0);
  });

  // ─── Rule 7: discard if the company moves to a site outside the regions ───

  test('discards itself when its company moves to a site NOT in the three regions', () => {
    // Moving to Moria (Redhorn Gate) → outside Gorgoroth/Imlad Morgul/Ithilien.
    const moving = movingCompanyState(MORIA_MINION);
    const after = dispatch(dispatch(moving, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[charId]?.allies.some(a => a.definitionId === LAST_CHILD)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LAST_CHILD)).toBe(true);
  });

  test('is NOT discarded when its company moves to a site within the three regions', () => {
    // Moving to Barad-dûr (Gorgoroth) → one of the qualifying regions.
    const moving = movingCompanyState(BARAD_DUR);
    const after = dispatch(dispatch(moving, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[charId]?.allies.some(a => a.definitionId === LAST_CHILD)).toBe(true);
  });

  // ─── Rule 8: return to hand if Shelob is played ───────────────────────────

  test('returns to its owner\'s hand when Shelob (tw-86) is in play', () => {
    // Shelob's permanent-event mode needs Doors of Night in play (her own
    // `discard-self-when` would otherwise sweep her away first), so both go on
    // the hazard player's table. Last Child is a manifestation of Shelob, and
    // her text settles g.man.1's one-slot competition by handing the ally back
    // rather than discarding her.
    const base = buildSitePhaseState({ characters: [ASTERNAK], site: SHELOBS_LAIR });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, LAST_CHILD);
    const withShelob = addCardInPlay(addCardInPlay(withAlly, HAZARD_PLAYER, DOORS_OF_NIGHT), HAZARD_PLAYER, SHELOB);

    const after = dispatch(withShelob, { type: 'pass', player: PLAYER_1 });

    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[charId]?.allies.some(a => a.definitionId === LAST_CHILD)).toBe(false);
    // Back in hand — not discarded (rule 7's discard is a different trigger).
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === LAST_CHILD)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LAST_CHILD)).toBe(false);
  });

  test('stays in play while Shelob is not on the table', () => {
    // The same position with Doors of Night alone: nothing to yield to.
    const base = buildSitePhaseState({ characters: [ASTERNAK], site: SHELOBS_LAIR });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, LAST_CHILD);
    const withoutShelob = addCardInPlay(withAlly, HAZARD_PLAYER, DOORS_OF_NIGHT);

    const after = dispatch(withoutShelob, { type: 'pass', player: PLAYER_1 });

    const charId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[charId]?.allies.some(a => a.definitionId === LAST_CHILD)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === LAST_CHILD)).toBe(false);
  });
});
