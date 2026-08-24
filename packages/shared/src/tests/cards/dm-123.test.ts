/**
 * @module dm-123.test
 *
 * Card test: Dark Numbers (dm-123)
 * Type: hero-resource-event (permanent), Stolen Knowledge, alignment wizard,
 * non-unique. Marshalling points: 0 (miscellaneous).
 *
 * Card text: "Stolen Knowledge. Playable on an untapped scout immediately
 * after facing an Orc, Troll, or Man attack. Tap scout. Can be stored at a
 * Haven [{H}]. If not stored, discard to give +3 to an influence attempt
 * against a faction by a character in the same company."
 *
 * Effects & engine support:
 * | # | Rule                                                         | Mechanism                                                             |
 * |---|---------------------------------------------------------------|------------------------------------------------------------------------|
 * | 1 | Stolen Knowledge (card-category tag)                          | keywords: ["stolen-knowledge"] — tag-only, referenced by sibling cards |
 * | 2 | Playable immediately after facing an Orc/Troll/Man attack     | play-window { phase: combat, step: after-attack, when: attack.source ∈ {creature, on-guard-creature, automatic-attack, played-auto-attack} ∧ enemy.race ∈ {orc, troll, man} } |
 * | 3 | … on an untapped scout of that company                        | play-target character, filter { target.skills $includes "scout" ∧ target.status: "untapped" } |
 * | 4 | Tap scout                                                      | play-target cost { tap: "character" }                                  |
 * | 5 | Can be stored at a Haven                                       | storable-at, siteTypes: ["haven"]                                       |
 * | 6 | If not stored, discard for +3 to a company-mate's influence attempt | grant-action "discard-boost-influence", activeSitePhase, cost { discard: "self" }, add-constraint check-modifier influence +3 (turn-scoped, target action-target-character) |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildSitePhaseState, attachItemToChar,
  makeBorderMHState, makeDoubleWildernessMHState, makeCancelWindowCombat,
  playCreatureHazardAndResolve, runCreatureCombat, resolveChain,
  findCharInstanceId, findHandCardId, companyIdAt, setCharStatus,
  viableActions, dispatch,
  ARAGORN, FARAMIR, MEN_OF_LEBENNIN, PELARGIR, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
} from '../test-helpers.js';
import { Phase, RegionType, Race, computeLegalActions, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayPermanentEventAction,
  ActivateGrantedAction, InfluenceAttemptAction,
} from '../../index.js';
import { enqueuePostAttackPlayOffers } from '../../engine/post-attack-play.js';

const DARK_NUMBERS = 'dm-123' as CardDefinitionId;

// Hazard creatures used to face the after-attack window's race gate.
const ORC_LIEUTENANT = 'tw-073' as CardDefinitionId; // Orc, one strike, keyed {w}
const ABDUCTOR = 'tw-1' as CardDefinitionId;         // Man, one strike, keyed {b}
const TOM_TUMA = 'tw-103' as CardDefinitionId;       // Troll, one strike, keyed {w}{w}
const ELF_LORD = 'le-69' as CardDefinitionId;        // Elf, one strike, keyed {w}{w} — never matches

/**
 * Hero company in its M/H phase moving from Rivendell, holding `hand`; the
 * opposing (hazard-playing) player holds `hazards`. `path` picks the resolved
 * site path so the creature under test can be keyed to it.
 */
function mhBase(opts: {
  characters: CardDefinitionId[];
  hand?: CardDefinitionId[];
  hazards?: CardDefinitionId[];
  path?: 'border' | 'double-wilderness';
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [MORIA],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [FARAMIR] }],
        hand: opts.hazards ?? [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  const phaseState = opts.path === 'double-wilderness'
    ? makeDoubleWildernessMHState()
    : makeBorderMHState();
  return { ...state, phaseState };
}

/**
 * Play `creature` against the hero company and fight the single strike out,
 * without tapping to fight (so the struck scout stays untapped and eligible
 * as a bearer afterward). Rolls the max valid cheat total (12); with Aragorn's
 * untapped prowess (6 - 3 = 3), the 12 roll (total 15) defeats every creature
 * used in this file (prowess up to 13; the 15-prowess Elf-lord ties, which
 * still counts as a defeated strike but taps the character).
 */
function faceCreature(
  state: GameState,
  creature: CardDefinitionId,
  struckChar: CardDefinitionId,
  keying: RegionType,
  bodyRoll: number | null = null,
): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, creature);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const inCombat = playCreatureHazardAndResolve(
    state, PLAYER_2, cardId, companyId,
    { method: 'region-type' as const, value: keying },
  );
  expect(inCombat.combat).not.toBeNull();
  return runCreatureCombat(inCombat, struckChar, 12, bodyRoll);
}

/** The after-attack offer queued for the hero player, if any. */
function offerFor(state: GameState) {
  return state.pendingResolutions.find(r => r.kind.type === 'post-attack-play-offer');
}

