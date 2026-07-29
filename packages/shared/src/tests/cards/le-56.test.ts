/**
 * @module le-56.test
 *
 * Card test: Ren the Ringwraith (le-56)
 * Type: minion-character (ringwraith avatar), alignment ringwraith.
 * Stats: prowess 8, body 10, direct influence 4, mind null. Unique.
 * Skills: sage, diplomat, sorcery, shadow-magic. Homesite: any site in
 * Gorgoroth. Manifestation of Ren the Unclean.
 *
 * Card text (authoritative — CoE cards database):
 *   "Unique. Manifestation of Ren the Unclean. Can use sorcery and
 *    shadow-magic. -2 direct influence in Heralded Lord mode. +2 prowess in
 *    Fell Rider mode. As your Ringwraith, if at a Darkhaven, he may tap during
 *    your organization phase to modify all corruption checks made this turn by
 *    minions in any one of your companies by +2."
 *
 * (The remaster card data previously stored an older/erroneous variant —
 * "by your characters by -1 or +1"; corrected to match the authoritative
 * database, whose text and mechanics are the source of truth.)
 *
 * Engine support:
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | -2 direct influence in Heralded Lord mode                   | IMPLEMENTED | stat-modifier gated on bearer.ringwraithMode |
 * | 2 | +2 prowess in Fell Rider mode                               | IMPLEMENTED | stat-modifier gated on bearer.ringwraithMode |
 * | 3 | Org-phase tap → +2 to one company's minions' corruption     | IMPLEMENTED | grant-action modify-company-corruption-checks; add-constraint check-modifier +2, target action-target-company, scope turn |
 * | 4 | "if at a Darkhaven"                                          | IMPLEMENTED | when bearer.atDarkhaven (minion-aligned haven) |
 * | 5 | "As your Ringwraith" — only the revealed avatar             | IMPLEMENTED | when bearer.isRevealedAvatar |
 * | 6 | Tap cost (untapped bearer)                                   | IMPLEMENTED | cost tap: bearer |
 * | 7 | "any one of your companies" — one activation per company    | IMPLEMENTED | targets scope player-companies |
 * | 8 | Applies to every corruption check by minions in that company| IMPLEMENTED | company-scoped check-modifier collected in pending + Free Council corruption resolvers, not consumed |
 * | 9 | Unique / can use sorcery & shadow-magic                      | DATA        | unique flag + skills array |
 * |10 | Manifestation of Ren the Unclean (tw-83)                     | IMPLEMENTED | `manifestId` chain + on-event self-enters-play discard (rule 3.06) |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch,
  getCharacter, findCharInstanceId, companyIdAt, addCardInPlay, recomputeDerived,
  enqueueCorruptionCheck,
  CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInstanceId, FreeCouncilPhaseState, GameState,
} from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';

const REN = 'le-56' as CardDefinitionId;
const KHAMUL = 'le-55' as CardDefinitionId;       // a second Ringwraith avatar

// Ringwraith mode cards.
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;

// Non-avatar minion characters (cardType minion-character).
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // no inherent corruption modifier
const ORC_SNIFFLER = 'le-33' as CardDefinitionId;  // no inherent corruption modifier

// Minion Darkhavens (siteType haven, alignment ringwraith).
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Minion non-haven site (shadow-hold).
const MORIA = 'le-392' as CardDefinitionId;
// A hero Haven (siteType haven but NOT a Darkhaven — alignment wizard).
const RIVENDELL = 'tw-421' as CardDefinitionId;

// Hero sites so the opposing player has a legal position.
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
const TW_RIVENDELL = 'tw-404' as CardDefinitionId;

const ACTION_ID = 'modify-company-corruption-checks';

/** Grant activations for Ren's corruption-modifier ability. */
function renGrants(state: GameState): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === ACTION_ID);
}

