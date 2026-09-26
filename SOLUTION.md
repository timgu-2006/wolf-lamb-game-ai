# Wolf and Lamb — exact solution

**Result. Under the rules of SPEC.md (wolves win when only three lambs remain,
100 turns without a capture is a draw, threefold repetition is a draw) the
starting position is a draw with best play by both sides.** Exactly one opening
move keeps the draw, the wolf's central capture (1,3) x (3,3); every other first
move loses. With 14 or 15 lambs on the board there is no position at all in which
the wolves can force a win, and 99.98% of 15-lamb positions are forced lamb wins.
The starting position is one of the rare exceptions, because the wolves' opening
double threats let them capture their way down to a seven-lamb fortress that
neither side can break. Removing the 100-turn rule does not change the result.

Solved 2026-09-26. Every state of the game was enumerated, valued, and re-checked
by an independent program; every won state also carries the exact number of
plies to the end of the game.

## 1. What was computed

A **state** is the placement of the 3 wolves and the k lambs plus the side to
move. Captures only ever reduce k, so the game was solved in **layers** k = 4,
5, ..., 15, each using only the layer below (three or fewer lambs is a wolf win
by rule).

### Values

The 100-turn rule resets on every capture, so the value of a state with a fresh
clock depends only on what a side can force **inside the current layer**. For
each layer and each side X the solver computes

> **T_X(s)** = the smallest number of plies within which X can force, against
> any defence, either a *terminal win* (the opponent has no legal move) or a
> *capture into a layer-(k-1) state that is an X win*.

Only wolves capture, but a wolf capture that lands in a lamb-win state counts as
a lamb "exit". For a state with a fresh clock, X wins iff T_X(s) ≤ 100 (the
winner's line has strictly decreasing T, so it fits inside the clock and cannot
be stopped by repetition); T_X and T_Y cannot both be finite; everything else is
a draw (the defender can prevent every hostile exit for 100 plies).

### Distances to the end

For every won state the second program (`solver/dist.c`) computes

> **D(s)** = plies until the game ends with best play, the winner minimising and
> the loser maximising, where a capture contributes 1 plus the D of the position
> it lands in;
>
> **S(s)** = the capture-free stretch a D-optimal strategy needs, counting only
> D-optimal lines whose captures land in positions that are themselves exact.

If S(s) ≤ 100 − (plies already on the clock), a D-optimal strategy is legal
under the 100-turn rule and D(s) is exact under the full rules. Otherwise the
shortest line would need more than 100 plies between captures, the winner must
choose a longer route, and D(s) is a proven lower bound. This affects 6,488,029
of the 1,708,662,445 won non-alias states (0.38%), almost all lamb wins with 8 to
13 lambs; with 15 lambs only 2,260 states are affected. The tools show such
numbers with a "≥" sign.

### Size

Symmetry: the rules are invariant under the 8 symmetries of the square, so wolf
placements are grouped into 319 orbits (of 2300 triples). About 10% of entries
are symmetric aliases of another entry.

| lambs | entries | wolf wins | lamb wins | draws | max T wolf | max T lamb | max D |
|------:|--------:|----------:|----------:|------:|---:|---:|---:|
| 4  | 4,666,970   | 4,631,731  | 165         | 35,074      | 50 | 3   | 50  |
| 5  | 16,801,092  | 16,190,699 | 2,919       | 607,474     | 88 | 23  | 106 |
| 6  | 47,603,094  | 41,252,463 | 56,073      | 6,294,558   | 82 | 39  | 140 |
| 7  | 108,807,072 | 73,454,103 | 802,636     | 34,550,333  | 70 | 99  | 148 |
| 8  | 204,013,260 | 88,208,850 | 8,814,216   | 106,990,194 | 72 | 159* | 162 |
| 9  | 317,353,960 | 69,860,851 | 53,921,205  | 193,571,904 | 60 | 113* | 190 |
| 10 | 412,560,148 | 35,122,520 | 176,467,067 | 200,970,561 | 42 | 113* | 197 |
| 11 | 450,065,616 | 9,600,185  | 322,390,318 | 118,075,113 | 24 | 55  | 211 |
| 12 | 412,560,148 | 841,061    | 371,557,736 | 40,161,351  | 7  | 43  | 212 |
| 13 | 317,353,960 | 4,168      | 309,017,226 | 8,332,566   | 1  | 48  | 208 |
| 14 | 204,013,260 | 0          | 203,094,682 | 918,578     | –  | 31  | 210 |
| 15 | 108,807,072 | 0          | 108,784,334 | 22,738      | –  | 24  | 210 |

\* lamb wins needing more than 100 plies of squeezing are draws under the rules.
T is plies to the next capture or the end; D is plies to the end of the game.
2.6 billion entries in total; the tables occupy 15 GB (values, D and S) in
`solver/tables/`. Solving took about 12 minutes on 12 threads, the distances
about 30 minutes.

## 2. Why this is a proof

The claim "the value table is correct" reduces to a **local check on every
state**, which `solver/verify.js` performs. Write "child c is a Z-win within n"
for: c is reached by a capture and its (layer k-1) value is a Z win, or c is
reached by a step and is labelled Z-win with T ≤ n. For a state s with mover M
and opponent Y:

| label of s | required local property |
|---|---|
| no legal move | label = Y wins, T = 0 |
| M wins, T | some child is an M-win within T-1, and none within T-2, with 1 ≤ T ≤ 100 |
| Y wins, T | every child is a Y-win within T-1, and some child is not within T-2, with 1 ≤ T ≤ 100 |
| draw | no child is an M-win within 99, and some child is not a Y-win within 99 |

