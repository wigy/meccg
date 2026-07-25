/**
 * @module dm-166.test
 *
 * Card test: Aiglos (dm-166)
 * Type: hero-resource-item (Special Item), alignment wizard, unique, weapon.
 * Marshalling points: 5 · Corruption: 3.
 *
 * Text: "Unique. Playable at any Under-deeps Dark-hold [{D}] or Shadow-hold
 * [{S}]. Weapon. Warrior only: +2 prowess (+5 if Doors of Night is in play)
 * (to a maximum of 11); +1 body (to a maximum of 10); -2 to target's body;
 * +3 direct influence against Elves and Elf factions."
 *
 * Effects:
 * | # | Effect Type                          | Status | Notes                                                        |
 * |---|---------------------------------------|--------|---------------------------------------------------------------|
 * | 1 | item-play-site (filter)               | OK     | under-deeps keyword AND siteType dark-hold OR shadow-hold      |
 * | 2 | stat-modifier prowess +2, max 11 (id) | OK     | warrior only                                                   |
 * | 3 | stat-modifier prowess +5 (overrides)  | OK     | warrior only + Doors of Night in play, same max 11             |
 * | 4 | stat-modifier body +1, max 10         | OK     | warrior only                                                   |
 * | 5 | enemy-modifier body subtract 2        | OK     | warrior only; creature body checks and CvCC defender body      |
 * | 6 | stat-modifier direct-influence +3     | OK     | warrior only; influence-check target.race elf OR               |
 * |   |                                       |        | faction-influence-check faction.race elf                       |
 *
 * Playable: YES.
 *
 * The structural `prowessModifier: 2` / `bodyModifier: 1` fields mirror the
 * printed attribute line but are suppressed by the engine because the card
 * declares `stat-modifier` DSL effects (which correctly gate on the Warrior
 * skill; the structural fields cannot).
 *
 * Fixtures are hero-aligned per project convention (Aiglos is a hero item):
 * Aragorn II (warrior, prowess 6, body 9, DI 3), Glorfindel II (warrior,
 * prowess 8 — proves the prowess cap of 11 clamps under Doors of Night),
 * Frodo (non-warrior control). The DM set provides hero Under-deeps sites
 * (The Under-galleries dark-hold, The Under-leas shadow-hold, The
 * Under-grottos ruins-and-lairs).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, Alignment, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActions, executeAction, attachItemToChar, addP2CardsInPlay,
  findCharInstanceId, findHandCardId, findInPile, companyIdAt,
  getCharacter, recomputeDerived, makeBodyCheckCombat, makeMHState,
  ARAGORN, FRODO, GLORFINDEL_II, LEGOLAS, GIMLI, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, THRANDUILS_HALLS, BREE,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  InfluenceAttemptAction, PlayCharacterAction,
} from '../../index.js';

const AIGLOS = 'dm-166' as CardDefinitionId;

// Hero Under-deeps sites (DM set).
const UNDER_GALLERIES = 'dm-37' as CardDefinitionId;  // dark-hold, under-deeps — valid
const UNDER_LEAS = 'dm-40' as CardDefinitionId;       // shadow-hold, under-deeps — valid
const UNDER_GROTTOS = 'dm-39' as CardDefinitionId;    // ruins-and-lairs, under-deeps — wrong site type
// MORIA (tw-413) is a shadow-hold that is NOT Under-deeps — wrong keyword.

// Minion opponent character for CvCC: body 7, no printed discardBodyCheck
// values (minion Orcs/Trolls like le-31 are *discarded* on specific rolls,
// which would mask the elimination-vs-survival distinction under test).
const LUITPRAND = 'le-23' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

// Hazard creature token for the creature body-check test.
const ORC_GUARD = 'tw-072' as CardDefinitionId;

// Elf faction (influence # 9, no standard modification for a Dúnadan
// influencer) and a Dúnadan faction control (influence # 10, Dúnedain +1).
const WOOD_ELVES = 'tw-367' as CardDefinitionId;
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId;

const DON_IN_PLAY: CardInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

describe('Aiglos (dm-166)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site — Under-deeps Dark-hold or Shadow-hold ──────

  test('playable at an Under-deeps Dark-hold (The Under-galleries)', () => {
    const state = buildSitePhaseState({
      site: UNDER_GALLERIES,
      characters: [ARAGORN],
      hand: [AIGLOS],
    });
    const aiglosId = findHandCardId(state, RESOURCE_PLAYER, AIGLOS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (aiglosId as string),
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildSitePhaseState({
      site: UNDER_LEAS,
      characters: [ARAGORN],
      hand: [AIGLOS],
    });
    const aiglosId = findHandCardId(state, RESOURCE_PLAYER, AIGLOS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (aiglosId as string),
    );
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable at a Shadow-hold that is not Under-deeps (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [AIGLOS],
    });
    const aiglosId = findHandCardId(state, RESOURCE_PLAYER, AIGLOS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (aiglosId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at an Under-deeps site that is neither hold type (The Under-grottos)', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [AIGLOS],
    });
    const aiglosId = findHandCardId(state, RESOURCE_PLAYER, AIGLOS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (aiglosId as string),
    );
    expect(plays).toHaveLength(0);
  });

  // ── Effects 2+3: warrior-only +2 prowess, +5 with Doors of Night, max 11 ──

  test('warrior bearer gains +2 prowess without Doors of Night', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(8); // base 6 + 2
  });

  test('warrior bearer gains +5 prowess with Doors of Night in play (6 + 5 = the maximum of 11)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [DON_IN_PLAY] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(11); // base 6 + 5
  });

  test('prowess is clamped at 11: Glorfindel II (base 8) with Doors of Night gets 11, not 13', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GLORFINDEL_II] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [DON_IN_PLAY] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GLORFINDEL_II, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, GLORFINDEL_II).effectiveStats.prowess).toBe(11);
  });

  test('non-warrior bearer gains no prowess even with Doors of Night in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [DON_IN_PLAY] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(1); // unchanged
  });

  // ── Effect 4: warrior-only +1 body (max 10) ───────────────────────────────

  test('warrior bearer gains +1 body, landing exactly on the maximum of 10 (Aragorn base 9)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.body).toBe(10); // base 9 + 1
  });

  test('non-warrior bearer gains no body bonus', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, AIGLOS));
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(9); // unchanged
  });

  // ── Effect 5: warrior-only -2 to target's body ────────────────────────────
  //
  // Creature combat: the bearer defeats a strike, the resulting body check
  // against the creature uses its body reduced by 2 (elimination when the
  // roll exceeds body).

  test("creature body check: with Aiglos a roll of 8 defeats a body-8 creature (effective body 6)", () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, AIGLOS);
    const creatureId = 'orc-guard-1' as CardInstanceId;
    state = addP2CardsInPlay(state, [{ instanceId: creatureId, definitionId: ORC_GUARD, status: CardStatus.Untapped }]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const combat = makeBodyCheckCombat({
      companyId: companyIdAt(state, RESOURCE_PLAYER),
      characterId: aragornId,
      attackingPlayerId: PLAYER_2,
      defendingPlayerId: PLAYER_1,
      bodyCheckTarget: 'creature',
      result: 'success', // Aragorn parried this strike
      creatureBody: 8,
      creatureRace: 'orc',
      attackSource: { type: 'creature', instanceId: creatureId },
    });
    // Roll 8 > effective body 6 (8 - 2) → creature defeated, kill MP awarded.
    const after = executeAction({ ...state, phaseState: makeMHState(), combat }, PLAYER_2, 'body-check-roll', 8);
    expect(findInPile(after, RESOURCE_PLAYER, 'killPile', creatureId)).toBeDefined();
  });

  test('creature body check: without Aiglos the same roll of 8 leaves the body-8 creature undefeated (control)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const creatureId = 'orc-guard-1' as CardInstanceId;
    state = addP2CardsInPlay(state, [{ instanceId: creatureId, definitionId: ORC_GUARD, status: CardStatus.Untapped }]);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const combat = makeBodyCheckCombat({
      companyId: companyIdAt(state, RESOURCE_PLAYER),
      characterId: aragornId,
      attackingPlayerId: PLAYER_2,
      defendingPlayerId: PLAYER_1,
      bodyCheckTarget: 'creature',
      result: 'success',
      creatureBody: 8,
      creatureRace: 'orc',
      attackSource: { type: 'creature', instanceId: creatureId },
    });
    // Roll 8 = body 8 → not > body → creature survives, discarded.
    const after = executeAction({ ...state, phaseState: makeMHState(), combat }, PLAYER_2, 'body-check-roll', 8);
    expect(findInPile(after, RESOURCE_PLAYER, 'killPile', creatureId)).toBeUndefined();
    expect(findInPile(after, HAZARD_PLAYER, 'discardPile', creatureId)).toBeDefined();
  });

  test('CvCC: with Aiglos on a warrior attacker, a roll of 7 eliminates a body-7 defender (effective body 5)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, AIGLOS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const luitprandId = findCharInstanceId(state, HAZARD_PLAYER, LUITPRAND);
    const combat = makeBodyCheckCombat({
      companyId: companyIdAt(state, HAZARD_PLAYER),
      characterId: luitprandId,
      attackingPlayerId: PLAYER_1,
      defendingPlayerId: PLAYER_2,
      bodyCheckTarget: 'character',
      isCvCC: true,
      attackingCharacterId: aragornId,
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
    });
    // Luitprand body 7 - 2 = 5; roll 7 > 5 → eliminated.
    const after = executeAction({ ...state, combat }, PLAYER_1, 'body-check-roll', 7);
    expect(after.players[HAZARD_PLAYER].characters[luitprandId]).toBeUndefined();
  });

  test('CvCC: without Aiglos the same roll of 7 leaves the body-7 defender in play (control)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const luitprandId = findCharInstanceId(state, HAZARD_PLAYER, LUITPRAND);
    const combat = makeBodyCheckCombat({
      companyId: companyIdAt(state, HAZARD_PLAYER),
      characterId: luitprandId,
      attackingPlayerId: PLAYER_1,
      defendingPlayerId: PLAYER_2,
      bodyCheckTarget: 'character',
      isCvCC: true,
      attackingCharacterId: aragornId,
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
    });
    // Roll 7 = body 7 → not > body → wounded but not eliminated.
    const after = executeAction({ ...state, combat }, PLAYER_1, 'body-check-roll', 7);
    expect(after.players[HAZARD_PLAYER].characters[luitprandId]).toBeDefined();
  });

  test('CvCC: with Aiglos on a NON-warrior attacker, no body reduction (control)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, FRODO, AIGLOS);
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const luitprandId = findCharInstanceId(state, HAZARD_PLAYER, LUITPRAND);
    const combat = makeBodyCheckCombat({
      companyId: companyIdAt(state, HAZARD_PLAYER),
      characterId: luitprandId,
      attackingPlayerId: PLAYER_1,
      defendingPlayerId: PLAYER_2,
      bodyCheckTarget: 'character',
      isCvCC: true,
      attackingCharacterId: frodoId,
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(state, RESOURCE_PLAYER) },
    });
    // No warrior → body stays 7; roll 7 does not eliminate.
    const after = executeAction({ ...state, combat }, PLAYER_1, 'body-check-roll', 7);
    expect(after.players[HAZARD_PLAYER].characters[luitprandId]).toBeDefined();
  });

  // ── Effect 6: warrior-only +3 direct influence vs Elves and Elf factions ──

  test('+3 DI applies to a faction-influence attempt on an Elf faction (Wood-elves)', () => {
    // Aragorn (dunadan, DI 3, no standard modification from Wood-elves):
    // need = influence # 9 - DI 3 - Aiglos 3 = 3.
    const base = buildSitePhaseState({
      site: THRANDUILS_HALLS,
      characters: [ARAGORN],
      hand: [WOOD_ELVES],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(3);
  });

  test('without Aiglos the same Elf-faction attempt needs 3 more (control)', () => {
    // need = influence # 9 - DI 3 = 6.
    const state = buildSitePhaseState({
      site: THRANDUILS_HALLS,
      characters: [ARAGORN],
      hand: [WOOD_ELVES],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  test('+3 DI does NOT apply against a non-Elf faction (Rangers of the North)', () => {
    // Rangers of the North (dúnadan, influence # 10, Dúnedain +1 standard
    // modification for the dúnadan Aragorn, plus Aragorn II's own printed
    // "+2 DI against Rangers of the North"): need = 10 - DI 3 - 1 - 2 = 4,
    // with no Aiglos bonus despite the warrior bearer (were the +3 wrongly
    // applied: 1).
    const base = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const attempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('+3 DI does NOT apply for a non-warrior bearer influencing an Elf faction', () => {
    // Frodo (hobbit, DI 1, non-warrior): need = 9 - 1 = 8, Aiglos inert.
    const base = buildSitePhaseState({
      site: THRANDUILS_HALLS,
      characters: [FRODO],
      hand: [WOOD_ELVES],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, AIGLOS));
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);
    const attempt = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === frodoId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('+3 DI lets the bearer control an Elf character: Legolas (mind 6) under Aragorn (DI 3 + 3)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LEGOLAS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findHandCardId(state, RESOURCE_PLAYER, LEGOLAS);
    const plays = viableActions(state, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .filter(a => a.characterInstanceId === legolasId && a.controlledBy === aragornId);
    expect(plays.length).toBeGreaterThan(0);
  });

  test('without Aiglos, Aragorn (DI 3) cannot control Legolas (mind 6) — control', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LEGOLAS], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findHandCardId(state, RESOURCE_PLAYER, LEGOLAS);
    const plays = viableActions(state, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .filter(a => a.characterInstanceId === legolasId && a.controlledBy === aragornId);
    expect(plays).toHaveLength(0);
  });

  test('+3 DI does NOT apply to a non-Elf character: Gimli (dwarf, mind 6) stays uncontrollable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [GIMLI], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, AIGLOS));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findHandCardId(state, RESOURCE_PLAYER, GIMLI);
    const plays = viableActions(state, PLAYER_1, 'play-character')
      .map(a => a.action as PlayCharacterAction)
      .filter(a => a.characterInstanceId === gimliId && a.controlledBy === aragornId);
    expect(plays).toHaveLength(0);
  });
});