describe('Dark Numbers (dm-123)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: the after-attack play window, gated on race ───────────────────

  test('facing an Orc hazard creature opens the after-attack play window', () => {
    const state = mhBase({
      characters: [ARAGORN], hand: [DARK_NUMBERS], hazards: [ORC_LIEUTENANT], path: 'double-wilderness',
    });
    const after = faceCreature(state, ORC_LIEUTENANT, ARAGORN, RegionType.Wilderness);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeDefined();
  });

  test('facing a Man hazard creature opens the after-attack play window', () => {
    const state = mhBase({
      characters: [ARAGORN], hand: [DARK_NUMBERS], hazards: [ABDUCTOR], path: 'border',
    });
    const after = faceCreature(state, ABDUCTOR, ARAGORN, RegionType.Border);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeDefined();
  });

  test('facing a Troll hazard creature opens the after-attack play window', () => {
    const state = mhBase({
      characters: [ARAGORN], hand: [DARK_NUMBERS], hazards: [TOM_TUMA], path: 'double-wilderness',
    });
    const after = faceCreature(state, TOM_TUMA, ARAGORN, RegionType.Wilderness);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeDefined();
  });

  test('facing an Elf hazard creature does NOT open the window', () => {
    const state = mhBase({
      characters: [ARAGORN], hand: [DARK_NUMBERS], hazards: [ELF_LORD], path: 'double-wilderness',
    });
    // Elf-lord has a body, so the parried strike is followed by a body check
    // the defender fails (roll 2) — the creature survives and combat ends.
    const after = faceCreature(state, ELF_LORD, ARAGORN, RegionType.Wilderness, 2);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeUndefined();
  });

  test('an Orc site automatic-attack also opens the window', () => {
    const base = mhBase({ characters: [ARAGORN], hand: [DARK_NUMBERS] });
    const withCombat = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackSourceType: 'automatic-attack',
      strikesTotal: 1,
    });
    const after = runCreatureCombat(withCombat, ARAGORN, 12, null);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeDefined();
  });

  test('a site\'s NEXT automatic-attack opens the window between the two attacks', () => {
    // Regression: multi-attack sequences install the next attack in the same
    // reduce step that finalizes the previous one, so the prev/next diff sees
    // two live combats. sameAttack() discriminated only creature sources —
    // two different automatic-attacks of one site (attackIndex 0 → 1) compared
    // as "the same attack" and the CoE 8.03 window between them was skipped.
    const base = mhBase({ characters: [ARAGORN], hand: [DARK_NUMBERS] });
    const prev = makeCancelWindowCombat(base, {
      creatureRace: Race.Orc,
      attackSourceType: 'automatic-attack',
      strikesTotal: 1,
    });
    const siteInstanceId = (prev.combat!.attackSource as { siteInstanceId: CardInstanceId }).siteInstanceId;
    const next: GameState = {
      ...prev,
      combat: {
        ...prev.combat!,
        attackSource: { type: 'automatic-attack', siteInstanceId, attackIndex: 1 },
      },
    };

    // Attack 0 ended, attack 1 of the same site began → the window opens.
    expect(offerFor(enqueuePostAttackPlayOffers(prev, next))).toBeDefined();
    // Control: the same attack still running opens no window.
    expect(offerFor(enqueuePostAttackPlayOffers(prev, prev))).toBeUndefined();
  });

  test('no window opens when the company has no scout at all', () => {
    const state = mhBase({
      characters: [FARAMIR], hand: [DARK_NUMBERS], hazards: [ORC_LIEUTENANT], path: 'double-wilderness',
    });
    const after = faceCreature(state, ORC_LIEUTENANT, FARAMIR, RegionType.Wilderness);
    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeUndefined();
  });

  // ── Rule 3: only an untapped scout of the company is a legal bearer ───────

  test('only the scout (not a non-scout company-mate) is offered as bearer', () => {
    const state = mhBase({
      characters: [ARAGORN, FARAMIR], hand: [DARK_NUMBERS], hazards: [ORC_LIEUTENANT], path: 'double-wilderness',
    });
    const after = faceCreature(state, ORC_LIEUTENANT, ARAGORN, RegionType.Wilderness);

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(after, RESOURCE_PLAYER, FARAMIR);
    const targets = viableActions(after, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);
    expect(targets).toContain(aragornId);
    expect(targets).not.toContain(faramirId);
  });

  // ── Rule 4: playing it attaches the card and taps the scout ───────────────

  test('playing the card attaches it to the scout and taps him', () => {
    const state = mhBase({
      characters: [ARAGORN], hand: [DARK_NUMBERS], hazards: [ORC_LIEUTENANT], path: 'double-wilderness',
    });
    const after = faceCreature(state, ORC_LIEUTENANT, ARAGORN, RegionType.Wilderness);
    const play = viableActions(after, PLAYER_1, 'play-permanent-event').find(
      ea => (ea.action as PlayPermanentEventAction).targetCharacterId
        === findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN),
    )!;
    const attached = resolveChain(dispatch(after, play.action));

    const aragornId = findCharInstanceId(attached, RESOURCE_PLAYER, ARAGORN);
    const aragorn = attached.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.status).toBe(CardStatus.Tapped);
    expect(aragorn.items.some(i => i.definitionId === DARK_NUMBERS)).toBe(true);
    expect(attached.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === DARK_NUMBERS)).toBe(false);
  });

  // ── Rule 5: storable at a Haven ────────────────────────────────────────────

  test('Dark Numbers can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DARK_NUMBERS] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);

    // Storing awards the printed 1 misc marshalling point (storable-at MP).
    const stored = dispatch(state, storeActions[0].action);
    expect(stored.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === DARK_NUMBERS)).toBe(true);
    expect(stored.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(1);
  });

  // ── Rule 6: discard for +3 to a company-mate's influence attempt ──────────

  test('the granted ability is offered for BOTH the scout bearer and an untapped company-mate', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FARAMIR],
      site: PELARGIR,
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DARK_NUMBERS);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    const targets = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'discard-boost-influence')
      .map(a => a.targetCardId);

    // Unlike boost-company-influence (dm-163), the cost is discarding the
    // card, not tapping the bearer, so the bearer remains a legal target.
    expect(targets).toContain(aragornId);
    expect(targets).toContain(faramirId);
  });

  test('the granted ability is NOT offered for a tapped company-mate', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FARAMIR],
      site: PELARGIR,
    });
    const attached = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DARK_NUMBERS);
    const state = setCharStatus(attached, RESOURCE_PLAYER, FARAMIR, CardStatus.Tapped);

    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);
    const targets = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'discard-boost-influence')
      .map(a => a.targetCardId);
    expect(targets).not.toContain(faramirId);
  });

  test('activating discards the card and adds a +3 turn-scoped influence check-modifier on the chosen character', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FARAMIR],
      site: PELARGIR,
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DARK_NUMBERS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    const action = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'discard-boost-influence' && a.targetCardId === faramirId)!;
    const after = dispatch(state, action);

    // The card is discarded from the bearer's items to the player's discard pile.
    const aragorn = after.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.items.some(i => i.definitionId === DARK_NUMBERS)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DARK_NUMBERS)).toBe(true);

    const infConstraints = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(infConstraints).toHaveLength(1);
    const constraint = infConstraints[0];
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.value).toBe(3);
    }
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target.kind).toBe('character');
    if (constraint.target.kind === 'character') {
      expect(constraint.target.characterId).toBe(faramirId);
    }
  });

  test('the +3 modifier reduces a company-mate influence-attempt need and is consumed', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FARAMIR],
      site: PELARGIR,
      hand: [MEN_OF_LEBENNIN], // playable at Pelargir, influence # 8, Dúnedain +1
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DARK_NUMBERS);
    const faramirId = findCharInstanceId(state, RESOURCE_PLAYER, FARAMIR);

    // Baseline: Faramir (Dúnedain, DI 1) → need 8 - 1 (DI) - 1 (Dúnedain) = 6.
    const baseAttempt = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === faramirId);
    expect(baseAttempt?.need).toBe(6);

    const activate = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'discard-boost-influence' && a.targetCardId === faramirId)!;
    const boosted = dispatch(state, activate);

    const boostedAttempt = computeLegalActions(boosted, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'influence-attempt')
      .map(ea => ea.action as InfluenceAttemptAction)
      .find(a => a.influencingCharacterId === faramirId);
    expect(boostedAttempt?.need).toBe(3); // 6 - 3

    // Resolve the attempt — the one-shot constraint is consumed.
    const factionInstance = boosted.players[RESOURCE_PLAYER].hand.find(
      c => c.definitionId === MEN_OF_LEBENNIN,
    )!;
    const afterAttempt = resolveChain(dispatch({ ...boosted, cheatRollTotal: 12 }, {
      type: 'influence-attempt',
      player: PLAYER_1,
      factionInstanceId: factionInstance.instanceId,
      influencingCharacterId: faramirId,
      need: 3,
      explanation: 'test',
    }));
    const rollAction = computeLegalActions(afterAttempt, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'faction-influence-roll')[0].action;
    const after = dispatch(afterAttempt, rollAction);

    const remaining = after.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    );
    expect(remaining).toHaveLength(0);
  });

  test('once stored, the granted ability is no longer offered (it left the bearer\'s items)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DARK_NUMBERS] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FARAMIR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const storeAction = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, storeAction);

    const actions = viableActions(afterStore, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'discard-boost-influence');
    expect(actions).toHaveLength(0);
    expect(afterStore.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DARK_NUMBERS)).toBe(false);
  });
});
