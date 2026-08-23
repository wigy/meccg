/**
 * @module tw-225.test
 *
 * Card test: Elven Cloak (tw-225)
 * Type: hero-resource-item (subtype: minor), alignment wizard, non-unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * Card text: "Tap Elven Cloak to cancel one hazard creature strike against
 * bearer keyed by type to one or more Wilderness [{w}]. Cannot be duplicated
 * on a given character."
 *
 * Rule coverage:
 *
 * | # | Rule                                                        | Mechanism                                                       |
 * |---|--------------------------------------------------------------|-----------------------------------------------------------------|
 * | 1 | Tap to cancel a strike from a creature keyed to {w}          | cancel-strike cost {tap:self}, when attack.keying "wilderness"   |
 * | 2 | Applying the cancel taps the cloak (not bearer), strike gone | handleCancelStrike                                               |
 * | 3 | No cancel when the creature is keyed elsewhere ({s}/{d} only) | when condition on attack.keying fails                            |
 * | 4 | A tapped Elven Cloak cannot cancel                           | selfCancelStrikeActions requires untapped item                  |
 * | 5 | Only protects its own bearer (self-target)                   | cancel-strike target self — scan is over the struck char's items|
 * | 6 | Cannot be duplicated on a given character                    | duplication-limit scope:character max:1 (item play at site)     |
 *
 * Reuses the shared attack-keying context (`buildAttackKeyingCtx`) already
 * proven by Shadow-cloak (le-344), keying the gate to `wilderness` instead of
 * shadow/dark. Land-drake (le-80) is keyed {w}/{R} (declared here via its
 * region-type match), so it satisfies the gate; Barrow-wight (tw-14) is keyed
 * only {s}{d}/{S}{D}, so it does not.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, mint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  getCharacter, makeMHState,
  findCharInstanceId, findHandCardId, handCardId, companyIdAt, resolveChain, dispatch, actionAs,
} from '../test-helpers.js';
import type { CharacterEntry } from '../test-helpers.js';
import {
  ARAGORN, LEGOLAS, MORIA, MINAS_TIRITH, LORIEN,
  computeLegalActions, RegionType, Alignment, SetupStep,
} from '../../index.js';
import type { CardDefinitionId, CancelStrikeAction, GameState } from '../../index.js';

const ELVEN_CLOAK = 'tw-225' as CardDefinitionId;
const LAND_DRAKE = 'le-80' as CardDefinitionId;  // keyed {w}/{R}, 1 strike, 8 prowess
const BARROW_WIGHT = 'tw-14' as CardDefinitionId; // keyed {s}{d}/{S}{D} only, 1 strike, 12 prowess, no special effects

/**
 * Build an M/H-phase state with a single hero company (player 0, bearing the
 * given `characters`) and the hazard player (player 1) holding one creature,
 * then play that creature keyed by the declared `keyedBy` match and drive
 * combat up to the resolve-strike sub-phase against `targetCharacterDefId`.
 */
function bearerFacingStrike(
  characters: CharacterEntry[],
  creature: CardDefinitionId,
  keyedBy: { method: 'region-type'; value: RegionType },
  targetCharacterDefId: CardDefinitionId,
) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [creature], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const mh = makeMHState({
    resolvedSitePath: [keyedBy.value],
    resolvedSitePathNames: [],
    destinationSiteType: null,
    destinationSiteName: null,
  });
  const gameState = { ...state, phaseState: mh };

  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const afterPlay = dispatch(gameState, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: creatureId,
    targetCompanyId: companyId,
    keyedBy,
  });
  const afterChain = resolveChain(afterPlay);

  const targetId = findCharInstanceId(afterChain, RESOURCE_PLAYER, targetCharacterDefId);
  const r = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: targetId, tapped: false });
  return r;
}

