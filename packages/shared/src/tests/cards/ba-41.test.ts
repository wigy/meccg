/**
 * @module ba-41.test
 *
 * Card test: No Better Use (ba-41)
 * Type: minion-resource-event (permanent), alignment ringwraith. Non-unique.
 *
 * Card text:
 *   "Playable on a character during your organization phase. One time you may
 *    tap your character to place an opponent's character 'off to the side'
 *    with this card. Do this in lieu of making opponent's character's body
 *    check in company vs. company combat with your character's company.
 *    Discard all cards on opponent's character. If your character becomes
 *    wounded or leaves active play, discard this card — opponent's character
 *    then forms a company at your character's current or new site. During
 *    the site phase at Shelob's Lair, your character may tap and discard
 *    this card to eliminate opponent's character — whom you then receive as
 *    kill marshalling points."
 *
 * Effects tested:
 * 1. cvcc-capture-in-lieu-of-body-check — offered alongside body-check-roll
 *    whenever a CvCC character body check is pending against the opposing
 *    company (both the `'character'` and `'attacker-character'` targets);
 *    activating it bypasses the roll and places the character off to the
 *    side with the card instead.
 * 2. Discard all cards on the captured character (items/allies/hazards);
 *    followers revert to general influence (Press-gang ba-22 shape).
 * 3. One-time use per host card, even after being untapped.
 * 4. If the bearer becomes wounded or leaves active play, the host is
 *    discarded and the captured character forms a fresh company at the
 *    bearer's current (or, if the bearer moved since capture, new) site.
 * 5. grant-action `eliminate-captured-character`: at Shelob's Lair during
 *    the site phase, tap and discard the host to eliminate the captured
 *    character, crediting its kill marshalling points to the activator.
 *
 * | # | Rule                                                          | Status | Notes |
 * |---|----------------------------------------------------------------|--------|-------|
 * | 1 | Offered in lieu of body-check-roll ('character' target)        | OK     | bearer on the attacking side |
 * | 2 | Offered in lieu of body-check-roll ('attacker-character')      | OK     | bearer on the defending side |
 * | 3 | Discards all cards on opponent's character; followers → GI     | OK     | Press-gang shape reused |
 * | 4 | One time only                                                  | OK     | persistent granted-action-used lock |
 * | 5 | Bearer wounded → discard host, release to new company at site  | OK     | sweepNoBetterUseCaptures |
 * | 6 | Bearer leaves play → release to new company at last known site | OK     | sweepNoBetterUseCaptures |
 * | 7 | Shelob's Lair finisher: eliminate for kill MP                  | OK     | grant-action eliminate-captured-character |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  dispatch, viableActions,
  findCharInstanceId, attachItemToChar, attachAllyToChar,
  makeSitePhase,
} from '../test-helpers.js';
import type { CardDefinitionId, CompanyId, GameState, ActivateGrantedAction } from '../../index.js';
import { Alignment } from '../../index.js';
import {
  captureCharacterInLieuOfBodyCheck, noBetterUseAlreadyUsed, noBetterUseHeldCharacter, sweepNoBetterUseCaptures,
} from '../../engine/no-better-use.js';
import { addConstraint } from '../../engine/pending.js';

const NO_BETTER_USE = 'ba-41' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;   // prowess 6, body 9
const DENETHOR = 'tw-140' as CardDefinitionId;  // prowess 3, body 6
const PERCHEN = 'as-4' as CardDefinitionId;     // prowess 3, body 9 (minion)
const MAUHUR = 'as-2' as CardDefinitionId;      // prowess 6, body 9 (minion)
const ASTERNAK = 'le-1' as CardDefinitionId;    // minion — used as a follower
const DAGGER = 'tw-206' as CardDefinitionId;    // minor weapon item
const NOBLE_STEED = 'wh-33' as CardDefinitionId; // ally
const MORIA = 'tw-d21' as CardDefinitionId;
const MORIA_AS = 'as-169' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;
const SHELOBS_LAIR = 'le-402' as CardDefinitionId; // minion-site (shadow-hold)
const HAZARD_PLAYER_IDX = 1;

function buildCvCCState(opts: {
  p1Alignment: Alignment;
  p2Alignment: Alignment;
  p1Characters: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Characters: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: opts.p1Alignment, companies: [{ site: MORIA, characters: opts.p1Characters }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, alignment: opts.p2Alignment, companies: [{ site: MORIA, characters: opts.p2Characters }], hand: [], siteDeck: [MORIA_AS] },
    ],
    phase: Phase.Site,
  });
  return { ...state, phaseState: makeSitePhase() };
}

describe('No Better Use (ba-41)', () => {
  beforeEach(() => resetMint());

  // ─── 1. Offered in lieu of body-check-roll — 'character' target (bearer attacks) ─

  test('offered alongside body-check-roll when the defending character is checked, and bypasses the roll', () => {
    // Aragorn fights the strike; Denethor II (bearing the card) is the
    // attacking company's second member — with only one defender to pair
    // against, he becomes an unpaired "excess" attacker (CoE rule 3.V.ii) and
    // stays untapped, able to pay the ability's tap cost once Perchen's body
    // check comes up from Aragorn's strike.
    let s = buildCvCCState({
      p1Alignment: Alignment.Ringwraith,
      p2Alignment: Alignment.Wizard,
      p1Characters: [ARAGORN, { defId: DENETHOR, items: [NO_BETTER_USE] }],
      p2Characters: [PERCHEN],
    });
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const denethorId = findCharInstanceId(s, RESOURCE_PLAYER, DENETHOR);
    const perchenId = s.players[1].companies[0].characters[0];
    const hostId = s.players[RESOURCE_PLAYER].characters[denethorId].items[0].instanceId;

    const aragornAssign = viableActions(s, PLAYER_1, 'assign-strike')
      .find(ea => (ea.action as { attackingCharacterId: unknown }).attackingCharacterId === aragornId)!.action;
    s = dispatch(s, aragornAssign);
    // Leave Denethor II unassigned (excess pool) rather than allocating him.
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // Force Aragorn (prowess 6) to beat Perchen (prowess 3) regardless of RNG.
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 12 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(s.combat?.phase).toBe('body-check');
    expect(s.combat?.bodyCheckTarget).toBe('character');
    expect(s.players[RESOURCE_PLAYER].characters[denethorId].status).toBe(CardStatus.Untapped);

    const captureActions = viableActions(s, PLAYER_1, 'capture-in-lieu-of-body-check');
    expect(captureActions).toHaveLength(1);
    expect((captureActions[0].action as { characterId: unknown }).characterId).toBe(denethorId);

    s = dispatch(s, captureActions[0].action);

    // Perchen is off to the side: still in his owner's characters map, in no company.
    expect(s.players[1].characters[perchenId]).toBeDefined();
    expect(s.players[1].companies.some(c => c.characters.includes(perchenId))).toBe(false);
    expect(s.players[1].discardPile.some(c => c.instanceId === perchenId)).toBe(false);
    expect(s.players[1].outOfPlayPile.some(c => c.instanceId === perchenId)).toBe(false);
    // Not eliminated: no kill MP was awarded.
    expect(s.players[0].killPile.some(c => c.instanceId === perchenId)).toBe(false);
    // Marked with the character-pressed constraint, pointing at the host.
    expect(noBetterUseHeldCharacter(s, hostId)).toBe(perchenId);
    // The bearer paid the tap cost.
    expect(s.players[RESOURCE_PLAYER].characters[denethorId].status).toBe(CardStatus.Tapped);
    // The host card is still in play (capture, not the wound/leaves-play release).
    expect(s.players[RESOURCE_PLAYER].characters[denethorId].items.some(i => i.instanceId === hostId)).toBe(true);
  });

  test('baseline: without the card in play, only body-check-roll is offered', () => {
    let s = buildCvCCState({
      p1Alignment: Alignment.Ringwraith,
      p2Alignment: Alignment.Wizard,
      p1Characters: [ARAGORN],
      p2Characters: [PERCHEN],
    });
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });
    const atkAssign = viableActions(s, PLAYER_1, 'assign-strike');
    s = dispatch(s, atkAssign[0].action);
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 12 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(s.combat?.bodyCheckTarget).toBe('character');
    expect(viableActions(s, PLAYER_1, 'capture-in-lieu-of-body-check')).toHaveLength(0);
    expect(viableActions(s, PLAYER_1, 'body-check-roll')).toHaveLength(1);
  });

  // ─── 2. Offered in lieu of body-check-roll — 'attacker-character' target (bearer defends) ─

  test('offered alongside body-check-roll when the ATTACKING character is checked (bearer on the defending side)', () => {
    // Mauhúr faces the single incoming strike; Perchen (bearing the card) is
    // the defending company's second member. With only one strike to cover,
    // the defending player need not commit him — he stays untapped, able to
    // pay the ability's tap cost once Denethor II's body check comes up from
    // losing to Mauhúr.
    let s = buildCvCCState({
      p1Alignment: Alignment.Wizard,
      p2Alignment: Alignment.Ringwraith,
      p1Characters: [DENETHOR],
      p2Characters: [MAUHUR, { defId: PERCHEN, items: [NO_BETTER_USE] }],
    });
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);

    const denethorId = s.players[0].companies[0].characters[0];
    const mauhurId = findCharInstanceId(s, HAZARD_PLAYER_IDX, MAUHUR);
    const perchenId = findCharInstanceId(s, HAZARD_PLAYER_IDX, PERCHEN);
    const hostId = s.players[1].characters[perchenId].items[0].instanceId;

    const mauhurAssign = viableActions(s, PLAYER_2, 'assign-strike')
      .find(ea => (ea.action as { characterId: unknown }).characterId === mauhurId)!.action;
    s = dispatch(s, mauhurAssign);

    // Force Mauhúr (defender, prowess 6) to beat Denethor II (attacker, prowess 3).
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 2 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(s.combat?.bodyCheckTarget).toBe('attacker-character');
    expect(s.players[HAZARD_PLAYER_IDX].characters[perchenId].status).toBe(CardStatus.Untapped);

    const captureActions = viableActions(s, PLAYER_2, 'capture-in-lieu-of-body-check');
    expect(captureActions).toHaveLength(1);
    expect((captureActions[0].action as { characterId: unknown }).characterId).toBe(perchenId);

    s = dispatch(s, captureActions[0].action);

    expect(s.combat).toBeNull();
    expect(s.players[0].characters[denethorId]).toBeDefined();
    expect(s.players[0].companies.some(c => c.characters.includes(denethorId))).toBe(false);
    expect(s.players[1].killPile.some(c => c.instanceId === denethorId)).toBe(false);
    expect(noBetterUseHeldCharacter(s, hostId)).toBe(denethorId);
    expect(s.players[1].characters[perchenId].status).toBe(CardStatus.Tapped);
  });

  // ─── 3. Discard all cards on opponent's character; followers revert to GI ────

  test('captures discard the target\'s items and allies, but its follower reverts to general influence', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [{ defId: PERCHEN }, { defId: ASTERNAK, followerOf: 0 }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [NO_BETTER_USE] }] }], hand: [], siteDeck: [MORIA_AS] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, PERCHEN, DAGGER);
    state = attachAllyToChar(state, RESOURCE_PLAYER, PERCHEN, NOBLE_STEED);

    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const asternakId = findCharInstanceId(state, RESOURCE_PLAYER, ASTERNAK);
    const daggerId = state.players[RESOURCE_PLAYER].characters[perchenId].items[0].instanceId;
    const steedId = state.players[RESOURCE_PLAYER].characters[perchenId].allies[0].instanceId;
    const bearerId = findCharInstanceId(state, 1, ARAGORN);
    const hostId = state.players[1].characters[bearerId].items[0].instanceId;
    const bearerSite = state.players[1].companies[0].currentSite;

    const after = captureCharacterInLieuOfBodyCheck(
      state, RESOURCE_PLAYER, perchenId, hostId, bearerId, state.players[1].id, bearerSite,
    );

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === daggerId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === steedId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[perchenId].items).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].characters[perchenId].allies).toHaveLength(0);

    const follower = after.players[RESOURCE_PLAYER].characters[asternakId];
    expect(follower).toBeDefined();
    expect(follower.controlledBy).toBe('general');
    expect(follower.influenceUnsubtracted).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === asternakId)).toBe(false);
  });

  // ─── 4. One-time use ───────────────────────────────────────────────────────

  test('activating the capture records a persistent one-time-use lock on the host', () => {
    let s = buildCvCCState({
      p1Alignment: Alignment.Ringwraith,
      p2Alignment: Alignment.Wizard,
      p1Characters: [ARAGORN, { defId: DENETHOR, items: [NO_BETTER_USE] }],
      p2Characters: [PERCHEN],
    });
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const denethorId = findCharInstanceId(s, RESOURCE_PLAYER, DENETHOR);

    const aragornAssign = viableActions(s, PLAYER_1, 'assign-strike')
      .find(ea => (ea.action as { attackingCharacterId: unknown }).attackingCharacterId === aragornId)!.action;
    s = dispatch(s, aragornAssign);
    s = dispatch(s, { type: 'pass', player: PLAYER_1 }); // leave Denethor II as excess

    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 12 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });
    const captureActions = viableActions(s, PLAYER_1, 'capture-in-lieu-of-body-check');
    s = dispatch(s, captureActions[0].action);

    const hostId = s.players[RESOURCE_PLAYER].characters[denethorId].items[0].instanceId;
    expect(noBetterUseAlreadyUsed(s, hostId)).toBe(true);
  });

  test('one time only: a host already marked used is never offered again, even once its bearer is untapped', () => {
    // A fresh CvCC scenario reaching a pending 'character' body check, with
    // the host already carrying the persistent used-lock (as it would after
    // an earlier activation) — confirms the *lock*, not merely the bearer's
    // tapped status, is what withholds the action.
    let s = buildCvCCState({
      p1Alignment: Alignment.Ringwraith,
      p2Alignment: Alignment.Wizard,
      p1Characters: [ARAGORN, { defId: DENETHOR, items: [NO_BETTER_USE] }],
      p2Characters: [PERCHEN],
    });
    const denethorId = findCharInstanceId(s, RESOURCE_PLAYER, DENETHOR);
    const hostId = s.players[RESOURCE_PLAYER].characters[denethorId].items[0].instanceId;
    s = addConstraint(s, {
      source: hostId,
      sourceDefinitionId: NO_BETTER_USE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'granted-action-used', sourceInstanceId: hostId, actionId: 'no-better-use-capture' },
    });

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const declareAction = viableActions(s, PLAYER_1, 'declare-company-attack')[0].action as {
      type: 'declare-company-attack'; player: typeof PLAYER_1; attackingCompanyId: CompanyId; targetCompanyId: CompanyId;
    };
    s = dispatch(s, declareAction);
    s = dispatch(s, { type: 'pass', player: PLAYER_2 });

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const aragornAssign = viableActions(s, PLAYER_1, 'assign-strike')
      .find(ea => (ea.action as { attackingCharacterId: unknown }).attackingCharacterId === aragornId)!.action;
    s = dispatch(s, aragornAssign);
    s = dispatch(s, { type: 'pass', player: PLAYER_1 }); // leave Denethor II as excess, untapped

    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_1, tapToFight: true, need: 2, explanation: '' });
    s = { ...s, cheatRollTotal: 12 };
    s = dispatch(s, { type: 'resolve-strike', player: PLAYER_2, tapToFight: true, need: 2, explanation: '' });

    expect(s.combat?.bodyCheckTarget).toBe('character');
    expect(s.players[RESOURCE_PLAYER].characters[denethorId].status).toBe(CardStatus.Untapped);
    expect(viableActions(s, PLAYER_1, 'capture-in-lieu-of-body-check')).toHaveLength(0);
    expect(viableActions(s, PLAYER_1, 'body-check-roll')).toHaveLength(1);
  });

  // ─── 5 + 6. Release when the bearer is wounded or leaves play ────────────────

  test('bearer wounded: the host is discarded and the captured character forms a fresh company at the bearer\'s site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [PERCHEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [NO_BETTER_USE] }] }], hand: [], siteDeck: [MORIA_AS] },
      ],
    });
    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const bearerId = findCharInstanceId(state, 1, ARAGORN);
    const hostId = state.players[1].characters[bearerId].items[0].instanceId;
    const bearerSite = state.players[1].companies[0].currentSite;

    const captured = captureCharacterInLieuOfBodyCheck(state, RESOURCE_PLAYER, perchenId, hostId, bearerId, state.players[1].id, bearerSite);
    expect(noBetterUseHeldCharacter(captured, hostId)).toBe(perchenId);

    // The bearer is later wounded (some other combat).
    const wounded: GameState = {
      ...captured,
      players: [
        captured.players[0],
        { ...captured.players[1], characters: { ...captured.players[1].characters, [bearerId as string]: { ...captured.players[1].characters[bearerId], status: CardStatus.Inverted } } },
      ] as unknown as GameState['players'],
    };

    const released = sweepNoBetterUseCaptures(wounded);

    // Host discarded from the bearer.
    expect(released.players[1].characters[bearerId].items.some(i => i.instanceId === hostId)).toBe(false);
    expect(released.players[1].discardPile.some(c => c.instanceId === hostId)).toBe(true);
    // Captured character released: constraint gone, forms a new company at the bearer's site.
    expect(noBetterUseHeldCharacter(released, hostId)).toBeNull();
    const newCompany = released.players[RESOURCE_PLAYER].companies.find(c => c.characters.includes(perchenId));
    expect(newCompany).toBeDefined();
    expect(newCompany!.characters).toEqual([perchenId]);
    expect(newCompany!.currentSite?.definitionId).toBe(bearerSite?.definitionId);
  });

  test('bearer leaves play entirely: the captured character is released at the bearer\'s last known site, tracking movement since capture', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [PERCHEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [NO_BETTER_USE] }] }], hand: [], siteDeck: [MORIA_AS] },
      ],
    });
    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const bearerId = findCharInstanceId(state, 1, ARAGORN);
    const hostId = state.players[1].characters[bearerId].items[0].instanceId;
    const captureSite = state.players[1].companies[0].currentSite;

    const captured = captureCharacterInLieuOfBodyCheck(state, RESOURCE_PLAYER, perchenId, hostId, bearerId, state.players[1].id, captureSite);

    // The bearer's company moves to a new site; a sweep pass while the bearer
    // is still alive refreshes the tracked site to the *new* one.
    const newSite = { ...captureSite!, definitionId: MORIA_AS };
    const moved: GameState = {
      ...captured,
      players: [
        captured.players[0],
        { ...captured.players[1], companies: captured.players[1].companies.map(c => ({ ...c, currentSite: newSite })) },
      ] as unknown as GameState['players'],
    };
    const refreshed = sweepNoBetterUseCaptures(moved);
    expect(noBetterUseHeldCharacter(refreshed, hostId)).toBe(perchenId); // still held — not released yet

    // The bearer now leaves active play entirely (discarded/eliminated by some
    // other means — its items, including the host, are already gone with it).
    const { [bearerId]: _removedBearer, ...remainingChars } = refreshed.players[1].characters;
    void _removedBearer;
    const bearerGone: GameState = {
      ...refreshed,
      players: [
        refreshed.players[0],
        { ...refreshed.players[1], characters: remainingChars },
      ] as unknown as GameState['players'],
    };

    const released = sweepNoBetterUseCaptures(bearerGone);

    expect(noBetterUseHeldCharacter(released, hostId)).toBeNull();
    const newCompany = released.players[RESOURCE_PLAYER].companies.find(c => c.characters.includes(perchenId));
    expect(newCompany).toBeDefined();
    // Released at the bearer's *new* (last known, tracked) site, not the capture-time site.
    expect(newCompany!.currentSite?.definitionId).toBe(MORIA_AS);
  });

  // ─── 7. Shelob's Lair finisher ────────────────────────────────────────────

  test('Shelob\'s Lair: tap and discard the host to eliminate the captured character for kill MP', () => {
    const state = buildTestState({
      // The grant-action's `anyPhase: true` window is scoped to the bearer's
      // controller's own turn (CoE 2.1.1) — P2 (the Ringwraith bearer's
      // owner) must be the active player.
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [PERCHEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: SHELOBS_LAIR, characters: [{ defId: ARAGORN, items: [NO_BETTER_USE] }] }], hand: [], siteDeck: [MORIA_AS] },
      ],
    });
    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const bearerId = findCharInstanceId(state, 1, ARAGORN);
    const hostId = state.players[1].characters[bearerId].items[0].instanceId;
    const bearerSite = state.players[1].companies[0].currentSite;

    let captured = captureCharacterInLieuOfBodyCheck(state, RESOURCE_PLAYER, perchenId, hostId, bearerId, state.players[1].id, bearerSite);
    captured = { ...captured, phaseState: makeSitePhase() };

    const eliminateActions = viableActions(captured, PLAYER_2, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'no-better-use-eliminate');
    expect(eliminateActions).toHaveLength(1);

    const after = dispatch(captured, eliminateActions[0].action);

    // Captured character eliminated: removed from the game entirely, no
    // longer held, and credited as kill MP to the activating (P2) player.
    expect(after.players[RESOURCE_PLAYER].characters[perchenId]).toBeUndefined();
    expect(noBetterUseHeldCharacter(after, hostId)).toBeNull();
    expect(after.players[1].killPile.some(c => c.instanceId === perchenId)).toBe(true);
    // The bearer paid tap + discard.
    expect(after.players[1].characters[bearerId].status).toBe(CardStatus.Tapped);
    expect(after.players[1].characters[bearerId].items.some(i => i.instanceId === hostId)).toBe(false);
    expect(after.players[1].discardPile.some(c => c.instanceId === hostId)).toBe(true);
  });

  test('baseline: the Shelob\'s Lair finisher is not offered at a different site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [PERCHEN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_AS, characters: [{ defId: ARAGORN, items: [NO_BETTER_USE] }] }], hand: [], siteDeck: [MORIA_AS] },
      ],
    });
    const perchenId = findCharInstanceId(state, RESOURCE_PLAYER, PERCHEN);
    const bearerId = findCharInstanceId(state, 1, ARAGORN);
    const hostId = state.players[1].characters[bearerId].items[0].instanceId;
    const bearerSite = state.players[1].companies[0].currentSite;

    let captured = captureCharacterInLieuOfBodyCheck(state, RESOURCE_PLAYER, perchenId, hostId, bearerId, state.players[1].id, bearerSite);
    captured = { ...captured, phaseState: makeSitePhase() };

    const eliminateActions = viableActions(captured, PLAYER_2, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'no-better-use-eliminate');
    expect(eliminateActions).toHaveLength(0);
  });
});
