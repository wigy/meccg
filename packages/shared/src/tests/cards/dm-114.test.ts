/**
 * @module dm-114.test
 *
 * Card test: An Unexpected Party (dm-114)
 * Type: hero-resource-event (permanent)
 * Alignment: wizard (Hero)
 *
 * Text:
 *   "Only playable during the organization phase on a company. There is no
 *    limit to the size of this company. Dwarves with a mind of 2 or less in
 *    this company do not require influence to be controlled; and there is no
 *    limit to how many Dwarves may be brought into play on a given turn with
 *    the company. Discard this card if the company has more than one non-Wizard
 *    character with a mind greater than 5 or more than two non-Dwarf characters
 *    or no Dwarf with a mind greater than 5. Cannot be duplicated on a given
 *    company."
 *
 * CRF 22: "It allows the player to play one non-Dwarf character and any number
 * of Dwarves all in the same organization phase." / errata: read "on a given
 * turn" as "during this organization phase".
 *
 * Effects:
 *   1. play-target: company                      (organization-phase company play)
 *   2. duplication-limit: scope company, max 1   ("cannot be duplicated")
 *   3. company-size-unlimited                    ("no limit to the size")
 *   4. company-influence-exempt (Dwarf, mind ≤ 2)
 *   5. company-character-play-exempt (Dwarf)
 *   6. discard-self-when-company (three counted clauses)
 *
 * Engine support:
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Only playable in the organization phase, on a company       | IMPLEMENTED |
 * | 2 | No limit to the size of this company                        | IMPLEMENTED |
 * | 3 | Dwarves with mind ≤ 2 need no influence to be controlled    | IMPLEMENTED |
 * | 4 | No limit to how many Dwarves join the company this phase    | IMPLEMENTED |
 * | 5 | Discard: > 1 non-Wizard character with mind > 5             | IMPLEMENTED |
 * | 6 | Discard: > 2 non-Dwarf characters                           | IMPLEMENTED |
 * | 7 | Discard: no Dwarf with mind > 5                             | IMPLEMENTED |
 * | 8 | Cannot be duplicated on a given company                     | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (all Hero, from The Wizards):
 *   THORIN (tw-183)   — Dwarf, mind 8   (the "Dwarf with a mind greater than 5")
 *   DAIN (tw-138)     — Dwarf, mind 7   (a second big-mind character)
 *   BALIN (tw-123)    — Dwarf, mind 5   (not influence-exempt: mind > 2)
 *   GLOIN (tw-160)    — Dwarf, mind 5
 *   BIFUR (tw-130)    — Dwarf, mind 2   (influence-exempt)
 *   NORI (tw-171)     — Dwarf, mind 2   (influence-exempt)
 *   DWALIN (tw-142)   — Dwarf, mind 1   (influence-exempt)
 *   ORI (tw-173)      — Dwarf, mind 1   (influence-exempt)
 *   BOMBUR (tw-133), DORI (tw-141), FILI (tw-150) — Dwarf fillers
 *   BERGIL / BEREGOND / ANBORN — Dúnedain, mind 2 (non-Dwarf, non-Wizard)
 *   RIVENDELL (tw-421) — Hero haven (any character may be played there)
 *   AMON_HEN (tw-371)  — Hero ruins-and-lairs (non-haven: size limit applies)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, buildTwoCompaniesAt, buildSitePhaseState, makePlayDeck, resetMint,
  viableActions, dispatch, addCardInPlay,
  findCharInstanceId, findHandCardId, companyIdAt,
  playPermanentEventAndResolve,
  LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId,
  MergeCompaniesAction, PlayCharacterAction, PlayPermanentEventAction, SplitCompanyAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** An Unexpected Party — the card under test. */
const UNEXPECTED_PARTY = 'dm-114' as CardDefinitionId;

const THORIN = 'tw-183' as CardDefinitionId;   // Dwarf, mind 8
const DAIN = 'tw-138' as CardDefinitionId;     // Dwarf, mind 7
const BALIN = 'tw-123' as CardDefinitionId;    // Dwarf, mind 5
const GLOIN = 'tw-160' as CardDefinitionId;    // Dwarf, mind 5
const BIFUR = 'tw-130' as CardDefinitionId;    // Dwarf, mind 2
const NORI = 'tw-171' as CardDefinitionId;     // Dwarf, mind 2
const DWALIN = 'tw-142' as CardDefinitionId;   // Dwarf, mind 1
const ORI = 'tw-173' as CardDefinitionId;      // Dwarf, mind 1
const BOMBUR = 'tw-133' as CardDefinitionId;   // Dwarf, mind 1
const DORI = 'tw-141' as CardDefinitionId;     // Dwarf, mind 1
const FILI = 'tw-150' as CardDefinitionId;     // Dwarf, mind 2
const BERGIL = 'tw-129' as CardDefinitionId;   // Dúnadan, mind 2
const BEREGOND = 'tw-127' as CardDefinitionId; // Dúnadan, mind 2
const ANBORN = 'tw-118' as CardDefinitionId;   // Dúnadan, mind 2

