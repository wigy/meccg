/**
 * @module le-58.test
 *
 * Card test: The Witch-king (le-58)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 9, body 12, direct influence 3, mind null.
 *
 * Card text:
 *   "Unique. Manifestation of The Witch-king of Angmar. Can use spirit-magic
 *    and shadow-magic. +3 direct influence in Heralded Lord mode. +1 prowess in
 *    Fell Rider mode. As your Ringwraith, up to two Ringwraith followers in his
 *    company may be controlled with no influence. You may bring these followers
 *    into play during separate organization phases."
 *
 * Like every named Ringwraith manifestation, the Witch-king's per-mode stat
 * change "to your Ringwraith" lives on this avatar card as `stat-modifier`
 * effects gated on `bearer.ringwraithMode` (the mode is established by an
 * in-play mode card — Black Rider le-170 / Fell Rider le-183 / Heralded Lord
 * le-190 — bound to his company; see le-53 Hoarmûrath for the reference).
 *
 * The follower allowance is the `ringwraith-follower-slots` effect: while the
 * Witch-king is the player's revealed Ringwraith, up to two other Ringwraith
 * avatar cards may be played as Ringwraith followers in his company
 * (CoE 2.II.2.1.R4–R5), each entering at a Darkhaven or its own home site and
 * consuming no influence (a Ringwraith follower's mind is null, so
 * `availableDI` deducts nothing). The "separate organization phases" clause is
 * enforced by the one-character-per-turn organization rule.
 *
 * Engine Support:
 * | # | Feature                                                       | Status      | Notes                                              |
 * |---|---------------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | +3 direct influence in Heralded Lord mode                     | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode`     |
 * | 2 | +1 prowess in Fell Rider mode                                 | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode`     |
 * | 3 | Can use spirit-magic / shadow-magic                           | FLAVOR      | Ringwraiths use shadow-magic by race; same N/A     |
 * |   |                                                               |             | treatment as le-53's "Can use sorcery"             |
 * | 4 | Up to two Ringwraith followers, controlled with no influence  | IMPLEMENTED | ringwraith-follower-slots (legal-actions emitter   |
 * |   |                                                               |             | `ringwraithFollowerPlayAction`)                    |
 * | 5 | Followers brought into play during separate org phases        | IMPLEMENTED | one-character-per-turn organization rule           |
 * | 6 | Manifestation of Witch-king of Angmar (tw-113)                | IMPLEMENTED | `manifestId` chain + on-event discard (rule 3.06)  |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  findCharInstanceId, handCardId, dispatch,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const THE_WITCH_KING = 'le-58' as CardDefinitionId;

// Other Ringwraith avatars used as follower candidates.
const DWAR = 'le-52' as CardDefinitionId;       // homesite: Any site in Udûn
const KHAMUL = 'le-55' as CardDefinitionId;     // homesite: Dol Guldur
const REN = 'le-56' as CardDefinitionId;        // homesite: Any site in Gorgoroth

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Darkhavens (siteType: haven, ringwraith alignment).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Minion shadow-hold in Gorgoroth (Ren's home region, not a Darkhaven).
const MOUNT_DOOM_MINION = 'le-393' as CardDefinitionId;
// Hero site so the opposing player has a legal position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

describe('The Witch-king (le-58)', () => {
  beforeEach(() => resetMint());

  // ─── Per-mode stat changes ─────────────────────────────────────────────────

  test('base stats with no mode card: prowess 9, direct influence 3', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.prowess).toBe(9);
    expect(wk.effectiveStats.directInfluence).toBe(3);
  });

  test('+3 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.directInfluence).toBe(6); // 3 + 3
    expect(wk.effectiveStats.prowess).toBe(9); // Fell Rider bonus does not apply
  });

  test('+1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.prowess).toBe(10); // 9 + 1
    expect(wk.effectiveStats.directInfluence).toBe(3); // Heralded Lord bonus does not apply
  });

  // ─── Ringwraith followers: up to two, controlled with no influence ─────────

  test('a Ringwraith avatar in hand is playable as a follower of the Witch-king at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [KHAMUL], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wkId = findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING);
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    // The only legal way to play a second Ringwraith is as the Witch-king's
    // follower in his company — never as a second revealed avatar.
    expect(viable[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
    expect(viable[0].controlledBy).toBe(wkId);
    expect(viable[0].atSite).toBe(siteId);
  });

  test('playing a Ringwraith follower consumes no general or direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [KHAMUL], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const [followerPlay] = viablePlayCharacterActions(state, PLAYER_1);
    const after = dispatch(state, followerPlay);

    const wk = getCharacter(after, RESOURCE_PLAYER, THE_WITCH_KING);
    const khamul = getCharacter(after, RESOURCE_PLAYER, KHAMUL);
    expect(khamul.controlledBy).toBe(wk.instanceId);
    expect(wk.followers).toContain(khamul.instanceId);
    // The follower joins the Witch-king's company.
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(khamul.instanceId);
    // No influence consumed: GI untouched, and the Witch-king's full direct
    // influence (3) remains available because a null-mind follower deducts none.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
    expect(availableDI(after, wk.instanceId, after.players[RESOURCE_PLAYER])).toBe(3);
  });

  test('a second Ringwraith cannot be played when the revealed avatar has no follower ability', () => {
    // Dwar is the revealed avatar — he has no ringwraith-follower-slots
    // effect, so a different Ringwraith in hand cannot be played at all
    // (rule 2.II.2.1.1: no second avatar reveal).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DWAR] }], hand: [REN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
  });

  test('the two followers must enter play during separate organization phases', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING] }], hand: [KHAMUL, DWAR], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // First follower (Khamûl) enters play this organization phase.
    const khamulHandId = handCardId(state, RESOURCE_PLAYER, 0);
    const viable = viablePlayCharacterActions(state, PLAYER_1);
    const khamulPlay = viable.find(a => a.characterInstanceId === khamulHandId)!;
    expect(khamulPlay).toBeDefined();
    const after = dispatch(state, khamulPlay);

    // The second follower (Dwar) cannot enter play in the same phase.
    expect(viablePlayCharacterActions(after, PLAYER_1)).toHaveLength(0);
  });

  test('a second follower may enter play in a later organization phase', () => {
    // Khamûl is already in play as the Witch-king's follower (brought in
    // during an earlier organization phase); Dwar may now be played too.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: KHAMUL, followerOf: 0 }] }],
          hand: [DWAR],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wkId = findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING);

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].controlledBy).toBe(wkId);
  });

  test('no more than two Ringwraith followers may be controlled', () => {
    // Both follower slots are used (Khamûl and Dwar follow the Witch-king);
    // a third Ringwraith in hand is not playable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: DOL_GULDUR,
            characters: [THE_WITCH_KING, { defId: KHAMUL, followerOf: 0 }, { defId: DWAR, followerOf: 0 }],
          }],
          hand: [REN],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    const blocked = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
  });

  test('a follower cannot enter play when the Witch-king is at neither a Darkhaven nor the follower\'s home site', () => {
    // The Witch-king's company is at Mount Doom (shadow-hold in Gorgoroth).
    // Khamûl's home site is Dol Guldur, so he may not enter play here
    // (CoE 2.II.2.1.R4).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_DOOM_MINION, characters: [THE_WITCH_KING] }], hand: [KHAMUL], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1)).toHaveLength(1);
  });

  test('a follower may enter play at its own home site (region-form home site)', () => {
    // Ren's home site is "Any site in Gorgoroth"; Mount Doom lies in
    // Gorgoroth, so Ren may join the Witch-king's company there even though
    // it is not a Darkhaven (CoE 2.II.2.1.R4).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_DOOM_MINION, characters: [THE_WITCH_KING] }], hand: [REN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const wkId = findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING);

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].controlledBy).toBe(wkId);
  });

  test('a Ringwraith follower in play does not count as the player\'s avatar', () => {
    // With Khamûl in play as a follower, the Witch-king remains the player's
    // revealed Ringwraith: his per-mode bonuses still apply through the
    // company's bound mode card.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [THE_WITCH_KING, { defId: KHAMUL, followerOf: 0 }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const wk = getCharacter(state, RESOURCE_PLAYER, THE_WITCH_KING);
    expect(wk.effectiveStats.directInfluence).toBe(6); // 3 + 3, still the revealed avatar
  });
});
