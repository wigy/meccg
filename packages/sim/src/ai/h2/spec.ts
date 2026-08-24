/**
 * @module ai/h2/spec
 *
 * The `h2` agent spec grammar, in one place.
 *
 * `h2[:<modules>][@<temperature>][/<tunable>=<value>…]`
 *
 * Both the registry (`cli/common`'s `resolveAgent`, which builds the agent) and
 * the explainer (`ai/explain-decision`, which has to re-run the same module set
 * with the same constants to say why the agent did what it did) need to read
 * this. Two parsers would mean an explanation of `h2:combat/tapTempoCost=0.6`
 * quietly derived from the shipped defaults — an explanation of a different
 * agent than the one that played.
 */

import type { Tunables } from './core/tunables.js';
import { DEFAULT_TUNABLES, withTunable } from './core/tunables.js';

/** Flag reference, printed by the CLIs. */
export const H2_SPEC_GRAMMAR = 'h2[:<modules>][@<temperature>][/<tunable>=<value>...]';

/** An `h2` spec's parameter, taken apart. */
export interface H2Spec {
  /** Module selector: `undefined` / `'all'` for everything, or `'combat,kill'`. */
  readonly modules?: string;
  /** Softmax temperature, when the spec asked for sampled play with `@T`. */
  readonly temperature?: number;
  /** Constants, with any `/name=value` overrides applied. */
  readonly tunables: Tunables;
  /** Whether any tunable differs from the shipped set. */
  readonly hasTunableOverrides: boolean;
}

/**
 * Parse the `/name=value` tunable overrides of an `h2` spec.
 *
 * The separator is `/` because `--agents` splits specs on commas and the
 * module selector spends commas already. Unknown names throw via
 * `withTunable`, so a typo in a gate fails at launch rather than quietly
 * rating the shipped defaults against themselves.
 */
export function parseH2Tunables(param: string): Tunables {
  let tunables = DEFAULT_TUNABLES;
  for (const part of param.split('/')) {
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`h2 expects name=value tunables separated by "/", got "${part}"`);
    const name = part.slice(0, eq).trim();
    const value = Number(part.slice(eq + 1).trim());
    if (!Number.isFinite(value)) {
      throw new Error(`h2 tunable ${name} expects a number, got "${part.slice(eq + 1).trim()}"`);
    }
    tunables = withTunable(tunables, name, value);
  }
  return tunables;
}

/**
 * Parse an `h2` spec's parameter — everything after the first `:`, or
 * `undefined` for a bare `h2`.
 *
 * Composition operators (`+`, `>`) are rejected here rather than ignored: H2
 * has no fallback, and a script asking for `h2>mc` is told the composition no
 * longer exists instead of quietly getting plain `h2`.
 */
export function parseH2Spec(param?: string): H2Spec {
  if (param !== undefined) {
    const op = [param.indexOf('+'), param.indexOf('>')].filter(i => i >= 0);
    if (op.length > 0) {
      const found = param.slice(Math.min(...op), Math.min(...op) + 1);
      throw new Error(
        `h2 no longer composes a fallback, so "${found}" is not accepted: `
        + 'it answers every decision with its own modules. Use plain `h2`.',
      );
    }
  }
  const slash = param === undefined ? -1 : param.indexOf('/');
  const head = slash >= 0 ? param!.slice(0, slash) : param;
  const tunables = slash >= 0 ? parseH2Tunables(param!.slice(slash + 1)) : DEFAULT_TUNABLES;
  const at = head === undefined ? -1 : head.lastIndexOf('@');
  const modules = head === undefined || head.length === 0 ? undefined : at > 0 ? head.slice(0, at) : head;
  const temperature = at > 0 ? Number(head!.slice(at + 1)) : undefined;
  if (temperature !== undefined && !Number.isFinite(temperature)) {
    throw new Error(`h2 expects a numeric temperature after "@", got "${head!.slice(at + 1)}"`);
  }
  return { modules, temperature, tunables, hasTunableOverrides: slash >= 0 };
}

/** Whether an agent spec names the H2 agent, and so has a module-level explanation. */
export function isH2Spec(spec: string): boolean {
  const colon = spec.indexOf(':');
  const name = colon === -1 ? spec : spec.slice(0, colon);
  return name === 'h2';
}

/** The parameter part of an agent spec (everything after the first `:`). */
export function agentSpecParam(spec: string): string | undefined {
  const colon = spec.indexOf(':');
  return colon === -1 ? undefined : spec.slice(colon + 1);
}
