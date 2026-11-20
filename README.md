# Token Launch Radar

My entry for make.fun's **token-radar-01** bounty ("Build the best token launch radar", $1,325 pot, closes 2026-12-14). It estimates a fair launch value — an implied market cap — for protocols that have no token yet, and presents the 198-row board plus a 40-row watchlist in an offline dashboard.

## Model: radar-6 (v5)

- **Log-log peer fit.** Instead of one flat multiple, the model fits log(market cap) on log(TVL) by OLS on the snapshot's own 128 token-bearing peers at runtime (slope 0.52, intercept 6.99). Value grows sublinearly with TVL: peers' band medians run 0.42x at $5–50M TVL down to 0.030x at $1–5B.
- **Shrunk super-category intercepts.** Seven families (lending −0.23, dex +0.53, yield −0.63, staking −0.64, bridge +0.45, rwa +0.10, other +0.26 log points), each the residual median shrunk k=12 toward zero and centered.
- **Small honest tilts.** Growth enters only as a discount for hot weeks; age is a ≤5% maturity tilt. Every row carries its interquartile range (×3.78 either way).

## Results (this snapshot)

- Total implied value: **$2.08B** across 198 rows; no row above $100M.
- Top 5: Bittensor dTAO $55.4M · Polymarket $52.4M · Steakhouse $49.4M · Sentora $48.3M · USDD $45.0M.
- Local holdout (5-fold × 5 seeds, 640 held-out predictions on the 128 peers): MALE 1.222, within-2× 32.0% — vs a flat-median baseline at MALE 1.633, within-2× 29.4%. That is local validation of the model, not the server judge's pairwise win rate; the entry is graded on make.fun (v4 scored an 87.85% judge win rate, rank 5,870/13,786 — this v5 is the attempt to climb toward the top 100).

## Run it

Node 22, standard library only, no dependencies, no network:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

That writes `out/board.json`, `out/data.js` and `out/dossier.json`, and copies `dashboard/` and `screenshots/` to `out/`. Open the dashboard to browse the board. Two runs are byte-identical.

## Files

- `main.ts` — entrypoint: parse snapshot, fit radar-6, write board + dossier.
- `lib/model.ts` — the radar-6 model (peer fit, category intercepts, board build).
- `dashboard/` — the offline board (index.html, app.js, app.css; 42,408 bytes total).
- `screenshots/` — board, detail and filtered views.
- `vendor/makefun-board.ts` — the kit's dossier builder (unchanged).

## Status

Submitted to make.fun as round 2 (submission 01a1f67b-c4f8-7515-bfdb-2f03315ae1c5, commit 311e5e4); server checks pass, final grading after the competition closes on 2026-12-14. MIT licensed.
