/**
 * @module as-24.test
 *
 * Card test: Alone and Unadvised (as-24)
 * Type: hazard-event (permanent, corruption keyword, character-targeting)
 * Effects: 7 (play-target character filter non-wizard/non-ringwraith maxCompanySize:3,
 *             duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +4,
 *             on-event end-of-company-mh force-check corruption perRegion:true,
 *             check-modifier corruption value:company.characterCount,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:7,
 *             on-event company-composition-changed discard-self when company.characterCount >= 4)
 *
 * "Corruption. Playable on a non-Wizard, non-Ringwraith character in a
 *  company with 3 or fewer characters. Target character makes a corruption
 *  check at the end of his movement/hazard phase for each region he moved
 *  through. All of his corruption checks are modified by adding the number
 *  of characters in his company. During his organization phase, the
 *  character may tap to attempt to remove this card. Make a roll—if the
 *  result is greater than 6, discard this card. Discard this card if his
 *  company has 4 or more characters. Cannot be duplicated on a given
 *  character."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                       |
 * |---|------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Play from hand targeting character        | IMPLEMENTED | play-hazard with targetCharacterId          |
 * | 2 | Filter: non-wizard, non-ringwraith        | IMPLEMENTED | play-target filter with $ne                 |
 * | 3 | Max company size 3                        | IMPLEMENTED | play-target maxCompanySize                  |
 * | 4 | +4 corruption points while attached       | IMPLEMENTED | stat-modifier corruption-points value:4     |
 * | 5 | Corruption check per region at end of MH  | IMPLEMENTED | on-event end-of-company-mh per region       |
 * | 6 | Check modifier = company character count  | IMPLEMENTED | check-modifier with expression value        |
 * | 7 | Tap to attempt removal (roll>6)           | IMPLEMENTED | grant-action remove-self-on-roll            |
 * | 8 | Auto-discard if company >= 4 characters   | IMPLEMENTED | on-event company-composition-changed        |
 * | 9 | Cannot be duplicated on a character       | IMPLEMENTED | duplication-limit scope:character max:1     |
 * | 10| Valid target for Marvels Told             | IMPLEMENTED | hazard-event permanent, non-environment     |
 *
 * Playable: YES
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, ELROND, GLORFINDEL_II,
  SAM_GAMGEE, FATTY_BOLGER, ANBORN, ADRAZAR,
  ALONE_AND_UNADVISED, MARVELS_TOLD,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, dispatch, dispatchResult, expectCharStatus, expectInDiscardPile,
  makeMHState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CorruptionCheckAction, PlayHazardAction, CardDefinitionId, FreeCouncilPhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { RegionType } from '../../index.js';

// Orc characters for the half-size regression test (CoE 3.24: each Hobbit or
// Orc scout counts as half toward company size). Declared locally per the
// card-ids.ts single-use policy.
const LAGDUF = 'le-18' as CardDefinitionId;     // Orc warrior — full character
const MUZGASH = 'le-25' as CardDefinitionId;    // Orc warrior — full character
const GORBAG = 'le-11' as CardDefinitionId;     // Orc warrior/scout — counts as half
const GRISHNAKH = 'le-12' as CardDefinitionId;  // Orc warrior/scout — counts as half

// Gandalf's Fallen-wizard avatar (race "fallen-wizard"), for the g.wiz.F1 regression below.
const GANDALF_FW = 'wh-4' as CardDefinitionId;

describe('Alone and Unadvised (as-24)', () => {
  beforeEach(() => resetMint());


  test('attached card adds 4 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED));
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(4);
  });

  test('offered as a viable hazard play targeting each character in company during MH', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    expect(playActions).toHaveLength(2);
    const targetCharIds = playActions.map(a => a.targetCharacterId);
    expect(targetCharIds).toContain(findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN));
    expect(targetCharIds).toContain(findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS));
  });

  test('not playable if company has more than 3 characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('not playable on a Fallen-wizard avatar — counts as Wizard for card-text filters (CoE g.wiz.F1)', () => {
    // Bug report: Alone and Unadvised was played targeting Gandalf's
    // Fallen-wizard avatar (wh-4, race "fallen-wizard"). Per CoE glossary
    // rule g.wiz.F1, card text that refers to a Fallen-wizard player's
    // "Wizard" means that player's Fallen-wizard avatar — so the avatar
    // must match the "non-Wizard" filter and be excluded as a target.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('maxCompanySize counts sheer characters, not the Hobbit/Orc-scout-halved hazard-limit size (CoE 3.24)', () => {
    // Four characters: two full Orcs + two Orc scouts. The hazard-limit
    // notion of company size (CoE 3.24 / 2.IV.iii) would halve the two
    // scouts to an effective size of 3 — but maxCompanySize on a card's
    // play-target gate compares the company's literal character count (4),
    // which exceeds Alone and Unadvised's maxCompanySize of 3. Not playable.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LAGDUF, MUZGASH, GORBAG, GRISHNAKH] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('not playable on a 4-character company even though 2 Hobbits reduce the hazard limit to 3 (bug report)', () => {
    // Bug report: Sam Gamgee, Fatty Bolger, Anborn, and Adrazar (4
    // characters, 2 Hobbits) moved with a hazard limit of 3 (Hobbits count
    // as half toward the hazard limit — CoE 3.24 / 2.IV.iii). Alone and
    // Unadvised was wrongly offered as playable because the engine reused
    // that same Hobbit-halved size (also 3) for the card's own
    // maxCompanySize:3 gate. Company size for the card gate is the sheer
    // character count (4), which exceeds 3, so the card must not be
    // offered — independent of the hazard limit.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [SAM_GAMGEE, FATTY_BOLGER, ANBORN, ADRAZAR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0, hazardLimitAtReveal: 3 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withOne, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('playing from hand attaches to target character via chain resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, HAZARD_PLAYER);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardInstance,
      targetCompanyId,
      targetCharacterId: aragornId,
    });
    expect(afterPlay.chain).not.toBeNull();

    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    const aragornData = current.players[0].characters[aragornId];
    expect(aragornData.hazards).toHaveLength(1);
    expect(aragornData.hazards[0].definitionId).toBe(ALONE_AND_UNADVISED);
  });

  test('end of company MH enqueues corruption checks per region moved', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(2);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.reason).toContain('Alone and Unadvised');
      expect(pending[0].kind.reason).toContain('region 1/2');
    }
    if (pending[1].kind.type === 'corruption-check') {
      expect(pending[1].kind.reason).toContain('region 2/2');
    }
  });

  test('no corruption checks enqueued when company did not move', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  test('corruption check modifier includes company character count', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED));
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(afterBothPass, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check');
    expect(ccAction).toBeDefined();

    const cc = ccAction!.action as CorruptionCheckAction;
    expect(cc.corruptionPoints).toBe(4);
    // Company has 2 characters → modifier includes +2 from company.characterCount
    // Aragorn's base corruptionModifier is 0, so total modifier = 0 + 2 = 2
    expect(cc.corruptionModifier).toBe(2);
  });

  test('corruption check modifier includes company character count during Free Council end-of-game checks', () => {
    // Bug report: a character bearing Alone and Unadvised got no company-size
    // bonus when checked during Free Council (end-of-game corruption checks,
    // CoE 7.1) — the legal-action computer there calls resolveCheckModifier()
    // without a context, so the card's string-valued "company.characterCount"
    // check-modifier silently evaluated to 0. Company has 3 characters
    // (Aragorn, Legolas, Gimli) → modifier must include +3.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED));
    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const stateAtFreeCouncil = { ...withCard, phaseState: fcState };

    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(stateAtFreeCouncil, PLAYER_1);
    const ccAction = actions.find(
      a => a.viable && a.action.type === 'corruption-check' && a.action.characterId === aragornId,
    );
    expect(ccAction).toBeDefined();

    const cc = ccAction!.action as CorruptionCheckAction;
    expect(cc.corruptionPoints).toBe(4);
    expect(cc.corruptionModifier).toBe(3);
  });

  test('untapped bearer in Organization can activate remove-self-on-roll (rollThreshold 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    // METD §7 step 10 added a no-tap variant alongside the standard
    // tap-and-roll for any corruption-card removal. Both are now offered.
    const standard = actions.filter(ea => (ea.action as ActivateGrantedAction).noTap !== true);
    expect(standard).toHaveLength(1);

    const action = standard[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(7);
  });

  // Roll >6 discards the corruption card; roll ≤6 keeps it attached. Either way the
  // bearer taps because the granted action's cost always pays the tap.
  test.each([
    { label: 'successful removal roll (>6) discards the card', roll: 7, expectedHazards: 0 },
    { label: 'failed removal roll (<=6) keeps the card attached', roll: 6, expectedHazards: 1 },
  ])('$label; bearer taps either way', ({ roll, expectedHazards }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    const cheated = { ...withCard, cheatRollTotal: roll };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)).toHaveLength(expectedHazards);
    if (expectedHazards === 0) {
      expectInDiscardPile(next, HAZARD_PLAYER, ALONE_AND_UNADVISED);
    } else {
      expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)[0].definitionId).toBe(ALONE_AND_UNADVISED);
    }
  });

  test('auto-discards when company reaches 4+ characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [ELROND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);
    expect(getHazardsOn(withCard, RESOURCE_PLAYER, ARAGORN)).toHaveLength(1);

    const afterRecruit = dispatch(withCard, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: handCardId(withCard, RESOURCE_PLAYER),
      atSite: withCard.players[0].companies[0].currentSite!.instanceId,
      controlledBy: 'general',
    });

    expect(afterRecruit.players[0].companies[0].characters).toHaveLength(4);
    expect(getHazardsOn(afterRecruit, RESOURCE_PLAYER, ARAGORN)).toHaveLength(0);
  });

  test('remaining corruption checks auto-resolve with pass when bearer is eliminated mid-series', () => {
    // Regression: when a character bearing Alone and Unadvised fails one of a
    // multi-region series of corruption checks (and is thereby removed from play),
    // the remaining pending corruption checks in the queue should be resolvable
    // via `pass`. Previously the reducer rejected `pass` with an error because it
    // checked action.type === 'corruption-check' before checking if the character
    // still existed, causing the game to hang.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Attach Alone and Unadvised to ARAGORN (solo company → modifier = +1)
    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED));

    // Both players pass in play-hazards with 2-region path → 2 corruption checks queued
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resourcePlayerPassed: true,
    });
    const afterBothPass = dispatch({ ...withCard, phaseState: mhState }, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(2);

    // First corruption check with a low roll: CP=4, modifier=+1 (solo company),
    // cheatRollTotal=2 → total=3 = CP-1 → wound (ARAGORN removed from characters)
    const firstCcActions = viableActions(afterBothPass, PLAYER_1, 'corruption-check');
    expect(firstCcActions).toHaveLength(1);
    const afterFirstCheck = dispatch(
      { ...afterBothPass, cheatRollTotal: 2 },
      firstCcActions[0].action,
    );

    // ARAGORN should be gone from characters after the wound
    const p1 = afterFirstCheck.players.find(p => p.id === PLAYER_1)!;
    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    expect(p1.characters[aragornId]).toBeUndefined();

    // One corruption check still pending for the now-gone ARAGORN
    expect(afterFirstCheck.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(1);

    // Legal actions for PLAYER_1 must offer `pass` (not `corruption-check`)
    const legalAfter = computeLegalActions(afterFirstCheck, PLAYER_1);
    const passAction = legalAfter.find(ea => ea.viable && ea.action.type === 'pass');
    expect(passAction).toBeDefined();
    const ccAction = legalAfter.find(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(ccAction).toBeUndefined();

    // Dispatching `pass` must succeed and dequeue the orphaned resolution
    const result = dispatchResult(afterFirstCheck, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('Marvels Told can target Alone and Unadvised as a valid discard target', () => {
    // Alone and Unadvised is a hazard permanent-event with the Corruption keyword.
    // Marvels Told targets "hazard non-environment permanent-event or long-event",
    // so it must offer Alone and Unadvised as a valid discard target.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GLORFINDEL_II, ARAGORN] }], hand: [MARVELS_TOLD], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, ALONE_AND_UNADVISED);

    const playActions = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(playActions).toHaveLength(1);

    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    const hazardId = withCard.players[0].characters[aragornId].hazards[0].instanceId;
    expect((playActions[0].action as { discardTargetInstanceId?: unknown }).discardTargetInstanceId).toBe(hazardId);
  });
});
