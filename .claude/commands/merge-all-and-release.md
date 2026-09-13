Fix and merge every open pull request, release master, and deploy the release to the live server. This is the end-to-end "ship everything" flow: `PR sweep → merge loop → master verification → /release → bin/update-dev`.

A release title MAY be provided as an argument (e.g. `/merge-all-and-release Card pool expansion`). If none is given, `/release` writes its own title from the pending commits.

The title argument is: $ARGUMENTS

**IMPORTANT:** This skill must run to completion autonomously. Do NOT stop to ask the user for confirmation at any step. Invoking this skill is wigy's explicit approval to merge every open, non-draft PR — including PRs that change test files — so the usual "open the test PR and stop" rule does not apply here. The only PRs left unmerged are the ones listed under **Skip rules** below; report them at the end instead of asking about them.

**Outward-facing steps:** the final step restarts the live server at `ai-meccg.com` with players on it. That is the point of this skill; do it, but only after a release actually happened.

## Working-tree contract

- The main checkout (`/home/wigy/projects/meccg`) stays on `master` and clean for the whole run. Never check a PR branch out there.
- All PR fixing happens in ONE scratch worktree under `.claude/worktrees/` (gitignored). Create it once with `git worktree add .claude/worktrees/merge origin/master` and reuse it with `git checkout -B <branch> origin/<branch>` for each PR. Remove it with `git worktree remove --force .claude/worktrees/merge` when done.
- Give the worktree a `node_modules` with the **safe recipe** (never symlink the whole main `node_modules`, never `ln -sf` into an existing dir, never `git add -A` in the worktree):

  ```sh
  cd .claude/worktrees/merge && mkdir node_modules && cd node_modules
  for e in /home/wigy/projects/meccg/node_modules/* /home/wigy/projects/meccg/node_modules/.bin; do ln -sT "$e" "$(basename "$e")"; done
  rm '@meccg' && mkdir '@meccg' && cd '@meccg'
  for p in shared game-server lobby-server text-client sim; do ln -sT ../../packages/$p $p; done
  ```

- Stage files explicitly (`git add <file>...`). Never amend, never rebase, never `reset --hard`. Every fix is a new commit on the PR's own branch.

## Skip rules

Leave a PR open (and say why in the final report) when it is:

- a **draft** (`isDraft: true`);
- **CHANGES_REQUESTED** by a human reviewer (`reviewDecision`) — the review-fix pipeline owns it;
- labelled `do-not-merge`, `hold`, or `wip`;
- still **red or conflicting after two fix attempts** in this run — do not burn the rest of the run on one PR;
- from a **different author** than wigy/ai and not obviously safe (e.g. a dependency bot bump that fails CI).

Everything else gets fixed and merged.

## Steps

### 1. Preconditions

```sh
cd /home/wigy/projects/meccg
git status --porcelain            # must be empty
git rev-parse --abbrev-ref HEAD   # must be master
git fetch --tags origin && git pull --ff-only
gh auth status                    # gh must work — bin/run-ai once lost a whole sweep to a broken gh wrapper
```

If the tree is dirty or the branch is not master, stop and report; do not stash or discard anything.

### 2. Inventory the open PRs

`gh pr list` defaults to **30 rows** — older PRs are silently skipped without `--limit 100`.

```sh
gh pr list --state open --limit 100 \
  --json number,title,headRefName,baseRefName,isDraft,labels,author,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup
```

Order the list oldest-first (lowest number first) — that is merge order. For each PR note:

- `mergeable` — `MERGEABLE` / `CONFLICTING` / `UNKNOWN`. `UNKNOWN` is transient (GitHub recomputes it after every merge); poll `gh pr view <n> --json mergeable` every 4 s, up to ~15 tries, before treating it as anything.
- `mergeStateStatus` — `CLEAN` is mergeable with green CI; `BLOCKED`/`UNSTABLE` means red or pending CI; `DIRTY` means conflicts; `BEHIND` is fine.
- `statusCheckRollup` — which CI jobs failed. An empty rollup on a non-draft PR means CI never ran; merging `origin/master` into the branch (step 4) triggers it.
- `baseRefName` — a PR whose base is another feature branch is a **stacked PR**. Retarget it with `gh pr edit <n> --base master` once its parent has merged (its diff shrinks to its own commits then), and merge it after the parent. `git log --oneline origin/master..origin/<branch>` shows the stack shape.

