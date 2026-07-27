/**
 * @module le-211.test
 *
 * Card test: No News of Our Riding (le-211)
 * Type: minion-resource-event, subtype Permanent-event, alignment ringwraith,
 * non-unique. Marshalling points: 1 (miscellaneous).
 *
 * Card text: "Playable on an untapped character immediately after his company
 * faces an Elf, Dúnadan, or Man hazard creature. Tap the character. The
 * character can later tap to cancel an Elf, Dúnadan, or Man hazard creature
 * attack against his company. Cannot be duplicated in a given company."
 *
 * Effects & engine support:
 * | # | Rule                                                          | Mechanism                                                        |
 * |---|---------------------------------------------------------------|------------------------------------------------------------------|
 * | 1 | Playable immediately after facing an Elf/Dúnadan/Man creature | play-window { phase: combat, step: after-attack, when: attack.source ∈ {creature, on-guard-creature} ∧ enemy.race ∈ {elf, dunadan, man} } → `post-attack-play-offer` resolution |
 * | 2 | … on an untapped character of that company                    | play-target character, filter { target.status: "untapped" }       |
 * | 3 | Tap the character                                             | play-target cost { tap: "character" }, applied on chain resolution |
 * | 4 | Character can later tap to cancel a matching creature attack   | cancel-attack cost { tap: "bearer" } with the same attack filter  |
 * | 5 | Cannot be duplicated in a given company                       | duplication-limit scope "company", max 1                          |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildMinionSitePhaseState,
  makeMHState, makeCancelWindowCombat,
  playCreatureHazardAndResolve, runCreatureCombat, resolveChain,
  findCharInstanceId, findHandCardId, companyIdAt, setCharStatus,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, Race, computeLegalActions, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState, PlayPermanentEventAction, CancelAttackAction } from '../../index.js';

const NO_NEWS = 'le-211' as CardDefinitionId;

// Minion fixtures — le-211 is a Ringwraith resource, so the company that faces
// the attack is a minion company at minion sites.
const REN_RW = 'le-56' as CardDefinitionId;        // Ringwraith avatar (mind null)
const LUITPRAND = 'le-23' as CardDefinitionId;     // minion Man companion
const ULFAST = 'le-33' as CardDefinitionId;        // minion Man companion
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion dark-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion shadow-hold (location deck)

// Hazard creatures. Race decides whether the window / the granted ability apply.
const ABDUCTOR = 'tw-1' as CardDefinitionId;       // Man, one strike, keyed {b}
const ELF_LORD = 'le-69' as CardDefinitionId;      // Elf, one strike, keyed {w}{w}
const ORC_LIEUTENANT = 'tw-073' as CardDefinitionId; // Orcs, one strike, keyed {w} — never matches

// Hero side (the hazard player needs a company of its own).
const ARAGORN = 'tw-120' as CardDefinitionId;
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
const LORIEN = 'tw-406' as CardDefinitionId;

/**
 * Minion company in its M/H phase with a declared path, holding `hand`; the
 * hazard player holds `hazards`. `path` picks the resolved site path so the
 * creature under test can be keyed to it.
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
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
        hand: opts.hazards ?? [],
        siteDeck: [LORIEN],
      },
    ],
  });
  const phaseState = opts.path === 'double-wilderness'
    ? makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Hollin'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      })
    : makeMHState({
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Cardolan'],
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
      });
  return { ...state, phaseState };
}

/**
 * Play `creature` against the minion company and fight the single strike out,
 * so the company has "faced" the attack (rule 8.03) and the after-attack window
 * has had its chance to open. The strike is parried (cheat roll 20 — no wound).
 */
function faceCreature(
  state: GameState,
  creature: CardDefinitionId,
  struckChar: CardDefinitionId,
  keying: RegionType = RegionType.Border,
  bodyRoll: number | null = null,
): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, creature);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const inCombat = playCreatureHazardAndResolve(
    state, PLAYER_2, cardId, companyId,
    { method: 'region-type' as const, value: keying },
  );
  expect(inCombat.combat).not.toBeNull();
  return runCreatureCombat(inCombat, struckChar, 20, bodyRoll);
}

/** The after-attack offer queued for the minion player, if any. */
function offerFor(state: GameState) {
  return state.pendingResolutions.find(r => r.kind.type === 'post-attack-play-offer');
}

/** The le-211 card borne by `charDefId` (resource permanent events attach into items). */
function noNewsOn(state: GameState, charDefId: CardDefinitionId) {
  const charId = findCharInstanceId(state, RESOURCE_PLAYER, charDefId);
  return state.players[RESOURCE_PLAYER].characters[charId].items.find(i => i.definitionId === NO_NEWS);
}

