# Behavioral-cloning training (P3)

Offline training loop for the action-conditioned policy/value net. The
TypeScript side exports featurized teacher trajectories and runs inference;
Python (PyTorch, CPU is fine) fits the weights.

## Workflow

```sh
# 1. Export teacher trajectories (heuristic self-play), from packages/sim:
npm run export-training -w @meccg/sim -- --games 40 --seed 200 --out train.jsonl

# 2. Train (a few minutes on CPU for the 'full' preset):
python3 train/train_bc.py --data train.jsonl --out bc-weights.json --epochs 4

# 3. Play the trained policy — the `bc` agent runs a pure-TS forward pass:
npm run play -w @meccg/sim -- --agents bc:bc-weights.json,heuristic
npm run gate -w @meccg/sim -- --challenger bc:bc-weights.json --champion heuristic
```

## Notes

- The weights JSON embeds a `selfTest` block (real example inputs plus the
  trainer's outputs). `createBcAgent` replays it on load and refuses to run
  if the TypeScript forward pass deviates — runtime parity is enforced, not
  assumed. It also verifies the card-vocabulary hash against the live pool.
- Feature layouts are versioned (`FEATURE_SPEC_VERSION` in
  `src/features/index.ts`); the trainer and loader both refuse mismatches.
- `--dims mini` trains the tiny preset used by the committed test fixture
  `test-fixtures/bc-mini-weights.json` (regenerate it from the 2-game smoke
  export if the feature spec or network shape changes).
- ONNX was deliberately skipped for now: the net is ~35k parameters, so a
  hand-mirrored TS forward pass is simpler than carrying `onnxruntime-node`
  plus Python `onnx` wheels. Revisit when the net grows (P4+).