### 3. Check that master itself is green

```sh
gh run list --branch master --limit 3 --json databaseId,conclusion,headSha,displayTitle
```

When **several PRs fail CI with the same test**, suspect a red master rather than N bugs: diff the failing branches, and if none touch the failing file, the fix belongs on master as ONE small PR (branch from master, fix, PR, merge it first). If some branch already carries the fix, make the master fix **textually identical** to that branch's version so they merge without conflict. Then merge master into the remaining branches.

### 4. Fix the PRs that need it

Only PRs that are `CONFLICTING`, have failed checks, or carry unresolved review comments need work. A `MERGEABLE`/`CLEAN` PR is left untouched.

Fix PRs **in parallel with subagents**, one Agent per PR, each in its own worktree (`git worktree add .claude/worktrees/pr-<n> origin/<branch>` plus the node_modules recipe). Give each agent the PR number, the branch, this section's rules, and the working-tree contract. Subagents can die on the session rate limit — when one returns without a pushed commit, look at its worktree (`git worktree list`, `git -C <wt> status`) and finish the PR by hand. When only one or two PRs need work, do them yourself in the shared scratch worktree.

For each PR:

1. `git checkout -B <branch> origin/<branch>` in the worktree, then `git merge origin/master`.
2. **Conflicts.** Resolve by kind:
   - `docs/certification-engine-support.md`, `docs/card-effects-dsl.md`, `CHANGELOG.md` and other docs append-zones: **keep both sides** (delete the `<<<<<<<`/`=======`/`>>>>>>>` lines, keep everything between), then `npx markdownlint-cli2 --fix <file>` for the MD022/MD031/MD032 blank-line seams. Bullets first, then `###` sections, blank line before every heading — CI does not run `lint:md`, so only master/release catches a broken seam.
   - `import { a, b }` / `import type { ... }` lists and `| 'x';` union-type tails: take the **union of both name lists** (strip the `;` from the first side of a union tail).
   - Sim `ACTION_TYPES` in `packages/sim`: **append-only serialization format** — keep both new entries, in merge order, never reorder or insert.
   - Real semantic conflicts (two sibling cards implementing the same primitive differently): take **master's shape** (`git checkout --theirs` on the engine files if master's version is complete), then port the branch's card JSON, docs and test expectations to master's shape. Drop branch-only helpers master superseded. Card tests of all the siblings must pass together.
   - Anything else: read both sides and resolve by hand. Never resolve by dropping one side wholesale without understanding it.
3. **Failed CI.** `gh run view <run-id> --log-failed` (run id from `statusCheckRollup`) and fix the actual cause on the branch. If the failure is in a test file the branch did not touch, go back to step 3 (red master).
4. **Review comments.** `gh pr view <n> --json reviews,comments` and `gh api repos/{owner}/{repo}/pulls/<n>/comments` — address each unresolved comment.
5. **Verify** in the worktree, in parallel, and iterate until all pass:
   - `npm run build`
   - changed tests only: `git diff --name-only origin/master...HEAD -- '*.test.ts' | xargs npx vitest run` (plus tests of any sibling cards touched by a semantic resolution)
   - `npm run lint` (fix with `npm run lint:fix`)
   - `npm run lint:md` (fix with `npm run lint:md:fix`)
   - after a merge that pulled in another session's resolution: `grep -hE '^- `' docs/*.md | sort | uniq -d` must print nothing (duplicate docs bullets), and eslint's `no-duplicate-type-constituents` must be clean.

   Do NOT run `npm test` or `npm run test:nightly` — the PR's CI does that.
6. **Commit and push.** Stage explicitly, commit as `Merge master into <branch>` / `Fix CI: <cause>` / `Address review comments: <what>` with the co-authored-by trailer, `git push`. On a **non-fast-forward rejection** a concurrent session pushed its own resolution: `git fetch`, check `git merge-base --is-ancestor origin/master origin/<branch>`, and if theirs already contains master just take theirs (`git checkout -B <branch> origin/<branch>`) and re-verify.

