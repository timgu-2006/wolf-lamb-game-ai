# Wolf and Lamb

A 5×5 asymmetric board game (three wolves vs fifteen lambs; the wolves win once only
three lambs remain), a playable web board with a search engine, and a complete,
independently verified solution of the game including exact distances to the end.

**Result:** with best play the game is a draw. Only one opening move keeps the draw,
the wolf's central capture. See `SOLUTION.md` and `paper/wolf_lamb_solution.pdf`.

## Layout

| path | what |
|---|---|
| `SPEC.md` | the rules |
| `engine.js` | reference rules engine (source of truth) |
| `bitboard.js` | fast bitboard core, cross-checked against `engine.js` |
| `ai.js` | alpha-beta search engine for practical play |
| `index.html` | the board: play, analyse, and, with the lookup server running, see exact values |
| `solver/solve.c` | retrograde solver (C, pthreads) |
| `solver/verify.js` | independent checker of the solved tables |
| `solver/spotcheck.js` | brute-force spot check against the reference rules |
| `solver/tables.js`, `solver/play.js`, `solver/server.js` | table lookup, perfect play, lookup server for the page |
| `paper/` | LaTeX write-up of the solution |
| `test.js`, `test_bitboard.js`, `test_ai.js` | tests (`node test.js` etc.) |

## Rebuilding the solution

The solved tables are not in the repository (15 GB). To rebuild:

```
cc -O3 -o solver/solve solver/solve.c -lpthread
solver/solve 15 12            # about 12 minutes on 12 threads
node solver/verify.js         # independent verification, zero errors expected
solver/dist 15 12             # plies-to-end tables, about 30 minutes
node solver/verify_dist.js
node solver/server.js         # then open index.html for exact values
```

## Online version (GitHub Pages)

The page works without any server when it is served over HTTP together with the
`tables/` directory: `solver/pack.js` packs the win/draw/loss values to 2 bits per
entry (651 MB, files under 100 MB), and `web_oracle.js` reads single bytes from
them with HTTP range requests. The online version shows exact win/draw/loss for
the position and every move and lets the AI play perfectly; the plies-to-end
numbers, trap probabilities and shared games need the local server.

Deploy: push this repository (including `tables/`) to GitHub, then in the
repository settings enable Pages from the `main` branch, root folder.
