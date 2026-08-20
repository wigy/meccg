/**
 * @module ai/h2/modules/characters/characters
 *
 * The `characters` module — bringing a character into play, and changing who
 * holds it.
 *
 * A character is the only resource in the game that is simultaneously a score,
 * a cost and a capability. Its marshalling points count toward the character
 * source; its mind is charged against a 20-point general-influence pool; and
 * once in play it supplies the prowess that survives combats and the direct
 * influence that reaches factions. This module prices the first two, which are
 * exact, and reports the third rather than guessing at it.
 *
 * The mind cost is the part H1 treats as a gate — play the character if it
 * fits — and the part that is really a price. A mind-6 character consumes
 * nearly a third of the pool, and what that displaces is whatever else would
 * have been played into it. `budget` supplies what is free; what the
 * displacement is worth belongs to the roster plan of §3.2, which does not
 * exist, so it is declared rather than invented.
 *
 * An avatar (`mind === null`) is the exception the marshalling-points price
 * cannot see: its own MP is frequently zero, since its value is never there,
 * and CoE 2.II.2 allows only one character played per turn — so without a
 * floor, a positive-MP hero character always wins the slot over an avatar
 * worth strictly more, and the avatar sits in hand for the rest of the game.
 * `avatarInPlayTsd` is a flat, declared floor for the two rule-derived
 * capabilities an avatar in play unlocks (sideboard access, CoE 2.II.6; a
 * low-mind company's eligibility to draw at all, CoE 2.IV.v) — not a guess at
 * either one's full value, which needs the sideboard's contents or a roster
 * plan this module does not have.
 *
 * `move-to-influence` transfers a character between a controller's direct
 * influence and the general pool. It moves no marshalling points, but it does
 * move direct influence — and free direct influence is exactly what an
 * influence attempt spends (`reducer-site.ts`). So the action is scored as
 * point-neutral with the influence change reported, which is the honest shape
 * until the strategic half can say what that influence is for.
 *
 * **Company shape** — `split-company`, `merge-companies`, `move-to-company` —
 * belongs here for the same reason: it is a question about the roster, not
 * about a destination. It is priced as a difference of one potential over the
 * whole board, `services/organization`'s `u(arrangement)`: the harm each
 * company's own size invites (`defence`, the hazard limit *is* the company
 * size) plus the goals the arrangement can serve — the committed portfolio
 * and the hand's opportunities, matched to companies by reach and, for
 * factions, by the influence check the arrangement's free direct influence
 * buys. Splitting is finally credited for the reason anyone splits — two
 * companies reaching two goals — and only when a second, distinct playable
 * card exists to serve; leading keeps the big company and trailing splits
 * with no posture branch, because both fall out of the curvature of `W` over
 * the arrangement's outcome spread.
 *
 * The difference has to be of *one scored number per arrangement*, or the
 * module will value a change and its undo both positively and do them
 * forever. It did, twice, and both times the game ran to the decision limit
 * inside a single organization phase — and scoring a *delta* distribution
 * through `standing.score` would revive the loop through Jensen's inequality
 * the moment a posture is convex. `evaluateShape` documents the resulting
 * contract bend; `organization` carries the canonicalisation and the memo
 * that make `u` single-valued, and the tests pin `utility(change) +
 * utility(undo) = 0` at every posture.
 */

import { isAvatarCharacter } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { distributionStats, netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';
import { computeCharacterValue } from '../../services/character-value.js';
import type { ArrangedCompany } from '../../services/organization.js';
import { computeOrganization } from '../../services/organization.js';
import { namedCharacter } from '../../core/action-fields.js';
import type { Plan, PlanStep } from '../../core/plan.js';
import { CARRIER_STEP } from '../../core/plan.js';
import { rosterOf } from '../../services/strike/prowess.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'play-character', 'move-to-influence', 'discard-character',
  'split-company', 'merge-companies', 'move-to-company',
] as const;

