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
 * `move-to-influence` transfers a character between a controller's direct
 * influence and the general pool. It moves no marshalling points, but it does
 * move direct influence — and free direct influence is exactly what an
 * influence attempt spends (`reducer-site.ts`). So the action is scored as
 * point-neutral with the influence change reported, which is the honest shape
 * until the strategic half can say what that influence is for.
 *
 * **Company shape** — `split-company` and `merge-companies` — belongs here for
 * the same reason: it is a question about the roster, not about a destination.
 * And it has a real answer, because the hazard limit *is* the company size. A
 * company of five hands the opponent five slots to spend on it; split into two
 * and three it hands them two and three, aimed at rosters that answer very
 * differently. `defence` computes both sides against the same typical attack —
 * the creatures this opponent has actually shown — and the difference is the
 * whole evaluation.
 *
 * That difference has to be a difference *of one potential*, `Σ harm(company)`
 * over the whole board, or the module will value a change and its undo both
 * positively and do them forever. It did, twice, and both times the game ran to
 * the decision limit inside a single organization phase. `defence` carries the
 * two conditions that make it a potential and the tests that pin them.
 *
 * What that leaves out is stated: splitting also lets two companies reach two
 * sites, which is usually the reason anyone does it, and pricing that needs
 * destinations the organization phase has not chosen yet.
 */

import type { CardDefinition, CardInstanceId, GameAction } from '@meccg/shared';
import type { Evaluation, H2Module, ModuleContext, Outcome, Rationale } from '../../core/types.js';
import type { MpSource } from '../../core/tsd.js';
import { netTsdDelta } from '../../core/tsd.js';
import { leaf, node } from '../../core/rationale.js';
import { computeBudget } from '../../services/budget.js';
import { computeCharacterValue } from '../../services/character-value.js';
import { computeDefence } from '../../services/defence.js';
import { rosterOf } from '../../services/strike/prowess.js';
import type { StrikeTarget } from '../../services/strike/prowess.js';

/** Action types this module scores. */
const OWNED_ACTION_TYPES = [
  'play-character', 'move-to-influence', 'discard-character', 'split-company', 'merge-companies',
] as const;

/** A character definition named by an action, from hand or from play. */
function characterOf(
  context: ModuleContext,
  instanceId: CardInstanceId | undefined,
): { name: string; source: MpSource; marshallingPoints: number; mind: number } | null {
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
  };
}

