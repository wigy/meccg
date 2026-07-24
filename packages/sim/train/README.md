# Policy training (P3 behavioral cloning + P4 self-play RL)

Offline training loops for the action-conditioned policy/value net. The
TypeScript side exports featurized trajectories and runs inference; Python
(PyTorch, CPU is fine) fits the weights.

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

## Self-play RL (P4: PPO / REINFORCE, league rollouts)

Starting from a BC champion, each iteration rolls out games with the
policy *sampling* at temperature 1 (`bc:weights.json@1`) — partly
self-play, partly against frozen **league** opponents (default: the
heuristic) with the learner alternating seats — updates the policy, and
promotes the candidate only when it beats the champion (Elo-diff lower
bound ≥ `GATE_MIN_ELO`) *and* does not regress against any league member
(≥ `GATE_LEAGUE_MIN_ELO`):

```sh
LEAGUE="heuristic,bc:frozen-bc.json" train/selfplay_loop.sh bc-weights.json /tmp/selfplay-run 10
```

The league exists because pure self-play measurably overfits: a
self-play-only candidate gained ~+26 Elo on its BC parent while losing
~−77 Elo to the heuristic. Only the learner's decisions enter the
gradient (`--data file@seat` filters), since the opponents' recorded
behavior probabilities belong to different policies.

Two update modes (both require `--init`, the policy that produced the
rollouts, and temperature-1 rollouts so the recorded policy probabilities
are the behavior distribution):

- `--mode ppo` (loop default): clipped-ratio surrogate against the
  recorded behavior probabilities, advantages fixed from the warm-started
  value head — the same rollouts safely train several epochs (default 4),
  squeezing ~4× more learning out of each expensive rollout batch.
- `--mode reinforce`: one on-policy policy-gradient epoch with the value
  head as baseline; simplest possible update, kept as the sanity
  reference.

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
