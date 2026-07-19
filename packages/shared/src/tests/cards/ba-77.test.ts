/**
 * @module ba-77.test
 *
 * Card test: Tempest of Fire (ba-77)
 * Type: minion-resource-event (permanent), alignment ringwraith, Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable during the site phase on an untapped Border-hold
 *    [{B}] or Shadow-hold [{S}]; the site cannot be an Under-deeps site or
 *    surface site thereof. Tap the site. The company faces three attacks (Men at
 *    a Border-hold [{B}], Orcs at a Shadow-hold [{S}] — 5 strikes with 8
 *    prowess, 4 strikes with 9 prowess, 3 strikes with 10 prowess). Following
 *    these attacks: discard this card or tap a character, place this card in
 *    your marshalling point pile, and return each unique faction playable at the
 *    site to its owner's hand."
 *
 * Effects:
 *   1. play-target site  { siteType in [border-hold, shadow-hold], NOT under-deeps,
 *                          NOT surface-of-under-deeps }                  — site.ts filter
 *   2. play-flag untapped-site-required                                  — site.ts
 *   3. play-flag tap-site-on-play                                        — chain-reducer.ts
 *   4. trigger-attack-on-play (3 attacks 5/8, 4/9, 3/10; move-to-mp-pile;
 *      creatureTypeBySiteType {border-hold: Men, shadow-hold: Orcs};
 *      returnFactionsAtSite)                                             — chain/combat-finalize/pending
 *
 * The card is non-unique, has NO character play-target (any untapped character
 * may be tapped to keep it), and is worth 3 miscellaneous MP once kept. Unlike
 * ba-56 (Descent through Fire) it carries no lingering stat buffs; instead the
 * keep branch returns every unique faction playable at the site to its owner's
 * hand.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
  CardStatus,
  Phase,
  buildMinionSitePhaseState,
  resetMint, mint,
  viableActions,
  playPermanentEventAndResolve, runCardTriggeredAttackCombat,
  dispatch, companyIdAt, findCharInstanceId,
  attachItemToChar,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayerId,
  PlayPermanentEventAction, SelectCardBearerAction,
  PendingResolution, ResolutionId,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const TEMPEST = 'ba-77' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;        // balrog avatar, prowess 8
const LIEUTENANT = 'le-21' as CardDefinitionId;       // Lieutenant of Dol Guldur — troll leader

// Plain (non-under-deeps, non-surface) sites of each admissible type.
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;     // border-hold
const SARN_GORIWING = 'tw-423' as CardDefinitionId;   // shadow-hold — Orcs of Mirkwood keyed here
// Excluded sites.
const UNDER_LEAS = 'ba-102' as CardDefinitionId;      // shadow-hold, UNDER-DEEPS
const MORIA = 'tw-413' as CardDefinitionId;           // shadow-hold, SURFACE of The Under-gates
const DUNHARROW = 'tw-389' as CardDefinitionId;       // border-hold, SURFACE of The Pûkel-deeps
const GOBLIN_GATE = 'tw-398' as CardDefinitionId;     // shadow-hold, SURFACE of The Under-grottos
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // haven — wrong site type

// Factions for the "return unique factions playable at the site" branch.
const ORCS_OF_MIRKWOOD = 'le-277' as CardDefinitionId; // UNIQUE, playableAt { site: 'Sarn Goriwing' }
const SNAGA_HAI = 'le-286' as CardDefinitionId;        // NON-unique, playableAt { siteType: 'shadow-hold' }
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;    // UNIQUE, playableAt { site: 'Moria' } (not here)

/**
 * Seed a select-card-bearer pending resolution for a kept Tempest of Fire (the
 * `move-to-mp-pile` + `returnFactionsAtSite` keep branch), with the card sitting
 * in cardsInPlay flagged `pendingTriggerAttack` as it is mid-flow right after
 * its attacks. Both company members are untapped. `factions` are added to the
 * named owner's cardsInPlay so the return branch can act on them.
 */
