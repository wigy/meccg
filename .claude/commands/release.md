Perform a release of the MECCG project. A release title MUST be provided as an argument (e.g. `/release Card pool expansion and UI polish`). If no title is given, stop and ask for one.

The title argument is: $ARGUMENTS

Follow these steps exactly:

1. **Run checks:** Execute all four in parallel and verify they pass. If any fail, stop and report the failures.
   - `npm run build` — type-check
   - `npm test` — rules tests
   - `npm run test:nightly` — card tests
   - `npm run lint` — linting

2. **Build API docs:** Execute `npm run docs` and verify it completes without errors. Warnings are acceptable.

3. **Update README:** Run `/update-readme` to refresh the project status section with current progress metrics.

4. **Bump version:** Read the current version from `packages/shared/package.json`. Increment the minor version (e.g. 0.1.0 -> 0.2.0). Update the version in ALL package.json files:
   - `packages/shared/package.json`
   - `packages/game-server/package.json`
   - `packages/text-client/package.json`
   - `packages/lobby-server/package.json`

5. **Update CHANGELOG.md:** Add a new section at the top (below the `# Changelog` heading) for the new version with today's date and the release title in the heading (format: `## X.Y.Z — YYYY-MM-DD` on the first line, followed by the release title on the next line). Summarize the changes since the last release by reading `git log` from the last version tag. Group changes by category (Game Engine, Web Client, Text Client, Infrastructure, etc.).

6. **Commit:** Stage all modified package.json files and CHANGELOG.md, then create a commit with the message: `Release vX.Y.Z` (using the new version number). Include the co-authored-by trailer.

7. **Tag:** Create an annotated git tag `vX.Y.Z` with message `vX.Y.Z`.

8. **Push:** Push the commit and tag to the remote.

9. **Report:** Show the new version number and confirm success.