describe('Elven Cloak (tw-225)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 & 2: cancel a strike from a creature keyed to Wilderness ──────

  test('bearer facing a creature keyed to Wilderness may tap Elven Cloak to cancel the strike', () => {
    const r2 = bearerFacingStrike(
      [{ defId: ARAGORN, items: [ELVEN_CLOAK] }],
      LAND_DRAKE,
      { method: 'region-type', value: RegionType.Wilderness },
      ARAGORN,
    );
    expect(r2.combat!.phase).toBe('resolve-strike');

    const bearerId = findCharInstanceId(r2, RESOURCE_PLAYER, ARAGORN);
    const cloakId = getCharacter(r2, RESOURCE_PLAYER, ARAGORN).items[0].instanceId;

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(1);
    expect(actionAs<CancelStrikeAction>(cancels[0].action).cancellerInstanceId).toBe(cloakId);
    expect(actionAs<CancelStrikeAction>(cancels[0].action).targetCharacterId).toBe(bearerId);

    // Applying the cancel taps the cloak (not the bearer) and removes the strike.
    const r3 = dispatch(r2, cancels[0].action);
    const bearerAfter = r3.players[RESOURCE_PLAYER].characters[bearerId];
    const cloakAfter = bearerAfter.items.find(i => i.instanceId === cloakId)!;
    expect(cloakAfter.status).toBe(CardStatus.Tapped);
    expect(bearerAfter.status).toBe(CardStatus.Untapped);

    const strike = r3.combat === null
      ? undefined
      : r3.combat.strikeAssignments.find(sa => sa.characterId === bearerId);
    if (strike) {
      expect(strike.resolved).toBe(true);
      expect(strike.result).toBe('canceled');
    } else {
      // Sole strike canceled → combat ends outright.
      expect(r3.combat).toBeNull();
    }
  });

  // ── Rule 3: no cancel against a creature keyed only to Border/Border-hold ─

  test('bearer facing a creature keyed only to Shadow-land cannot cancel with Elven Cloak', () => {
    const r2 = bearerFacingStrike(
      [{ defId: ARAGORN, items: [ELVEN_CLOAK] }],
      BARROW_WIGHT,
      { method: 'region-type', value: RegionType.Shadow },
      ARAGORN,
    );
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 4: a tapped Elven Cloak cannot cancel ────────────────────────────

  test('a tapped Elven Cloak offers no cancel even against a Wilderness-keyed creature', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [ELVEN_CLOAK] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LAND_DRAKE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bearerKey = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const bearerChar = base.players[RESOURCE_PLAYER].characters[bearerKey];
    const tappedCloak = { ...bearerChar.items[0], status: CardStatus.Tapped };
    const state = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          characters: { ...base.players[RESOURCE_PLAYER].characters, [bearerKey]: { ...bearerChar, items: [tappedCloak] } },
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: [], destinationSiteType: null, destinationSiteName: null }),
    };

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: creatureId,
      targetCompanyId: companyId,
      keyedBy: { method: 'region-type', value: RegionType.Wilderness },
    });
    const afterChain = resolveChain(afterPlay);
    const bearerId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    const r2 = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: bearerId, tapped: false });

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 5: only protects its own bearer ─────────────────────────────────

  test('Elven Cloak does not cancel a strike against a different character in the company', () => {
    const r2 = bearerFacingStrike(
      [{ defId: ARAGORN, items: [ELVEN_CLOAK] }, { defId: LEGOLAS }],
      LAND_DRAKE,
      { method: 'region-type', value: RegionType.Wilderness },
      LEGOLAS,
    );
    expect(r2.combat!.phase).toBe('resolve-strike');

    const cancels = computeLegalActions(r2, PLAYER_1).filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancels).toHaveLength(0);
  });

  // ── Rule 6: cannot be duplicated on a given character ─────────────────────

  test('a character already bearing Elven Cloak may not receive a second; another may', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [{ defId: ARAGORN, items: [ELVEN_CLOAK] }, LEGOLAS],
      hand: [ELVEN_CLOAK],
    });

    const cloakInHand = findHandCardId(state, RESOURCE_PLAYER, ELVEN_CLOAK);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (cloakInHand as string),
    );
    const targets = plays.map(ea => (ea.action as { attachToCharacterId?: string }).attachToCharacterId);

    // Not offered on the character that already bears one.
    expect(targets).not.toContain(aragornId as string);
    // Offered on the character without one.
    expect(targets).toContain(legolasId as string);
  });

  // ── Starting-item pool eligibility ────────────────────────────────────────

  test('Elven Cloak is offered as a legal starting item', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cloakInst = { instanceId: mint(), definitionId: ELVEN_CLOAK };
    const state: GameState = {
      ...base,
      phaseState: {
        phase: Phase.Setup,
        setupStep: {
          step: SetupStep.ItemDraft,
          itemDraftState: [
            { unassignedItems: [cloakInst], done: false },
            { unassignedItems: [], done: true },
          ],
          remainingPool: [[], []],
        },
      },
    } as GameState;

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.action.type === 'assign-starting-item'
        && (ea.action as { itemDefId?: string }).itemDefId === ELVEN_CLOAK);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(ea => ea.viable)).toBe(true);
  });

  // Elven Cloak is a non-unique, non-hoard minor item, so CoE rule 1.7 makes
  // it eligible for a player's pool. The deck editor's pool card browser (and
  // the `starting-item` keyword's documented semantics, types/common.ts) key
  // off this keyword to decide which minor items may be offered for the
  // starting-company pool; it was missing from this card's data, silently
  // hiding an otherwise-legal card from that picker.
  test('Elven Cloak carries the starting-item keyword (CoE rule 1.7 pool eligibility)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const def = base.cardPool[ELVEN_CLOAK] as { keywords?: readonly string[] };
    expect(def.keywords ?? []).toContain('starting-item');
  });
});
