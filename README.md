# Wolf and Lamb

A 5×5 asymmetric board game (three wolves vs fifteen lambs), a playable web board
with a search engine, and a complete, independently verified solution of the game.

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

The solved tables are not in the repository (5 GB per rule set). To rebuild:

```
cc -O3 -o solver/solve solver/solve.c -lpthread
solver/solve 15 12            # about 12 minutes on 12 threads
node solver/verify.js         # independent verification, zero errors expected
node solver/server.js         # then open index.html for exact values
```
