/*
 * Wolf and Lamb — exact retrograde solver under the full rules of SPEC.md v1.0,
 * including the 100-turn no-capture draw rule and threefold repetition.
 *
 * Layers: a layer is the number of lambs k (3..15). Captures only move down a
 * layer, so layer k needs only layer k-1. Fewer than 3 lambs is a wolf win.
 *
 * Within a layer, for each side X we compute
 *
 *   T_X(s) = the smallest number of plies within which X can force, against
 *            any resistance, either a terminal win (the opponent has no move)
 *            or a capture into a layer-(k-1) state that is an X win.
 *
 * (Only wolves capture, but a wolf capture into a lamb-win state counts as a
 * lamb "exit".) The 100-turn rule resets on every capture, so X wins the game
 * from s with a fresh clock exactly when T_X(s) <= 100. T_X and T_Y cannot both
 * be finite. States where neither is <= 100 are draws: the defending side can
 * hold out until the clock, and repetition only ever produces draws. Winning
 * lines have strictly decreasing T, so repetition cannot stop a winner either.
 *
 * State indexing (verify.js re-implements it independently):
 *   - The three wolves are a 3-subset of the 25 cells, grouped into orbits under
 *     the 8 symmetries of the square. A state is stored with the wolves in the
 *     orbit's canonical (numerically smallest) mask.
 *   - Lambs are a k-subset of the remaining 22 cells, ranked in colex order
 *     (combinatorial number system) after the same transform. If the wolf mask
 *     is fixed by several transforms, the one giving the smallest lamb mask is
 *     used; other lamb masks of such orbits are aliases and are filled with a
 *     copy of their canonical twin's value.
 *   - index = (orbit * C(22,k) + lambRank) * 2 + side, side 0 = wolf to move.
 *
 * Output: solver/tables/layer_<k>.bin, one little-endian uint16 per state:
 *   bits 15..14: 1 WOLF wins, 2 LAMB wins, 3 draw
 *   bits 13..0 : T for the winner (plies to a winning capture or the end), 0 for draws
 *
 * Build: cc -O3 -o solver/solve solver/solve.c -lpthread
 * Run:   solver/solve [maxLayer] [threads]
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <pthread.h>
#include <time.h>
#include <sys/stat.h>

#define ALL ((1u << 25) - 1)
#define WOLF 1
#define LAMB 2
#define DRAW 3
#ifndef CLOCK
#define CLOCK 100          /* plies without a capture allowed before a draw */
#endif
#ifndef TABLES_DIR
#define TABLES_DIR "solver/tables"
#endif
#define ESCAPE 0xff        /* counter marker: the defender has a way out of the layer */

static uint32_t NOT_COL1, NOT_COL5;
static inline uint32_t up(uint32_t b) { return b >> 5; }
static inline uint32_t down(uint32_t b) { return (b << 5) & ALL; }
static inline uint32_t left(uint32_t b) { return (b >> 1) & NOT_COL5; }
static inline uint32_t right(uint32_t b) { return (b << 1) & NOT_COL1; }

static double now_s(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }

/* ---- symmetry ---------------------------------------------------------- */
static int perm[8][25];
static uint32_t rowT[8][5][32];
static inline uint32_t xf(int t, uint32_t m) {
  return rowT[t][0][m & 31] | rowT[t][1][(m >> 5) & 31] | rowT[t][2][(m >> 10) & 31] |
         rowT[t][3][(m >> 15) & 31] | rowT[t][4][(m >> 20) & 31];
}
static void init_symmetry(void) {
  for (int r = 0; r < 5; r++) for (int c = 0; c < 5; c++) {
    int i = r * 5 + c;
    perm[0][i] = r * 5 + c;             /* identity   */
    perm[1][i] = c * 5 + (4 - r);       /* rot 90     */
    perm[2][i] = (4 - r) * 5 + (4 - c); /* rot 180    */
    perm[3][i] = (4 - c) * 5 + r;       /* rot 270    */
    perm[4][i] = r * 5 + (4 - c);       /* mirror L-R */
    perm[5][i] = (4 - r) * 5 + c;       /* mirror U-D */
    perm[6][i] = c * 5 + r;             /* transpose  */
    perm[7][i] = (4 - c) * 5 + (4 - r); /* anti-transpose */
  }
  for (int t = 0; t < 8; t++) for (int r = 0; r < 5; r++) for (int bits = 0; bits < 32; bits++) {
    uint32_t m = 0;
    for (int c = 0; c < 5; c++) if (bits & (1 << c)) m |= 1u << perm[t][r * 5 + c];
    rowT[t][r][bits] = m;
  }
}