**Stacking.** When more than ~3 PRs conflict, CI at ~12 min each makes serial "fix → wait → merge → next" cost hours. Prepare them as a **stack** instead: for PR N merge `origin/master` AND the already-prepared branches of PRs 1..N-1 into it, resolve, verify, push. Later merges into master are then no-ops and the merge loop in step 5 just waits for green in order. Fix the docs tail on the TOP branch of the stack — its file is what master ends up with.

### 5. Merge loop

Write a small driver script in the scratchpad and run it under **Monitor** (or `run_in_background`) so CI waits do not block the session. For each PR in merge order:

1. Poll `gh pr view <n> --json state,mergeable,mergeStateStatus,statusCheckRollup` every 45 s until `mergeable: MERGEABLE` and `mergeStateStatus: CLEAN`. Give up on a PR after ~30 min of `BLOCKED` and go look at why.
2. Before merging, make sure no worktree has the branch checked out (`git checkout --detach` in the worktree, `git branch -D <branch>` locally) — otherwise `gh pr merge --delete-branch` reports a failure even though the remote merge succeeded.
3. `gh pr merge <n> --merge --delete-branch`. If it reports an error, check `gh pr view <n> --json state` — `MERGED` means it worked and only the local branch delete failed.
4. After every merge GitHub recomputes all other PRs' `mergeable` → `UNKNOWN` for a few seconds. Poll before judging. A PR that flips to `CONFLICTING` (docs append-zones re-conflict serially) goes back through step 4 and rejoins the loop.

Merge with `--merge`, never squash or rebase — the project never rewrites history.

### 6. Verify merged master

```sh
cd /home/wigy/projects/meccg && git pull --ff-only
```

Then, in parallel: `npm run build`, `npm run lint`, `npm run lint:md`, the duplicate-bullet grep from step 4, and the test files that **more than one merged branch touched** (batch merges can carry competing fixes for the same test — each branch was green against a different base and gh still reported CLEAN). When something is red, bisect with `git checkout --detach <merge-commit>` + vitest on the test, fix on a branch, open a PR, merge it through step 5, and re-verify.

Finally wait for master's own CI run on the final commit to be green:

```sh
gh run list --branch master --limit 1 --json databaseId,status,conclusion
gh run watch <databaseId> --exit-status
```

Do not release on a red master. Local full-suite runs on this machine are unreliable (a concurrent session often runs vitest); trust the CI run, do not re-run `npm test` locally.

### 7. Release

If `git log v<current-version>..master --oneline` is empty, there is nothing to release: skip to the report and say so; do **not** deploy.

Otherwise read `.claude/commands/release.md`, substitute its `$ARGUMENTS` with the title argument above (or nothing), and hand it to the **Agent tool** as the prompt (not the Skill tool — a Skill call ends this flow). The release must run from `master` in the main checkout. It bumps the minor version in the four package.json files, writes the CHANGELOG, commits `Release vX.Y.Z`, tags, pushes and runs `bin/build-and-publish latest` and `bin/build-and-publish vX.Y.Z`. When the agent returns, confirm the tag exists on the remote:

```sh
git fetch --tags && git tag --points-at origin/master
```

### 8. Deploy

Only after a new tag was pushed and published:

```sh
bin/update-dev
```

It SSHes to `ai-meccg.com`, pulls `dataplug/meccg-dev:latest`, restarts the stack and toasts every player online before and after. Verify the deploy — there is no `/api/version` endpoint:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://ai-meccg.com/          # 200
ssh ai-meccg.com "docker exec meccg-dev grep version packages/lobby-server/package.json"   # new version
```

### 9. Clean up and report

- `git worktree remove --force` every worktree this run created; `git worktree prune`.
- Main checkout back on clean `master`.

Then report, in this order:

1. a table of PRs: number, title, outcome (`merged` / `skipped: <reason>` / `failed: <reason>`), and for fixed ones what was fixed;
2. anything that had to land on master as a separate PR (red-master fix, post-merge test reconciliation);
3. the released version, its title, and the tag;
4. the deploy verification output (HTTP status and the version the container reports).

If a step failed hard (release aborted, deploy unreachable), say exactly which step, what the error was, and what was already done — merges are not reversible, so a reader must know the repository's state.