/** Assumptions every characters evaluation rests on. */
const ASSUMPTIONS: readonly string[] = [
  'the general influence a character consumes is reported but not priced — what it displaces is '
  + 'the roster plan\'s to say (§3.2), and that strategic half does not exist yet',
  'the prowess and direct influence a character brings are not counted as value here; `combat` '
  + 'and `factions` price those where they are actually used',
  'a change of controller is scored as marshalling-point neutral, which it is',
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

/** The characters of a company, as strike targets from our own seat. */
function rosterFor(context: ModuleContext, companyId: string): StrikeTarget[] {
  const company = context.view.self.companies.find(c => (c.id as string) === companyId);
  return company ? rosterOf(company, context.view.self.characters, context.cardPool) : [];
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

/**
 * Score changing the shape of a company.
 *
 * Both actions are the same comparison: the harm the shape *before* invites
 * against the harm the shape *after* invites, where a company's hazard limit is
 * its own size. Merging concentrates the slots on one roster that answers
 * better; splitting spreads them across two that answer worse. Which wins is
 * position-dependent, which is the point of computing it.
 */
function evaluateShape(context: ModuleContext, action: GameAction): Evaluation | null {
  const { standing, cardPool, tunables, view } = context;
  const defence = computeDefence(view, cardPool, standing, tunables);
  const merging = action.type === 'merge-companies';

  let before: StrikeTarget[][];
  let after: StrikeTarget[][];
  let headline: string;

  if (merging) {
    const record = action as unknown as { sourceCompanyId: string; targetCompanyId: string };
    const source = rosterFor(context, record.sourceCompanyId);
    const target = rosterFor(context, record.targetCompanyId);
    if (source.length === 0 || target.length === 0) return null;
    before = [source, target];
    after = [[...target, ...source]];
    headline = `merge ${names(source)} into ${names(target)}`;
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
    const source = rosterOf(company, view.self.characters, cardPool);
    const leaving = rosterOf({ characters: goes }, view.self.characters, cardPool);
    const staying = rosterOf({ characters: stays }, view.self.characters, cardPool);
    before = [source];
    after = [staying, leaving];
    headline = `split ${names(leaving)} out of ${names(staying)}`;
  }

  // A company's hazard limit is its own size, so the shape decides both how
  // many slots there are and what they are aimed at.
  const harmOf = (shapes: StrikeTarget[][]): number =>
    shapes.reduce((sum, roster) => sum + defence.expectedHarm(roster, roster.length), 0);
  const harmBefore = harmOf(before);
  const harmAfter = harmOf(after);
  const dtsd = harmBefore - harmAfter;

  const outcomes: Outcome[] = [{
    p: 1,
    label: dtsd >= 0
      ? `${headline} — the shape invites ${dtsd.toFixed(1)} less harm`
      : `${headline} — the shape invites ${(-dtsd).toFixed(1)} more harm`,
    dtsd,
  }];
  const scored = standing.score(outcomes);

  const detail: Rationale[] = [
    leaf('typical attack', `${defence.typical.strikes} strike(s) at prowess `
      + `${defence.typical.prowess}`, {
      note: defence.typical.fromPool
        ? 'the opponent has shown no creature yet — the median of the card pool'
        : `the median of the ${defence.typical.seen} creature(s) they have shown`,
    }),
  ];
  for (const roster of before) {
    detail.push(leaf(`before: ${names(roster)}`, defence.expectedHarm(roster, roster.length), {
      unit: 'tsd',
      note: `${roster.length} character(s), so ${roster.length} hazard slot(s)`,
    }));
  }
  for (const roster of after) {
    detail.push(leaf(`after: ${names(roster)}`, defence.expectedHarm(roster, roster.length), {
      unit: 'tsd',
      note: `${roster.length} character(s), so ${roster.length} hazard slot(s)`,
    }));
  }

  return {
    action,
    module: 'characters',
    outcomes,
    expectedTsd: scored.expectedTsd,
    sigmaTsd: scored.sigmaTsd,
    utility: scored.utility,
    method: scored.method,
    rationale: node(headline, scored.utility, [
      node('harm the shape invites', dtsd, detail, { unit: 'tsd' }),
      scored.rationale,
    ], { unit: 'winprob' }),
    assumptions: [
      'company shape is priced only by the hazards its size invites; that splitting lets two '
      + 'companies reach two sites — usually the reason to do it — needs destinations the '
      + 'organization phase has not chosen yet',
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

  evaluate(action: GameAction, context: ModuleContext): Evaluation | null {
    if (action.type === 'split-company' || action.type === 'merge-companies') {
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
      const held = budget.characters[named as string];
      const outcomes: Outcome[] = [{
        p: 1,
        label: `${character.name} changes controller — no marshalling points move`,
        dtsd: 0,
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
        rationale: node(`move ${character.name}`, scored.utility, [
          node('control', 0, [
            leaf('marshalling points moved', 0, { unit: 'mp', note: 'control changes, score does not' }),
            leaf('mind', character.mind, {
              note: 'charged against the general influence pool while held there',
            }),
            leaf('free direct influence it frees or consumes', held?.freeDirectInfluence ?? 0, {
              note: 'only an untapped character with free direct influence may attempt a faction '
                + '(reducer-site.ts) — reported, not priced',
            }),
          ]),
          scored.rationale,
        ], { unit: 'winprob' }),
        assumptions: ASSUMPTIONS,
      };
    }

    // Playing a character: its points are worth what that source is worth.
    const gain = character.marshallingPoints > 0
      ? standing.tsdAfter({ [character.source]: character.marshallingPoints }) - standing.tsd
      : 0;
    const dtsd = netTsdDelta({ realized: gain }, tunables);
    const outcomes: Outcome[] = [{
      p: 1,
      label: `play ${character.name} — ${character.marshallingPoints} ${character.source} MP, mind ${character.mind}`,
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