function seedKeepWithFactions(
  site: CardDefinitionId,
  factions: Array<{ defId: CardDefinitionId; owner: PlayerId; instanceId: CardInstanceId }>,
): { state: GameState; cardInstanceId: CardInstanceId } {
  const base = buildMinionSitePhaseState({
    site,
    characters: [THE_BALROG, LIEUTENANT],
    hand: [],
  });
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const cardInstanceId = mint();

  const p1Factions = factions
    .filter(f => f.owner === PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));
  const p2Factions = factions
    .filter(f => f.owner !== PLAYER_1)
    .map(f => ({ instanceId: f.instanceId, definitionId: f.defId, status: CardStatus.Untapped }));

  const withCard: GameState = {
    ...base,
    players: [
      {
        ...base.players[RESOURCE_PLAYER],
        cardsInPlay: [
          ...base.players[RESOURCE_PLAYER].cardsInPlay,
          { instanceId: cardInstanceId, definitionId: TEMPEST, status: CardStatus.Untapped, pendingTriggerAttack: true },
          ...p1Factions,
        ],
      },
      {
        ...base.players[HAZARD_PLAYER],
        cardsInPlay: [...base.players[HAZARD_PLAYER].cardsInPlay, ...p2Factions],
      },
    ] as typeof base.players,
    pendingResolutions: [
      {
        id: 'tempest-bearer' as ResolutionId,
        source: cardInstanceId,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: {
          type: 'select-card-bearer',
          cardInstanceId,
          companyId,
          mode: 'move-to-mp-pile',
          returnFactionsAtSite: true,
        },
      } satisfies PendingResolution,
    ],
  };
  return { state: recomputeDerived(withCard), cardInstanceId };
}

