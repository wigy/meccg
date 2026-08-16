/**
 * @module cli/tree-check
 *
 * Which working tree is this measurement actually reading?
 *
 * A gate result is a number about a *specific* revision, and it is quoted long
 * after the run — in a PR, in the sim README, in an argument about whether a
 * change paid. If the harness can be pointed at one tree and silently read
 * another, every one of those quotations is unsound, and nothing about the
 * output says so.
 *
 * That happened, and the observed cause is mundane. A control was launched as
 * `git checkout master && npm run gate`; the checkout **failed**, because a
 * worktree already held `master`, and the gate ran anyway — on the branch the
 * repository was still sitting on. It printed a clean-looking result under the
 * label "control". A day of comparisons was invalidated, and the tell was two
 * runs of supposedly different trees agreeing to the digit.
 *
 * The fix is therefore mostly **provenance**: a result that names the branch and
 * SHA it measured cannot be silently mislabelled, because the label is derived
 * rather than assumed. Careful shell discipline is not a substitute — the
 * failure produces a plausible number rather than an error, so it survives
 * exactly the review that plausible numbers survive.
 *
 * Two refusals back it up:
 *
 * - **Is the code being run the code in this directory?** Comparing the git
 *   toplevel of the caller's own module against the toplevel of the working
 *   directory. A `git worktree` with a symlinked `node_modules` was *suspected*
 *   of resolving workspace packages to the other checkout; testing showed it
 *   does not — the worktree ran its own code. The check stays because it is
 *   cheap and the property is worth asserting, not because it is known to fire.
 * - **Is this revision reproducible?** A dirty tree cannot be quoted, because
 *   the number belongs to no commit anybody can return to.
 *
 * Refusals rather than warnings: a warning is what the original failure would
 * have printed, and it would have scrolled past.
 */

import { execFileSync } from 'node:child_process';

/** What a working tree is, for the purpose of labelling a measurement. */
export interface TreeIdentity {
  /** Absolute path of the git worktree root. */
  readonly toplevel: string;
  /** Full commit SHA of `HEAD`. */
  readonly sha: string;
  /** Branch name, or `detached` when `HEAD` is not on one. */
  readonly branch: string;
  /** Paths reported by `git status --porcelain`, empty when clean. */
  readonly dirty: readonly string[];
}

/** Run one git command in `cwd`, or return null when git cannot answer. */
function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Read the identity of the working tree containing `cwd`, or null outside git. */
export function treeAt(cwd: string): TreeIdentity | null {
  const toplevel = git(cwd, ['rev-parse', '--show-toplevel']);
  const sha = git(cwd, ['rev-parse', 'HEAD']);
  if (toplevel === null || sha === null) return null;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'detached';
  const status = git(cwd, ['status', '--porcelain']) ?? '';
  return {
    toplevel,
    sha,
    branch,
    dirty: status.length === 0 ? [] : status.split('\n').map(line => line.trim()),
  };
}

/** How a caller wants the checks applied. */
export interface TreeCheckOptions {
  /** Allow uncommitted changes. The result then belongs to no commit. */
  readonly allowDirty?: boolean;
  /**
   * Directory of the module doing the checking — `__dirname` at the call site.
   *
   * It must be the *caller's* location, not this file's: what needs proving is
   * that the code the process actually loaded lives in the tree it claims, and
   * only the caller can say where it was loaded from.
   */
  readonly moduleDir: string;
}

/**
 * Verify that the running code and the working directory are the same tree, and
 * that the tree is committed. Throws with the discrepancy on failure.
 *
 * Returns the identity so the caller can print it beside its result: a number
 * quoted without the revision it came from is the same problem one step later.
 */
export function verifyTree(options: TreeCheckOptions): TreeIdentity {
  const here = treeAt(process.cwd());
  if (here === null) {
    throw new Error('tree-check: not inside a git working tree — refusing to report a measurement');
  }

  const running = treeAt(options.moduleDir);
  if (running === null) {
    throw new Error(`tree-check: the running code at ${options.moduleDir} is not inside a git working tree`);
  }

  if (running.toplevel !== here.toplevel) {
    throw new Error(
      'tree-check: the code being run is not the code in this directory.\n'
      + `  running from : ${running.toplevel} (${running.branch} @ ${running.sha.slice(0, 9)})\n`
      + `  working dir  : ${here.toplevel} (${here.branch} @ ${here.sha.slice(0, 9)})\n`
      + '  A worktree with a symlinked node_modules resolves workspace packages to the\n'
      + '  other checkout, so the result would be labelled with a tree it never read.',
    );
  }

  if (running.dirty.length > 0 && options.allowDirty !== true) {
    throw new Error(
      `tree-check: ${running.dirty.length} uncommitted change(s) — the result would belong to no commit.\n`
      + running.dirty.slice(0, 8).map(line => `    ${line}`).join('\n')
      + (running.dirty.length > 8 ? `\n    …and ${running.dirty.length - 8} more` : '')
      + '\n  Commit them, or pass --allow-dirty to measure anyway.',
    );
  }

  return running;
}

/** One line naming the revision a measurement belongs to. */
export function describeTree(tree: TreeIdentity): string {
  return `tree ${tree.branch} @ ${tree.sha.slice(0, 9)}`
    + (tree.dirty.length > 0 ? ` (DIRTY: ${tree.dirty.length} uncommitted change(s))` : '');
}
