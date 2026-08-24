/**
 * @module le-55.test
 *
 * Card test: Khamûl the Ringwraith (le-55)
 * Type: minion-character (ringwraith avatar), alignment ringwraith, unique.
 * Stats: prowess 9, body 9, direct influence 4, mind null.
 * Skills: warrior, ranger, diplomat, sorcery.
 *
 * Card text:
 *   "Unique. Manifestation of Khamûl the Easterling. Can use sorcery. -2 direct
 *    influence in Heralded Lord mode. +1 prowess in Fell Rider mode. -2 to the
 *    body of any Elf character targeted by a strike from Khamûl. As your
 *    Ringwraith, one Ringwraith follower in his company may be controlled with
 *    no influence."
 *
 * Like every named Ringwraith manifestation, Khamûl's per-mode stat change "to
 * your Ringwraith" lives on this avatar card as `stat-modifier` effects gated on
 * `bearer.ringwraithMode` (the mode is established by an in-play mode card —
 * Black Rider le-170 / Fell Rider le-183 / Heralded Lord le-190 — bound to his
 * company; see le-53 Hoarmûrath / le-58 The Witch-king for the reference).
 *
 * The "-2 to the body of any Elf character targeted by a strike from Khamûl"
 * clause is an `enemy-modifier` (`stat: body`, `op: subtract`, `value: 2`) gated
 * on `enemy.race === "elf"`. During a character-vs-character combat, the
 * attacking character's `enemy-modifier` body effects reduce the defending
 * character's body-check target (`resolveEnemyBody`, combat-actions.ts) — the
 * same DSL primitive Ancient Black Axe (as-122) uses for "-1 to strike's body",
 * here intrinsic to the character and race-gated instead of skill-gated.
 *
 * The follower allowance is the `ringwraith-follower-slots` effect (count 1):
 * while Khamûl is the player's revealed Ringwraith, exactly one other Ringwraith
 * avatar card may be played as a Ringwraith follower in his company
 * (CoE 2.II.2.1.R4–R5), entering at a Darkhaven or its own home site and
 * consuming no influence (a Ringwraith follower's mind is null, so `availableDI`
 * deducts nothing). See le-58 The Witch-king (count 2) for the two-slot sibling.
 *
 * Engine Support:
 * | # | Feature                                                       | Status      | Notes                                              |
 * |---|---------------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | -2 direct influence in Heralded Lord mode                     | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode`     |
 * | 2 | +1 prowess in Fell Rider mode                                 | IMPLEMENTED | stat-modifier gated on `bearer.ringwraithMode`     |
 * | 3 | Can use sorcery                                               | DATA        | `sorcery` skill in skills array                    |
 * | 4 | -2 to the body of any Elf character struck by Khamûl          | IMPLEMENTED | enemy-modifier body subtract 2, `enemy.race` elf   |
 * | 5 | One Ringwraith follower controlled with no influence          | IMPLEMENTED | ringwraith-follower-slots count 1                  |
 * | 6 | Manifestation of Khamûl the Easterling (tw-47)                | IMPLEMENTED | `manifestId` chain + on-event discard (rule 3.06)  |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  getCharacter, companyIdAt, addCardInPlay, recomputeDerived,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  viableActions, findCharInstanceId, handCardId, dispatch,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CombatState, GameState } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';

const KHAMUL = 'le-55' as CardDefinitionId;

// Other Ringwraith avatars used as follower candidates.
const DWAR = 'le-52' as CardDefinitionId;   // homesite: Any site in Udûn
const REN = 'le-56' as CardDefinitionId;    // homesite: Any site in Gorgoroth

// Ringwraith mode cards that establish the company's mode.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // Darkhaven (Khamûl's home site)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // Darkhaven (site-deck filler)
const MINAS_TIRITH = 'tw-407' as CardDefinitionId; // hero haven (opponent position)

// Hero CvCC defenders.
const ELROND = 'tw-145' as CardDefinitionId;   // elf, body 9
const ARAGORN = 'tw-120' as CardDefinitionId;  // dunadan (non-elf), body 9

describe('Khamûl the Ringwraith (le-55)', () => {
  beforeEach(() => resetMint());

  // ─── Per-mode stat changes ─────────────────────────────────────────────────

  test('base stats with no mode card: prowess 9, direct influence 4', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const k = getCharacter(state, RESOURCE_PLAYER, KHAMUL);
    expect(k.effectiveStats.prowess).toBe(9);
    expect(k.effectiveStats.directInfluence).toBe(4);
  });

  test('-2 direct influence in Heralded Lord mode, stacking on the mode card\'s company-wide swing', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const k = getCharacter(state, RESOURCE_PLAYER, KHAMUL);
    // Heralded Lord (le-190) itself swings -2 prowess / +3 direct influence
    // across the entire company; his own -2 stacks on top of that.
    expect(k.effectiveStats.directInfluence).toBe(5); // 4 - 2 (his own) + 3 (mode card)
    expect(k.effectiveStats.prowess).toBe(7); // 9 - 2 (mode card); his Fell Rider bonus does not apply
  });

  test('+1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const k = getCharacter(state, RESOURCE_PLAYER, KHAMUL);
    expect(k.effectiveStats.prowess).toBe(10); // 9 + 1
    expect(k.effectiveStats.directInfluence).toBe(4); // Heralded Lord bonus does not apply
  });

  // ─── -2 to the body of any Elf character struck by Khamûl (CvCC) ───────────

  function cvccBase(defenderDefId: CardDefinitionId): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [defenderDefId] }], hand: [], siteDeck: [] },
      ],
    });
  }

  /** Build a CvCC body-check combat where Khamûl (PLAYER_1) strikes `defenderDefId` (PLAYER_2). */
  function cvccBodyCheckCombat(state: GameState, defenderDefId: CardDefinitionId): CombatState {
    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);
    const defenderId = findCharInstanceId(state, HAZARD_PLAYER, defenderDefId);
    return {
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
      companyId: companyIdAt(state, HAZARD_PLAYER),
      defendingPlayerId: state.players[HAZARD_PLAYER].id,
      attackingPlayerId: state.players[RESOURCE_PLAYER].id,
      strikesTotal: 1,
      strikeProwess: 10,
      creatureBody: null,
      creatureRace: undefined,
      strikeAssignments: [
        {
          characterId: defenderId,
          attackingCharacterId: khamulId,
          excessStrikes: 0,
          resolved: true,
          result: 'wounded',
          wasAlreadyWounded: false,
        },
      ],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'character',
      isCvCC: true,
      detainment: false,
    };
  }

  function rollBodyCheck(state: GameState, defenderDefId: CardDefinitionId, roll: number): { after: GameState; eliminated: boolean } {
    const combat = cvccBodyCheckCombat(state, defenderDefId);
    const ready = { ...state, combat, cheatRollTotal: roll };
    const [bodyCheck] = viableActions(ready, PLAYER_1, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    const defenderId = findCharInstanceId(state, HAZARD_PLAYER, defenderDefId);
    // CoE 3.v: a defending character eliminated in CvCC counts as kill MPs for
    // the opposing player, so the card lands in the attacker's kill pile — not
    // in its own player's out-of-play pile.
    const eliminated = after.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === defenderId);
    return { after, eliminated };
  }

  test('Khamûl striking an Elf reduces its body by 2: roll 8 eliminates body-9 Elrond (effective body 7)', () => {
    const { eliminated } = rollBodyCheck(cvccBase(ELROND), ELROND, 8);
    expect(eliminated).toBe(true);
  });

  test('the reduction is exactly -2: roll 7 leaves Elrond alive at effective body 7 (boundary)', () => {
    const { eliminated } = rollBodyCheck(cvccBase(ELROND), ELROND, 7);
    expect(eliminated).toBe(false);
  });

  test('no reduction against a non-Elf: the same roll of 8 leaves body-9 Aragorn (dunadan) alive', () => {
    const { eliminated } = rollBodyCheck(cvccBase(ARAGORN), ARAGORN, 8);
    expect(eliminated).toBe(false);
  });

  // ─── One Ringwraith follower, controlled with no influence ─────────────────

  test('a Ringwraith avatar in hand is playable as a follower of Khamûl at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [DWAR], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const khamulId = findCharInstanceId(state, RESOURCE_PLAYER, KHAMUL);
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    // The only legal way to play a second Ringwraith is as Khamûl's follower —
    // never as a second revealed avatar.
    expect(viable[0].characterInstanceId).toBe(handCardId(state, RESOURCE_PLAYER));
    expect(viable[0].controlledBy).toBe(khamulId);
    expect(viable[0].atSite).toBe(siteId);
  });

  test('playing a Ringwraith follower consumes no general or direct influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL] }], hand: [DWAR], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const [followerPlay] = viablePlayCharacterActions(state, PLAYER_1);
    const after = dispatch(state, followerPlay);

    const khamul = getCharacter(after, RESOURCE_PLAYER, KHAMUL);
    const dwar = getCharacter(after, RESOURCE_PLAYER, DWAR);
    expect(dwar.controlledBy).toBe(khamul.instanceId);
    expect(khamul.followers).toContain(dwar.instanceId);
    // The follower joins Khamûl's company.
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(dwar.instanceId);
    // No influence consumed: GI untouched, and Khamûl's full direct influence (4)
    // remains available because a null-mind follower deducts none.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
    expect(availableDI(after, khamul.instanceId, after.players[RESOURCE_PLAYER])).toBe(4);
  });

  test('only one Ringwraith follower: a second cannot be played when the slot is used', () => {
    // Dwar already follows Khamûl (brought in during an earlier org phase);
    // Ren in hand cannot be played — the single follower slot is full.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [KHAMUL, { defId: DWAR, followerOf: 0 }] }],
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
});