/** Amon Hen — Hero ruins-and-lairs; a non-haven, where the size cap applies. */
const AMON_HEN = 'tw-371' as CardDefinitionId;
/** Dol Guldur — site-deck filler. */
const DOL_GULDUR = 'tw-387' as CardDefinitionId;

describe('An Unexpected Party (dm-114)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: only playable during the organization phase, on a company ─────

  test('offers one play-permanent-event bound to the company during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayPermanentEventAction).targetCompanyId)
      .toBe(companyIdAt(state, RESOURCE_PLAYER));
  });

  test('resolves into cardsInPlay bound to the target company and stays there', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, { targetCompanyId: companyId });

    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cardId);
    expect(inPlay).toBeDefined();
    expect(inPlay?.companyId).toBe(companyId);
  });

  test('not playable outside the organization phase (site phase offers nothing)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [THORIN, BIFUR],
      hand: [UNEXPECTED_PARTY],
    });

    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 8: cannot be duplicated on a given company ───────────────────────

  test('a second copy is not offered on a company that already carries one', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY, UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    // Both copies are offered while the company carries none.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(2);

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const firstCopy = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === UNEXPECTED_PARTY)!;
    const after = playPermanentEventAndResolve(state, PLAYER_1, firstCopy.instanceId, undefined, { targetCompanyId: companyId });

    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === UNEXPECTED_PARTY)).toBe(true);
    expect(viableActions(after, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Rule 2: there is no limit to the size of this company ─────────────────

  test('merging to an 8-character company at a non-haven is blocked without the card', () => {
    const state = buildTwoCompaniesAt(
      AMON_HEN,
      [THORIN, BIFUR, BOMBUR, DORI, DWALIN],
      [FILI, NORI, ORI],
    );
    expect(viableActions(state, PLAYER_1, 'merge-companies')).toHaveLength(0);
  });

  test('merging to 8 characters is viable into the company carrying the card', () => {
    const base = buildTwoCompaniesAt(
      AMON_HEN,
      [THORIN, BIFUR, BOMBUR, DORI, DWALIN],
      [FILI, NORI, ORI],
    );
    const boundCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);
    const state = addCardInPlay(base, RESOURCE_PLAYER, UNEXPECTED_PARTY, boundCompanyId);

    const merges = viableActions(state, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];
    // Into the exempt company: allowed. The other direction still hits the cap,
    // because the surviving company would be the one without the card.
    expect(merges.some(m => m.action.targetCompanyId === boundCompanyId && m.action.sourceCompanyId === otherCompanyId)).toBe(true);
    expect(merges.some(m => m.action.targetCompanyId === otherCompanyId)).toBe(false);
  });

  // ── Rule 3: Dwarves with a mind of 2 or less need no influence ────────────

  test('mind ≤ 2 Dwarves in the company stop consuming general influence', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR, DWALIN] }], hand: [UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    // Thorin 8 + Bifur 2 + Dwalin 1 = 11.
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(11);

    const cardId = findHandCardId(state, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
    });
    // Only Thorin (mind 8) still costs influence.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(8);
  });

  test('the waiver is limited to Dwarves and to mind 2 or less', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        // Balin is a Dwarf of mind 5; Bergil is a mind-2 Dúnadan. Neither qualifies.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BALIN, BERGIL, BIFUR] }], hand: [UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    // Thorin 8 + Balin 5 + Bergil 2 + Bifur 2 = 17.
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(17);

    const cardId = findHandCardId(state, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
    });
    // Only Bifur (Dwarf, mind 2) is waived: 17 − 2 = 15.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(15);
  });

  test('a mind ≤ 2 Dwarf may still be brought into the company with the influence pool exhausted', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        // 8 + 5 + 5 + 2 = 20 = the whole general-influence pool.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BALIN, GLOIN, BERGIL] }], hand: [UNEXPECTED_PARTY, BIFUR], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);

    const bifurId = findHandCardId(state, RESOURCE_PLAYER, BIFUR);
    // Baseline: with no influence left, Bifur cannot be taken under general influence.
    const baseline = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .filter(a => a.action.characterInstanceId === bifurId && a.action.controlledBy === 'general');
    expect(baseline).toHaveLength(0);

    const cardId = findHandCardId(state, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
    });
    // None of the four in play is waived, so the pool is still fully spent…
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);
    // …yet Bifur may now join the company for free.
    const withCard = (viableActions(after, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .filter(a => a.action.characterInstanceId === bifurId && a.action.controlledBy === 'general');
    expect(withCard.length).toBeGreaterThan(0);

    const played = dispatch(after, withCard[0].action);
    expect(played.players[RESOURCE_PLAYER].companies[0].characters).toHaveLength(5);
    expect(played.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);
  });

  // ── Rule 4: no limit to how many Dwarves join the company this phase ──────

  test('any number of Dwarves may join the company, and the ordinary slot survives', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY, DWALIN, ORI, BERGIL, BEREGOND], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    let state = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
    });

    for (const dwarf of [DWALIN, ORI]) {
      const instId = findHandCardId(state, RESOURCE_PLAYER, dwarf);
      const play = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
        .find(a => a.action.characterInstanceId === instId && a.action.controlledBy === 'general');
      expect(play).toBeDefined();
      state = dispatch(state, play!.action);
      // A Dwarf joining the bound company never consumes the turn's slot.
      expect(state.phaseState.phase).toBe(Phase.Organization);
      if (state.phaseState.phase !== Phase.Organization) return;
      expect(state.phaseState.characterPlayedThisTurn).toBe(false);
    }
    expect(state.players[RESOURCE_PLAYER].companies[0].characters).toHaveLength(4);

    // The ordinary one-character play is still available afterwards.
    const bergilId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const bergilPlay = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .find(a => a.action.characterInstanceId === bergilId && a.action.controlledBy === 'general');
    expect(bergilPlay).toBeDefined();
    state = dispatch(state, bergilPlay!.action);
    expect(state.phaseState.phase).toBe(Phase.Organization);
    if (state.phaseState.phase !== Phase.Organization) return;
    expect(state.phaseState.characterPlayedThisTurn).toBe(true);

    // …and the slot is now spent: no further non-Dwarf may be played.
    const beregondId = findHandCardId(state, RESOURCE_PLAYER, BEREGOND);
    const beregondPlays = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .filter(a => a.action.characterInstanceId === beregondId);
    expect(beregondPlays).toHaveLength(0);
  });

  test('a Dwarf may still join the company after the turn\'s ordinary character has been played', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY, BERGIL, DWALIN, BEREGOND], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    let state = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
    });

    const bergilId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const bergilPlay = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .find(a => a.action.characterInstanceId === bergilId && a.action.controlledBy === 'general');
    state = dispatch(state, bergilPlay!.action);
    expect(state.phaseState.phase).toBe(Phase.Organization);
    if (state.phaseState.phase !== Phase.Organization) return;
    expect(state.phaseState.characterPlayedThisTurn).toBe(true);

    const plays = viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[];
    const dwalinId = findHandCardId(state, RESOURCE_PLAYER, DWALIN);
    const beregondId = findHandCardId(state, RESOURCE_PLAYER, BEREGOND);
    expect(plays.some(a => a.action.characterInstanceId === dwalinId)).toBe(true);
    expect(plays.some(a => a.action.characterInstanceId === beregondId)).toBe(false);
  });

  // ── Rule 5: discard on more than one non-Wizard with a mind > 5 ───────────

  test('discarded when a second non-Wizard character with mind > 5 joins', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR] }], hand: [UNEXPECTED_PARTY, DAIN], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const state = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
    });
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);

    const dainId = findHandCardId(state, RESOURCE_PLAYER, DAIN);
    const dainPlay = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .find(a => a.action.characterInstanceId === dainId && a.action.controlledBy === 'general');
    expect(dainPlay).toBeDefined();
    const after = dispatch(state, dainPlay!.action);

    // Thorin (8) and Dáin (7) — two non-Wizard characters with a mind over 5.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  // ── Rule 6: discard on more than two non-Dwarf characters ─────────────────

  test('two non-Dwarf characters are tolerated; a third discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR, BERGIL, BEREGOND] }], hand: [UNEXPECTED_PARTY, ANBORN], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const state = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetCompanyId: companyIdAt(base, RESOURCE_PLAYER),
    });
    // Exactly two non-Dwarves (Bergil, Beregond): still in play.
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);

    const anbornId = findHandCardId(state, RESOURCE_PLAYER, ANBORN);
    const anbornPlay = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .find(a => a.action.characterInstanceId === anbornId && a.action.controlledBy === 'general');
    expect(anbornPlay).toBeDefined();
    const after = dispatch(state, anbornPlay!.action);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  // ── Rule 7: discard when no Dwarf with a mind > 5 is left ─────────────────

  test('discarded once the big-mind Dwarf splits away from the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THORIN, BIFUR, DWALIN] }], hand: [UNEXPECTED_PARTY], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, UNEXPECTED_PARTY);
    const boundCompanyId: CompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const state = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, { targetCompanyId: boundCompanyId });
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(true);

    const thorinId: CardInstanceId = findCharInstanceId(state, RESOURCE_PLAYER, THORIN);
    const split = (viableActions(state, PLAYER_1, 'split-company') as { action: SplitCompanyAction }[])
      .find(a => a.action.characterId === thorinId && a.action.sourceCompanyId === boundCompanyId);
    expect(split).toBeDefined();
    const after = dispatch(state, split!.action);

    // The bound company (Bifur + Dwalin) no longer has a Dwarf with a mind > 5.
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
  });

  test('a company with no big-mind Dwarf discards the card on the next action', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BIFUR, DWALIN, NORI] }], hand: [BERGIL], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH], playDeck: makePlayDeck() },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const state = addCardInPlay(base, RESOURCE_PLAYER, UNEXPECTED_PARTY, companyId);
    const cardInstanceId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const bergilId = findHandCardId(state, RESOURCE_PLAYER, BERGIL);
    const play = (viableActions(state, PLAYER_1, 'play-character') as { action: PlayCharacterAction }[])
      .find(a => a.action.characterInstanceId === bergilId && a.action.controlledBy === 'general');
    const after = dispatch(state, play!.action);

    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });
});
