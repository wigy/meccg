/**
 * @module le-214.test
 *
 * Card test: Old Prejudice (le-214)
 * Type: minion-resource-event, Long-event, non-unique.
 *
 * Text:
 *   "Triple all standard modifications for influence checks against factions."
 *
 * Modeled by a single `{ "type": "multiply-standard-modifications", "factor": 3 }`
 * effect. While a card carrying it sits bare in *either* player's
 * `cardsInPlay`, `standardModificationMultiplier` returns 3 and
 * `collectFactionCardEffects` triples every influence `check-modifier` printed
 * on the faction being influenced — in the displayed need
 * (`legal-actions/site.ts`), the paused roll (`legal-actions/pending.ts`) and
 * the roll resolver (`reducer-site.ts`).
 *
 * "Standard modifications" are the modifications printed on the faction card
 * itself. The influencer's direct influence, his own card-text bonuses, and
 * modifiers from other cards (Times Are Evil) are not standard modifications
 * and are untouched. Like other long-events the effect is game-wide.
 *
 * Rule coverage:
 * | # | Rule                                                                   | Status      |
 * |---|------------------------------------------------------------------------|-------------|
 * | 1 | Playable as a minion long-event; resolves bare into play               | IMPLEMENTED |
 * | 2 | A positive standard modification is tripled (+2 → +6)                  | IMPLEMENTED |
 * | 3 | A negative standard modification is tripled (-2 → -6)                  | IMPLEMENTED |
 * | 4 | Applies from either player's play area                                 | IMPLEMENTED |
 * | 5 | Non-standard modifications (DI, own card text, Times Are Evil) are not | IMPLEMENTED |
 * | 6 | The roll resolver agrees with the tripled need                         | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   OLD_PREJUDICE (le-214)          - this card
 *   LAGDUF (le-18)                  - orc warrior, DI 0, no effects
 *   LIEUTENANT_OF_MORGUL (le-22)    - DI 2, "+3 DI against … Orc factions" (own card text)
 *   GOBLINS_GOBLIN_GATE (le-265)    - influence # 9, "Standard Modifications: Grey Mountain Goblins (+2)"
 *   GREY_MOUNTAIN_GOBLINS (le-266)  - in play, triggers the +2 above
 *   ORCS_OF_MORIA (le-278)          - influence # 11, "… Orcs of Dol Guldur (-2)"
 *   ORCS_OF_DOL_GULDUR (as-121)     - in play, triggers the -2 above
 *   TIMES_ARE_EVIL (td-76)          - hazard long-event, -3 to influence attempts
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, viableActions, resolveChain,
  makeSitePhase, firstFactionInfluenceAttempt, findHandCardId,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  FactionInfluenceRollAction,
} from '../../index.js';

const OLD_PREJUDICE = 'le-214' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GREY_MOUNTAIN_GOBLINS = 'le-266' as CardDefinitionId;
const ORCS_OF_MORIA = 'le-278' as CardDefinitionId;
const ORCS_OF_DOL_GULDUR = 'as-121' as CardDefinitionId;
const TIMES_ARE_EVIL = 'td-76' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const MORIA = 'le-392' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

const inPlay = (definitionId: CardDefinitionId, instanceId: string): CardInPlay =>
  ({ instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped });

interface Opts {
  readonly influencer?: CardDefinitionId;
  readonly faction?: 'goblin-gate' | 'moria';
  readonly prejudice?: 'self' | 'opponent';
  readonly modifierFaction?: boolean;
  readonly timesAreEvil?: boolean;
}

/**
 * Site-phase state: the influencer stands at the faction's site with the
 * faction in hand. `modifierFaction` puts in play the faction that triggers
 * the target faction's printed Standard Modification.
 */
