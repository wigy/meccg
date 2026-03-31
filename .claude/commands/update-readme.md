Update the "Project Status" section in the top-level README.md with current progress metrics.

Follow these steps exactly:

1. **Update rules test README** (`packages/shared/src/tests/rules/README.md`):
   - Scan all `.test.ts` files under `packages/shared/src/tests/rules/`
   - For each test file, count `test(` (implemented) vs `test.todo(` (unimplemented)
   - A rule file is "done" if it has at least one `test(` and zero `test.todo(`
   - Update the "Overall Progress" table (Total Rules, Implemented, Remaining, Progress %)
   - Update the "Section Breakdown" table (per-directory counts)
   - Update the "Detailed Test Matrix" status column: ☑ = done, ☐ = all todo, ◐ = partial

2. **Update card tests README** (`packages/shared/src/tests/cards/README.md`):
   - Scan all `.test.ts` files under `packages/shared/src/tests/cards/`
   - For each card test file, count `test(` vs `test.todo(`
   - A card is "certified" in tests if it has at least one `test(` and zero `test.todo(`
   - Update the "Overall Progress" table (Total Cards, Certified, Remaining, Progress %)
   - Update the "Category Breakdown" table (group by card type)
   - Update the "Detailed Test Matrix" status column: ☑ = all tests pass, ☐ = all todo, ◐ = partial

3. **Gather metrics for the top-level README**:
   - **Rule tests**: count implemented rule files (☑) vs total rule files from the rules README
   - **Card tests**: count certified cards (☑) vs total card test files from the cards README
   - **Cards created**: count total cards in `packages/shared/src/data/*.json` (each JSON file is an array, sum all array lengths) vs total cards in `data/cards.json` (the CoE database — sum `Object.keys(set.cards).length` for each set)
   - **Cards certified**: count cards with `"certified"` field in `packages/shared/src/data/*.json` vs total cards created (from previous bullet)
   - **Total progress**: sum all "done" items across the 4 categories / sum all "total" items across the 4 categories

4. **Update README.md**: Find or create a `## Project Status` section (place it right after the `## Screenshots` section). Replace its content with a table like this:

```markdown
## Project Status

| Metric | Done | Total | Progress |
|:-------|-----:|------:|---------:|
| Rule tests | 10 | 295 | 3.4% |
| Card tests | 3 | 39 | 7.7% |
| Cards created | 197 | 1683 | 11.7% |
| Cards certified | 1 | 197 | 0.5% |
| **Total** | **211** | **2214** | **9.5%** |
```

Use actual computed numbers, not these examples. Format percentages to one decimal place. The Total row sums Done and Total columns across all 4 rows above it.

5. **Report**: Show the updated progress table to the user.
