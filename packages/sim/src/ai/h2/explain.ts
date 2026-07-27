/**
 * @module ai/h2/explain
 *
 * Renders one decision as text: the standing, the ranked candidates in win
 * probability, and the rationale tree behind the top few.
 *
 * This lives beside the modules rather than in the CLI because the same
 * rendering is what golden tests diff. `explain` is the primary development
 * tool for H2 — the answer to "why did it do that" is meant to be readable,
 * not reconstructed from weights.
 */

import type { CardDefinition, GameAction, PlayerView } from '@meccg/shared';
import { buildCompanyNames, buildInstanceLookup, describeAction, stripCardMarkers } from '@meccg/shared';
import type { Evaluation } from './core/types.js';
import { renderRationale } from './core/rationale.js';
import type { Standing } from './services/standing.js';
import type { Budget } from './services/budget.js';

/** Everything the renderer needs about one decision. */
export interface ExplanationInput {
  /** Heading line identifying the position, e.g. a scenario ID or `game#seq`. */
  readonly title: string;
  /** The acting player's view. */
  readonly view: PlayerView;
  /** Card pool, for describing actions. */
  readonly cardPool: Readonly<Record<string, CardDefinition>>;
  /** The standing at this decision. */
  readonly standing: Standing;
  /** Name of the module that claimed the decision, or `null` for the H1 fallback. */
  readonly module: string | null;
  /** Ranked evaluations; empty when the H1 fallback owns the decision. */
  readonly evaluations: readonly Evaluation[];
  /** H1's weights, used when no module claimed the decision. */
  readonly fallback?: readonly { readonly action: GameAction; readonly weight: number }[];
  /** How many candidates to expand fully. */
  readonly topN: number;
  /** The hard constraints the position is played inside. */
  readonly budget?: Budget;
}

/** Build a describer for the acting player's view. */
function makeDescriber(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): (action: GameAction) => string {
  const lookup = buildInstanceLookup(view);
  const companies = buildCompanyNames(view.self.companies, view.self.characters, cardPool);
  const names: Record<string, string> = {
    [view.self.id as string]: view.self.name,
    [view.opponent.id as string]: view.opponent.name,
  };
  return action => stripCardMarkers(describeAction(action, cardPool, lookup, companies, names));
}

/** Signed percentage, the unit utilities are reported in. */
function pct(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

/** Signed TSD figure. */
function tsdText(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

/** Render the whole explanation as lines of text. */
export function renderExplanation(input: ExplanationInput): string[] {
  const { view, standing } = input;
  const describe = makeDescriber(view, input.cardPool);
  const lines: string[] = [];

  const step = 'setupStep' in view.phaseState
    ? `/${(view.phaseState as { setupStep: { step: string } }).setupStep.step}`
    : '';
  lines.push(`Position: ${input.title}`);
  lines.push(`          turn ${view.turnNumber}, ${view.phaseState.phase}${step}, ${view.self.name} (${view.self.id}) to act`);
  lines.push(
    `Standing: TSD ${tsdText(standing.tsd)} (${view.self.name} ${standing.selfScore} / ${view.opponent.name} ${standing.opponentScore})`
    + `, W = ${(standing.risk.standing.winProbability * 100).toFixed(1)}%`
    + ` → risk λ = ${standing.risk.lambda >= 0 ? '+' : ''}${standing.risk.lambda.toFixed(2)} (${standing.risk.source})`,
  );
  if (standing.risk.source === 'override') {
    lines.push(
      `          utilities evaluated at TSD ${tsdText(standing.risk.standing.effectiveTsd)}`
      + ` — the standing whose curvature matches the requested λ`,
    );
  }
  lines.push('');
  lines.push('STANDING');
  lines.push(...renderRationale(standing.rationale(), '  '));
  lines.push('');

  if (input.budget) {
    // The constraints are as much a part of "why" as the score is: a faction
    // is unreachable without an untapped character holding enough free direct
    // influence, and that is visible here or nowhere.
    const budget = input.budget;
    lines.push('BUDGET');
    lines.push(`  general influence  ${budget.freeGeneralInfluence} free of ${budget.generalInfluence}`
      + ` — the mind a new character must fit inside`);
    lines.push(`  taps available     ${budget.tapsAvailable}`);
    for (const company of view.self.companies) {
      const untapped = budget.untappedIn(company.id);
      const best = budget.bestInfluencerIn(company.id);
      lines.push(`  ${company.id as string}: ${untapped.length} untapped`
        + (best
          ? `, best influence ${best.freeDirectInfluence} free (${best.name})`
          : ', no untapped character — no influence attempt possible'));
    }
    lines.push('');
  }

  if (input.module === null) {
    lines.push(`RANKED (heuristics-1 fallback — no H2 module owns this decision)`);
    const ranked = [...(input.fallback ?? [])].sort((a, b) => b.weight - a.weight);
    const total = ranked.reduce((sum, c) => sum + c.weight, 0);
    ranked.slice(0, input.topN).forEach((candidate, i) => {
      const share = total > 0 ? ((candidate.weight / total) * 100).toFixed(1) : '0.0';
      lines.push(`  ${i + 1}. ${describe(candidate.action)}`);
      lines.push(`     h1 weight ${candidate.weight.toFixed(2)}  (${share}% of the sampling mass)`);
    });
    if (ranked.length > input.topN) lines.push(`  … ${ranked.length - input.topN} more candidates`);
    lines.push('');
    lines.push('  Heuristics-1 weights are unitless and comparable only within one evaluator;');
    lines.push('  they are shown for orientation, not as win-probability deltas.');
    return lines;
  }

  lines.push(`RANKED (module ${input.module})`);
  input.evaluations.forEach((evaluation, i) => {
    lines.push(
      `  ${i + 1}. ${describe(evaluation.action)}`,
    );
    lines.push(
      `     U = ${pct(evaluation.utility)} win   E[Δtsd] ${tsdText(evaluation.expectedTsd)}`
      + `  σ ${evaluation.sigmaTsd.toFixed(1)}  (${evaluation.method})`,
    );
  });
  lines.push('');

  input.evaluations.slice(0, input.topN).forEach((evaluation, i) => {
    lines.push(`  #${i + 1} ${describe(evaluation.action)}`);
    lines.push(...renderRationale(evaluation.rationale, '  '));
    for (const outcome of evaluation.outcomes) {
      lines.push(`    ${(outcome.p * 100).toFixed(1).padStart(5)}%  ${outcome.label}  Δtsd ${tsdText(outcome.dtsd)}`);
    }
    if (evaluation.assumptions.length > 0) {
      lines.push(`    assumptions: ${evaluation.assumptions.join('; ')}`);
    }
    lines.push('');
  });
  return lines;
}
