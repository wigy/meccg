/**
 * @module wh-115.test — Shifter of Hues
 *
 * Card shape (documented here, not asserted against the JSON):
 *   - `minion-resource-event`, `alignment: "stage"`, `eventType: "permanent"`,
 *     non-unique, MP 0 (misc). Keywords `radagast-specific`, `shapeshifter`.
 *     The form's adopted attributes (from the CoE database) are body 10 /
 *     prowess 6 / general-influence 27 / direct-influence 3 / corruption −2 —
 *     expressed as deltas from Radagast's printed 9 / 6 / 22 / 5 base, plus a
 *     corruption check-modifier.
 *
 * Card text (authoritative — CoE database):
 *   "Radagast specific. Shapeshifter. Place this card on Radagast if he is in
 *    play. Return this card to your hand: when you play another Shapeshifter card
 *    or, if you choose, during your organization phase. In addition to adopting
 *    the given attributes, Radagast's skills become Warrior/Diplomat. Radagast
 *    may not move. You may keep one more card than normal in your hand. Radagast
 *    can tap [to] give +2 to the corruption checks of the characters in one
 *    company through your next organization phase (this company must be moving
 *    with at least one Wilderness [{w}] in their site path). Radagast may bear,
 *    but may not use, items."
 *
 * Every test builds a game state and drives the reducer / legal-action pipeline;
 * none assert JSON shape.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, getCharacter, findCharInstanceId, findHandCardId,
  companyIdAt, recomputeDerived, attachItemToChar, playPermanentEventAndResolve,
  enqueueCorruptionCheck, mint,
  CardStatus, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  ActivateGrantedAction, CardDefinitionId, CardInstanceId, CompanyId, GameState, SiteInPlay,
} from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';
import { getEffectiveNaturalSkills, resolveHandSize } from '../../engine/effects/resolver.js';
import { advanceNextOrganizationPhaseConstraints } from '../../engine/pending.js';

const RADAGAST = 'wh-8' as CardDefinitionId;      // Fallen-wizard avatar (prowess 6 / body 9 / DI 5 / GI 22)
const SHIFTER = 'wh-115' as CardDefinitionId;      // Shifter of Hues
const MASTER = 'wh-112' as CardDefinitionId;       // Master of Shapes — a second Shapeshifter form
const DAGGER = 'tw-206' as CardDefinitionId;       // hero item: +1 prowess (DSL), 1 corruption point
const LEGOLAS = 'tw-168' as CardDefinitionId;      // a second Fallen-wizard-controlled hero character
const RHOSGOBEL = 'wh-57' as CardDefinitionId;     // FW Wizardhaven (Radagast's homesite)
const RIVENDELL = 'tw-421' as CardDefinitionId;    // hero Haven
const MORIA = 'tw-413' as CardDefinitionId;        // hero site
const ETTENMOORS = 'tw-395' as CardDefinitionId;   // hero site whose printed site path includes Wilderness
const HIMRING = 'tw-401' as CardDefinitionId;      // hero site whose printed site path has NO Wilderness

const CORRUPTION_ACTION = 'modify-company-corruption-checks';

/** Build a Fallen-wizard organization-phase state with Radagast (and optional extra chars/hand). */
const fwOrg = (opts?: {
  extraChars?: CardDefinitionId[];
  hand?: CardDefinitionId[];
  radagastSite?: CardDefinitionId;
  secondCompany?: { site: CardDefinitionId; characters: CardDefinitionId[] };
}): GameState => {
  const companies: { site: CardDefinitionId; characters: CardDefinitionId[] }[] = [
    { site: opts?.radagastSite ?? RHOSGOBEL, characters: [RADAGAST, ...(opts?.extraChars ?? [])] },
  ];
  if (opts?.secondCompany) companies.push(opts.secondCompany);
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies, hand: opts?.hand ?? [], siteDeck: [MORIA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [MORIA] },
    ],
  });
};

/** Instance id of the Shifter of Hues form borne by Radagast. */
const shifterOn = (state: GameState): CardInstanceId => {
  const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
  const form = state.players[RESOURCE_PLAYER].characters[radagastId]?.items
    .find(i => i.definitionId === SHIFTER);
  if (!form) throw new Error('Shifter of Hues not on Radagast');
  return form.instanceId;
};