const buildState = (opts: Opts = {}): GameState => {
  const atMoria = opts.faction === 'moria';
  const selfInPlay: CardInPlay[] = [];
  const oppInPlay: CardInPlay[] = [];
  if (opts.prejudice === 'self') selfInPlay.push(inPlay(OLD_PREJUDICE, 'op-1'));
  if (opts.prejudice === 'opponent') oppInPlay.push(inPlay(OLD_PREJUDICE, 'op-1'));
  if (opts.modifierFaction) {
    selfInPlay.push(inPlay(atMoria ? ORCS_OF_DOL_GULDUR : GREY_MOUNTAIN_GOBLINS, 'mf-1'));
  }
  if (opts.timesAreEvil) oppInPlay.push(inPlay(TIMES_ARE_EVIL, 'tae-1'));

  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: atMoria ? MORIA : GOBLIN_GATE, characters: [opts.influencer ?? LAGDUF] }],
        hand: [atMoria ? ORCS_OF_MORIA : GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        cardsInPlay: selfInPlay,
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM],
        cardsInPlay: oppInPlay,
      },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
};

const needOf = (state: GameState): number | undefined =>
  firstFactionInfluenceAttempt(state, state.players[RESOURCE_PLAYER].hand[0].instanceId)?.need;

describe('Old Prejudice (le-214)', () => {
  beforeEach(() => resetMint());

  test('playable as a long-event and resolves bare into play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [OLD_PREJUDICE], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const cardId = findHandCardId(base, RESOURCE_PLAYER, OLD_PREJUDICE);
    const plays = viableActions(base, PLAYER_1, 'play-long-event')
      .filter(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === cardId);
    expect(plays).toHaveLength(1);

    const after = resolveChain(dispatch(base, plays[0].action));
    const entry = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === OLD_PREJUDICE);
    expect(entry).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === OLD_PREJUDICE)).toBe(false);
  });

  test('a positive standard modification is tripled: +2 becomes +6', () => {
    // Goblins of Goblin-gate influence # 9, Lagduf DI 0.
    expect(needOf(buildState())).toBe(9);
    expect(needOf(buildState({ modifierFaction: true }))).toBe(7);
    expect(needOf(buildState({ modifierFaction: true, prejudice: 'self' }))).toBe(3);
  });

  test('a negative standard modification is tripled: -2 becomes -6', () => {
    // Orcs of Moria influence # 11; Orcs of Dol Guldur in play gives -2.
    expect(needOf(buildState({ faction: 'moria' }))).toBe(11);
    expect(needOf(buildState({ faction: 'moria', modifierFaction: true }))).toBe(13);
    expect(needOf(buildState({ faction: 'moria', modifierFaction: true, prejudice: 'self' }))).toBe(17);
  });

  test('applies from the opponent’s play area too', () => {
    expect(needOf(buildState({ modifierFaction: true, prejudice: 'opponent' }))).toBe(3);
  });

  test('no standard modification applies → no change', () => {
    expect(needOf(buildState({ prejudice: 'self' }))).toBe(9);
  });

  test('direct influence and the influencer’s own card-text bonus are not tripled', () => {
    // Lieutenant of Morgul: DI 2 + own "+3 against Orc factions" → need 4.
    expect(needOf(buildState({ influencer: LIEUTENANT_OF_MORGUL }))).toBe(4);
    expect(needOf(buildState({ influencer: LIEUTENANT_OF_MORGUL, prejudice: 'self' }))).toBe(4);
  });

  test('a non-standard modifier from another card (Times Are Evil -3) is not tripled', () => {
    expect(needOf(buildState({ timesAreEvil: true }))).toBe(12);
    expect(needOf(buildState({ timesAreEvil: true, prejudice: 'self' }))).toBe(12);
  });

  test('the roll resolver uses the tripled modification: a raw 3 succeeds', () => {
    const state = buildState({ modifierFaction: true, prejudice: 'self' });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    let cur = resolveChain(dispatch(state, attempt!));

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(3);

    cur = dispatch({ ...cur, cheatRollTotal: 3 }, rollActions[0].action);
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(GOBLINS_GOBLIN_GATE);
  });

  test('control: without Old Prejudice the same raw 3 fails', () => {
    const state = buildState({ modifierFaction: true });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    let cur = resolveChain(dispatch(state, firstFactionInfluenceAttempt(state, factionInst)!));
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(7);
    cur = dispatch({ ...cur, cheatRollTotal: 3 }, rollActions[0].action);
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(GOBLINS_GOBLIN_GATE);
  });
});
