/**
 * @module tw-305.test
 *
 * Card test: Praise to Elbereth (tw-305)
 * Type: hero-resource-event (short)
 * Effects: 3
 *   1. cancel-attack (when: enemy.race ringwraith, cost: tap a company
 *      character — any character, not race/skill-gated)
 *   2. on-event self-enters-play → cancel-chain-entry (select: target,
 *      repeatable: true, keyword: "Nazgûl") — opens the repeatable
 *      nazgul-multi-cancel window
 *   3. on-event self-enters-play → add-constraint (global-stat-modifier,
 *      +1 prowess, scope turn), gated on Doors of Night in play
 *
 * Text:
 *   "For each of your characters in play that you choose to tap (when this
 *    card is declared), cancel one Nazgûl event or one Nazgûl attack against
 *    that character's company. Nazgûl events discarded by Praise to Elbereth
 *    have no effect and Nazgûl permanent-events that are targeted by Praise
 *    to Elbereth may not be tapped in response to its play. Additionally, if
 *    Doors of Night is in play, characters gain +1 prowess until the end of
 *    the turn."
 *
 * Engine Support:
 * | # | Feature                                                          | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Cancel a live Nazgûl attack by tapping any company character     | IMPLEMENTED |
 * | 2 | Cancel multiple still-undeclared Nazgûl chain entries in one play | IMPLEMENTED |
 * | 3 | Cancel an already in-play Nazgûl permanent-event                | IMPLEMENTED |
 * | 4 | +1 prowess to all characters (both players) while Doors of Night | IMPLEMENTED |
 * | 5 | Not offered with no target and no Doors of Night                | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, RIVENDELL,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, findHandCardId, companyIdAt, charIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  viableActionsForHandCard, viableActions, firstAction,
  expectInDiscardPile, expectNotInHand,
  addCardInPlay, baseProwess, resolveChain,
} from '../test-helpers.js';
import type {
  CardDefinitionId, PlayShortEventAction, CancelAttackAction,
  NazgulMultiCancelTapAction,
} from '../../index.js';
import { Alignment, RegionType, SiteType, CardStatus } from '../../index.js';

const PRAISE_TO_ELBERETH = 'tw-305' as CardDefinitionId;
const KHAMUL = 'tw-47' as CardDefinitionId;      // Nazgûl (2nd) — creature/permanent-event, keyed to dark
const ADUNAPHEL = 'tw-2' as CardDefinitionId;    // Nazgûl (7th) — creature/permanent-event, keyed to dark
const WITCH_KING = 'tw-113' as CardDefinitionId; // Nazgûl (1st) — creature/permanent-event, keyed to dark
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

const LAGDUF = 'le-18' as CardDefinitionId;         // minion placeholder company: orc warrior
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven

const MH_PATH = {
  activeCompanyIndex: 0,
  resolvedSitePath: [RegionType.Dark, RegionType.Dark],
  resolvedSitePathNames: ['Ered Mithrin', 'Northern Waste'],
  destinationSiteType: SiteType.DarkHold,
  destinationSiteName: 'Dol Guldur',
} as const;

function buildHeroVsRingwraithState(heroHand: CardDefinitionId[], ringwraithHand: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: heroHand, siteDeck: [RIVENDELL] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: ringwraithHand, siteDeck: [MINAS_MORGUL] },
    ],
  });
  return { ...base, phaseState: makeMHState(MH_PATH) };
}

describe('Praise to Elbereth (tw-305)', () => {
  beforeEach(() => resetMint());

  test('cancels a live Nazgûl attack by tapping any company character (not race/skill-gated)', () => {
    const stateAtMH = buildHeroVsRingwraithState([PRAISE_TO_ELBERETH], [KHAMUL]);

    const khamulId = handCardId(stateAtMH, HAZARD_PLAYER);
    const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
    const combatState = playCreatureHazardAndResolve(
      stateAtMH, PLAYER_2, khamulId, targetCompanyId,
      { method: 'region-type', value: 'dark' },
    );
    expect(combatState.combat).not.toBeNull();

    const aragornId = charIdAt(combatState, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(combatState, RESOURCE_PLAYER, 0, 1);

    // Either character may pay the tap cost — no requiredSkill/requiredRace.
    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction);
    expect(cancelActions.some(a => a.scoutInstanceId === aragornId)).toBe(true);
    expect(cancelActions.some(a => a.scoutInstanceId === legolasId)).toBe(true);

    const cancelAction = firstAction<CancelAttackAction>(
      combatState, PLAYER_1, 'cancel-attack', a => a.scoutInstanceId === legolasId,
    );
    const praiseId = findHandCardId(combatState, RESOURCE_PLAYER, PRAISE_TO_ELBERETH);
    const afterCancel = dispatch(combatState, cancelAction);
    const resolved = afterCancel.chain ? resolveChain(afterCancel) : afterCancel;

    expect(resolved.combat).toBeNull();
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expectInDiscardPile(resolved, HAZARD_PLAYER, khamulId);
    expect(resolved.players[HAZARD_PLAYER].killPile.some(c => c.instanceId === khamulId)).toBe(false);
    expectNotInHand(resolved, RESOURCE_PLAYER, praiseId);
  });

  test('cancels a still-undeclared Nazgûl creature AND an already in-play Nazgûl permanent-event by tapping two different characters', () => {
    const stateAtMH = buildHeroVsRingwraithState([PRAISE_TO_ELBERETH], [ADUNAPHEL]);
    const withWitchKing = addCardInPlay(stateAtMH, HAZARD_PLAYER, WITCH_KING);

    const adunaphelId = findHandCardId(withWitchKing, HAZARD_PLAYER, ADUNAPHEL);
    const targetCompanyId = companyIdAt(withWitchKing, RESOURCE_PLAYER);
    const witchKingInstanceId = withWitchKing.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === WITCH_KING)!.instanceId;

    // Hazard player declares Adûnaphel as a creature attack.
    const afterCreature = dispatch(withWitchKing, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: adunaphelId, targetCompanyId,
      keyedBy: { method: 'region-type', value: 'dark' },
    });
    expect(afterCreature.chain!.entries).toHaveLength(1);

    // Hero responds with Praise to Elbereth on the same chain.
    const praiseAction = firstAction<PlayShortEventAction>(afterCreature, PLAYER_1, 'play-short-event');
    const praiseId = praiseAction.cardInstanceId;
    const afterPraise = dispatch(afterCreature, praiseAction);
    expect(afterPraise.chain!.entries).toHaveLength(2);

    // Both players pass — the chain starts resolving. Praise to Elbereth
    // (last declared) resolves first and opens the repeatable window.
    const afterHazardPass = dispatch(afterPraise, { type: 'pass-chain-priority', player: PLAYER_2 });
    const afterHeroPass = dispatch(afterHazardPass, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterHeroPass.pendingResolutions.some(r => r.kind.type === 'nazgul-multi-cancel')).toBe(true);
    expect(afterHeroPass.chain).not.toBeNull();

    const aragornId = charIdAt(afterHeroPass, RESOURCE_PLAYER, 0, 0);
    const legolasId = charIdAt(afterHeroPass, RESOURCE_PLAYER, 0, 1);
    const adunaphelEntryId = afterHeroPass.chain!.entries.find(e => e.card?.definitionId === ADUNAPHEL)!.card!.instanceId;

    const tapAragorn = firstAction<NazgulMultiCancelTapAction>(
      afterHeroPass, PLAYER_1, 'nazgul-multi-cancel-tap',
      a => a.characterId === aragornId && a.targetInstanceId === adunaphelEntryId,
    );
    const afterFirstTap = dispatch(afterHeroPass, tapAragorn);
    // The window stays open — a second tap/cancel is still on offer.
    expect(afterFirstTap.pendingResolutions.some(r => r.kind.type === 'nazgul-multi-cancel')).toBe(true);

    const tapLegolas = firstAction<NazgulMultiCancelTapAction>(
      afterFirstTap, PLAYER_1, 'nazgul-multi-cancel-tap',
      a => a.characterId === legolasId && a.targetInstanceId === witchKingInstanceId,
    );
    const afterSecondTap = dispatch(afterFirstTap, tapLegolas);

    // Close the window and let the chain finish resolving.
    const afterPassWindow = dispatch(afterSecondTap, { type: 'pass', player: PLAYER_1 });
    expect(afterPassWindow.chain).toBeNull();
    expect(afterPassWindow.combat).toBeNull();

    expect(afterPassWindow.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(afterPassWindow.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);

    // The undeclared creature attack never starts (negated before resolving);
    // the in-play permanent-event is discarded straight from cardsInPlay.
    expectInDiscardPile(afterPassWindow, HAZARD_PLAYER, adunaphelId);
    expect(afterPassWindow.players[HAZARD_PLAYER].killPile).toHaveLength(0);
    expect(afterPassWindow.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === witchKingInstanceId)).toBe(false);
    expect(afterPassWindow.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === witchKingInstanceId)).toBe(true);
    expectNotInHand(afterPassWindow, RESOURCE_PLAYER, praiseId);
    expectInDiscardPile(afterPassWindow, RESOURCE_PLAYER, praiseId);
  });

  test('cancels an already in-play Nazgûl permanent-event by tapping a character', () => {
    const stateAtMH = buildHeroVsRingwraithState([PRAISE_TO_ELBERETH], []);
    const withWitchKing = addCardInPlay(stateAtMH, HAZARD_PLAYER, WITCH_KING);

    const praiseAction = firstAction<PlayShortEventAction>(withWitchKing, PLAYER_1, 'play-short-event');
    const praiseId = praiseAction.cardInstanceId;
    const afterPraise = dispatch(withWitchKing, praiseAction);

    const afterHazardPass = dispatch(afterPraise, { type: 'pass-chain-priority', player: PLAYER_2 });
    const afterHeroPass = dispatch(afterHazardPass, { type: 'pass-chain-priority', player: PLAYER_1 });
    expect(afterHeroPass.pendingResolutions.some(r => r.kind.type === 'nazgul-multi-cancel')).toBe(true);

    const witchKingInstanceId = withWitchKing.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === WITCH_KING)!.instanceId;
    const aragornId = charIdAt(afterHeroPass, RESOURCE_PLAYER, 0, 0);

    const tap = firstAction<NazgulMultiCancelTapAction>(
      afterHeroPass, PLAYER_1, 'nazgul-multi-cancel-tap',
      a => a.characterId === aragornId && a.targetInstanceId === witchKingInstanceId,
    );
    const afterTap = dispatch(afterHeroPass, tap);
    const resolved = dispatch(afterTap, { type: 'pass', player: PLAYER_1 });

    expect(resolved.chain).toBeNull();
    expect(resolved.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === witchKingInstanceId)).toBe(false);
    expect(resolved.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === witchKingInstanceId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    expectNotInHand(resolved, RESOURCE_PLAYER, praiseId);
  });

  test('grants +1 prowess to every character (both players) while Doors of Night is in play', () => {
    const stateAtMH = buildHeroVsRingwraithState([PRAISE_TO_ELBERETH], []);
    const withDoN = addCardInPlay(stateAtMH, HAZARD_PLAYER, DOORS_OF_NIGHT);

    // Playable purely for the buff — no Nazgûl target is present.
    const praisePlays = viableActionsForHandCard(withDoN, PLAYER_1, 'play-short-event', RESOURCE_PLAYER, PRAISE_TO_ELBERETH);
    expect(praisePlays).toHaveLength(1);

    const praiseAction = praisePlays[0].action as PlayShortEventAction;
    const praiseId = praiseAction.cardInstanceId;
    const afterPraise = dispatch(withDoN, praiseAction);
    const afterHazardPass = dispatch(afterPraise, { type: 'pass-chain-priority', player: PLAYER_2 });
    const resolved = dispatch(afterHazardPass, { type: 'pass-chain-priority', player: PLAYER_1 });

    expect(resolved.chain).toBeNull();
    const aragornId = charIdAt(resolved, RESOURCE_PLAYER, 0, 0);
    const lagdufId = charIdAt(resolved, HAZARD_PLAYER, 0, 0);
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(baseProwess(ARAGORN) + 1);
    expect(resolved.players[HAZARD_PLAYER].characters[lagdufId].effectiveStats.prowess).toBe(baseProwess(LAGDUF) + 1);
    expectNotInHand(resolved, RESOURCE_PLAYER, praiseId);
  });

  test('not offered with no Nazgûl target and no Doors of Night in play', () => {
    const stateAtMH = buildHeroVsRingwraithState([PRAISE_TO_ELBERETH], []);

    expect(
      viableActionsForHandCard(stateAtMH, PLAYER_1, 'play-short-event', RESOURCE_PLAYER, PRAISE_TO_ELBERETH),
    ).toHaveLength(0);
    expect(viableActions(stateAtMH, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