/** Set a company's declared movement destination to a given site definition. */
const setDestination = (state: GameState, companyIdx: number, siteDefId: CardDefinitionId): GameState => {
  const dest: SiteInPlay = { instanceId: mint(), definitionId: siteDefId, status: CardStatus.Untapped };
  const companies = state.players[RESOURCE_PLAYER].companies.map((c, i) =>
    i === companyIdx ? { ...c, destinationSite: dest } : c);
  const p1 = { ...state.players[RESOURCE_PLAYER], companies };
  return { ...state, players: [p1, state.players[1]] as unknown as GameState['players'] };
};

/** Shifter-of-Hues corruption-aid grant activations offered to the FW player. */
const shifterGrants = (state: GameState): ActivateGrantedAction[] =>
  viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === CORRUPTION_ACTION);

describe('Shifter of Hues (wh-115)', () => {
  beforeEach(() => resetMint());

  // ── Place on Radagast (play-target filter) ────────────────────────────────

  test('is playable onto Radagast — and not onto another character', () => {
    const state = fwOrg({ extraChars: [LEGOLAS], hand: [SHIFTER] });
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    const targets = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as { targetCharacterId?: CardInstanceId }).targetCharacterId);
    expect(targets).toContain(radagastId);
    expect(targets).not.toContain(legolasId);
  });

  test('playing it attaches the form to Radagast (into his items)', () => {
    const state = fwOrg({ hand: [SHIFTER] });
    const formInHand = findHandCardId(state, RESOURCE_PLAYER, SHIFTER);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);

    const after = playPermanentEventAndResolve(state, PLAYER_1, formInHand, radagastId);
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].items
      .some(i => i.definitionId === SHIFTER)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === SHIFTER)).toBe(false);
  });

  // ── Adopting the given attributes ─────────────────────────────────────────

  test('Radagast adopts the form attributes: body 10, direct influence 3, prowess 6, +5 general influence', () => {
    let state = fwOrg();
    // Baseline (no form): Radagast's printed stats.
    const base = getCharacter(state, RESOURCE_PLAYER, RADAGAST);
    expect(base.effectiveStats.body).toBe(9);
    expect(base.effectiveStats.directInfluence).toBe(5);
    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(0);

    state = recomputeDerived(attachItemToChar(state, RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const formed = getCharacter(state, RESOURCE_PLAYER, RADAGAST);
    expect(formed.effectiveStats.body).toBe(10);           // 9 + 1
    expect(formed.effectiveStats.directInfluence).toBe(3);  // 5 - 2
    expect(formed.effectiveStats.prowess).toBe(6);          // unchanged
    expect(state.players[RESOURCE_PLAYER].generalInfluenceBonus).toBe(5); // 22 -> 27
  });

  test("corruption -2: Radagast's own corruption checks are penalised by 2", () => {
    let state = recomputeDerived(attachItemToChar(fwOrg(), RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    state = enqueueCorruptionCheck(state, PLAYER_1, radagastId);
    const roll = viableActions(state, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === radagastId)!;
    expect(roll.corruptionModifier).toBe(-2);
  });

  // ── Skills become Warrior/Diplomat (replacement, not addition) ─────────────

  test("Radagast's natural skills become exactly Warrior/Diplomat (Scout/Ranger dropped)", () => {
    const state = fwOrg();
    const radagast = getCharacter(state, RESOURCE_PLAYER, RADAGAST);
    const radagastDef = state.cardPool[RADAGAST] as { skills?: readonly string[] };
    // Printed skills include scout and ranger.
    expect(getEffectiveNaturalSkills(state, radagast, radagastDef)).toEqual(
      expect.arrayContaining(['warrior', 'scout', 'ranger', 'diplomat']));

    const formed = recomputeDerived(attachItemToChar(state, RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const formedRadagast = getCharacter(formed, RESOURCE_PLAYER, RADAGAST);
    const effSkills = getEffectiveNaturalSkills(formed, formedRadagast, radagastDef);
    expect([...effSkills].sort()).toEqual(['diplomat', 'warrior']);
    expect(effSkills).not.toContain('scout');
    expect(effSkills).not.toContain('ranger');
  });

  // ── Keep one more card than normal ────────────────────────────────────────

  test('increases the maximum hand size by 1', () => {
    const state = fwOrg();
    const base = resolveHandSize(state, RESOURCE_PLAYER);
    const formed = recomputeDerived(attachItemToChar(state, RESOURCE_PLAYER, RADAGAST, SHIFTER));
    expect(resolveHandSize(formed, RESOURCE_PLAYER)).toBe(base + 1);
  });

  // ── Radagast may not move ─────────────────────────────────────────────────

  test("Radagast's company may not declare movement while the form is on him", () => {
    // At a haven, starter movement to a site-deck site is normally offered.
    const base = fwOrg({ radagastSite: RIVENDELL });
    const movesWithout = viableActions(base, PLAYER_1, 'plan-movement')
      .filter(ea => (ea.action as { companyId?: CompanyId }).companyId === companyIdAt(base, RESOURCE_PLAYER, 0));
    expect(movesWithout.length).toBeGreaterThan(0);

    const formed = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const movesWith = viableActions(formed, PLAYER_1, 'plan-movement')
      .filter(ea => (ea.action as { companyId?: CompanyId }).companyId === companyIdAt(formed, RESOURCE_PLAYER, 0));
    expect(movesWith.length).toBe(0);
  });

  // ── May bear, but may not use, items ──────────────────────────────────────

  test('an item Radagast bears grants no bonus while the form is on him, but its corruption still applies', () => {
    // Baseline: Radagast + Dagger (no form) → +1 prowess, +1 corruption point.
    let armed = recomputeDerived(attachItemToChar(fwOrg(), RESOURCE_PLAYER, RADAGAST, DAGGER));
    const armedRadagast = getCharacter(armed, RESOURCE_PLAYER, RADAGAST);
    expect(armedRadagast.effectiveStats.prowess).toBe(7);          // 6 + 1
    expect(armedRadagast.effectiveStats.corruptionPoints).toBe(1);

    // With the form: the Dagger is borne but not used — no prowess bonus — yet
    // its corruption point still burdens Radagast.
    const formed = recomputeDerived(attachItemToChar(armed, RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const formedRadagast = getCharacter(formed, RESOURCE_PLAYER, RADAGAST);
    expect(formedRadagast.effectiveStats.prowess).toBe(6);          // Dagger bonus nulled
    expect(formedRadagast.effectiveStats.corruptionPoints).toBe(1); // corruption still applies
  });

  // ── Return to hand: during your organization phase ────────────────────────

  test('may be voluntarily returned to hand during the organization phase, reverting the adoption', () => {
    let state = recomputeDerived(attachItemToChar(fwOrg(), RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const formId = shifterOn(state);

    const returnAction = viableActions(state, PLAYER_1, 'return-attached-to-hand')
      .find(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === formId);
    expect(returnAction).toBeDefined();

    state = dispatch(state, returnAction!.action);
    expect(state.players[RESOURCE_PLAYER].characters[radagastId].items
      .some(i => i.definitionId === SHIFTER)).toBe(false);
    expect(state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === SHIFTER)).toBe(true);
    // Adoption reverted: body back to printed 9.
    expect(getCharacter(state, RESOURCE_PLAYER, RADAGAST).effectiveStats.body).toBe(9);
  });

  // ── Return to hand: when you play another Shapeshifter card ────────────────

  test('is returned to hand when another Shapeshifter form is played on Radagast', () => {
    let state = recomputeDerived(attachItemToChar(fwOrg({ hand: [MASTER] }), RESOURCE_PLAYER, RADAGAST, SHIFTER));
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const masterInHand = findHandCardId(state, RESOURCE_PLAYER, MASTER);

    const after = playPermanentEventAndResolve(state, PLAYER_1, masterInHand, radagastId);
    // The new form is on Radagast; the old Shifter of Hues has left for the hand.
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].items
      .some(i => i.definitionId === MASTER)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[radagastId].items
      .some(i => i.definitionId === SHIFTER)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === SHIFTER)).toBe(true);
  });

  // ── Tap Radagast → +2 corruption to one moving company ────────────────────

  test('offered only for a company moving with a Wilderness in its site path', () => {
    // Company 1 (Legolas) moves toward Ettenmoors (Wilderness path); company 0
    // (Radagast) is not moving. Radagast bears the form.
    let state = recomputeDerived(attachItemToChar(
      fwOrg({ secondCompany: { site: MORIA, characters: [LEGOLAS] } }),
      RESOURCE_PLAYER, RADAGAST, SHIFTER));
    state = setDestination(state, 1, ETTENMOORS);

    const grants = shifterGrants(state);
    expect(grants.length).toBe(1);
    expect(grants[0].targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER, 1));
  });

  test('NOT offered for a non-moving company, nor for a company moving with no Wilderness', () => {
    // No destinations set anywhere.
    const idle = recomputeDerived(attachItemToChar(
      fwOrg({ secondCompany: { site: MORIA, characters: [LEGOLAS] } }),
      RESOURCE_PLAYER, RADAGAST, SHIFTER));
    expect(shifterGrants(idle).length).toBe(0);

    // Company 1 moves to Himring — a site whose path holds no Wilderness.
    const noWild = setDestination(idle, 1, HIMRING);
    expect(shifterGrants(noWild).length).toBe(0);
  });

  test('activating taps Radagast and adds a +2 corruption check-modifier to the moving company', () => {
    let state = recomputeDerived(attachItemToChar(
      fwOrg({ secondCompany: { site: MORIA, characters: [LEGOLAS] } }),
      RESOURCE_PLAYER, RADAGAST, SHIFTER));
    state = setDestination(state, 1, ETTENMOORS);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const company1Id = companyIdAt(state, RESOURCE_PLAYER, 1);

    // Baseline: Legolas has no corruption modifier.
    {
      const s = enqueueCorruptionCheck(state, PLAYER_1, legolasId);
      const roll = viableActions(s, PLAYER_1, 'corruption-check')
        .map(ea => ea.action as CorruptionCheckAction).find(a => a.characterId === legolasId)!;
      expect(roll.corruptionModifier).toBe(0);
    }

    const grant = shifterGrants(state)[0];
    const after = dispatch(state, grant);
    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).status).toBe(CardStatus.Tapped);
    const buff = after.activeConstraints.find(c =>
      c.kind.type === 'check-modifier' && c.kind.check === 'corruption'
      && c.kind.value === 2 && c.target.kind === 'company' && c.target.companyId === company1Id);
    expect(buff).toBeDefined();
    expect(buff!.scope.kind).toBe('next-organization-phase');

    // The +2 applies to a corruption check by a character in the targeted company.
    const s2 = enqueueCorruptionCheck(after, PLAYER_1, legolasId);
    const roll2 = viableActions(s2, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction).find(a => a.characterId === legolasId)!;
    expect(roll2.corruptionModifier).toBe(2);
    // Radagast still in play (only tapped).
    expect(after.players[RESOURCE_PLAYER].characters[radagastId]).toBeDefined();
  });

  test('the +2 survives the current org phase and clears only at the end of the next one', () => {
    let state = recomputeDerived(attachItemToChar(
      fwOrg({ secondCompany: { site: MORIA, characters: [LEGOLAS] } }),
      RESOURCE_PLAYER, RADAGAST, SHIFTER));
    state = setDestination(state, 1, ETTENMOORS);
    state = dispatch(state, shifterGrants(state)[0]);
    const isBuffPresent = (s: GameState) => s.activeConstraints.some(c =>
      c.kind.type === 'check-modifier' && c.scope.kind === 'next-organization-phase');
    expect(isBuffPresent(state)).toBe(true);

    // End of this player's current org phase: the buff is armed, not cleared.
    const armed = advanceNextOrganizationPhaseConstraints(state, PLAYER_1);
    expect(isBuffPresent(armed)).toBe(true);
    // The opponent's org phase does not touch it.
    const opponentPass = advanceNextOrganizationPhaseConstraints(armed, PLAYER_2);
    expect(isBuffPresent(opponentPass)).toBe(true);
    // End of the owner's NEXT org phase: cleared.
    const expired = advanceNextOrganizationPhaseConstraints(opponentPass, PLAYER_1);
    expect(isBuffPresent(expired)).toBe(false);
  });

  test('passing the organization phase arms (does not clear) the buff', () => {
    let state = recomputeDerived(attachItemToChar(
      fwOrg({ secondCompany: { site: MORIA, characters: [LEGOLAS] } }),
      RESOURCE_PLAYER, RADAGAST, SHIFTER));
    state = setDestination(state, 1, ETTENMOORS);
    state = dispatch(state, shifterGrants(state)[0]);

    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.activeConstraints.some(c =>
      c.kind.type === 'check-modifier'
      && c.scope.kind === 'next-organization-phase'
      && c.scope.armed === true)).toBe(true);
  });
});
