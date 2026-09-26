# Wolf and Lamb — Game Specification

Status: v1.0 (2026-09-26). All rules confirmed by the game designer.

## 1. Overview

Wolf and Lamb is a two-player, turn-based, perfect-information board game played on
a 5×5 grid. One player controls the **Wolf** side (3 wolves), the other controls the
**Lamb** side (15 lambs). The sides are asymmetric:

- Wolves capture lambs by jumping over an empty cell onto them.
- Lambs cannot capture. They win by immobilising every wolf.
- General rule: **the side that has no legal move on its turn loses.**

## 2. Board

- A 5×5 grid of 25 cells.
- Cells are addressed `(row, col)` with `row, col ∈ {1..5}`, 1-indexed. `(1,1)` is
  the top-left; row 1 is the wolves' home row, row 5 is the lambs' back row.
- Each cell holds at most one piece.
- No special cells.

## 3. Pieces and Starting Position

| Side | Count | Starting cells                              |
|------|-------|---------------------------------------------|
| Wolf | 3     | `(1,2)`, `(1,3)`, `(1,4)`                   |
| Lamb | 15    | every cell in rows 3, 4 and 5               |

Pieces of the same side are interchangeable (no individual identity).

```
      col 1  2  3  4  5
row 1     .  W  W  W  .
row 2     .  .  .  .  .
row 3     L  L  L  L  L
row 4     L  L  L  L  L
row 5     L  L  L  L  L
```

## 4. Turn Order

- The **Wolf side moves first.**
- Players alternate turns. Exactly one piece moves per turn.
- Passing is not allowed.

## 5. Adjacency

Two cells are **adjacent** if they share an edge: they differ by exactly 1 in the
row *or* the column, not both. Diagonal cells are not adjacent, so
there is no diagonal movement for either side.

## 6. Moves

### 6.1 Lamb move

A lamb moves to an adjacent empty cell. Any direction (forward, backward, sideways).
This is the only kind of move a lamb has.

### 6.2 Wolf step

A wolf moves to an adjacent empty cell, exactly like a lamb move.

### 6.3 Wolf capture

A wolf at `(r, c)` may capture a lamb at `(r', c')` when all of the following hold:

1. Same row or same column: `r = r'` or `c = c'`.
2. The other coordinate differs by exactly 2: `|r - r'| + |c - c'| = 2`.
3. The single cell between them is **empty** (no lamb and no wolf).

Effect:

- The captured lamb is removed from the board permanently.
- The wolf **jumps to the captured lamb's cell** `(r', c')`.
- The capture uses the wolf side's whole turn. One capture per turn, no chaining.

Capturing is **optional**: if a capture is available the wolf side may still choose a
plain step instead.

Wolves never capture wolves, and a wolf cannot jump over a wolf (rule 3).

Illustration (`W` wolf, `L` lamb, `.` empty):

```
. . . . .
. W . L .    <- W may capture: same row, 2 apart, empty cell between
. L . . .    <- NOT capturable: adjacent (distance 1)
. . . . .
. . . . .

. . . . .
. W L L .    <- far L NOT capturable: a lamb sits in between
. . . . .
. . . . .
. . . . .
```

After the capture in the first diagram the board is:

```
. . . . .
. . . W .
. L . . .
. . . . .
. . . . .
```

## 7. Game End

Checked at the start of each turn, before the side to move acts.

### 7.1 Lamb side wins

It is the Wolf side's turn and **no wolf has any legal move** (neither a step per
6.2 nor a capture per 6.3).

### 7.2 Wolf side wins

Any one of:

- (a) **All lambs have been captured.**
- (b) It is the Lamb side's turn and **no lamb has any legal move.**
- (c) **Three or fewer lambs remain.** The Wolf side wins as soon as the lamb
  count drops to 3 (rule of the game as played; with three lambs the wolves are
  considered untrappable in practice).

### 7.3 Draw

To guarantee that every game ends (needed for search-based AI):

- **Threefold repetition:** the same board position with the same side to move
  occurs for the third time → draw.
- **Move limit:** 100 consecutive turns (50 by each side) with no capture → draw.

## 8. Illegal-move handling

An engine must reject any move that violates Sections 4–6. No penalty; the player
chooses again.

## 9. Notation

- Cells: `(row, col)`, 1-indexed.
- Lamb move / wolf step: `from -> to`, e.g. `(3,2) -> (2,2)`.
- Wolf capture: `from x target`, e.g. `(1,2) x (3,2)`; the wolf ends on `target`.
- A game record is the ordered list of moves from the starting position, Wolf first.

## 10. Rule summary (for implementers)

```
legal_moves(side):
  if side == LAMB:
    for each lamb: adjacent empty cells -> step
  if side == WOLF:
    for each wolf:
      adjacent empty cells -> step
      for each of 4 directions d:
        mid = wolf + d, far = wolf + 2d
        if far on board and mid empty and far holds a lamb -> capture

game_over(side_to_move):
  lambs_remaining == 0                 -> WOLF wins
  lambs_remaining <= 3                 -> WOLF wins
  legal_moves(side_to_move) is empty   -> side_to_move loses
  threefold repetition / move limit    -> draw
```

