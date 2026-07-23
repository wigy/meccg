#!/usr/bin/env bash
# Self-play RL loop (P4: PPO by default, REINFORCE via MODE=reinforce).
#
# Each iteration: (1) roll out self-play games with the current policy
# *sampling* at temperature 1 (exploration; the recorded policy probs are
# then the behavior distribution PPO ratios need), (2) update — PPO takes
# EPOCHS clipped-ratio passes over the rollouts, REINFORCE one on-policy
# step, (3) gate the updated policy (argmax) against the current champion —
# promotion only when the paired-seed Elo-diff 95% lower bound clears
# GATE_MIN_ELO. Rejected candidates are kept on disk but the champion
# stays.
#
# Usage:
#   train/selfplay_loop.sh <champion-weights.json> <workdir> [iterations]
#
# Env overrides: MODE (ppo|reinforce, default ppo), EPOCHS (default 4 for
# ppo, 1 for reinforce), CLIP (default 0.2), GAMES (rollout games/iter,
# default 100), LR (default 1e-4), ENTROPY (default 0.01), GATE_PAIRS
# (default 15), GATE_ROUNDS (default 2), GATE_MIN_ELO (default 0), SEED0
# (rollout seed base, default 50000).
set -euo pipefail

CHAMPION=$(realpath "$1")
WORKDIR=$(realpath "$2")
ITERS=${3:-5}
MODE=${MODE:-ppo}
if [ "$MODE" = "ppo" ]; then EPOCHS=${EPOCHS:-4}; else EPOCHS=${EPOCHS:-1}; fi
CLIP=${CLIP:-0.2}
GAMES=${GAMES:-100}
LR=${LR:-1e-4}
ENTROPY=${ENTROPY:-0.01}
GATE_PAIRS=${GATE_PAIRS:-15}
GATE_ROUNDS=${GATE_ROUNDS:-2}
GATE_MIN_ELO=${GATE_MIN_ELO:-0}
SEED0=${SEED0:-50000}

cd "$(dirname "$0")/.."
mkdir -p "$WORKDIR"

for ((i = 1; i <= ITERS; i++)); do
  seed=$((SEED0 + (i - 1) * GAMES))
  rollout="$WORKDIR/rollout-$i.jsonl"
  candidate="$WORKDIR/candidate-$i.json"
  echo "=== iteration $i/$ITERS: rollout $GAMES games (seeds $seed..) with $CHAMPION @1 ==="
  npm run --silent export-training -- \
    --agents "bc:$CHAMPION@1,bc:$CHAMPION@1" --games "$GAMES" --seed "$seed" --out "$rollout"
  echo "=== iteration $i: $MODE update ($EPOCHS epoch(s)) ==="
  python3 train/train_bc.py --mode "$MODE" --init "$CHAMPION" \
    --data "$rollout" --out "$candidate" --epochs "$EPOCHS" --lr "$LR" \
    --entropy "$ENTROPY" --clip "$CLIP" --holdout 0
  echo "=== iteration $i: gate candidate vs champion ==="
  if npm run --silent gate -- --challenger "bc:$candidate" --champion "bc:$CHAMPION" \
    --pairs "$GATE_PAIRS" --rounds "$GATE_ROUNDS" --seed $((seed + 700000)) --min-elo "$GATE_MIN_ELO"; then
    echo "=== iteration $i: PROMOTED $candidate ==="
    CHAMPION=$(realpath "$candidate")
  else
    echo "=== iteration $i: candidate rejected, champion stays ==="
  fi
  rm -f "$rollout"
done

echo "final champion: $CHAMPION"