/* ---- binomials, wolf triples, orbits ----------------------------------- */
static uint32_t binom[26][26];
static void init_binom(void) {
  for (int n = 0; n < 26; n++) { binom[n][0] = 1; for (int k = 1; k < 26; k++) binom[n][k] = (n == 0) ? 0 : binom[n - 1][k - 1] + binom[n - 1][k]; }
}
static inline int rank3(uint32_t w) {
  int a = __builtin_ctz(w); w &= w - 1; int b = __builtin_ctz(w); w &= w - 1; int c = __builtin_ctz(w);
  return binom[a][1] + binom[b][2] + binom[c][3];
}

#define NTRIPLES 2300
static uint16_t tripleOrbit[NTRIPLES];
static uint8_t tripleCosetN[NTRIPLES];
static uint8_t tripleCoset[NTRIPLES][8];
static int nOrbits = 0;
static uint32_t orbitMask[NTRIPLES];
static int8_t orbitComp[NTRIPLES][25];
static uint32_t orbitExp8[NTRIPLES][3][256];
static uint8_t orbitStabN[NTRIPLES];
static uint8_t orbitStab[NTRIPLES][8];

static void init_orbits(void) {
  uint32_t masks[NTRIPLES];
  for (int a = 0; a < 25; a++) for (int b = a + 1; b < 25; b++) for (int c = b + 1; c < 25; c++) {
    uint32_t w = (1u << a) | (1u << b) | (1u << c);
    masks[rank3(w)] = w;
  }
  for (int r = 0; r < NTRIPLES; r++) tripleOrbit[r] = 0xffff;
  for (int r = 0; r < NTRIPLES; r++) {
    uint32_t w = masks[r];
    uint32_t canon = ALL;
    for (int t = 0; t < 8; t++) { uint32_t m = xf(t, w); if (m < canon) canon = m; }
    int cr = rank3(canon);
    if (tripleOrbit[cr] == 0xffff) {
      int o = nOrbits++;
      orbitMask[o] = canon;
      int ci = 0;
      for (int p = 0; p < 25; p++) orbitComp[o][p] = (canon >> p) & 1 ? -1 : ci++;
      int cells[22]; ci = 0;
      for (int p = 0; p < 25; p++) if (!((canon >> p) & 1)) cells[ci++] = p;
      for (int chunk = 0; chunk < 3; chunk++) for (int v = 0; v < 256; v++) {
        uint32_t m = 0;
        for (int bit = 0; bit < 8; bit++) { int c = chunk * 8 + bit; if (c < 22 && (v & (1 << bit))) m |= 1u << cells[c]; }
        orbitExp8[o][chunk][v] = m;
      }
      orbitStabN[o] = 0;
      for (int t = 0; t < 8; t++) if (xf(t, canon) == canon) orbitStab[o][orbitStabN[o]++] = t;
      tripleOrbit[cr] = o;
    }
    tripleOrbit[r] = tripleOrbit[cr];
    tripleCosetN[r] = 0;
    for (int t = 0; t < 8; t++) if (xf(t, w) == canon) tripleCoset[r][tripleCosetN[r]++] = t;
  }
}