describe('Ren the Ringwraith (le-56)', () => {
  beforeEach(() => resetMint());

  // ── Per-mode stat changes ───────────────────────────────────────────────

  test('-2 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [REN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyIdAt(state, RESOURCE_PLAYER)));
    const ren = getCharacter(state, RESOURCE_PLAYER, REN);
    expect(ren.effectiveStats.directInfluence).toBe(2); // 4 - 2
    expect(ren.effectiveStats.prowess).toBe(8);          // Fell Rider bonus does not apply
  });

  test('+2 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [REN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    state = recomputeDerived(addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyIdAt(state, RESOURCE_PLAYER)));
    const ren = getCharacter(state, RESOURCE_PLAYER, REN);
    expect(ren.effectiveStats.prowess).toBe(10);           // 8 + 2
    expect(ren.effectiveStats.directInfluence).toBe(4);    // Heralded Lord penalty does not apply
  });

  // ── The corruption-check ability: availability gates ─────────────────────

  test('offered at a Darkhaven during organization — one activation per company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [REN] },
            { site: MINAS_MORGUL, characters: [ORC_CAPTAIN] },
          ],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });

    const grants = renGrants(state);
    expect(grants.length).toBe(2); // one per company
    const targeted = new Set(grants.map(g => g.targetCompanyId as string));
    expect(targeted.has(companyIdAt(state, RESOURCE_PLAYER, 0) as string)).toBe(true);
    expect(targeted.has(companyIdAt(state, RESOURCE_PLAYER, 1) as string)).toBe(true);
    // Ren is always the tapping source.
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN);
    expect(grants.every(g => g.characterId === renId)).toBe(true);
  });

  test('NOT offered at a minion non-haven site (Moria is not a Darkhaven)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [REN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    expect(renGrants(state).length).toBe(0);
  });

  test('NOT offered at a hero Haven (a Haven, but not a Darkhaven)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: RIVENDELL, characters: [REN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    expect(renGrants(state).length).toBe(0);
  });

  test('NOT offered when Ren is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [{ defId: REN, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    expect(renGrants(state).length).toBe(0);
  });

  test('NOT offered when Ren is a Ringwraith follower (not the revealed avatar)', () => {
    // Khamûl is the revealed avatar; Ren rides as his follower.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [KHAMUL, { defId: REN, followerOf: 0 }] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    // Sanity: Ren really is a follower (not general-controlled).
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN);
    expect(state.players[RESOURCE_PLAYER].characters[renId].controlledBy).not.toBe('general');
    expect(renGrants(state).length).toBe(0);
  });

  test('NOT offered for the opposing (hazard) player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [REN] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    expect(renGrants(state).length).toBe(0);
  });

  // ── Activation + effect on corruption checks ─────────────────────────────

  test('activating taps Ren and adds a +2 company-scoped corruption check-modifier', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [REN] },
            { site: MINAS_MORGUL, characters: [ORC_CAPTAIN] },
          ],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN);
    const company1Id = companyIdAt(state, RESOURCE_PLAYER, 1);

    // Target company 1 (the Orc Captain's company) — isolates the +2 from the
    // rule-10.05 "+2 for sharing a company with a Ringwraith" (Ren is elsewhere).
    const grant = renGrants(state).find(g => g.targetCompanyId === company1Id)!;
    const after = dispatch(state, grant);

    expect(getCharacter(after, RESOURCE_PLAYER, REN).status).toBe(CardStatus.Tapped);
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'check-modifier'
      && c.kind.check === 'corruption'
      && c.kind.value === 2
      && c.target.kind === 'company'
      && c.target.companyId === company1Id)).toBe(true);
    // Ren still in play (only tapped, not consumed).
    expect(after.players[RESOURCE_PLAYER].characters[renId]).toBeDefined();
  });

  test('the +2 applies to a corruption check by a minion in the targeted company, and not to another company', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [REN] },
            { site: MINAS_MORGUL, characters: [ORC_CAPTAIN] },
            { site: MORIA, characters: [ORC_SNIFFLER] },
          ],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const brawlerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_SNIFFLER);
    const company1Id = companyIdAt(state, RESOURCE_PLAYER, 1);

    // Baseline: before activation, a check by the Orc Captain has no modifier
    // (no Ringwraith in his company → no rule-10.05 boost either).
    {
      const s = enqueueCorruptionCheck(state, PLAYER_1, captainId);
      const roll = viableActions(s, PLAYER_1, 'corruption-check')
        .map(ea => ea.action as CorruptionCheckAction)
        .find(a => a.characterId === captainId)!;
      expect(roll.corruptionModifier).toBe(0);
    }

    // Activate targeting the Orc Captain's company.
    const grant = renGrants(state).find(g => g.targetCompanyId === company1Id)!;
    state = dispatch(state, grant);

    // The Orc Captain's corruption check now carries +2.
    {
      const s = enqueueCorruptionCheck(state, PLAYER_1, captainId);
      const roll = viableActions(s, PLAYER_1, 'corruption-check')
        .map(ea => ea.action as CorruptionCheckAction)
        .find(a => a.characterId === captainId)!;
      expect(roll.corruptionModifier).toBe(2);
    }

    // A minion in a DIFFERENT (untargeted) company gets no modifier.
    {
      const s = enqueueCorruptionCheck(state, PLAYER_1, brawlerId);
      const roll = viableActions(s, PLAYER_1, 'corruption-check')
        .map(ea => ea.action as CorruptionCheckAction)
        .find(a => a.characterId === brawlerId)!;
      expect(roll.corruptionModifier).toBe(0);
    }
  });

  test('the +2 persists for the turn (not consumed by one check)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [REN] },
            { site: MINAS_MORGUL, characters: [ORC_CAPTAIN, ORC_SNIFFLER] },
          ],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });
    const captainId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_CAPTAIN);
    const brawlerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_SNIFFLER);
    const company1Id = companyIdAt(state, RESOURCE_PLAYER, 1);

    const grant = renGrants(state).find(g => g.targetCompanyId === company1Id)!;
    state = dispatch(state, grant);

    // Resolve the Orc Captain's check (cheat a passing roll) — the company-scoped
    // constraint must survive for the Orc Brawler's later check in the same company.
    let s: GameState = enqueueCorruptionCheck(state, PLAYER_1, captainId);
    const captainRoll = viableActions(s, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === captainId)!;
    expect(captainRoll.corruptionModifier).toBe(2);
    s = dispatch({ ...s, cheatRollTotal: 12 }, captainRoll);

    // Constraint still present; the Orc Brawler's check also gets +2.
    expect(s.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.target.kind === 'company' && c.target.companyId === company1Id)).toBe(true);
    s = enqueueCorruptionCheck(s, PLAYER_1, brawlerId);
    const brawlerRoll = viableActions(s, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === brawlerId)!;
    expect(brawlerRoll.corruptionModifier).toBe(2);
  });

  // ── The +2 in the Free Council end-of-turn corruption window ──────────────

  test('the +2 lets a Free Council corruption check by a targeted minion survive', () => {
    // Orc Captain has 8 CP; a roll of 6 fails without help, but +2 → 8 ≥ CP
    // taps-and-succeeds for a minion (CoE 7.1). Compare with/without the boost.
    const makeFc = (captainId: CardInstanceId): FreeCouncilPhaseState => ({
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: {
        characterId: captainId,
        corruptionPoints: 8,
        corruptionModifier: 0,
        possessions: [],
        need: 9,
        explanation: 'test',
        supportCount: 0,
      },
    });

    // Built in Organization phase so Ren's org-phase ability can be activated;
    // the caller then overrides phaseState with the Free Council window.
    const build = () => buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [
            { site: DOL_GULDUR, characters: [REN] },
            { site: MINAS_MORGUL, characters: [ORC_CAPTAIN] },
          ],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [TW_RIVENDELL] },
      ],
    });

    // Control: no boost — roll 6 vs CP 8 → far below, minion is eliminated.
    {
      const s = build();
      const captainId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CAPTAIN);
      const withFc: GameState = { ...s, phaseState: makeFc(captainId), cheatRollTotal: 6 };
      const after = dispatch(withFc, { type: 'pass', player: PLAYER_1 });
      expect(after.players[RESOURCE_PLAYER].characters[captainId]).toBeUndefined();
    }

    // With Ren's +2 targeting the Captain's company — roll 6 + 2 = 8; a minion
    // taps and succeeds on CP or CP-1 (8 within 1 of 8), so it survives.
    {
      let s = build();
      const captainId = findCharInstanceId(s, RESOURCE_PLAYER, ORC_CAPTAIN);
      const company1Id = companyIdAt(s, RESOURCE_PLAYER, 1);
      const grant = renGrants(s).find(g => g.targetCompanyId === company1Id)!;
      s = dispatch(s, grant);
      s = { ...s, phaseState: makeFc(captainId), cheatRollTotal: 6 };
      const after = dispatch(s, { type: 'pass', player: PLAYER_1 });
      expect(after.players[RESOURCE_PLAYER].characters[captainId]).toBeDefined();
    }
  });
});
