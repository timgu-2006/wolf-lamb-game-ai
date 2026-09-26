# Wolf and Lamb — exact solution

**Result. Under the rules of SPEC.md v1.0 the starting position is a draw with
best play by both sides.** The wolves cannot be trapped, and the lambs cannot be
reduced below three, if both sides play perfectly. The lamb side holds all the
winning chances in practice: with 14 or 15 lambs on the board there is no
position at all in which the wolves can force a win, and 99.98% of 15-lamb
positions are forced lamb wins. The starting position is one of the rare
exceptions, because the wolves' opening double threats let them capture their
way down to a seven-lamb fortress that neither side can break.

Solved 2026-09-26. Every state of the game was enumerated, valued, and then
re-checked by an independent program.

## 1. What was computed

A **state** is the placement of the 3 wolves and the k lambs plus the side to
move. Captures only ever reduce k, so the game was solved in **layers** k = 3,
4, ..., 15, each using only the layer below (fewer than 3 lambs is a wolf win by
rule).

The 100-turn rule (100 plies without a capture is a draw) resets on every
capture, so the value of a state with a fresh clock depends only on what a side
can force **inside the current layer**. For each layer and each side X the
solver computes

> **T_X(s)** = the smallest number of plies within which X can force, against
> any defence, either a *terminal win* (the opponent has no legal move) or a
> *capture into a layer-(k-1) state that is an X win*.

Only wolves capture, but a wolf capture that lands in a lamb-win state counts as
a lamb "exit" (the wolf would never choose it, so it is only forced when every
alternative is worse). Then, for a state with a fresh clock:

- X **wins** iff T_X(s) ≤ 100. The winner's line has strictly decreasing T, so
  it fits inside the clock and can never be stopped by repetition.
- T_X and T_Y cannot both be finite (X forcing an X-exit and Y forcing a Y-exit
  are incompatible), so at most one side wins.
- Otherwise the state is a **draw**: the defender can prevent every hostile exit
  for 100 plies, the clock ends the game, and threefold repetition can only end
  it as a draw as well.

The stored value of every state is (winner, T) or draw.

### Size

Symmetry: the rules are invariant under the 8 symmetries of the square, so wolf
placements are grouped into 319 orbits (of 2300 triples).

| lambs | states in table | wolf wins | lamb wins | draws |
|------:|----------------:|----------:|----------:|------:|
| 3  | 982,520     | 979,706    | 7           | 2,807       |
| 4  | 4,666,970   | 4,629,498  | 165         | 37,307      |
| 5  | 16,801,092  | 16,182,453 | 2,919       | 615,720     |
| 6  | 47,603,094  | 41,196,642 | 56,073      | 6,350,379   |
| 7  | 108,807,072 | 73,329,451 | 802,636     | 34,674,985  |
| 8  | 204,013,260 | 88,101,691 | 8,814,216   | 107,097,353 |
| 9  | 317,353,960 | 69,818,174 | 53,921,205  | 193,614,581 |
| 10 | 412,560,148 | 35,109,001 | 176,467,067 | 200,984,080 |
| 11 | 450,065,616 | 9,596,170  | 322,390,318 | 118,079,128 |
| 12 | 412,560,148 | 840,621    | 371,557,736 | 40,161,791  |
| 13 | 317,353,960 | 4,164      | 309,017,226 | 8,332,570   |
| 14 | 204,013,260 | 0          | 203,094,682 | 918,578     |
| 15 | 108,807,072 | 0          | 108,784,334 | 22,738      |

2.6 billion table entries in total (about 10% are symmetric aliases of another
entry). Solving took about 12 minutes on 12 threads; the tables occupy 5.2 GB
in `solver/tables/`.

Longest forced sequences to the next capture or the end of the game:

| lambs | wolf win, max T | lamb win, max T |
|------:|---:|---:|
| 8  | 72 | 159 → capped by the clock, becomes a draw above 100 |
| 9  | 60 | 113 → same |
| 10 | 42 | 113 → same |
| 11 | 24 | 55 |
| 12 | 7  | 43 |
| 13 | 1  | 48 |
| 14 | –  | 31 |
| 15 | –  | 24 |

The 100-turn rule matters: in layers 8 to 10 some lamb wins need more than 100
plies of squeezing and are therefore draws under the rules. Whether the
starting position is also a draw *without* the 100-turn rule is answered in
section 5.

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

**Soundness (every labelled win is a real forced win).** By induction on T: a
state labelled "M wins, T" has a child in which the opponent is labelled to lose
within T-1, so M reaches an exit in at most T plies whatever Y does, and the
exit is either a terminal win or a capture into a state that layer k-1 certifies
as an M win. The clock never runs out because T ≤ 100 and T strictly decreases;
repetition cannot occur along a strictly decreasing sequence.

**Completeness (every real forced win is labelled as one, with the right T).**
By induction on the true T: a state that X can really force in t ≤ 100 plies has
a child that X can force in t-1 (X to move) or only children X can force in
≤ t-1 (Y to move). By the induction hypothesis those children carry X-win labels
with T ≤ true value, so the local check forbids labelling s as a draw or as a
Y win, and the minimality/maximality clauses force its T to equal the true value.
Hence "draw" labels are exactly the states that neither side can force within
the clock, which is the game-theoretic draw under the rules (the defender's
strategy "move to any child that is not a loss within the remaining clock" is
always available and never loses).

The base of the layer induction is the rule that fewer than 3 lambs is a wolf
win. Symmetry is sound because every rule of the game is invariant under the
8 symmetries of the square (steps and jumps are orthogonal, and there is no
oriented rule); the verifier checks that all 8 images of random positions map to
the same table entry.