/** A character definition named by an action, from hand or from play. */
function characterOf(
  context: ModuleContext,
  instanceId: CardInstanceId | undefined,
): { name: string; source: MpSource; marshallingPoints: number; mind: number; avatar: boolean } | null {
  if (!instanceId) return null;
  const inHand = context.view.self.hand.find(c => c.instanceId === instanceId);
  const inPlay = context.view.self.characters[instanceId];
  const definitionId = inHand?.definitionId ?? inPlay?.definitionId;
  const def: CardDefinition | undefined = definitionId ? context.cardPool[definitionId] : undefined;
  if (!def) return null;
  const fields = def as unknown as {
    name?: string; marshallingPoints?: number; marshallingCategory?: string; mind?: number;
  };
  return {
    name: fields.name ?? (instanceId as string),
    source: (fields.marshallingCategory ?? 'character') as MpSource,
    marshallingPoints: fields.marshallingPoints ?? 0,
    mind: fields.mind ?? 0,
    avatar: isAvatarCharacter(def),
  };
}

// `influenceUnlocked` used to live here: a private, one-direction price for
// what freed direct influence buys. It is gone, subsumed by the organization
// potential — the matching's faction `checkP` is recomputed from the
// arrangement's free direct influence, so stacking and un-stacking are both
// priced as the same potential difference, and the pricing now also fires
// when the faction is a committed plan rather than a card in hand.

/** Assumptions every characters evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the general influence a character consumes when *played* is reported but not priced; what an '
  + 'influence *move* does to the pool is priced, through the organization potential\'s '
  + 'headroom and checkP terms',
  'the prowess a character brings is not counted as value here; `combat` prices it where it is '
  + 'actually used',
  'a change of controller is scored as marshalling-point neutral, which it is',
  'an avatar\'s sideboard access and draw eligibility are priced as one flat `avatarInPlayTsd`, not '
  + 'by what the sideboard actually holds or which companies currently need it',
];

/**
 * Score discarding one of our own characters in play (CoE 3.22).
 *
 * The cost is not the character's marshalling points alone. Its items and
 * allies go with it and its followers revert to general influence, and
 * `character-value.lossCost` already prices exactly that — it is the number
 * `combat` pays when a strike eliminates the same character, which is the point
 * of it being a service. What comes back is the mind he was occupying, and this
 * module has said since it was written that it reports general influence rather
 * than pricing it; discarding is not the place to start inventing a rate.
 */
