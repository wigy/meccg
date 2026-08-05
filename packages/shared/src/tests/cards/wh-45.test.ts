/**
 * @module wh-45.test
 *
 * Card test: Govern the Storms (wh-45)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Sorcery.
 *
 * Card text:
 *   "Magic. Sorcery. Cancel all hazard effects for the rest of the turn that:
 *    force a sorcery-using character's company to return to its site of
 *    origin or would tap its current or new site. Unless he is a Ringwraith,
 *    the sorcery using character makes a corruption check modified by -4."
 *
 * Distinct rules:
 *   1. Play-target — a `play-target` (character) with filter `$or` over
 *      `target.race === "ringwraith"` and `target.skills $includes "sorcery"`
 *      (mirrors the shadow-magic-using-character convention set by Deeper
 *      Shadow le-179): any Ringwraith qualifies regardless of printed skills,
 *      and any non-Ringwraith sorcery-skill character also qualifies.
 *   2. Main effect — a turn-scoped `cancel-return-and-site-tap` constraint
 *      added on play (`on-event self-enters-play` -> `add-constraint`)
 *      targeting the chosen character's company. This is the SAME constraint
 *      kind installed by Promptings of Wisdom (wh-34) / Piercing All Shadows
 *      (wh-47); its real enforcement (added alongside this certification)
 *      lives in `findForcingEnvironment` (mh-hazard-play.ts, rule 5.31),
 *      `combat-finalize.ts`'s `attack-strike-successful` handler (rule
 *      2.IV.4), the `agent-discard-return-to-origin` legal-action emitter
 *      (`legal-actions/movement-hazard.ts`), and `applyTapSitesInPlayOnResolve`
 *      (chain-reducer.ts, `tap-sites-in-play`) — see `hasCancelReturnAndSiteTap`
 *      (`pending.ts`) for every call site.
 *   3. Corruption check — a second `on-event self-enters-play` ->
 *      `enqueue-corruption-check modifier -4`, gated `when $not target.race
 *      ringwraith`.
 *
 * Rule coverage:
 * | #  | Rule                                                                      | Status      |
 * |----|----------------------------------------------------------------------------|-------------|
 * | 1  | Playable on a Ringwraith without the sorcery skill (Adûnaphel)              | IMPLEMENTED |
 * | 2  | Playable on a non-Ringwraith sorcery-skill character (The Grimburgoth)      | IMPLEMENTED |
 * | 3  | NOT playable on a non-Ringwraith, non-sorcery character (Gorbag)            | IMPLEMENTED |
 * | 4  | Playing it adds a turn-scoped cancel-return-and-site-tap constraint         | IMPLEMENTED |
 * | 5  | The constraint suppresses a hazard environment's forced return (rule 5.31) | IMPLEMENTED |
 * | 6  | The constraint suppresses the environment's site-tap (Doors of Night)      | IMPLEMENTED |
 * | 7  | An unprotected company is unaffected by the constraint (still tapped/returned) | IMPLEMENTED |
 * | 8  | The constraint suppresses a successful-strike forced return (rule 2.IV.4)  | IMPLEMENTED |
 * | 9  | Ringwraith target makes NO corruption check                                | IMPLEMENTED |
 * | 10 | Non-Ringwraith target makes a corruption check modified by -4              | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   GOVERN_STORMS (wh-45)  - minion short event (this card)
 *   ADUNAPHEL (le-50)      - ringwraith avatar, no sorcery skill (spirit-magic)
 *   GRIMBURGOTH (dm-15)    - minion man, sorcery skill, non-ringwraith
 *   GORBAG (le-11)         - orc, warrior/scout — no sorcery, not a ringwraith
 *   VARIAG_CAMP (le-411)   - minion border-hold, sitePath incl. 2 wildernesses
 *   STONE_CIRCLE (le-405)  - minion ruins-and-lairs, sitePath: 2 wildernesses
 *   DOL_GULDUR (le-367)    - minion haven (site of origin)
 *   MORIA_MINION (le-392)  - minion shadow-hold (M/H destination)
 *   LONG_WINTER (le-117)   - hazard environment: force-return-to-origin +
 *                            tap-sites-in-play (Doors of Night), no minion gate
 *   DOORS_OF_NIGHT (tw-28) - enables Long Winter's site-tap clause
 *   FELL_TURTLE (tw-34)    - hazard creature: successful strike forces the
 *                            defending company to return to origin (2.IV.4)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, RIVENDELL, MINAS_TIRITH,
  viableActions, getCharacter, findHandCardId, expectInDiscardPile,
  makeMHState, addCardInPlay, resolveChain, mint,
  findCharInstanceId, playCreatureHazardAndResolve, runCreatureCombat,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayShortEventAction } from '../../index.js';
import { Alignment, CardStatus, RegionType, SiteType } from '../../index.js';
import { initiateChain } from '../../engine/chain-reducer.js';

const GOVERN_STORMS = 'wh-45' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const GRIMBURGOTH = 'dm-15' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const STONE_CIRCLE = 'le-405' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const LONG_WINTER = 'le-117' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const FELL_TURTLE = 'tw-34' as CardDefinitionId;
const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

/** Org-phase state for the Ringwraith player with the given company + hand. */
function orgState(opts: {
  characters: CardDefinitionId[];
  hand: CardDefinitionId[];
  site?: CardDefinitionId;
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: opts.site ?? VARIAG_CAMP, characters: opts.characters }],
        hand: opts.hand,
        siteDeck: [MORIA_MINION],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** All viable Govern the Storms plays targeting a specific character instance. */
