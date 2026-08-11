/**
 * @module cycle-guard
 *
 * The last resort against a policy that has walked in a circle.
 *
 * A deterministic argmax policy plus a legal no-op loop is a hang. The `bc`
 * agent has carried its own guard against this since two model agents burned a
 * 25,000-decision budget inside turn 1 on *I'll Report You* (le-196), and
 * `state-signature` exists for it: a coarse fingerprint of the quantities any
 * real progress moves, so that a true cycle returns to an identical string
 * while legitimately repeated actions never collide.
 *
 * What that guard cannot catch is a cycle whose actions carry **fresh instance
 * identifiers each lap**, and Heuristics 2 rides exactly one of those:
 *
 * ```text
 *   split-company  →  plan-movement  →  merge-companies
 * ```
 *
 * rotating the planned destination between four sites. Every `split-company`
 * mints a new company ID, so the `merge-companies` that follows names a
 * different company on every lap; the engine's `reverse-actions` cannot mark it
 * an undo, and a guard keyed on action identity sees an unbroken run of moves
 * it has never tried before. The README records the same family being kept from
 * the `mc` fallback for the same reason (`NEVER_YIELDED_ACTION_TYPES`) — plain
 * `h2` rides it alone.
 *
 * ## Why this is worth more than it looks
 *
 * It reads like hygiene, and it was written off as hygiene once already. It is
 * not: it is the reason the plan layer cannot be measured. Gating `h2` against
 * its own off-switch over 96 games returned **+92 Elo [−2, +203]** — a miss by
 * two points — with **32 of 96 games unfinished**, every one of them in this
 * cycle. A third of the sample is discarded before the rating is computed, and
 * that is roughly the width needed to clear zero. A hang is not only a bad
 * experience in a lobby game; it is a hole in every experiment run afterwards.
 *
 * ## How it works
 *
 * The guard keys on the *position* rather than on the action. Revisit a
 * signature often enough and the conclusion is not that some particular move
 * was wrong, it is that **everything tried from here led back here** — which is
 * a statement about the action types already spent, whatever identifiers they
 * carried. Above the threshold the guard drops those types; if that leaves
 * nothing, it takes `pass`, which ends the phase and so cannot recur.
 *
 * Three properties this deliberately has:
 *
 * - **It only ever narrows.** The agent still ranks what survives, so on every
 *   position the guard has not seen too often — which is all of them in a
 *   healthy game — behaviour is bit-identical.
 * - **It terminates.** Each visit above the threshold spends one more action
 *   type, and there are finitely many; the tail is `pass`, and a phase can only
 *   be passed once.
 * - **It is not a fix.** A model that scores a shape change and its undo as
 *   both profitable is wrong about the position, and this does not make it
 *   right. It converts a hang into a completed game, which is what both a lobby
 *   game and a gate need first.
 */

import type { GameAction } from '@meccg/shared';

/**
 * Visits to one signature before the guard engages.
 *
 * Chosen above the longest legitimate run of same-signature decisions rather
 * than as tight as possible. The signature is deliberately coarse — it tracks
 * zone sizes and tap counts, not card identity — so a long attack can assign
 * several strikes without moving any quantity it watches, and a threshold at
 * two or three would rewrite combat to end a loop that lives in the
 * organization phase. Eight leaves that alone and still ends a period-three
 * cycle within a few laps.
 */
const DEFAULT_VISITS_BEFORE_GUARDING = 8;

/** How the guard is configured. */
export interface CycleGuardOptions {
  /** Visits to a signature before its spent action types are dropped. */
  readonly visitsBeforeGuarding?: number;
}

/** A per-game record of which positions have been revisited, and how. */
export interface CycleGuard {
  /** Forget everything. Signatures are coarse, so they must not cross games. */
  reset(): void;
  /**
   * The candidates still worth considering at this position.
   *
   * Returns `actions` unchanged below the threshold, and on a forced decision
   * at any count — narrowing a single legal action is not a choice.
   */
  allow(signature: string, actions: readonly GameAction[]): readonly GameAction[];
  /** Record what was chosen here, so a later visit knows it was spent. */
  taken(signature: string, action: GameAction): void;
}

/** One position's history. */
interface Visits {
  /** Decisions taken at this signature so far this game. */
  count: number;
  /** Action types already chosen from it. */
  readonly types: Set<string>;
}

/** Build a guard. One per agent instance, reset at the start of each game. */
export function createCycleGuard(options: CycleGuardOptions = {}): CycleGuard {
  const threshold = options.visitsBeforeGuarding ?? DEFAULT_VISITS_BEFORE_GUARDING;
  let seen = new Map<string, Visits>();

  return {
    reset(): void {
      seen = new Map<string, Visits>();
    },

    allow(signature: string, actions: readonly GameAction[]): readonly GameAction[] {
      if (actions.length <= 1) return actions;
      const visits = seen.get(signature);
      if (visits === undefined || visits.count < threshold) return actions;

      const fresh = actions.filter(action => !visits.types.has(action.type));
      if (fresh.length > 0) return fresh;

      // Every kind of action available here has been tried and brought us
      // back. Passing ends the phase, so the position cannot recur — and if
      // the engine does not offer it, the caller is better off ranking the
      // full list than being handed nothing.
      const pass = actions.find(action => action.type === 'pass');
      return pass ? [pass] : actions;
    },

    taken(signature: string, action: GameAction): void {
      const visits = seen.get(signature);
      if (visits === undefined) {
        seen.set(signature, { count: 1, types: new Set([action.type]) });
        return;
      }
      visits.count++;
      visits.types.add(action.type);
    },
  };
}
