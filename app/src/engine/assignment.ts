/**
 * Min-cost assignment of n rows to m ≥ n columns (Hungarian algorithm, O(n²m)).
 * Returns col index per row.
 */
export function hungarianMin(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  if (m < n) throw new Error(`hungarianMin needs cols >= rows (${n}x${m})`);
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      const row = cost[i0 - 1]!;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = row[j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const ans = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) ans[p[j]! - 1] = j - 1;
  return ans;
}

const BLOCKED = 1e12;

/**
 * Best assignment of items to slots maximizing total value. `value(slot, item)` returns the value or
 * `null` when the item can't fill the slot. Slots may stay empty (value 0).
 * Returns the item index per slot (-1 = empty) and the total value.
 */
export function bestAssignment(
  slotCount: number,
  itemCount: number,
  value: (slot: number, item: number) => number | null,
): { assignment: number[]; total: number } {
  if (slotCount === 0) return { assignment: [], total: 0 };
  // Columns: real items, then one "empty" dummy per slot so every slot can stay unfilled.
  const cols = itemCount + slotCount;
  const cost: number[][] = [];
  for (let s = 0; s < slotCount; s++) {
    const row = new Array<number>(cols);
    for (let i = 0; i < itemCount; i++) {
      const val = value(s, i);
      row[i] = val === null ? BLOCKED : -val;
    }
    for (let d = 0; d < slotCount; d++) row[itemCount + d] = 0;
    cost.push(row);
  }
  const cols4row = hungarianMin(cost);
  let total = 0;
  const assignment = cols4row.map((c, s) => {
    if (c < itemCount) {
      const val = value(s, c);
      if (val === null) return -1;
      total += val;
      return c;
    }
    return -1;
  });
  return { assignment, total };
}