/** Play the card on `bearer` through the open after-attack window and resolve the chain. */
function attachViaWindow(state: GameState, bearer: CardDefinitionId): GameState {
  expect(offerFor(state)).toBeDefined();
  const bearerId = findCharInstanceId(state, RESOURCE_PLAYER, bearer);
  const play = viableActions(state, PLAYER_1, 'play-permanent-event').find(
    ea => (ea.action as PlayPermanentEventAction).targetCharacterId === bearerId,
  );
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
}

describe('No News of Our Riding (le-211)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: the after-attack play window ──────────────────────────────────

  test('facing a Man hazard creature opens the after-attack play window', () => {
    const state = mhBase({ characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ABDUCTOR] });
    const after = faceCreature(state, ABDUCTOR, REN_RW);

    expect(after.combat).toBeNull();
    const offer = offerFor(after);
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);
    const noNewsId = findHandCardId(after, RESOURCE_PLAYER, NO_NEWS);
    expect(offer!.kind.type === 'post-attack-play-offer' && offer!.kind.cardInstanceIds).toContain(noNewsId);
  });

  test('facing an Elf hazard creature also opens the window', () => {
    const state = mhBase({
      characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ELF_LORD], path: 'double-wilderness',
    });
    // Elf-lord has a body, so the parried strike is followed by a body check
    // the defender fails (roll 2) — the creature survives and combat ends.
    const after = faceCreature(state, ELF_LORD, REN_RW, RegionType.Wilderness, 2);

    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeDefined();
  });

  test('facing an Orc hazard creature does NOT open the window', () => {
    const state = mhBase({
      characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ORC_LIEUTENANT], path: 'double-wilderness',
    });
    const after = faceCreature(state, ORC_LIEUTENANT, REN_RW, RegionType.Wilderness);

    expect(after.combat).toBeNull();
    expect(offerFor(after)).toBeUndefined();
  });

  test('no window opens when the card is not in hand', () => {
    const state = mhBase({ characters: [REN_RW, LUITPRAND], hand: [], hazards: [ABDUCTOR] });
    const after = faceCreature(state, ABDUCTOR, REN_RW);
    expect(offerFor(after)).toBeUndefined();
  });

  test('the card is NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [REN_RW, LUITPRAND] }],
          hand: [NO_NEWS],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const noNewsId = findHandCardId(state, RESOURCE_PLAYER, NO_NEWS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-permanent-event'
        && ea.action.cardInstanceId === noNewsId,
    );
    expect(plays).toHaveLength(0);
  });

  test('the card is NOT playable during the site phase', () => {
    const state = buildMinionSitePhaseState({
      site: DOL_GULDUR,
      characters: [REN_RW, LUITPRAND],
      hand: [NO_NEWS],
    });
    const noNewsId = findHandCardId(state, RESOURCE_PLAYER, NO_NEWS);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-permanent-event'
        && ea.action.cardInstanceId === noNewsId,
    );
    expect(plays).toHaveLength(0);
  });

  // ── Rule 2: only untapped characters of that company are legal bearers ────

  test('only untapped characters of the company are offered as bearers', () => {
    let state = mhBase({ characters: [REN_RW, LUITPRAND, ULFAST], hand: [NO_NEWS], hazards: [ABDUCTOR] });
    state = setCharStatus(state, RESOURCE_PLAYER, LUITPRAND, CardStatus.Tapped);
    const after = faceCreature(state, ABDUCTOR, REN_RW);

    const ulfastId = findCharInstanceId(after, RESOURCE_PLAYER, ULFAST);
    const luitprandId = findCharInstanceId(after, RESOURCE_PLAYER, LUITPRAND);

    const targets = viableActions(after, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as PlayPermanentEventAction).targetCharacterId);
    expect(targets).toContain(ulfastId);
    expect(targets).not.toContain(luitprandId);
  });

  test('the offer can be declined with pass, closing the window', () => {
    const state = mhBase({ characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ABDUCTOR] });
    const faced = faceCreature(state, ABDUCTOR, REN_RW);
    expect(offerFor(faced)).toBeDefined();

    const after = dispatch(faced, { type: 'pass', player: PLAYER_1 });
    expect(offerFor(after)).toBeUndefined();
    // Nothing was played — the card stays in hand and no character bears it.
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === NO_NEWS)).toBe(true);
    expect(noNewsOn(after, LUITPRAND)).toBeUndefined();
  });

  // ── Rule 3: playing it attaches the card and taps the character ───────────

  test('playing the card attaches it to the chosen character and taps him', () => {
    const state = mhBase({ characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ABDUCTOR] });
    const faced = faceCreature(state, ABDUCTOR, REN_RW);
    const after = attachViaWindow(faced, LUITPRAND);

    expect(noNewsOn(after, LUITPRAND)).toBeDefined();
    const luitprandId = findCharInstanceId(after, RESOURCE_PLAYER, LUITPRAND);
    expect(after.players[RESOURCE_PLAYER].characters[luitprandId].status).toBe(CardStatus.Tapped);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === NO_NEWS)).toBe(false);
    expect(offerFor(after)).toBeUndefined();
  });

  // ── Rule 5: cannot be duplicated in a given company ───────────────────────

  test('a second copy is not offered while one is already in the company', () => {
    const state = mhBase({
      characters: [REN_RW, LUITPRAND, ULFAST], hand: [NO_NEWS, NO_NEWS], hazards: [ABDUCTOR, ABDUCTOR],
    });
    const faced = faceCreature(state, ABDUCTOR, REN_RW);
    const attached = attachViaWindow(faced, LUITPRAND);
    expect(noNewsOn(attached, LUITPRAND)).toBeDefined();

    // Face a second Man creature: Ulfast is still untapped and a copy is still
    // in hand, but the company already carries one — no window opens.
    const again = faceCreature(attached, ABDUCTOR, ULFAST);
    expect(offerFor(again)).toBeUndefined();
  });

  // ── Rule 4: the bearer may later tap to cancel a matching attack ──────────

  /** Minion company with the card borne by Luitprand, stopped in a cancel window. */
  function cancelWindow(opts: {
    creatureRace: Race;
    creatureDefId: CardDefinitionId;
    bearerTapped?: boolean;
    attackSourceType?: 'creature' | 'on-guard-creature' | 'automatic-attack';
  }): GameState {
    const state = mhBase({ characters: [REN_RW, LUITPRAND], hand: [NO_NEWS], hazards: [ABDUCTOR] });
    const faced = faceCreature(state, ABDUCTOR, REN_RW);
    let attached = attachViaWindow(faced, LUITPRAND);
    // Playing the card tapped the bearer; he untaps in his next organization
    // phase, so the "later tap" ability is exercised from an untapped bearer.
    attached = setCharStatus(
      attached, RESOURCE_PLAYER, LUITPRAND,
      opts.bearerTapped ? CardStatus.Tapped : CardStatus.Untapped,
    );
    return makeCancelWindowCombat(attached, {
      creatureDefId: opts.creatureDefId,
      creatureRace: opts.creatureRace,
      attackSourceType: opts.attackSourceType ?? 'creature',
    });
  }

  test('the bearer taps to cancel a Man hazard creature attack', () => {
    const state = cancelWindow({ creatureRace: Race.Man, creatureDefId: ABDUCTOR });
    const noNews = noNewsOn(state, LUITPRAND)!;

    const cancels = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancels).toHaveLength(1);
    expect((cancels[0].action as CancelAttackAction).cardInstanceId).toBe(noNews.instanceId);

    const after = dispatch(state, cancels[0].action);
    expect(after.combat).toBeNull();
    // The cost is the bearer's tap; the card itself stays untapped and in play.
    const luitprandId = findCharInstanceId(after, RESOURCE_PLAYER, LUITPRAND);
    expect(after.players[RESOURCE_PLAYER].characters[luitprandId].status).toBe(CardStatus.Tapped);
    expect(noNewsOn(after, LUITPRAND)!.status).toBe(CardStatus.Untapped);
  });

  test('the bearer may cancel Elf and Dúnadan creature attacks too', () => {
    for (const race of [Race.Elf, Race.Dunadan]) {
      const state = cancelWindow({ creatureRace: race, creatureDefId: ELF_LORD });
      expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
    }
  });

  test('no cancel is offered against an Orc attack', () => {
    const state = cancelWindow({ creatureRace: Race.Orc, creatureDefId: ORC_LIEUTENANT });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('no cancel is offered against a site automatic-attack (not a hazard creature)', () => {
    const state = cancelWindow({ creatureRace: Race.Man, creatureDefId: ABDUCTOR, attackSourceType: 'automatic-attack' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('an on-guard creature attack of a matching race can be canceled', () => {
    const state = cancelWindow({ creatureRace: Race.Man, creatureDefId: ABDUCTOR, attackSourceType: 'on-guard-creature' });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('no cancel is offered while the bearer is tapped', () => {
    const state = cancelWindow({ creatureRace: Race.Man, creatureDefId: ABDUCTOR, bearerTapped: true });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('the card in hand grants no cancel — it must be in play', () => {
    const base = mhBase({ characters: [REN_RW, LUITPRAND], hand: [NO_NEWS] });
    const state = makeCancelWindowCombat(base, {
      creatureDefId: ABDUCTOR, creatureRace: Race.Man, attackSourceType: 'creature',
    });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
