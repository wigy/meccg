/**
 * @module ba-79.test
 *
 * Card test: Vanguard of Might (ba-79)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Balrog specific.
 *
 * Text:
 *   "Balrog specific. Playable if a company at or moving to an Under-deeps site
 *    is facing an attack and Flame of Udûn is not in play. If not in the
 *    company, The Balrog immediately joins the company. This is considered
 *    movement for The Balrog with no movement/hazard phase. The Balrog must
 *    face a strike from the attack, regardless of any conflicting effects.
 *    Following the attack, if untapped, tap The Balrog."
 *
 * Implemented as a single `join-combat-force-strike` effect
 * ({ characterName: "The Balrog", tapAfterAttack: true,
 *    requiresSiteKeyword: "under-deeps", notInPlay: "Flame of Udûn" }):
 *   - Offered to the defending player in the pre-assignment window of the
 *     `assign-strikes` combat sub-phase, gated on the defending company being at
 *     (currentSite) or moving to (destinationSite) an under-deeps site, Flame of
 *     Udûn not in play, and The Balrog being in play for that player.
 *   - On play, The Balrog joins the attacked company if absent (membership only
 *     — "movement with no movement/hazard phase"), is added to
 *     `combat.forcedStrikeTargets` (its status gate is bypassed so it must face
 *     a strike "regardless of any conflicting effects"), and a
 *     `postAttackEffects` entry taps it after combat if still untapped.
 *
 * "Balrog specific" is a deck-construction keyword (`balrog-specific`), no
 * play-time gate — per the ba-45/ba-46 precedent.
 *
 * Rule coverage:
 * | # | Rule                                                                | Status      |
 * |---|---------------------------------------------------------------------|-------------|
 * | 1 | Offered vs an attack while at an under-deeps site (Balrog in play)   | IMPLEMENTED |
 * | 2 | Offered when the company is moving to (destination) an under-deeps   | IMPLEMENTED |
 * | 3 | NOT offered when the company is not at/moving to an under-deeps site | IMPLEMENTED |
 * | 4 | NOT offered when Flame of Udûn is in play                            | IMPLEMENTED |
 * | 5 | NOT offered when The Balrog is not in play                           | IMPLEMENTED |
 * | 6 | Play forces The Balrog to face a strike (forcedStrikeTargets)        | IMPLEMENTED |
 * | 7 | Play schedules the post-attack tap (postAttackEffects tapIfUntapped) | IMPLEMENTED |
 * | 8 | The spent event card is discarded                                    | IMPLEMENTED |
 * | 9 | If absent, The Balrog joins the attacked company on play            | IMPLEMENTED |
 * | 10| The forced strike restricts defender assignment to The Balrog       | IMPLEMENTED |
 * | 11| The forced strike bypasses the untapped gate (tapped Balrog)        | IMPLEMENTED |
 * | 12| Following the attack, an untapped Balrog is tapped                   | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   VANGUARD (ba-79)        - minion short event (this card)
 *   THE_BALROG (ba-3)       - minion balrog avatar, name "The Balrog", prowess 8
 *   LUITPRAND (le-23)       - generic minion man (non-Balrog company member)
 *   FLAME_OF_UDUN (ba-58)   - Balrog permanent event (the exclusion card)
 *   UNDER_COURTS (ba-98)    - dark-hold, `under-deeps` keyword (the combat site)
 *   MORIA (tw-413)          - non-under-deeps site (negative control)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, executeAction,
  findCharInstanceId, findHandCardId, companyIdAt, expectInDiscardPile,
  MORIA, LORIEN, RIVENDELL,
  PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, CardInPlay } from '../../index.js';
import { Alignment, CardStatus, Race } from '../../index.js';

const VANGUARD = 'ba-79' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;
const FLAME_OF_UDUN = 'ba-58' as CardDefinitionId;
const UNDER_COURTS = 'ba-98' as CardDefinitionId; // dark-hold, under-deeps

interface VanguardOpts {
  /** PLAYER_1's companies (character lists). Company 0 is the attacked company. */
  companies: CardDefinitionId[][];
  /** currentSite for the attacked company (index 0). Defaults to an under-deeps site. */
  site?: CardDefinitionId;
  /** destinationSite for the attacked company (index 0). */
  destinationSite?: CardDefinitionId;
  /** Put Flame of Udûn in PLAYER_1's cardsInPlay. */
  flameInPlay?: boolean;
  /** Status override for The Balrog (e.g. tapped). */
  balrogStatus?: CardStatus;
  strikesTotal?: number;
  strikeProwess?: number;
  creatureBody?: number | null;
}

