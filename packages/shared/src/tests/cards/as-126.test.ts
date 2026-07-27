/**
 * @module as-126.test
 *
 * Card test: Helm of Fear (as-126)
 * Type: minion-resource-item (Special Item), alignment ringwraith, unique.
 * Marshalling Points: 2.
 *
 * Card text: "Unique. Playable at a tapped or untapped Barad-dûr and only on
 * your Ringwraith (does not tap the site). This item only affects a Ringwraith.
 * Tap this item to cancel an attack against the Ringwraith's company. May not
 * cancel combat with a hero company. All body checks against the bearer are
 * modified by -1. Cannot be included in a Balrog's deck."
 *
 * Effects & engine support:
 * | # | Rule                                                  | Mechanism                                                       |
 * |---|-------------------------------------------------------|----------------------------------------------------------------|
 * | 1 | Playable at tapped/untapped Barad-dûr (does not tap)  | item-play-site sites=["Barad-dûr"], allowTapped, doesNotTapSite |
 * | 2 | Only on your Ringwraith / only affects a Ringwraith  | play-target character filter target.race === "ringwraith"       |
 * | 3 | Unique                                                | data unique:true → site item-play uniqueness gate               |
 * | 4 | Tap item to cancel an attack against the company     | cancel-attack cost { tap: "self" } (item taps, bearer does not) |
 * | 5 | May not cancel combat with a hero company            | cancel-attack when { attack.heroCompany: { $ne: true } }        |
 * | 6 | All body checks against the bearer modified by -1    | body-check-modifier value:-1 (applied to the body-check roll)   |
 * | 7 | Cannot be included in a Balrog's deck                | deck-validation BALROG_BANNED_CARD_IDS (rule 1.23)              |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  buildMinionSitePhaseState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, CardDefinitionId,
  dispatch, viableActions, attachItemToChar,
  findCharInstanceId, findHandCardId, companyIdAt, setCharStatus,
  makeCancelWindowCombat, makeBodyCheckCombat, makeShadowMHState,
  pool,
} from '../test-helpers.js';
import { computeLegalActions, validateDeck, Race } from '../../index.js';
import type { CancelAttackAction, CombatState, DeckList, GameState } from '../../index.js';

const HELM_OF_FEAR = 'as-126' as CardDefinitionId;
const REN_RW = 'le-56' as CardDefinitionId;        // Ringwraith avatar, body 10, mind null
const LUITPRAND = 'le-23' as CardDefinitionId;      // non-avatar minion companion (man)
const BARAD_DUR = 'le-352' as CardDefinitionId;     // minion dark-hold (name "Barad-dûr")
const CARN_DUM = 'le-359' as CardDefinitionId;      // a different minion dark-hold
const MINAS_MORGUL_LE = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const ORC_PATROL = 'tw-074' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;       // hero character (CvCC attacker)
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

/** Find the in-play instance of the Helm on a given character. */
function helmOnChar(state: GameState, playerIdx: number, charDefId: CardDefinitionId) {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  return state.players[playerIdx].characters[charId].items.find(
    i => i.definitionId === HELM_OF_FEAR,
  );
}