function evaluateDiscardCharacter(context: ModuleContext, action: GameAction): Evaluation | null {
  const record = action as unknown as { characterInstanceId?: CardInstanceId };
  const instanceId = record.characterInstanceId;
  if (!instanceId || !context.view.self.characters[instanceId]) return null;
  const { standing, cardPool, tunables, view } = context;

  const character = characterOf(context, instanceId);
  const loss = computeCharacterValue(view, cardPool, standing, tunables).lossCost(instanceId);
  const budget = computeBudget(view, cardPool);
  const mind = character?.mind ?? 0;

  // `lossCost` is deliberately "beyond its own marshalling points" — `combat`
  // adds those separately, and so must this. A character in play is scoring for
  // the character source right now, and discarding him stops it.
  const points = character?.marshallingPoints ?? 0;
  const mpLoss = points > 0
    ? standing.tsdAfter({ [character!.source]: -points }) - standing.tsd
    : 0;
  const dtsd = mpLoss - loss.tsd;
  const outcomes: Outcome[] = [{
    p: 1,
    label: points > 0
      ? `discard ${character?.name ?? (instanceId as string)} — ${points} ${character!.source} MP gone, ${loss.reason}`
      : `discard ${character?.name ?? (instanceId as string)} — ${loss.reason}`,
    dtsd,
  }];
  const scored = standing.score(outcomes);

  return {
    action,
    module: 'characters',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(`discard ${character?.name ?? (instanceId as string)}`, scored.utility, [
      node('what leaves with him', dtsd, [
        leaf('marshalling points he was scoring', mpLoss, {
          unit: 'tsd',
          note: points > 0
            ? `${points} ${character!.source} MP, priced at the current standing`
            : 'he carries none',
        }),
        leaf('everything else lost with him', loss.tsd, { unit: 'tsd', note: loss.reason }),
        leaf('mind returned to the pool', mind, {
          note: `${budget.freeGeneralInfluence} of ${budget.generalInfluence} free before — `
            + 'reported, not priced',
        }),
      ], { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'the influence a discard frees is reported but not priced — the same gap as playing him, and '
      + 'for the same reason: what it would be spent on is the roster plan\'s to say',
      ...ASSUMPTIONS,
    ],
  };
}

/**
 * Who actually leaves when a character is split out: him and his followers.
 *
 * The reducer moves the splitter *plus everyone he holds with direct
 * influence*, transitively — a follower of a follower goes too. Modelling only
 * the named character made split and merge stop being inverses of each other,
 * and an agent that values a change and its undo both positively will do them
 * forever. It did: a self-play game spent 4000 decisions cycling
 * split → plan-movement → merge → split in a single organization phase.
 */
function departingWith(context: ModuleContext, characterId: CardInstanceId): Set<string> {
  const leaving = new Set<string>([characterId as string]);
  const queue: CardInstanceId[] = [characterId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const follower of context.view.self.characters[next]?.followers ?? []) {
      if (leaving.has(follower as string)) continue;
      leaving.add(follower as string);
      queue.push(follower);
    }
  }
  return leaving;
}

/** A roster's names, for the rationale. */
function names(roster: readonly StrikeTarget[]): string {
  return roster.length > 0 ? roster.map(t => t.name).join(', ') : '(nobody)';
}

/** A view company as an arranged company, sites carried for the matching. */
function arrangedFrom(
  company: {
    characters: readonly CardInstanceId[];
    currentSite?: { definitionId: string } | null;
    destinationSite?: { definitionId: string } | null;
  },
  characterIds?: readonly CardInstanceId[],
): ArrangedCompany {
  return {
    characterIds: characterIds ?? company.characters,
    currentSiteDefinitionId: company.currentSite?.definitionId,
    destinationSiteDefinitionId: company.destinationSite?.definitionId,
  };
}

/**
 * Score changing the shape of a company.
 *
 * Every shape action is the same comparison: the whole-board arrangement
 * before against the whole-board arrangement after, each scored **once**
 * through `services/organization` — the harm its companies invite, plus the
 * goals the matching says they can serve — and the utility is the difference
 * `u(after) − u(before)` of those two scored numbers.
 *
 * The whole board, untouched companies included, because the matching is not
 * additive per company: a goal the changed company drops may be picked up by
 * another. The harm term still cancels for them.
 *
 * This deliberately bends the evaluation contract: `utility` is a difference
 * of two scored arrangements rather than `standing.score(outcomes).utility`
 * of the reported distribution. The alternative — scoring the delta — has
 * `E[Δ] ≈ 0, σ > 0` for a split, so a convex (trailing) posture prices the
 * split *and* the merge back positive by Jensen, and the agent cycles. As a
 * potential at the utility level, `utility(change) + utility(undo) = 0`
 * exactly, at every risk posture. The reported outcomes are the *after*
 * distribution, shifted so its mean is the change in `E[X]`.
 */
function evaluateShape(context: ModuleContext, action: GameAction): Evaluation | null {
  const { standing, cardPool, tunables, view } = context;
  const organization = computeOrganization(view, cardPool, standing, tunables, context.commitment);
  const merging = action.type === 'merge-companies';

  const untouched = (excluded: readonly string[]): ArrangedCompany[] =>
    view.self.companies
      .filter(c => !excluded.includes(c.id as string))
      .map(c => arrangedFrom(c));

  let before: ArrangedCompany[];
  let after: ArrangedCompany[];
  let headline: string;

  if (action.type === 'move-to-company') {
    // The third shape operation, and the same comparison: a character walks
    // from one company to another at the same site, so two companies change
    // size at once and both hazard limits move with them.
    const record = action as unknown as {
      characterInstanceId: CardInstanceId; sourceCompanyId: string; targetCompanyId: string;
    };
    const source = view.self.companies.find(c => (c.id as string) === record.sourceCompanyId);
    const target = view.self.companies.find(c => (c.id as string) === record.targetCompanyId);
    if (!source || !target) return null;
    const departing = departingWith(context, record.characterInstanceId);
    const goes = source.characters.filter(id => departing.has(id as string));
    const stays = source.characters.filter(id => !departing.has(id as string));
    if (goes.length === 0) return null;
    const leaving = rosterOf({ characters: goes }, view.self.characters, cardPool);
    const rest = untouched([record.sourceCompanyId, record.targetCompanyId]);
    before = [...rest, arrangedFrom(source), arrangedFrom(target)];
    after = [
      ...rest,
      arrangedFrom(source, stays),
      arrangedFrom(target, [...target.characters, ...goes]),
    ];
    headline = `move ${names(leaving)} to the other company`;
  } else if (merging) {
    const record = action as unknown as { sourceCompanyId: string; targetCompanyId: string };
    const source = view.self.companies.find(c => (c.id as string) === record.sourceCompanyId);
    const target = view.self.companies.find(c => (c.id as string) === record.targetCompanyId);
    if (!source || !target) return null;
    if (source.characters.length === 0 || target.characters.length === 0) return null;
    const rest = untouched([record.sourceCompanyId, record.targetCompanyId]);
    before = [...rest, arrangedFrom(source), arrangedFrom(target)];
    after = [...rest, arrangedFrom(target, [...target.characters, ...source.characters])];
    headline = `merge ${names(rosterOf(source, view.self.characters, cardPool))} into `
      + `${names(rosterOf(target, view.self.characters, cardPool))}`;
  } else {
    const record = action as unknown as { sourceCompanyId: string; characterId: CardInstanceId };
    const company = view.self.companies.find(c => (c.id as string) === record.sourceCompanyId);
    if (!company || company.characters.length < 2) return null;
    // Followers travel with the character holding them, so the two sides are
    // built from the company's character list and not by filtering a flat
    // roster — an ally on a departing character has to leave with him, and the
    // roster has already forgotten whose ally it is.
    const departing = departingWith(context, record.characterId);
    const goes = company.characters.filter(id => departing.has(id as string));
    const stays = company.characters.filter(id => !departing.has(id as string));
    if (goes.length === 0 || stays.length === 0) return null;
    const leaving = rosterOf({ characters: goes }, view.self.characters, cardPool);
    const staying = rosterOf({ characters: stays }, view.self.characters, cardPool);
    const rest = untouched([record.sourceCompanyId]);
    before = [...rest, arrangedFrom(company)];
    // The spun-off half stands where the source stands; it has no committed
    // movement of its own yet.
    after = [...rest, arrangedFrom(company, stays), arrangedFrom(company, goes)];
    headline = `split ${names(leaving)} out of ${names(staying)}`;
  }

  const valueBefore = organization.valueOf({ companies: before });
  const valueAfter = organization.valueOf({ companies: after });
  const utility = valueAfter.u - valueBefore.u;
  const expectedTsd = valueAfter.expectedTsd - valueBefore.expectedTsd;

  // The after distribution, re-centred on the change: its mean is
  // `E[X(after)] − E[X(before)]` and its spread is the after arrangement's
  // own, which is what the risk posture grips.
  const outcomes: Outcome[] = valueAfter.outcomes.map(outcome => ({
    ...outcome,
    dtsd: outcome.dtsd - valueBefore.expectedTsd,
  }));
  const { sigma } = distributionStats(outcomes);

  const served = valueAfter.assignments.map(a =>
    leaf(a.goal.label, a.p, {
      unit: 'p',
      note: `served by ${a.companyLabel} for ${a.weightTsd.toFixed(2)} tsd`
        + (a.goal.committed ? ' (committed)' : ' (opportunity, discounted)'),
    }));

  return {
    action,
    module: 'characters',
    outcomes,
    expectedTsd,
    sigmaTsd: sigma,
    utility,
    method: 'integrated',
    rationale: node(headline, utility, [
      leaf('potential difference', utility, {
        unit: 'winprob',
        note: 'u(after) − u(before), one scored number per whole-board arrangement — '
          + 'a scored delta would cycle under a convex posture (spec §5)',
      }),
      node('after this action', valueAfter.u,
        valueAfter.rationale.children ?? [], { unit: 'winprob' }),
      node('before it', valueBefore.u,
        valueBefore.rationale.children ?? [], { unit: 'winprob' }),
      ...(served.length > 0
        ? [node('goals the new shape serves', valueAfter.assignments.length, served)]
        : [leaf('goals the new shape serves', 0, {
          note: 'no company can serve any goal — the change only moves harm',
        })]),
    ], { unit: 'winprob' }),
    assumptions: [
      'utility is a difference of two scored arrangements, not standing.score of the reported '
      + 'distribution — the reported outcomes are the after-arrangement re-centred on the change',
      'one goal per company: within the horizon a company serves one destination at a time, and '
      + 'sequential service is conservatively discounted to zero',
      'the matching is tapped-ness-blind; the last-untapped-carrier cost is priced once, by the '
      + 'plan layer\'s CARRIER_STEP rule, never here',
      'the hazards are assumed to be the average creature the opponent has shown, played into '
      + 'every slot; a hand with nothing keyable to the path spends none of them',
      ...ASSUMPTIONS,
    ],
  };
}

/** The characters module. No context gate: both actions are always its own. */
export const charactersModule: H2Module = {
  name: 'characters',
  ownedActionTypes: OWNED_ACTION_TYPES,

  /**
   * Whether the company a plan depends on can still make the play.
   *
   * `characters` owns this step because every action that changes who stands
   * in a company is one of its own — `split-company`, `move-to-company`,
   * `discard-character`. The rules ask for one untapped character to make the
   * play, so the step is binary: the company has one or it does not, and a
   * fraction here would be a constant nobody could calibrate.
   *
   * This is also where company shape acquires a *reason*. `defence` prices a
   * split by the harm it changes, which is why a split and its undo can both
   * look positive and the agent spends whole games oscillating between them.
   * A committed plan breaks that symmetry: stripping the last untapped
   * character out of the company carrying a commitment now costs the whole
   * commitment, and putting one back is worth having it. The cycle is not the
   * target of this change and it is not fixed by it — but the shape decision
   * finally has something at stake beyond a difference of potentials.
   */
  planStepDelta(
    action: GameAction,
    plan: Plan,
    step: PlanStep,
    _stepIndex: number,
    context: ModuleContext,
  ): number | null {
    if (step.tag !== CARRIER_STEP) return null;
    const required = plan.requirements.find(r => r.kind === 'company-at-site');
    if (!required || required.kind !== 'company-at-site') return null;

    const fields = action as unknown as {
      sourceCompanyId?: string;
      targetCompanyId?: string;
    };
    const companyId = required.companyId as unknown as string;
    const leaving = (action.type === 'split-company' || action.type === 'move-to-company'
      || action.type === 'discard-character')
      && fields.sourceCompanyId === companyId;
    const arriving = action.type === 'move-to-company' && fields.targetCompanyId === companyId;

    const budget = computeBudget(context.view, context.cardPool);
    const untapped = budget.untappedIn(required.companyId);
    if (arriving) return untapped.length > 0 ? null : 1;

    // Anything that spends the company's last untapped character costs the
    // commitment, whatever the action is called.
    //
    // This is the measured bottleneck rather than a guess. Instrumented over
    // twelve games, H2 arrives at a site with **nobody left to tap 75.1% of
    // the time**, against `heuristic`'s 23.4% — while holding 2.5 items and
    // 2.1 factions it could have played. `tapTempoCost`'s own doc comment
    // predicted exactly this: "an AI that taps freely arrives at its site
    // unable to score." It is a flat 0.3 TSD and it does not know a commitment
    // exists; `influence-attempt` alone is taken by H2 at 93.9% against
    // `heuristic`'s 73.9%, and every one of those taps somebody.
    //
    // So the price of the *last* tap is the plan it forfeits, which is the
    // whole reason the plan layer exists — a cost that belongs to a
    // commitment, made visible to a decision that has no idea the commitment
    // is there.
    const named = namedCharacter(action);
    if (!leaving && named === undefined) return null;
    if (!leaving && !untapped.some(c => c.instanceId === named)) return null;

    // Leaving takes the named character and their followers; tapping spends
    // only the named one. Followers are not counted in either case, so a
    // character carrying untapped followers is under-charged — recorded rather
    // than guessed at, because the view does not report the attachment this
    // would need.
    const remaining = untapped.filter(c => c.instanceId !== named).length;
    return remaining > 0 ? null : 0;
  },

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'split-company' || action.type === 'merge-companies'
      || action.type === 'move-to-company') {
      return evaluateShape(context, action);
    }
    if (action.type === 'discard-character') return evaluateDiscardCharacter(context, action);
    // `move-to-influence` names the character in `characterInstanceId`;
    // `play-character` uses `cardInstanceId`. Reading only one of them made
    // the module return null on every real influence move, which the old
    // all-or-nothing dispatch hid behind a blanket fallback.
    const record = action as unknown as {
      characterInstanceId?: CardInstanceId; characterId?: CardInstanceId; cardInstanceId?: CardInstanceId;
    };
    const named = record.cardInstanceId ?? record.characterInstanceId ?? record.characterId;
    const character = characterOf(context, named);
    if (!character) return null;
    const { standing, tunables } = context;
    const budget = computeBudget(context.view, context.cardPool);

    if (action.type === 'move-to-influence') {
      // Both directions of the same potential difference. Stacking a
      // follower frees general influence (the headroom term) but spends the
      // holder's direct influence (the faction `checkP` term); un-stacking
      // trades the other way. Which wins is the whole of "stack followers in
      // the best possible manner, but leave direct influence free for
      // factions" — priced, never hard-coded: no reservation rule exists
      // anywhere.
      const controlledBy = (action as unknown as {
        controlledBy?: 'general' | CardInstanceId;
      }).controlledBy;
      if (controlledBy === undefined) return null;
      const { view, cardPool } = context;
      const organization = computeOrganization(view, cardPool, standing, tunables, context.commitment);
      const current = organization.current();
      const valueBefore = organization.valueOf(current);
      const valueAfter = organization.valueOf({
        ...current,
        controllers: { [named as string]: controlledBy as string },
      });
      const utility = valueAfter.u - valueBefore.u;
      const expectedTsd = valueAfter.expectedTsd - valueBefore.expectedTsd;
      const outcomes: Outcome[] = valueAfter.outcomes.map(outcome => ({
        ...outcome,
        dtsd: outcome.dtsd - valueBefore.expectedTsd,
      }));
      const { sigma } = distributionStats(outcomes);

      const moved = budget.afterInfluenceMove(named as CardInstanceId, controlledBy);
      const stacking = controlledBy !== 'general';
      const holderName = stacking
        ? budget.characters[controlledBy as string]?.name ?? (controlledBy as string)
        : null;
      const headline = stacking
        ? `stack ${character.name} under ${holderName}`
        : `move ${character.name} to general influence`;

      return {
        action,
        module: 'characters',
        outcomes,
        expectedTsd,
        sigmaTsd: sigma,
        utility,
        method: 'integrated',
        rationale: node(headline, utility, [
          leaf('potential difference', utility, {
            unit: 'winprob',
            note: 'u(after) − u(before) of the whole arrangement — the same potential every '
              + 'shape action is priced by (spec §5)',
          }),
          node('control', 0, [
            leaf('marshalling points moved', 0, { unit: 'mp', note: 'control changes, score does not' }),
            leaf('mind', character.mind, {
              note: stacking
                ? `held by ${holderName}'s direct influence after the move`
                : 'charged against the general influence pool after the move',
            }),
            leaf('general influence free after the move', moved.freeGeneralInfluence, {
              note: 'what stacking buys: room for the next character played',
            }),
            leaf('free direct influence after the move',
              stacking ? moved.freeDirectInfluence[controlledBy as string] ?? 0
                : Math.max(0, ...Object.values(moved.freeDirectInfluence)),
              {
                note: 'only an untapped character with free direct influence may attempt a faction '
                  + '(reducer-site.ts) — the matching\'s checkP is recomputed from it',
              }),
          ]),
          node('after this move', valueAfter.u,
            valueAfter.rationale.children ?? [], { unit: 'winprob' }),
          node('before it', valueBefore.u,
            valueBefore.rationale.children ?? [], { unit: 'winprob' }),
        ], { unit: 'winprob' }),
        assumptions: [
          'utility is a difference of two scored arrangements, not standing.score of the reported '
          + 'distribution — the reported outcomes are the after-arrangement re-centred on the change',
          'control cost is taken as effective mind; the engine\'s control-cost overrides are not '
          + 'in the view',
          ...ASSUMPTIONS,
        ],
      };
    }

    // Playing a character: its points are worth what that source is worth.
    const gain = character.marshallingPoints > 0
      ? standing.tsdAfter({ [character.source]: character.marshallingPoints }) - standing.tsd
      : 0;
    // An avatar's own marshalling points are frequently zero — its value is
    // never in its MP — so without a floor here it reads as worth exactly what
    // a zero-point non-avatar is worth, and `characterPlayedThisTurn` (CoE
    // 2.II.2) means a positive-MP hero character then always wins the slot.
    // `avatarInPlayTsd` is that floor: sideboard access and low-mind-company
    // draw eligibility are real, rule-derived capabilities this module cannot
    // price in full without the sideboard's contents or a roster plan, so a
    // flat number stands in rather than pretending they are worth nothing.
    const avatarBonus = character.avatar ? tunables.avatarInPlayTsd : 0;
    const dtsd = netTsdDelta({ realized: gain + avatarBonus }, tunables);
    const outcomes: Outcome[] = [{
      p: 1,
      label: `play ${character.name} — ${character.marshallingPoints} ${character.source} MP, mind ${character.mind}`
        + (character.avatar ? ', avatar' : ''),
      dtsd,
    }];
    const scored = standing.score(outcomes);

    const detail: Rationale[] = [
      leaf('character', character.name),
      leaf('marshalling points', character.marshallingPoints, { unit: 'mp', note: `${character.source} source` }),
      leaf(`worth of one ${character.source} point here`, standing.marginal[character.source], {
        unit: 'tsd',
        note: standing.marginal[character.source] === 0
          ? 'zero — that source is already at the half-total cap (CoE 10.3)'
          : 'CoE 10.3, after doubling and the diversity cap',
      }),
      leaf('mind', character.mind, {
        note: `${budget.freeGeneralInfluence} of ${budget.generalInfluence} general influence free — `
          + 'the cost is reported, not priced',
      }),
      leaf('avatar floor', avatarBonus, {
        unit: 'tsd',
        tunable: 'avatarInPlayTsd',
        note: character.avatar
          ? 'sideboard access (CoE 2.II.6) and low-mind-company draw eligibility (CoE 2.IV.v), '
            + 'priced flat rather than in full'
          : 'not an avatar',
      }),
    ];

    return {
      action,
      module: 'characters',
      outcomes,
      expectedTsd: scored.expectedTsd,
      sigmaTsd: scored.sigmaTsd,
      utility: scored.utility,
      method: scored.method,
      rationale: node(`play ${character.name}`, scored.utility, [
        node('character', character.marshallingPoints, detail),
        scored.rationale,
      ], { unit: 'winprob' }),
      assumptions: ASSUMPTIONS,
    };
  },
};