/**
 * Build an M/H creature combat against PLAYER_1's company 0. The attacked
 * company sits at an under-deeps site by default; PLAYER_1 (the Balrog player)
 * holds Vanguard of Might in hand.
 */
function buildVanguardCombat(opts: VanguardOpts): {
  state: ReturnType<typeof buildTestState>;
  balrogId: CardInstanceId | undefined;
} {
  const site = opts.site ?? UNDER_COURTS;
  const p1Companies = opts.companies.map((chars, i) => ({
    site: i === 0 ? site : MORIA,
    characters: chars,
    ...(i === 0 && opts.destinationSite ? { destinationSite: opts.destinationSite } : {}),
  }));
  const flame: CardInPlay[] = opts.flameInPlay
    ? [{ instanceId: 'flame-of-udun-inst' as CardInstanceId, definitionId: FLAME_OF_UDUN, status: CardStatus.Untapped }]
    : [];

  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: p1Companies, hand: [VANGUARD], siteDeck: [MORIA],
        cardsInPlay: flame,
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [RIVENDELL],
      },
    ],
  });

  // Optional Balrog status override (e.g. tapped) — locate wherever it sits.
  let balrogId: CardInstanceId | undefined;
  const chars = state.players[RESOURCE_PLAYER].characters;
  for (const [id, ch] of Object.entries(chars)) {
    if (ch.definitionId === THE_BALROG) balrogId = id as CardInstanceId;
  }
  if (balrogId && opts.balrogStatus) {
    const bId = balrogId;
    state = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: { ...chars, [bId as string]: { ...chars[bId], status: opts.balrogStatus } },
        },
        state.players[1],
      ] as unknown as typeof state.players,
    };
  }

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'fake-orc-attacker' as CardInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: opts.strikesTotal ?? 1,
    strikeProwess: opts.strikeProwess ?? 4,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: Race.Orc,
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { state: { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat }, balrogId };
}

