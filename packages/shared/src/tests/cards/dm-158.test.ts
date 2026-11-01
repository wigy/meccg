/**
 * @module dm-158.test
 *
 * Card test: Sentinels of Númenor (dm-158)
 * Type: hero-resource-event (permanent), non-unique, 0 MP (misc).
 *
 * "Place this card in your marshalling points pile. Any attempt (by any
 *  player) to influence a faction playable at a site in Anórien, Lebennin,
 *  Lamedon, Belfalas, or Anfalas (except Army of the Dead) is modified by -2
 *  and cannot be attempted with Muster. Place any such faction you
 *  successfully influence (while this card is in play) under this card. All
 *  factions under this card give an additional marshalling point. Discard when
 *  any faction under this card is discarded (all other contained factions
 *  remain). Cannot be duplicated."
 *
 * Effects (4):
 *   - faction-influence-restriction: -2 to influence attempts against factions
 *     playable at a site in the five regions (`matchFactionPlayableRegions`),
 *     blocks Muster, excepts Army of the Dead. Scanned from both players'
 *     play areas ("by any player").
 *   - contain-influenced-factions: a qualifying faction its controller
 *     influences while the card is in play is stamped `containedBy` and gives
 *     +1 faction MP.
 *   - discard-on-card-leaves-play `containedOnly`: discarded when a contained
 *     faction leaves play; the other contained factions remain (their stamp is
 *     cleared and the bonus lapses with the card).
 *   - duplication-limit (game, 1): "Cannot be duplicated".
 *
 * "Place this card in your marshalling points pile" is the engine's standard
 * treatment of a permanent-event in `cardsInPlay` (it scores from there; its
 * printed value is 0).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, buildSitePhaseState, buildTestState, addCardInPlay, findCharInstanceId, findHandCardId,
  firstFactionInfluenceAttempt, viableActions, dispatch, resolveChain,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { addConstraint } from '../../engine/pending.js';
import { applyDiscardOnCardLeaves, clearOrphanedContainedBy } from '../../engine/discard-on-card-leaves.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayPermanentEventAction } from '../../index.js';

const SENTINELS = 'dm-158' as CardDefinitionId;
const PELARGIR = 'tw-419' as CardDefinitionId;            // Lebennin
const MEN_OF_LEBENNIN = 'tw-280' as CardDefinitionId;     // influence # 8, 2 MP, playable at Pelargir
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;      // 2 MP, playable at Minas Tirith (Anórien)
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;       // Lamedon
const ARMY_OF_THE_DEAD = 'tw-193' as CardDefinitionId;    // influence # 0, 6 MP, Vale of Erech
const EASTERLING_CAMP = 'tw-392' as CardDefinitionId;     // Horse Plains (not a named region)
const WAIN_EASTERLINGS = 'as-60' as CardDefinitionId;     // playable at Easterling Camp
const MUSTER = 'tw-288' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

const SENTINELS_INST = 'p1-s1' as CardInstanceId;

describe('Sentinels of Númenor (dm-158)', () => {
  beforeEach(() => resetMint());

  // ── -2 to influence attempts against factions playable in the regions ─────

  test('influence against a faction playable at a site in Lebennin is modified by -2', () => {
    const base = buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] });
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const baseline = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withSentinels = addCardInPlay(base, RESOURCE_PLAYER, SENTINELS);
    expect(firstFactionInfluenceAttempt(withSentinels, factionInst)!.need).toBe(baseline + 2);
  });

  test('the penalty applies to any player — an opponent\'s Sentinels also penalise the attempt', () => {
    const base = buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] });
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const baseline = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withOpponentSentinels = addCardInPlay(base, HAZARD_PLAYER, SENTINELS);
    expect(firstFactionInfluenceAttempt(withOpponentSentinels, factionInst)!.need).toBe(baseline + 2);
  });

  test('a faction playable outside the five regions is not affected', () => {
    const base = buildSitePhaseState({ characters: [LEGOLAS], site: EASTERLING_CAMP, hand: [WAIN_EASTERLINGS] });
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, WAIN_EASTERLINGS);
    const baseline = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withSentinels = addCardInPlay(base, RESOURCE_PLAYER, SENTINELS);
    expect(firstFactionInfluenceAttempt(withSentinels, factionInst)!.need).toBe(baseline);
  });

  test('the -2 flips a would-be successful roll into a failure', () => {
    const base = addCardInPlay(
      buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] }),
      RESOURCE_PLAYER, SENTINELS);
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const need = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const afterChain = resolveChain(dispatch(base, firstFactionInfluenceAttempt(base, factionInst)!));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    // A roll of need - 1 would have succeeded without the -2 (need - 2 + 1 ≥ need - 2).
    const resolved = dispatch({ ...afterChain, cheatRollTotal: need - 1 }, roll);
    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInst)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === factionInst)).toBe(true);
  });

  // ── Cannot be attempted with Muster ───────────────────────────────────────

  test('a Muster boost is suppressed for an attempt against a qualifying faction', () => {
    const base = buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] });
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const baseline = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withMuster = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: MUSTER,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });
    expect(firstFactionInfluenceAttempt(withMuster, factionInst)!.need).toBe(baseline - 5);

    // With Sentinels: Muster contributes nothing, only the -2 applies.
    const withBoth = addCardInPlay(withMuster, RESOURCE_PLAYER, SENTINELS);
    expect(firstFactionInfluenceAttempt(withBoth, factionInst)!.need).toBe(baseline + 2);
  });

  // ── Except Army of the Dead ───────────────────────────────────────────────

  test('Army of the Dead is exempt: no penalty and it is not placed under the card', () => {
    const built = buildSitePhaseState({ characters: [ARAGORN], site: VALE_OF_ERECH, hand: [ARMY_OF_THE_DEAD] });
    const base: GameState = {
      ...built,
      players: [
        { ...built.players[0], companies: [{ ...built.players[0].companies[0], specialMovement: 'paths-of-the-dead' as const }] },
        built.players[1],
      ] as GameState['players'],
    };
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);
    const baseline = firstFactionInfluenceAttempt(base, factionInst)!.need;

    const withSentinels = addCardInPlay(base, RESOURCE_PLAYER, SENTINELS);
    const attempt = firstFactionInfluenceAttempt(withSentinels, factionInst)!;
    expect(attempt.need).toBe(baseline);

    const afterChain = resolveChain(dispatch(withSentinels, attempt));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, roll);
    const army = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInst);
    expect(army).toBeDefined();
    expect(army!.containedBy).toBeUndefined();
  });

  // ── Successfully influenced factions are placed under the card (+1 MP) ────

  test('a qualifying faction you influence is placed under the card and gives +1 MP', () => {
    const base = addCardInPlay(
      buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] }),
      RESOURCE_PLAYER, SENTINELS);
    const sentinelsInst = base.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === SENTINELS)!.instanceId;
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);

    const afterChain = resolveChain(dispatch(base, firstFactionInfluenceAttempt(base, factionInst)!));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, roll);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInst);
    expect(faction?.containedBy).toBe(sentinelsInst);
    // Men of Lebennin prints 2 MP; under Sentinels it gives 3.
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  test('a faction influenced without the card in play gives only its printed MP', () => {
    const base = buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] });
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const afterChain = resolveChain(dispatch(base, firstFactionInfluenceAttempt(base, factionInst)!));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, roll);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInst);
    expect(faction?.containedBy).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('only factions YOU influence go under your card — the opponent\'s Sentinels do not take yours', () => {
    const base = addCardInPlay(
      buildSitePhaseState({ characters: [ARAGORN], site: PELARGIR, hand: [MEN_OF_LEBENNIN] }),
      HAZARD_PLAYER, SENTINELS);
    const factionInst = findHandCardId(base, RESOURCE_PLAYER, MEN_OF_LEBENNIN);
    const afterChain = resolveChain(dispatch(base, firstFactionInfluenceAttempt(base, factionInst)!));
    const roll = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 12 }, roll);

    const faction = resolved.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === factionInst);
    expect(faction).toBeDefined();
    expect(faction!.containedBy).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  // ── Discard when a contained faction is discarded; others remain ──────────

  test('discarded when a faction under it is discarded; the other contained faction remains (without bonus)', () => {
    const inPlay: CardInPlay[] = [
      { instanceId: SENTINELS_INST, definitionId: SENTINELS, status: CardStatus.Untapped },
      { instanceId: 'p1-f1' as CardInstanceId, definitionId: MEN_OF_LEBENNIN, status: CardStatus.Untapped, containedBy: SENTINELS_INST },
      { instanceId: 'p1-f2' as CardInstanceId, definitionId: MEN_OF_ANORIEN, status: CardStatus.Untapped, containedBy: SENTINELS_INST },
    ];
    const prev = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN], cardsInPlay: inPlay },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    // Both contained: 2 + 2 printed, +1 each.
    expect(prev.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(6);

    const p0 = prev.players[RESOURCE_PLAYER];
    const next: GameState = {
      ...prev,
      players: [
        { ...p0,
          cardsInPlay: p0.cardsInPlay.filter(c => c.instanceId !== 'p1-f1'),
          discardPile: [...p0.discardPile, { instanceId: 'p1-f1' as CardInstanceId, definitionId: MEN_OF_LEBENNIN }] },
        prev.players[1],
      ] as GameState['players'],
    };
    const after = clearOrphanedContainedBy(applyDiscardOnCardLeaves(prev, next));
    const ap0 = after.players[RESOURCE_PLAYER];
    expect(ap0.cardsInPlay.some(c => c.definitionId === SENTINELS)).toBe(false);
    expect(ap0.discardPile.some(c => c.definitionId === SENTINELS)).toBe(true);
    const anorien = ap0.cardsInPlay.find(c => c.instanceId === 'p1-f2');
    expect(anorien).toBeDefined();
    expect(anorien!.containedBy).toBeUndefined();
  });

  test('NOT discarded when a faction that is not under it leaves play', () => {
    const inPlay: CardInPlay[] = [
      { instanceId: SENTINELS_INST, definitionId: SENTINELS, status: CardStatus.Untapped },
      { instanceId: 'p1-f1' as CardInstanceId, definitionId: MEN_OF_LEBENNIN, status: CardStatus.Untapped },
      { instanceId: 'p1-f2' as CardInstanceId, definitionId: MEN_OF_ANORIEN, status: CardStatus.Untapped, containedBy: SENTINELS_INST },
    ];
    const prev = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN], cardsInPlay: inPlay },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    // Only the contained faction gets +1: 2 + 2 + 1.
    expect(prev.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(5);

    const p0 = prev.players[RESOURCE_PLAYER];
    const next: GameState = {
      ...prev,
      players: [
        { ...p0,
          cardsInPlay: p0.cardsInPlay.filter(c => c.instanceId !== 'p1-f1'),
          discardPile: [...p0.discardPile, { instanceId: 'p1-f1' as CardInstanceId, definitionId: MEN_OF_LEBENNIN }] },
        prev.players[1],
      ] as GameState['players'],
    };
    const after = clearOrphanedContainedBy(applyDiscardOnCardLeaves(prev, next));
    const ap0 = after.players[RESOURCE_PLAYER];
    expect(ap0.cardsInPlay.some(c => c.definitionId === SENTINELS)).toBe(true);
    expect(ap0.cardsInPlay.find(c => c.instanceId === 'p1-f2')!.containedBy).toBe(SENTINELS_INST);
  });

  // ── Cannot be duplicated ──────────────────────────────────────────────────

  test('playable as a permanent-event when no copy is in play, but not while one is', () => {
    const build = (inPlay: CardInPlay[]): GameState => buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SENTINELS], siteDeck: [LORIEN], cardsInPlay: inPlay },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const playFor = (state: GameState) => {
      const inst = findHandCardId(state, RESOURCE_PLAYER, SENTINELS);
      return viableActions(state, PLAYER_1, 'play-permanent-event')
        .map(ea => ea.action as PlayPermanentEventAction)
        .find(a => a.cardInstanceId === inst);
    };
    expect(playFor(build([]))).toBeDefined();
    expect(playFor(build([{ instanceId: SENTINELS_INST, definitionId: SENTINELS, status: CardStatus.Untapped }]))).toBeUndefined();
  });

  test('playing it puts it in your play area (marshalling-point pile) as a permanent-event', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.Organization, recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [SENTINELS], siteDeck: [LORIEN] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const inst = findHandCardId(state, RESOURCE_PLAYER, SENTINELS);
    const play = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(ea => (ea.action as PlayPermanentEventAction).cardInstanceId === inst)!.action;
    const after = resolveChain(dispatch(state, play));
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === inst)).toBe(false);
  });
});