static inline uint32_t expandLambs(int o, uint32_t cm) {
  return orbitExp8[o][0][cm & 255] | orbitExp8[o][1][(cm >> 8) & 255] | orbitExp8[o][2][(cm >> 16) & 63];
}
static inline uint32_t rankLambs(int o, uint32_t lm) {
  uint32_t r = 0; int i = 0;
  while (lm) { int p = __builtin_ctz(lm); lm &= lm - 1; i++; r += binom[orbitComp[o][p]][i]; }
  return r;
}
static inline uint32_t unrankCompressed(uint32_t r, int k) {
  uint32_t cm = 0;
  for (int i = k - 1; i >= 0; i--) {
    int c = 21;
    while (binom[c][i + 1] > r) c--;
    r -= binom[c][i + 1];
    cm |= 1u << c;
  }
  return cm;
}
static inline uint32_t nextComb(uint32_t cm) { uint32_t c = cm & -cm, r = cm + c; return (((r ^ cm) >> 2) / c) | r; }
static inline int isAlias(int o, uint32_t l) {
  for (int i = 1; i < orbitStabN[o]; i++) if (xf(orbitStab[o][i], l) < l) return 1;
  return 0;
}

/* ---- layers ------------------------------------------------------------ */
typedef struct { int k; uint32_t c22k; uint64_t n; uint16_t *val; } Layer;

static inline uint64_t canonIndex(const Layer *L, uint32_t w, uint32_t l, int side) {
  int r = rank3(w);
  int o = tripleOrbit[r];
  uint32_t best = 0xffffffffu;
  for (int i = 0; i < tripleCosetN[r]; i++) { uint32_t m = xf(tripleCoset[r][i], l); if (m < best) best = m; }
  return (((uint64_t)o * L->c22k + rankLambs(o, best)) << 1) | side;
}
static inline void stateOf(const Layer *L, uint64_t idx, uint32_t *w, uint32_t *l, int *side) {
  *side = idx & 1; uint64_t s = idx >> 1;
  int o = (int)(s / L->c22k); uint32_t r = (uint32_t)(s % L->c22k);
  *w = orbitMask[o]; *l = expandLambs(o, unrankCompressed(r, L->k));
}

#define VAL(winner, d) ((uint16_t)(((winner) << 14) | (d)))
#define WINNER(v) ((v) >> 14)
#define DIST(v) ((v) & 0x3fff)

/* ---- move generation --------------------------------------------------- */
typedef struct { uint32_t w, l; uint8_t cap; } Child;

static inline int genChildren(uint32_t w, uint32_t l, int side, Child *out) {
  uint32_t empty = ALL & ~(w | l); int n = 0; uint32_t b;
  if (side == 0) {
#define WSTEP(dir, back) b = dir(w) & empty; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(1u << t); out[n].w = (w ^ f) | (1u << t); out[n].l = l; out[n].cap = 0; n++; }
#define WCAP(dir, back) b = dir(dir(w) & empty) & l; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(back(1u << t)); out[n].w = (w ^ f) | (1u << t); out[n].l = l & ~(1u << t); out[n].cap = 1; n++; }
    WCAP(up, down) WCAP(down, up) WCAP(left, right) WCAP(right, left)
    WSTEP(up, down) WSTEP(down, up) WSTEP(left, right) WSTEP(right, left)
  } else {
#define LSTEP(dir, back) b = dir(l) & empty; while (b) { int t = __builtin_ctz(b); b &= b - 1; uint32_t f = back(1u << t); out[n].w = w; out[n].l = (l ^ f) | (1u << t); out[n].cap = 0; n++; }
    LSTEP(up, down) LSTEP(down, up) LSTEP(left, right) LSTEP(right, left)
  }
  return n;
}
/* within-layer predecessors: the opponent of `side` just stepped a piece into its cell */
static inline int genPreds(uint32_t w, uint32_t l, int side, Child *out) {
  uint32_t empty = ALL & ~(w | l); int n = 0; uint32_t b;
  if (side == 1) {
#define WUN(dir, back) b = dir(w) & empty; while (b) { int f = __builtin_ctz(b); b &= b - 1; uint32_t t = back(1u << f); out[n].w = (w ^ t) | (1u << f); out[n].l = l; n++; }
    WUN(up, down) WUN(down, up) WUN(left, right) WUN(right, left)
  } else {
#define LUN(dir, back) b = dir(l) & empty; while (b) { int f = __builtin_ctz(b); b &= b - 1; uint32_t t = back(1u << f); out[n].w = w; out[n].l = (l ^ t) | (1u << f); n++; }
    LUN(up, down) LUN(down, up) LUN(left, right) LUN(right, left)
  }
  return n;
}