describe('Helm of Fear (as-126)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: play conditions (Barad-dûr, on a Ringwraith, no site tap) ──

  test('Helm is playable on the Ringwraith at Barad-dûr', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [HELM_OF_FEAR],
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN_RW);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { attachToCharacterId?: string }).attachToCharacterId).toBe(renId as string);
  });

  test('Helm is NOT playable on a non-Ringwraith company member', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW, LUITPRAND],
      hand: [HELM_OF_FEAR],
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN_RW);

    // Only the Ringwraith qualifies as bearer — exactly one viable play action.
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(plays).toHaveLength(1);
    expect((plays[0].action as { attachToCharacterId?: string }).attachToCharacterId).toBe(renId as string);
  });

  test('Helm is NOT playable at a different dark-hold (only at Barad-dûr)', () => {
    const state = buildMinionSitePhaseState({
      site: CARN_DUM,
      characters: [REN_RW],
      hand: [HELM_OF_FEAR],
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('playing the Helm does NOT tap an untapped Barad-dûr', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [HELM_OF_FEAR],
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const play = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);

    // Site stays untapped.
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Untapped);
    // Item attached to the Ringwraith.
    expect(helmOnChar(after, RESOURCE_PLAYER, REN_RW)).toBeDefined();
  });

  test('Helm is playable at an already-tapped Barad-dûr and leaves it tapped', () => {
    const state = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [HELM_OF_FEAR],
      siteStatus: CardStatus.Tapped,
    });
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const play = computeLegalActions(state, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(play).toBeDefined();
    const after = dispatch(state, play!.action);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe(CardStatus.Tapped);
    expect(helmOnChar(after, RESOURCE_PLAYER, REN_RW)).toBeDefined();
  });

  // ── Rule 3: unique ────────────────────────────────────────────────────────

  test('a second Helm is not playable while one is already in play', () => {
    const base = buildMinionSitePhaseState({
      site: BARAD_DUR,
      characters: [REN_RW],
      hand: [HELM_OF_FEAR],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const helmId = findHandCardId(state, RESOURCE_PLAYER, HELM_OF_FEAR);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (helmId as string),
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rule 4: tap the Helm to cancel an attack against the company ───────────

  function combatBase() {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [REN_RW] }], hand: [], siteDeck: [MINAS_MORGUL_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
  }

  test('cancel-attack is offered when the Helm is on the Ringwraith and a creature attacks', () => {
    const withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const state = makeCancelWindowCombat(withItem, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    const helm = helmOnChar(state, RESOURCE_PLAYER, REN_RW)!;
    expect((actions[0].action as CancelAttackAction).cardInstanceId).toBe(helm.instanceId);
  });

  test('activating the Helm cancels the attack, taps the item but NOT the bearer', () => {
    const withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const state = makeCancelWindowCombat(withItem, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    // Combat cancelled, no chain entry (immediate, like an ally/item cancel).
    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();

    // Item is tapped; the Ringwraith bearer stays untapped (cost is "self").
    expect(helmOnChar(after, RESOURCE_PLAYER, REN_RW)!.status).toBe(CardStatus.Tapped);
    const renId = findCharInstanceId(after, RESOURCE_PLAYER, REN_RW);
    expect(after.players[RESOURCE_PLAYER].characters[renId].status).toBe(CardStatus.Untapped);
  });

  test('cancel-attack is NOT offered when the Helm is already tapped', () => {
    let withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const renId = findCharInstanceId(withItem, RESOURCE_PLAYER, REN_RW);
    // Tap the Helm.
    withItem = {
      ...withItem,
      players: withItem.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [renId as string]: {
            ...p.characters[renId],
            items: p.characters[renId].items.map(it =>
              it.definitionId === HELM_OF_FEAR ? { ...it, status: CardStatus.Tapped } : it),
          },
        },
      }) as unknown as typeof withItem.players,
    };
    const state = makeCancelWindowCombat(withItem, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('cancel-attack IS still offered when the bearer is tapped (cost taps only the item)', () => {
    let withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    withItem = setCharStatus(withItem, RESOURCE_PLAYER, REN_RW, CardStatus.Tapped);
    const state = makeCancelWindowCombat(withItem, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);

    // And executing it works: combat cancelled, item tapped.
    const after = dispatch(state, actions[0].action);
    expect(after.combat).toBeNull();
    expect(helmOnChar(after, RESOURCE_PLAYER, REN_RW)!.status).toBe(CardStatus.Tapped);
  });

  test('cancel-attack is NOT offered when the Helm is only in hand (not in play)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [REN_RW] }], hand: [HELM_OF_FEAR], siteDeck: [MINAS_MORGUL_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ── Rule 5: may not cancel combat with a hero company ─────────────────────

  test('cancel-attack is NOT offered against a hero company in character-vs-character combat', () => {
    const withItem = attachItemToChar(combatBase(), RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const base = makeCancelWindowCombat(withItem, { creatureDefId: ORC_PATROL, creatureRace: Race.Orc, attackSourceType: 'creature' });
    // Reframe the combat as a CvCC attack by the Wizard (hero) company.
    const cvccCombat: CombatState = {
      ...(base.combat as CombatState),
      isCvCC: true,
      attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(base, HAZARD_PLAYER) },
    };
    const state = { ...base, combat: cvccCombat };
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ── Rule 6: all body checks against the bearer are modified by -1 ──────────

  test('without the Helm, a body-check roll of 11 eliminates the body-10 Ringwraith', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [REN_RW] }], hand: [], siteDeck: [MINAS_MORGUL_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const renId = findCharInstanceId(base, RESOURCE_PLAYER, REN_RW);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, REN_RW, CardStatus.Inverted);
    const ready = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId: companyIdAt(base, RESOURCE_PLAYER), characterId: renId }),
      cheatRollTotal: 11,
    };
    const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === renId)).toBe(true);
  });

  test('with the Helm (-1), the same body-check roll of 11 lets the body-10 Ringwraith survive', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [REN_RW] }], hand: [], siteDeck: [MINAS_MORGUL_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, REN_RW, HELM_OF_FEAR);
    const renId = findCharInstanceId(withItem, RESOURCE_PLAYER, REN_RW);
    const wounded = setCharStatus(withItem, RESOURCE_PLAYER, REN_RW, CardStatus.Inverted);
    const ready = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId: companyIdAt(base, RESOURCE_PLAYER), characterId: renId }),
      cheatRollTotal: 11,
    };
    const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    // Effective roll 11 - 1 = 10, not greater than body 10 → survives in company.
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === renId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(renId);
  });

  // ── Rule 7: cannot be included in a Balrog's deck ─────────────────────────

  test('a Balrog deck containing Helm of Fear is rejected (rule 1.23)', () => {
    const deck: DeckList = {
      id: 'test-helm-balrog',
      name: 'Helm Balrog Test',
      alignment: 'balrog',
      pool: [{ name: 'Helm of Fear', card: HELM_OF_FEAR, qty: 1 }],
      sideboard: [],
      sites: [],
      deck: { characters: [], hazards: [], resources: [] },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === HELM_OF_FEAR && /1\.23/.test(e.message))).toBe(true);
  });
});