function stormsActionsFor(state: GameState, targetId: string): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.targetCharacterId === targetId);
}

describe('Govern the Storms (wh-45)', () => {
  beforeEach(() => resetMint());

  // ── Play-target: sorcery-using character (race OR skill) ─────────────────

  test('playable on a Ringwraith without the sorcery skill (Adûnaphel)', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [GOVERN_STORMS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    expect(stormsActionsFor(state, adunId)).toHaveLength(1);
  });

  test('playable on a non-Ringwraith sorcery-skill character (The Grimburgoth)', () => {
    const state = orgState({ characters: [GRIMBURGOTH], hand: [GOVERN_STORMS] });
    const grimId = getCharacter(state, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;
    expect(stormsActionsFor(state, grimId)).toHaveLength(1);
  });

  test('NOT playable on a non-Ringwraith character without the sorcery skill (Gorbag)', () => {
    const state = orgState({ characters: [GORBAG], hand: [GOVERN_STORMS] });
    const anyPlay = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, GOVERN_STORMS));
    expect(anyPlay).toHaveLength(0);
  });

  // ── Main effect: turn-scoped cancel-return-and-site-tap constraint ────────

  test('playing it adds a turn-scoped cancel-return-and-site-tap constraint on the target company and discards the card', () => {
    const state = orgState({ characters: [GRIMBURGOTH], hand: [GOVERN_STORMS] });
    const grimId = getCharacter(state, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, GOVERN_STORMS);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;

    const after = dispatch(state, stormsActionsFor(state, grimId)[0]);

    const constraints = after.activeConstraints.filter(c => c.kind.type === 'cancel-return-and-site-tap');
    expect(constraints).toHaveLength(1);
    const constraint = constraints[0];
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target.kind).toBe('company');
    if (constraint.target.kind === 'company') {
      expect(constraint.target.companyId).toBe(companyId);
    }
    expect(constraint.sourceDefinitionId).toBe(GOVERN_STORMS);

    expectInDiscardPile(after, RESOURCE_PLAYER, inst);
  });

  // ── Corruption check: unless the target is a Ringwraith ───────────────────

  test('no corruption check is enqueued for a Ringwraith target (Adûnaphel)', () => {
    const state = orgState({ characters: [ADUNAPHEL], hand: [GOVERN_STORMS] });
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;

    const after = dispatch(state, stormsActionsFor(state, adunId)[0]);
    const ccResolutions = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccResolutions).toHaveLength(0);
  });

  test('a corruption check modified by -4 is enqueued for a non-Ringwraith target (The Grimburgoth)', () => {
    const state = orgState({ characters: [GRIMBURGOTH], hand: [GOVERN_STORMS] });
    const grimId = getCharacter(state, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;

    const after = dispatch(state, stormsActionsFor(state, grimId)[0]);
    const ccResolutions = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(ccResolutions).toHaveLength(1);
    const cc = ccResolutions[0].kind as { modifier?: number };
    expect(cc.modifier).toBe(-4);
  });

  // ── Enforcement: cancels a forced return to site of origin ────────────────

  test('the constraint cancels rule-5.31 forced return to origin for the protected company', () => {
    const state = orgState({ characters: [GRIMBURGOTH], hand: [GOVERN_STORMS], site: DOL_GULDUR });
    const grimId = getCharacter(state, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;
    const played = dispatch(state, stormsActionsFor(state, grimId)[0]);
    // The Grimburgoth is a non-Ringwraith target — resolve his enqueued
    // corruption check before moving on to the M/H phase.
    const ccAction = viableActions(played, PLAYER_1, 'corruption-check')[0].action;
    const afterPlay = dispatch(played, ccAction);

    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    const originInstanceId = company.currentSite!.instanceId;
    const dest = afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === MORIA_MINION)!;

    const withMovement: GameState = {
      ...afterPlay,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...afterPlay.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        afterPlay.players[HAZARD_PLAYER],
      ] as unknown as GameState['players'],
    };
    const withEnv = addCardInPlay(withMovement, HAZARD_PLAYER, LONG_WINTER);

    const after = dispatch(dispatch(withEnv, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });
    const resultCompany = after.players[RESOURCE_PLAYER].companies[0];
    // Rule 5.31 would normally force a company with 2 Wildernesses in its
    // path back to its site of origin — the constraint from Govern the
    // Storms cancels that, so the company completes its move instead.
    expect(resultCompany.currentSite?.instanceId).not.toBe(originInstanceId);
    expect(resultCompany.currentSite?.definitionId).toBe(MORIA_MINION);
  });

  // ── Enforcement: cancels the environment's site-tap (Doors of Night) ──────

  test('the constraint cancels the site-tap on the protected company while an unprotected company is still tapped', () => {
    const state = orgState({
      characters: [GRIMBURGOTH],
      hand: [GOVERN_STORMS],
      site: VARIAG_CAMP,
    });
    // Add a second, unprotected company for the same (Ringwraith) player at
    // another non-Haven site with 2 wildernesses in its own printed path.
    const withSecondCompany: GameState = {
      ...state,
      players: [
        {
          ...state.players[RESOURCE_PLAYER],
          companies: [
            ...state.players[RESOURCE_PLAYER].companies,
            { ...state.players[RESOURCE_PLAYER].companies[0], id: 'company-2' as GameState['players'][number]['companies'][number]['id'], characters: [], currentSite: { instanceId: mint(), definitionId: STONE_CIRCLE, status: CardStatus.Untapped }, destinationSite: null },
          ],
        },
        state.players[HAZARD_PLAYER],
      ] as unknown as GameState['players'],
    };

    const grimId = getCharacter(withSecondCompany, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;
    const played = dispatch(withSecondCompany, stormsActionsFor(withSecondCompany, grimId)[0]);
    const ccAction = viableActions(played, PLAYER_1, 'corruption-check')[0].action;
    const afterPlay = dispatch(played, ccAction);

    const withDon = addCardInPlay({ ...afterPlay, phaseState: makeMHState() }, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const chained = initiateChain(withDon, PLAYER_2, { instanceId: mint(), definitionId: LONG_WINTER }, { type: 'long-event' });
    const resolved = resolveChain(chained);

    const protectedCompany = resolved.players[RESOURCE_PLAYER].companies.find(c => c.characters.includes(grimId))!;
    const unprotectedCompany = resolved.players[RESOURCE_PLAYER].companies.find(c => !c.characters.includes(grimId))!;

    expect(protectedCompany.currentSite?.status).toBe(CardStatus.Untapped);
    expect(unprotectedCompany.currentSite?.status).toBe(CardStatus.Tapped);
  });

  // ── Enforcement: cancels a rule-2.IV.4 forced return after a successful strike ──

  test('the constraint cancels rule-2.IV.4 forced return to origin after a successful creature strike (Fell Turtle)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GRIMBURGOTH] }],
          hand: [GOVERN_STORMS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [FELL_TURTLE],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const grimId = getCharacter(state, RESOURCE_PLAYER, GRIMBURGOTH).instanceId;
    const played = dispatch(state, stormsActionsFor(state, grimId)[0]);
    const ccAction = viableActions(played, PLAYER_1, 'corruption-check')[0].action;
    const afterPlay = dispatch(played, ccAction);

    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    const companyId = company.id;
    const dest = afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === MORIA_MINION)!;

    const withMovement: GameState = {
      ...afterPlay,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Coastal],
        resolvedSitePathNames: ['Bay of Belfalas'],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
      players: [
        {
          ...afterPlay.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        afterPlay.players[HAZARD_PLAYER],
      ] as unknown as GameState['players'],
    };

    const turtleId = findHandCardId(withMovement, HAZARD_PLAYER, FELL_TURTLE);
    const afterChain = playCreatureHazardAndResolve(withMovement, PLAYER_2, turtleId, companyId, COASTAL_KEYING);

    // Grimburgoth prowess 7 + low roll 2 = 9 <= creature prowess 15 -> strike hits.
    // Body check: body 9, roll 5 <= 9 -> survives, stays wounded.
    const afterWound = runCreatureCombat(afterChain, GRIMBURGOTH, 2, 5);

    expect(afterWound.combat).toBeNull();
    const grimAfterId = findCharInstanceId(afterWound, RESOURCE_PLAYER, GRIMBURGOTH);
    expect(afterWound.players[RESOURCE_PLAYER].characters[grimAfterId]?.status).toBe(CardStatus.Inverted);

    // Rule 2.IV.4 would normally force the company back to its site of
    // origin after a successful strike — the constraint from Govern the
    // Storms cancels that.
    expect((afterWound.phaseState as { returnedToOrigin?: boolean }).returnedToOrigin).toBeFalsy();
    expect(afterWound.activeConstraints.some(c => c.kind.type === 'site-phase-do-nothing')).toBe(false);
  });
});