/* ---- vectors ----------------------------------------------------------- */
typedef struct { uint32_t *a; uint64_t n, cap; } Vec;
static void vpush(Vec *v, uint32_t x) {
  if (v->n == v->cap) { v->cap = v->cap ? v->cap * 2 : 1024; v->a = realloc(v->a, v->cap * sizeof(uint32_t)); if (!v->a) { fprintf(stderr, "oom\n"); exit(1); } }
  v->a[v->n++] = x;
}

/* ---- the T pass for one side ------------------------------------------- */
static Layer cur, prev;
static uint16_t *T;          /* T_X per state; 0 = unset except for terminal Y-to-move states */
static uint8_t *cnt;         /* Y-to-move: unresolved distinct step children, or ESCAPE */
static int nThreads = 8;
static int X;                /* the side whose T we are computing */

/* is a capture target (layer k-1 state, lamb to move) a win for X? */
static inline int lowerWin(uint32_t w, uint32_t l) {
  if (cur.k - 1 < 3) return X == WOLF;
  return WINNER(prev.val[canonIndex(&prev, w, l, 1)]) == X;
}

typedef struct { int tid; Vec q0, q1; } InitArg;

static void *initWorker(void *arg) {
  InitArg *A = arg;
  Child ch[64]; uint64_t seen[64];
  int k = cur.k;
  for (int o = A->tid; o < nOrbits; o += nThreads) {
    uint32_t cm = (1u << k) - 1; uint32_t rank = 0;
    uint64_t base = (uint64_t)o * cur.c22k;
    for (; cm < (1u << 22); cm = nextComb(cm), rank++) {
      uint32_t w = orbitMask[o], l = expandLambs(o, cm);
      if (isAlias(o, l)) continue;
      for (int side = 0; side < 2; side++) {
        uint64_t idx = ((base + rank) << 1) | side;
        int mover = side == 0 ? WOLF : LAMB;
        int n = genChildren(w, l, side, ch);
        if (mover == X) {
          if (n == 0) continue;                                   /* X is stuck: X cannot win here */
          for (int i = 0; i < n; i++) if (ch[i].cap && lowerWin(ch[i].w, ch[i].l)) { T[idx] = 1; vpush(&A->q1, (uint32_t)idx); break; }
        } else {
          if (n == 0) { T[idx] = 0; vpush(&A->q0, (uint32_t)idx); continue; } /* Y is stuck: X wins now */
          int nStep = 0, escape = 0;
          for (int i = 0; i < n; i++) {
            if (ch[i].cap) { if (!lowerWin(ch[i].w, ch[i].l)) { escape = 1; break; } }
            else {
              uint64_t ci = canonIndex(&cur, ch[i].w, ch[i].l, side ^ 1);
              int dup = 0; for (int j = 0; j < nStep; j++) if (seen[j] == ci) { dup = 1; break; }
              if (!dup) seen[nStep++] = ci;
            }
          }
          if (escape) cnt[idx] = ESCAPE;
          else if (nStep == 0) { T[idx] = 1; vpush(&A->q1, (uint32_t)idx); } /* every move is a capture into an X win */
          else cnt[idx] = (uint8_t)nStep;
        }
      }
    }
  }
  return NULL;
}