**What the verifier trusts.** Two things only:

1. **Move generation.** The verifier uses `bitboard.js`, which
   `test_bitboard.js` cross-checks move-for-move against `engine.js` on 200,000
   positions from random games and 100,000 uniformly random layouts.
   `engine.js` is the direct transcription of SPEC.md.
2. **Its own indexing** (`solver/indexing.js`), written separately from the C
   solver's and self-tested for symmetry invariance and rank/unrank round trips.

The solver itself is not trusted: any bug in it would show up as a failed local
check. As an extra guard, `solver/spotcheck.js` compares 3,000 random table
entries with a brute-force search that uses only `engine.js`: the search must
find each labelled win in exactly T plies and no win in either direction for a
labelled draw. It reports 0 mismatches.

Verification output (`node solver/verify.js`): all 13 layers, 2,348,715,942
non-alias states checked, **0 errors**.

## 3. The starting position

Wolf to move. **Exactly one of the eight legal moves holds the draw: the centre
capture (1,3) x (3,3).** Every other move loses:

| wolf move | value |
|---|---|
| (1,3) x (3,3) | draw |
| (1,2) x (3,2), (1,4) x (3,4) | lambs win, first forced capture or trap within 24 plies |
| (1,2) -> (2,2), (1,3) -> (2,3), (1,4) -> (2,4) | lambs win within 20 plies |
| (1,2) -> (1,1), (1,4) -> (1,5) | lambs win within 18 plies |

After the centre capture the lambs have four legal replies (the four remaining
third-rank lambs can step up), and all four keep the draw. The wolves then keep
winning material for a while: with one wolf on the third rank and two on the
first, the lambs can block only one capture lane per move.

A representative best-play line (ties between equally valued moves broken by
the search AI; `node solver/play.js line` prints it in full):

```
 1. Wolf (1,3) x (3,3)     9. Wolf (2,5) x (2,3)    25. Wolf (2,1) x (4,1)
 2. Lamb (3,2) -> (2,2)   ...                       29. Wolf (2,2) x (4,2)
 3. Wolf (1,4) x (3,4)    17. Wolf (3,1) x (3,3)    33. Wolf (3,1) x (5,1)
 4. Lamb (3,1) -> (2,1)   ...                       37. Wolf (3,4) x (5,4)
```

After move 37 seven lambs remain and the position is a fortress: the wolves can
never force another capture, the lambs can never trap a wolf, and the game ends
by the 100-turn rule at ply 137.

So the practical lesson matches your experience only in part. The lambs do win
against wolves that capture greedily or wander: 9 out of 10 positions with 12
lambs are lamb wins, and at 14 or 15 lambs the wolves have no winning positions
at all. But against precise wolf play the lambs cannot win from the start; the
best they can do is hold the fortress.

## 4. Files

| file | purpose |
|---|---|
| `solver/solve.c` | retrograde solver (C, pthreads). `cc -O3 -o solver/solve solver/solve.c -lpthread`, then `solver/solve 15 12` |
| `solver/tables/layer_<k>.bin` | one uint16 per state: winner in bits 15..14 (1 wolf, 2 lamb, 3 draw), T in bits 13..0 |
| `solver/indexing.js` | the state indexing, independent JavaScript implementation |
| `solver/verify.js` | independent checker: `node solver/verify.js [min] [max] [threads]` |
| `solver/spotcheck.js` | random entries against brute force over `engine.js` |
| `solver/tables.js` | lookup and best-move listing for a position |
| `solver/play.js` | `line` prints best play from the start; `play wolf|lamb` plays against the tables. Move choice everywhere: fastest win; in drawn positions the drawing move that gives a uniformly random opponent the highest probability of being lost within three of their moves (we answer optimally), with the one-move fraction as tie-break; otherwise the slowest loss |
| `solver/server.js` | `node solver/server.js` serves lookups on localhost:8787 for `index.html`: exact value of the position, exact outcome of every move, exact-blunder marks, and perfect AI play with the search engine breaking ties |

## 5. Without the 100-turn rule

To see whether the draw depends on the clock, the game was solved a second time
with the no-capture limit raised to 16,000 plies (effectively infinite; only
threefold repetition remains, which changes no values). Tables are in
`solver/tables_noclock/`, built with `-DCLOCK=16000`.

**The starting position is still a draw.** The wolves cannot be trapped and the
lambs cannot be reduced below three, no matter how long the game runs. The rule
change only converts some long lamb squeezes in the middle layers into wins:

| lambs | lamb wins with clock | lamb wins without clock | draws with clock | draws without clock |
|------:|---:|---:|---:|---:|
| 8  | 8,814,216   | 8,921,318   | 107,097,353 | 106,990,251 |
| 9  | 53,921,205  | 54,417,754  | 193,614,581 | 193,118,032 |
| 10 | 176,467,067 | 177,343,412 | 200,984,080 | 200,107,735 |
| 13 | 309,017,226 | 309,104,343 | 8,332,570   | 8,245,453   |
| 15 | 108,784,334 | 108,785,085 | 22,738      | 21,987      |

So the fortress is genuine: with 15 lambs, only 21,987 positions are not lamb
wins even with unlimited time, and the start is one of them. The longest forced
lamb win at 15 lambs takes 24 plies to the first capture or trap either way.

Verification of the no-clock tables with
`WL_CLOCK=16000 WL_TABLES=solver/tables_noclock node solver/verify.js`:
all 13 layers, 0 errors.