**Soundness.** By induction on T, a state labelled "M wins, T" has a child in
which the opponent is labelled to lose within T-1, so M reaches an exit in at
most T plies whatever Y does; the clock never runs out and repetition cannot
occur along a strictly decreasing sequence. **Completeness.** By induction on the
true T, a state X can really force in t ≤ 100 plies has children already labelled
correctly, so the local check forbids labelling s as a draw or as a Y win and
forces its T to equal the true value. Hence draws are exactly the states neither
side can force within the clock. The layer induction starts from the rule that
three or fewer lambs is a wolf win.

`solver/verify_dist.js` checks D and S the same way: D = 1 + min (winner to
move) or 1 + max (loser to move) over the children's distances, S likewise over
the D-optimal children with landing positions required to be exact, and
terminal states have D = S = 0. Induction on D, then on S, pins both tables.

**What the verifiers trust.** Move generation from `bitboard.js`, which
`test_bitboard.js` cross-checks move-for-move against `engine.js` (the direct
transcription of SPEC.md) on 300,000 positions; and their own indexing
(`solver/indexing.js`), written separately from the C solvers and self-tested for
symmetry invariance and rank/unrank round trips. The solvers themselves are not
trusted. `solver/spotcheck.js` additionally compares 3,000 random entries with a
brute-force search over `engine.js` alone: 0 mismatches.

Verification output: values, 2,347,828,242 non-alias states, 0 errors;
distances, all layers, 0 errors; no-clock tables, 0 errors.

## 3. The starting position

Wolf to move. **Exactly one of the eight legal moves holds the draw: the centre
capture (1,3) x (3,3).** Every other move loses:

| wolf move | value | game ends in |
|---|---|---|
| (1,3) x (3,3) | draw | – |
| (1,2) x (3,2), (1,4) x (3,4) | lambs win | 40 plies |
| (1,2) -> (1,1), (1,4) -> (1,5) | lambs win | 38 plies |
| (1,2) -> (2,2), (1,4) -> (2,4) | lambs win | 36 plies |
| (1,3) -> (2,3) | lambs win | 72 plies |

After the centre capture the lambs have four legal replies and all four keep the
draw, but two of them, (3,2) -> (2,2) and (3,4) -> (2,4), leave the wolves a
single drawing answer out of nine. The wolves then keep winning material for a
while: with one wolf on the third rank and two on the first, the lambs can block
only one capture lane per move. Around seven lambs the position becomes a
fortress and the game ends by the 100-turn rule (`node solver/play.js line`).

## 4. Without the 100-turn rule

A second solve with the no-capture limit raised to 16,000 plies (only repetition
remains, which changes no values) is in `solver/tables_noclock/`. **The starting
position is still a draw.** The rule change only converts some long lamb
squeezes in the middle layers into wins: 15-lamb draws fall from 22,738 to
21,987, 8-lamb lamb wins rise from 8,814,216 to 8,921,318.

## 5. Files

| file | purpose |
|---|---|
| `solver/solve.c` | value solver (C, pthreads). `cc -O3 -o solver/solve solver/solve.c -lpthread`, then `solver/solve 15 12` |
| `solver/dist.c` | distance-to-end solver. `cc -O3 -o solver/dist solver/dist.c -lpthread`, then `solver/dist 15 12` |
| `solver/tables/layer_<k>.bin` | one uint16 per state: winner in bits 15..14 (1 wolf, 2 lamb, 3 draw), T in bits 13..0 |
| `solver/tables/dist_<k>.bin`, `seg_<k>.bin` | D and S per state (0xFFFF for draws; S = 0xFFFF when no exact D-optimal line exists) |
| `solver/indexing.js` | the state indexing, independent JavaScript implementation |
| `solver/verify.js`, `solver/verify_dist.js` | independent checkers |
| `solver/spotcheck.js` | random entries against brute force over `engine.js` |
| `solver/tables.js` | lookup and best-move listing. Move choice everywhere: fastest win by D; in drawn positions the drawing move that gives a uniformly random opponent the highest probability of being lost within three of their moves (we answer optimally), one-move fraction as tie-break; otherwise the slowest loss by D |
| `solver/play.js` | `line` prints best play from the start; `play wolf|lamb` plays against the tables |
| `solver/server.js` | `node solver/server.js` serves lookups on localhost:8787 for `index.html`: exact value, plies to the end of every move, exact best lines, exact-blunder marks, perfect AI play |

## 6. Practical play from the drawn start

Perfect play only guarantees the draw; to win, the table player picks, among
value-preserving moves, the one after which a *modelled* opponent is most likely
to throw away value within three of its moves (wolves are assumed to prefer
captures 8:1, lambs to rescue threatened lambs, avoid hanging lambs and squeeze
the wolves; constants in `solver/tables.js`). In lost positions the same measure
ranks swindles. `node solver/practical.js` plays 60 games per pairing from the
start:

| table side | opponent | no traps | uniform-opponent traps | modelled-opponent traps |
|---|---|---|---|---|
| Lamb | greedy wolf (always captures) | 60-0-0 | 60-0-0 | 60-0-0 |
| Lamb | engine wolf, depth 6 | 21-39-0 | 60-0-0 | 60-0-0 |
| Lamb | engine wolf, 0.3 s | 59-1-0 | 60-0-0 | 60-0-0 |
| Wolf | careful lamb (covers threats, else engine) | 8-52-0 | 10-50-0 | 60-0-0 |
| Wolf | engine lamb, depth 6 | 5-55-0 | 60-0-0 | 60-0-0 |

(wins-draws-losses for the table side; opponents are largely deterministic, so
the 60 games of a pairing are not independent samples.)