/* Runs the BFS for side X, writes wins with T <= CLOCK into cur.val. Returns max finite T. */
static int tPass(int side, uint64_t *nWinOut) {
  X = side;
  T = calloc(cur.n, sizeof(uint16_t)); cnt = calloc(cur.n, 1);
  if (!T || !cnt) { fprintf(stderr, "oom T pass\n"); exit(1); }
  pthread_t th[64]; InitArg args[64];
  for (int t = 0; t < nThreads; t++) { args[t].tid = t; memset(&args[t].q0, 0, sizeof(Vec)); memset(&args[t].q1, 0, sizeof(Vec)); pthread_create(&th[t], NULL, initWorker, &args[t]); }
  Vec curq = {0}, nextq = {0};
  for (int t = 0; t < nThreads; t++) {
    pthread_join(th[t], NULL);
    for (uint64_t i = 0; i < args[t].q0.n; i++) vpush(&curq, args[t].q0.a[i]);
    for (uint64_t i = 0; i < args[t].q1.n; i++) vpush(&nextq, args[t].q1.a[i]);
    free(args[t].q0.a); free(args[t].q1.a);
  }
  Child pr[64]; uint64_t seen[64];
  int level = 0, maxT = -1; uint64_t nWin = 0;
  while (curq.n || nextq.n) {
    for (uint64_t bi = 0; bi < curq.n; bi++) {
      uint64_t idx = curq.a[bi];
      if (T[idx] != level) { fprintf(stderr, "internal error: level mismatch\n"); exit(1); }
      maxT = level;
      if (level <= CLOCK) {
        if (cur.val[idx] != 0) { fprintf(stderr, "internal error: state won by both sides\n"); exit(1); }
        cur.val[idx] = VAL(X, level); nWin++;
      }
      uint32_t w, l; int side; stateOf(&cur, idx, &w, &l, &side);
      int n = genPreds(w, l, side, pr); int ns = 0;
      for (int i = 0; i < n; i++) {
        uint64_t q = canonIndex(&cur, pr[i].w, pr[i].l, side ^ 1);
        int dup = 0; for (int j = 0; j < ns; j++) if (seen[j] == q) { dup = 1; break; }
        if (dup) continue; seen[ns++] = q;
        int qMover = (side ^ 1) == 0 ? WOLF : LAMB;
        if (qMover == X) {
          if (T[q] == 0) { T[q] = (uint16_t)(level + 1); vpush(&nextq, (uint32_t)q); }
        } else {
          uint8_t c = cnt[q];
          if (c == ESCAPE) continue;
          if (c == 0) { fprintf(stderr, "internal error: counter underflow\n"); exit(1); }
          if (--cnt[q] == 0) { T[q] = (uint16_t)(level + 1); vpush(&nextq, (uint32_t)q); }
        }
      }
    }
    free(curq.a); curq = nextq; memset(&nextq, 0, sizeof(Vec)); level++;
    if (level >= 16383) { fprintf(stderr, "T overflow\n"); exit(1); }
  }
  free(T); T = NULL; free(cnt); cnt = NULL;
  *nWinOut = nWin;
  return maxT;
}