describe('Tempest of Fire (ba-77)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1/2: playability keying ──

  test('playable at an untapped Border-hold', () => {
    const state = buildMinionSitePhaseState({ site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    // No character target embedded at play time — bearer chosen post-attack.
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBeUndefined();
  });

  test('playable at an untapped Shadow-hold', () => {
    const state = buildMinionSitePhaseState({ site: SARN_GORIWING, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable at a TAPPED Border-hold', () => {
    const state = buildMinionSitePhaseState({
      site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST], siteStatus: CardStatus.Tapped,
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a non-Border/Shadow-hold site (a Haven)', () => {
    const state = buildMinionSitePhaseState({ site: MINAS_MORGUL, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at an Under-deeps Shadow-hold (The Under-leas)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_LEAS, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a surface Shadow-hold of an Under-deeps site (Moria)', () => {
    const state = buildMinionSitePhaseState({ site: MORIA, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at another surface Shadow-hold (Goblin-gate)', () => {
    const state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable at a surface Border-hold of an Under-deeps site (Dunharrow)', () => {
    const state = buildMinionSitePhaseState({ site: DUNHARROW, characters: [THE_BALROG], hand: [TEMPEST] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Effect 3: tap-site-on-play ──

  test('playing Tempest of Fire taps the site', () => {
    const state = buildMinionSitePhaseState({ site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
  });

  // ── Effect 4: dynamic creature race by site type ──

  test('at a Border-hold the attacks are Men (first: 5 strikes @ 8 prowess)', () => {
    const state = buildMinionSitePhaseState({ site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.creatureRace).toBe('man');
    expect(afterPlay.combat!.strikesTotal).toBe(5);
    expect(afterPlay.combat!.strikeProwess).toBe(8);
  });

  test('at a Shadow-hold the attacks are Orcs (first: 5 strikes @ 8 prowess)', () => {
    const state = buildMinionSitePhaseState({ site: SARN_GORIWING, characters: [THE_BALROG], hand: [TEMPEST] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.creatureRace).toBe('orc');
    expect(afterPlay.combat!.strikesTotal).toBe(5);
    expect(afterPlay.combat!.strikeProwess).toBe(8);
  });

  test('three attacks chain in order (5/8 → 4/9 → 3/10) keeping the site-derived race', () => {
    const state = buildMinionSitePhaseState({ site: SARN_GORIWING, characters: [THE_BALROG], hand: [TEMPEST] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    // Lone Balrog faces one strike of attack 1; the rest are unassignable.
    const afterAttack1 = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: THE_BALROG, roll: 6 }]);
    expect(afterAttack1.combat).not.toBeNull();
    expect(afterAttack1.combat!.creatureRace).toBe('orc');
    expect(afterAttack1.combat!.strikesTotal).toBe(4);
    expect(afterAttack1.combat!.strikeProwess).toBe(9);

    const afterAttack2 = runCardTriggeredAttackCombat(afterAttack1, []);
    expect(afterAttack2.combat).not.toBeNull();
    expect(afterAttack2.combat!.creatureRace).toBe('orc');
    expect(afterAttack2.combat!.strikesTotal).toBe(3);
    expect(afterAttack2.combat!.strikeProwess).toBe(10);
  });

  test('card is discarded when no character is untapped after the attacks', () => {
    const state = buildMinionSitePhaseState({ site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST] });
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action as PlayPermanentEventAction;
    let s = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    s = runCardTriggeredAttackCombat(s, [{ characterDefId: THE_BALROG, roll: 6 }]); // attack 1 → 2
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 2 → 3
    s = runCardTriggeredAttackCombat(s, []);                                        // attack 3 → done
    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === TEMPEST)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === TEMPEST)).toBe(false);
  });

  // ── Effect 4: any untapped character may be tapped to keep (no character filter) ──

  test('select-card-bearer offers EVERY untapped company member (no character restriction)', () => {
    const { state } = seedKeepWithFactions(SARN_GORIWING, []);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const offered = viableActions(state, PLAYER_1, 'select-card-bearer')
      .map(ea => (ea.action as SelectCardBearerAction).characterId);
    expect(offered).toContain(balrogId);
    expect(offered).toContain(lieutenantId);
    // A pass (discard the card) is always available.
    expect(viableActions(state, PLAYER_1, 'pass').length).toBeGreaterThan(0);
  });

  // ── Effect 4: keeping taps the chosen character, keeps the card in the MP pile, scores 3 misc MP ──

  test('keeping taps the chosen character, leaves the card in play with no attach/untap-lock, and scores 3 misc MP', () => {
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, []);
    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT);
    const keep: SelectCardBearerAction = { type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: lieutenantId };

    const afterKeep = recomputeDerived(dispatch(state, keep));

    const lieutenant = afterKeep.players[RESOURCE_PLAYER].characters[lieutenantId];
    expect(lieutenant.status).toBe(CardStatus.Tapped);
    expect(lieutenant.items.some(i => i.definitionId === TEMPEST)).toBe(false);
    const kept = afterKeep.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === TEMPEST);
    expect(kept).toBeDefined();
    expect(kept!.pendingTriggerAttack).toBeUndefined();
    expect(afterKeep.activeConstraints.some(c => c.kind.type === 'bearer-cannot-untap')).toBe(false);
    // 3 miscellaneous marshalling points from the kept card.
    expect(afterKeep.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  test('passing (declining the keep) discards the card', () => {
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, []);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === cardInstanceId)).toBe(false);
    expect(afterPass.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInstanceId)).toBe(true);
  });

  // ── Effect 4: returnFactionsAtSite — unique factions playable at the site go to their owner's hand ──

  test('a kept card returns your own unique faction playable at the site to your hand', () => {
    const factionId = `${PLAYER_1}-201` as CardInstanceId;
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, [
      { defId: ORCS_OF_MIRKWOOD, owner: PLAYER_1, instanceId: factionId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, { type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId });

    expect(afterKeep.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterKeep.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === factionId)).toBe(true);
  });

  test("a kept card returns an opponent's unique faction playable at the site to the opponent's hand", () => {
    const factionId = 'p2-201' as CardInstanceId;
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, [
      { defId: ORCS_OF_MIRKWOOD, owner: 'p2' as PlayerId, instanceId: factionId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, { type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId });

    expect(afterKeep.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(afterKeep.players[HAZARD_PLAYER].hand.some(c => c.instanceId === factionId)).toBe(true);
  });

  test('a NON-unique faction playable at the site is NOT returned', () => {
    const snagaId = `${PLAYER_1}-202` as CardInstanceId;
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, [
      { defId: SNAGA_HAI, owner: PLAYER_1, instanceId: snagaId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, { type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId });

    expect(afterKeep.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === snagaId)).toBe(true);
    expect(afterKeep.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === snagaId)).toBe(false);
  });

  test('a unique faction NOT playable at the site is NOT returned', () => {
    const moriaOrcsId = `${PLAYER_1}-203` as CardInstanceId;
    const { state, cardInstanceId } = seedKeepWithFactions(SARN_GORIWING, [
      { defId: ORCS_OF_MORIA, owner: PLAYER_1, instanceId: moriaOrcsId },
    ]);
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);
    const afterKeep = dispatch(state, { type: 'select-card-bearer', player: PLAYER_1, cardInstanceId, characterId: balrogId });

    expect(afterKeep.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === moriaOrcsId)).toBe(true);
    expect(afterKeep.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === moriaOrcsId)).toBe(false);
  });

  // ── Effect 4: no faction return on discard ──

  test('declining the keep does NOT return factions', () => {
    const factionId = `${PLAYER_1}-201` as CardInstanceId;
    const { state } = seedKeepWithFactions(SARN_GORIWING, [
      { defId: ORCS_OF_MIRKWOOD, owner: PLAYER_1, instanceId: factionId },
    ]);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
    expect(afterPass.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === factionId)).toBe(false);
  });

  // ── duplication: the card is non-unique and NOT limited per site ──

  test('a second copy is playable at the same site even with a copy already present', () => {
    const state = buildMinionSitePhaseState({ site: CAMETH_BRIN, characters: [THE_BALROG], hand: [TEMPEST] });
    const withCopy = attachItemToChar(state, RESOURCE_PLAYER, THE_BALROG, TEMPEST);
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });
});
