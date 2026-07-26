#!/usr/bin/env python3
"""Value-head quality diagnostic for MECCG policy/value weights.

Search quality is bounded by value quality: PUCT truncates games that run
600-2000 decisions after a few dozen plies, so nearly all of a leaf's
evaluation comes from the value head. When the head is uninformative,
search degenerates to the bare policy — which is exactly what the P5 gate
measured (search 50.5% vs policy-only, +3 Elo). Running a 100-game search
gate costs about an hour; this diagnostic scores a weights file against a
held-out dataset in a couple of minutes, so value work can iterate fast.

Reported per game-stage bucket (by fraction of the game elapsed) and
overall:

- `mse`       — mean squared error against the final outcome in [-1, 1].
- `sign`      — fraction of non-drawn decisions whose value sign matches
                the eventual winner (0.5 = coin flip, the number that
                matters most for search).
- `|value|`   — mean confidence; a head that hedges near 0 everywhere can
                have a decent MSE while being useless as a discriminator.
- `late sign` — sign accuracy over the final quarter of each game, where a
                competent evaluator should approach certainty.

Usage:
  python3 eval_value.py --weights bc-weights.json --data eval.jsonl [...]
    [--limit N] [--batch 256]
"""

import argparse
import json

import torch

from train_bc import BcNet, collate, load_dataset


def bucket_of(fraction):
    """Coarse game-stage bucket for a 0..1 progress fraction."""
    if fraction < 0.25:
        return "early"
    if fraction < 0.50:
        return "mid-early"
    if fraction < 0.75:
        return "mid-late"
    return "late"


BUCKETS = ["early", "mid-early", "mid-late", "late"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True, help="weights JSON from train_bc.py")
    parser.add_argument("--data", required=True, nargs="+", help="export JSONL file(s), path[@seat]")
    parser.add_argument("--batch", type=int, default=256)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    with open(args.weights, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
    header, examples = load_dataset(args.data, args.limit)
    if payload.get("vocabHash") != header.get("vocabHash"):
        raise SystemExit(
            f"vocab mismatch: weights {payload.get('vocabHash')} vs data {header.get('vocabHash')}")
    global_width = header["globalWidth"]

    net = BcNet(header["vocabSize"], header["actionTypeCount"], global_width,
                tuple(payload["dims"]["values"]))
    net.load_state_dict({
        name: torch.tensor(tensor["data"]).reshape(tensor["shape"])
        for name, tensor in payload["weights"].items()
    })
    net.eval()

    # Per-game decision counts give each example a progress fraction.
    per_game_total = {}
    for decision, _ in examples:
        key = decision["game"]
        per_game_total[key] = max(per_game_total.get(key, 0), decision["seq"] + 1)

    stats = {b: {"n": 0, "se": 0.0, "signed": 0, "hits": 0, "absv": 0.0} for b in BUCKETS}
    overall = {"n": 0, "se": 0.0, "signed": 0, "hits": 0, "absv": 0.0}

    with torch.no_grad():
        for start in range(0, len(examples), args.batch):
            batch = examples[start : start + args.batch]
            glob, ents, emask, cands, _, _, _, z, _, _ = collate(batch, global_width)
            _, value = net(glob, ents, emask, cands)
            for i, (decision, outcome) in enumerate(batch):
                predicted = float(value[i])
                target = float(z[i])
                total = per_game_total.get(decision["game"], 1)
                stage = stats[bucket_of(decision["seq"] / max(total, 1))]
                for acc in (stage, overall):
                    acc["n"] += 1
                    acc["se"] += (predicted - target) ** 2
                    acc["absv"] += abs(predicted)
                    if target != 0.0:
                        acc["signed"] += 1
                        if (predicted > 0) == (target > 0):
                            acc["hits"] += 1

    def line(label, acc):
        if acc["n"] == 0:
            return f"{label:<10} (no examples)"
        sign = acc["hits"] / acc["signed"] if acc["signed"] else float("nan")
        return (f"{label:<10} n {acc['n']:>7}  mse {acc['se'] / acc['n']:.3f}  "
                f"sign {sign:.3f}  |value| {acc['absv'] / acc['n']:.3f}")

    print(f"value diagnostic: {args.weights}")
    print(f"  data: {len(examples)} examples / {len(per_game_total)} games")
    for name in BUCKETS:
        print("  " + line(name, stats[name]))
    print("  " + line("OVERALL", overall))
    late_sign = stats["late"]["hits"] / stats["late"]["signed"] if stats["late"]["signed"] else float("nan")
    print(f"  late-game sign accuracy: {late_sign:.3f} "
          f"({'usable as a search evaluator' if late_sign > 0.65 else 'TOO WEAK for search — leaf values are near-noise'})")


if __name__ == "__main__":
    main()