static void solveLayer(int k) {
  double t0 = now_s();
  cur.k = k; cur.c22k = binom[22][k]; cur.n = (uint64_t)nOrbits * cur.c22k * 2;
  cur.val = calloc(cur.n, sizeof(uint16_t));
  if (!cur.val) { fprintf(stderr, "oom layer %d\n", k); exit(1); }

  uint64_t nw, nl;
  int maxTW = tPass(WOLF, &nw);
  double t1 = now_s();
  int maxTL = tPass(LAMB, &nl);
  double t2 = now_s();

  /* aliases copy their canonical twin; everything else unset is a draw */
  uint64_t nAlias = 0;
  for (int o = 0; o < nOrbits; o++) {
    if (orbitStabN[o] < 2) continue;
    uint32_t cm = (1u << k) - 1; uint64_t base = (uint64_t)o * cur.c22k; uint32_t rank = 0;
    for (; cm < (1u << 22); cm = nextComb(cm), rank++) {
      uint32_t l = expandLambs(o, cm), best = l;
      for (int i = 1; i < orbitStabN[o]; i++) { uint32_t m = xf(orbitStab[o][i], l); if (m < best) best = m; }
      if (best != l) {
        uint64_t src = (base + rankLambs(o, best)) << 1, dst = (base + rank) << 1;
        cur.val[dst] = cur.val[src]; cur.val[dst | 1] = cur.val[src | 1]; nAlias++;
      }
    }
  }
  uint64_t cw = 0, cl = 0, cd = 0;
  for (uint64_t i = 0; i < cur.n; i++) {
    uint16_t v = cur.val[i];
    if (v == 0) { cur.val[i] = VAL(DRAW, 0); cd++; } else if (WINNER(v) == WOLF) cw++; else cl++;
  }
  fprintf(stderr, "layer %2d: %llu states  wolf-win %llu  lamb-win %llu  draw %llu  (alias states %llu)\n", k,
          (unsigned long long)cur.n, (unsigned long long)cw, (unsigned long long)cl, (unsigned long long)cd, (unsigned long long)nAlias * 2);
  fprintf(stderr, "          max T: wolf %d, lamb %d  (wins need T <= %d)   wolf pass %.1fs, lamb pass %.1fs\n",
          maxTW, maxTL, CLOCK, t1 - t0, t2 - t1);

  char path[256]; snprintf(path, sizeof path, TABLES_DIR "/layer_%d.bin", k);
  FILE *f = fopen(path, "wb");
  if (!f || fwrite(cur.val, sizeof(uint16_t), cur.n, f) != cur.n) { fprintf(stderr, "write failed %s\n", path); exit(1); }
  fclose(f);
  if (prev.val) free(prev.val);
  prev = cur; cur.val = NULL;
}

static int loadLayer(int k) {
  char path[256]; snprintf(path, sizeof path, TABLES_DIR "/layer_%d.bin", k);
  FILE *f = fopen(path, "rb"); if (!f) return 0;
  Layer L; L.k = k; L.c22k = binom[22][k]; L.n = (uint64_t)nOrbits * L.c22k * 2;
  L.val = malloc(L.n * sizeof(uint16_t));
  if (fread(L.val, sizeof(uint16_t), L.n, f) != L.n) { fclose(f); free(L.val); return 0; }
  fclose(f);
  if (prev.val) free(prev.val);
  prev = L; return 1;
}

int main(int argc, char **argv) {
  int maxLayer = argc > 1 ? atoi(argv[1]) : 15;
  if (argc > 2) nThreads = atoi(argv[2]);
  uint32_t col1 = 0, col5 = 0;
  for (int r = 0; r < 5; r++) { col1 |= 1u << (r * 5); col5 |= 1u << (r * 5 + 4); }
  NOT_COL1 = ALL & ~col1; NOT_COL5 = ALL & ~col5;
  init_symmetry(); init_binom(); init_orbits();
  mkdir("solver", 0755); mkdir(TABLES_DIR, 0755);
  fprintf(stderr, "wolf-triple orbits: %d, threads: %d, clock: %d plies\n", nOrbits, nThreads, CLOCK);
  memset(&prev, 0, sizeof prev); memset(&cur, 0, sizeof cur);

  int start = 3;
  for (int k = 3; k <= maxLayer; k++) if (loadLayer(k)) { start = k + 1; fprintf(stderr, "layer %2d: loaded from disk\n", k); } else break;
  for (int k = start; k <= maxLayer; k++) solveLayer(k);

  if (prev.val && prev.k == 15) {
    uint32_t w = (1u << 1) | (1u << 2) | (1u << 3), l = 0;
    for (int i = 10; i < 25; i++) l |= 1u << i;
    uint16_t v = prev.val[canonIndex(&prev, w, l, 0)];
    const char *who = WINNER(v) == WOLF ? "WOLF wins" : WINNER(v) == LAMB ? "LAMB wins" : "DRAW";
    printf("INITIAL POSITION (wolf to move): %s", who);
    if (WINNER(v) != DRAW) printf(", first winning capture or game end forced within %u plies", DIST(v));
    printf("\n");
  }
  return 0;
}