describe('Vanguard of Might (ba-79)', () => {
  beforeEach(() => resetMint());

  // ─── Offering ───────────────────────────────────────────────────────────────

  test('offered vs an attack while at an under-deeps site (Balrog in the company)', () => {
    const { state } = buildVanguardCombat({ companies: [[THE_BALROG]] });
    expect(state.combat!.phase).toBe('assign-strikes');
    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(1);
  });

  test('offered when the company is moving to an under-deeps site (destination gate)', () => {
    // currentSite is a plain site; the destination is the under-deeps site.
    const { state } = buildVanguardCombat({
      companies: [[THE_BALROG]],
      site: MORIA,
      destinationSite: UNDER_COURTS,
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(1);
  });

  test('offered when The Balrog is in a DIFFERENT company (it will join on play)', () => {
    const { state } = buildVanguardCombat({ companies: [[LUITPRAND], [THE_BALROG]] });
    expect(viableActions(state, PLAYER_1, 'play-short-event').length).toBe(1);
  });

  test('NOT offered when the company is not at nor moving to an under-deeps site', () => {
    const { state } = buildVanguardCombat({ companies: [[THE_BALROG]], site: MORIA });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT offered when Flame of Udûn is in play', () => {
    const { state } = buildVanguardCombat({ companies: [[THE_BALROG]], flameInPlay: true });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT offered when The Balrog is not in play', () => {
    const { state } = buildVanguardCombat({ companies: [[LUITPRAND]] });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ─── Play effects ─────────────────────────────────────────────────────────────

  test('playing forces The Balrog to face a strike and schedules the post-attack tap', () => {
    const { state, balrogId } = buildVanguardCombat({ companies: [[THE_BALROG]] });
    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    expect(after.combat!.forcedStrikeTargets).toContain(balrogId!);
    const post = (after.combat!.postAttackEffects ?? []).find(e => e.targetCharacterId === balrogId);
    expect(post).toBeDefined();
    expect(post!.tapIfUntapped).toBe(true);
  });

  test('the spent event card is discarded on play', () => {
    const { state } = buildVanguardCombat({ companies: [[THE_BALROG]] });
    const cardId = findHandCardId(state, RESOURCE_PLAYER, VANGUARD);
    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expectInDiscardPile(after, RESOURCE_PLAYER, VANGUARD);
  });

  test('if absent, The Balrog joins the attacked company on play (movement, membership only)', () => {
    const { state, balrogId } = buildVanguardCombat({ companies: [[LUITPRAND], [THE_BALROG]] });
    const attackedCompanyId = state.combat!.companyId;

    // Precondition: The Balrog starts in company 1, not the attacked company 0.
    const before = state.players[RESOURCE_PLAYER].companies.find(c => c.id === attackedCompanyId)!;
    expect(before.characters).not.toContain(balrogId!);

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    const attacked = after.players[RESOURCE_PLAYER].companies.find(c => c.id === attackedCompanyId)!;
    expect(attacked.characters).toContain(balrogId!);
    // Removed from the other company (no duplicate membership).
    const others = after.players[RESOURCE_PLAYER].companies.filter(c => c.id !== attackedCompanyId);
    for (const c of others) expect(c.characters).not.toContain(balrogId!);
    expect(after.combat!.forcedStrikeTargets).toContain(balrogId!);
  });

  // ─── Forced strike behaviour ────────────────────────────────────────────────

  test('after play the defender may only assign a strike to The Balrog (forced target)', () => {
    const { state, balrogId } = buildVanguardCombat({ companies: [[THE_BALROG, LUITPRAND]] });
    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    const targets = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
    expect(targets).toContain(balrogId!);
    // Luitprand is not a legal target while the forced Balrog strike is pending.
    const luitId = findCharInstanceId(after, RESOURCE_PLAYER, LUITPRAND);
    expect(targets).not.toContain(luitId);
  });

  test('the forced strike bypasses the untapped gate (a tapped Balrog must still face it)', () => {
    const { state, balrogId } = buildVanguardCombat({
      companies: [[THE_BALROG]],
      balrogStatus: CardStatus.Tapped,
    });
    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    const targets = viableActions(after, PLAYER_1, 'assign-strike')
      .map(ea => (ea.action as { characterId?: CardInstanceId }).characterId);
    // Tapped characters are normally not assignable — but the forced Balrog is.
    expect(targets).toContain(balrogId!);
  });

  // ─── Post-attack tap (end-to-end) ────────────────────────────────────────────

  test('following the attack, an untapped Balrog is tapped', () => {
    const { state, balrogId } = buildVanguardCombat({
      companies: [[THE_BALROG]],
      strikesTotal: 1,
      strikeProwess: 4,
      creatureBody: null,
    });
    const play = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const afterPlay = dispatch(state, play);

    // Assign the single forced strike to The Balrog.
    const assign = viableActions(afterPlay, PLAYER_1, 'assign-strike')
      .find(ea => (ea.action as { characterId?: CardInstanceId }).characterId === balrogId)!.action;
    const afterAssign = dispatch(afterPlay, assign);

    // Resolve the strike staying untapped — prowess 8 easily parries a 4-strike.
    const resolved = executeAction(afterAssign, PLAYER_1, 'resolve-strike', 11, false);

    // Combat is over; the post-attack effect taps the (still-untapped) Balrog.
    expect(resolved.combat).toBeNull();
    expect(resolved.players[RESOURCE_PLAYER].characters[balrogId!].status).toBe(CardStatus.Tapped);
  });
});
