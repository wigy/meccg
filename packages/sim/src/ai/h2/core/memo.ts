/**
 * @module ai/h2/core/memo
 *
 * Building a service once per *position* instead of once per candidate.
 *
 * Every service takes the view and returns an answer about it, and the registry
 * asks every module about every candidate on a decision — so a decision with
 * fourteen candidates was building `beliefs` fourteen times, `defence` fourteen
 * times (each one scanning the whole card pool for creatures), and `card-price`
 * fourteen times (each one resolving a whole attack per distinct creature in
 * hand). The answer is identical every time, because a service is a function of
 * the position and the position does not change between candidates.
 *
 * The measured cost is real but modest: an instrumented self-play game runs in
 * about ten seconds either way. What justifies this is not a benchmark — it is
 * that rebuilding an identical answer once per candidate is waste that grows
 * with every service added, and the services added this week are the expensive
 * kind: `defence` scans the whole card pool for creatures, `card-price`
 * resolves an attack per distinct creature in hand, and `hazards` runs a beam
 * search whose result does not depend on which candidate asked for it.
 *
 * (The suspicion that prompted it — a head-to-head producing no output for ten
 * minutes — turned out to be `tail` buffering the pipe, not a slow agent. The
 * memoisation stands on its own; the diagnosis did not.)
 *
 * The cache is keyed on the *identity* of the view, which is exactly the right
 * granularity: the registry builds one `ModuleContext` per decision and passes
 * the same view object to every module, and the next decision brings a freshly
 * projected one. A `WeakMap` means a finished decision's entry is collectable
 * the moment the view is, so nothing accumulates across a game.
 *
 * The remaining arguments are compared by identity too, and a mismatch simply
 * recomputes. That keeps `sweep` correct — it varies `tunables` and would
 * otherwise be handed another run's answer — without anyone having to remember
 * to invalidate anything.
 */

/** One cached answer, with the arguments it was computed for. */
interface Entry<T> {
  readonly rest: readonly unknown[];
  readonly value: T;
}

/**
 * Cache a service constructor on the identity of its first argument.
 *
 * The first argument is the position — a `PlayerView` for the services, a card
 * pool for the pool-wide statistics. Arguments after it are compared by
 * identity, so passing a fresh object every call is a cache miss rather than a
 * wrong answer.
 */
export function memoizeOnFirst<A extends object, Rest extends unknown[], R>(
  compute: (first: A, ...rest: Rest) => R,
): (first: A, ...rest: Rest) => R {
  const cache = new WeakMap<A, Entry<R>[]>();
  return (first: A, ...rest: Rest): R => {
    const entries = cache.get(first);
    if (entries) {
      for (const entry of entries) {
        if (entry.rest.length === rest.length && entry.rest.every((v, i) => v === rest[i])) {
          return entry.value;
        }
      }
    }
    const value = compute(first, ...rest);
    const entry: Entry<R> = { rest, value };
    if (entries) entries.push(entry);
    else cache.set(first, [entry]);
    return value;
  };
}
