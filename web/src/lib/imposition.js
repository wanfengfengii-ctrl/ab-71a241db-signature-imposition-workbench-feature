/**
 * 书帖编排规则的前端镜像实现（与 api/app/imposition.py 同一条规则）。
 *
 * 页面展示以 API 返回为准；本模块同时承担：
 *  1. Vitest 中用与 pytest 完全相同的向量校验规则；
 *  2. flattenPlacedPages() 从 API 响应中摊平页位，驱动页面上的
 *     “每个正文页恰好出现一次 / 空白只位于末帖尾部”核对清单。
 */

export const LONG_EDGE = "long_edge";
export const SHORT_EDGE = "short_edge";
export const FLIP_MODES = [LONG_EDGE, SHORT_EDGE];
export const ALLOWED_SIGNATURE_SIZES = [8, 16, 32];

function pageOrBlank(position, offset, totalPages) {
  const pageNumber = offset + position;
  return pageNumber <= totalPages ? pageNumber : null;
}

/** 合并重叠或相邻（首尾相接）的闭区间，返回升序的 [起点, 终点] 数组。 */
export function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const ordered = intervals
    .map(([start, end]) => [start, end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [ordered[0].slice()];
  for (const [start, end] of ordered.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/**
 * 自动混合容量规划：返回逐帖容量；约束下无解时返回 null。
 *
 * 候选容量为 8/16/32 中不超过 maxCapacity 者；书帖边界不能落在任何
 * 不可拆页段内部（段 [a,b] 内部下刀位置为 a ≤ p < b）。方案按
 * （补白最少、书帖数最少、容量序列从前向后较大者优先）唯一定序。
 */
export function planAutoCapacities(totalPages, maxCapacity, rawSegments) {
  const candidates = ALLOWED_SIGNATURE_SIZES.filter(
    (size) => size <= maxCapacity
  );
  const segments = mergeIntervals(rawSegments ?? []);
  const starts = segments.map(([start]) => start);

  function boundaryForbidden(position) {
    if (position <= 0 || position >= totalPages) return false;
    // bisect_right：第一个起点大于 position 的位置，再退一格
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= position) lo = mid + 1;
      else hi = mid;
    }
    const index = lo - 1;
    if (index < 0) return false;
    return position < segments[index][1];
  }

  function prefixBetter(candidate, incumbent) {
    if (candidate[0] !== incumbent[0]) return candidate[0] < incumbent[0];
    const a = candidate[1];
    const b = incumbent[1];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const left = a[i] ?? -Infinity;
      const right = b[i] ?? -Infinity;
      if (left !== right) return left > right;
    }
    return false;
  }

  // best：边界位置 -> [完整书帖数, 容量序列]（帖数最少，序列从前向后较大）
  const best = new Map([[0, [0, []]]]);
  for (let position = 0; position < totalPages; position += 1) {
    const current = best.get(position);
    if (!current) continue;
    for (const capacity of candidates) {
      const landing = position + capacity;
      if (landing >= totalPages) continue;
      if (boundaryForbidden(landing)) continue;
      const candidateState = [
        current[0] + 1,
        current[1].concat(capacity),
      ];
      const incumbent = best.get(landing);
      if (!incumbent || prefixBetter(candidateState, incumbent)) {
        best.set(landing, candidateState);
      }
    }
  }

  // 枚举所有可收尾的位置：末帖取恰好容纳剩余页的最小候选容量（补白最少）
  let winnerKey = null;
  let winnerSequence = null;
  for (const [position, [steps, sequence]] of best.entries()) {
    const lastContent = totalPages - position;
    if (lastContent < 1 || lastContent > maxCapacity) continue;
    const lastCapacity = candidates.find((size) => size >= lastContent);
    const fullSequence = sequence.concat(lastCapacity);
    const key = [
      lastCapacity - lastContent,
      steps + 1,
      fullSequence.map((capacity) => -capacity),
    ];
    if (winnerKey === null || comparePlanKey(key, winnerKey) < 0) {
      winnerKey = key;
      winnerSequence = fullSequence;
    }
  }
  return winnerSequence;
}

/** 方案定序：补白最少、书帖数最少、容量序列从前向后较大者优先。 */
function comparePlanKey(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return compareSequence(a[2], b[2]);
}

function compareSequence(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i] ?? Infinity;
    const right = b[i] ?? Infinity;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function buildSignature(index, offset, capacity, totalPages, flip, segments) {
  const sheets = [];
  for (let k = 0; k < capacity / 4; k += 1) {
    let backLeft = 2 + 2 * k;
    let backRight = capacity - 1 - 2 * k;
    if (flip === SHORT_EDGE) {
      [backLeft, backRight] = [backRight, backLeft];
    }

    sheets.push({
      index: k,
      front: {
        left: pageOrBlank(capacity - 2 * k, offset, totalPages),
        right: pageOrBlank(1 + 2 * k, offset, totalPages),
      },
      back: {
        left: pageOrBlank(backLeft, offset, totalPages),
        right: pageOrBlank(backRight, offset, totalPages),
      },
    });
  }

  const signature = {
    index,
    offset,
    capacity,
    content_pages: Math.min(capacity, totalPages - offset),
    sheets,
  };
  if (segments) {
    signature.padding = capacity - signature.content_pages;
    signature.protected_segments = segments
      .filter(
        ([start, end]) => offset < start && end <= offset + capacity
      )
      .map(([start, end]) => [start, end]);
  }
  return signature;
}

export function impose(
  totalPages,
  pagesPerSignature,
  flip,
  { autoMode = false, protectedSegments = null } = {}
) {
  let capacities;
  let segments = null;
  if (!autoMode) {
    capacities = Array(Math.ceil(totalPages / pagesPerSignature)).fill(
      pagesPerSignature
    );
  } else {
    capacities = planAutoCapacities(
      totalPages,
      pagesPerSignature,
      protectedSegments
    );
    if (capacities === null) {
      throw new Error("自动容量规划在当前不可拆页段约束下无解");
    }
    segments = mergeIntervals(protectedSegments ?? []);
  }

  const signatures = [];
  let offset = 0;
  capacities.forEach((capacity, index) => {
    signatures.push(
      buildSignature(index, offset, capacity, totalPages, flip, segments)
    );
    offset += capacity;
  });
  const totalCapacity = capacities.reduce((sum, size) => sum + size, 0);

  const result = {
    total_pages: totalPages,
    pages_per_signature: pagesPerSignature,
    flip,
    signatures,
    summary: {
      signature_count: capacities.length,
      sheet_count: signatures.reduce(
        (sum, signature) => sum + signature.sheets.length,
        0
      ),
      blank_count: totalCapacity - totalPages,
    },
  };

  if (autoMode) {
    result.auto_mode = true;
    result.auto_plan = {
      max_capacity: pagesPerSignature,
      candidate_capacities: ALLOWED_SIGNATURE_SIZES.filter(
        (size) => size <= pagesPerSignature
      ),
      protected_pages: segments.map(([start, end]) => [start, end]),
      capacities: capacities.slice(),
      blank_count: totalCapacity - totalPages,
    };
  }

  return result;
}

/** 摊平 API 响应（或本模块镜像结果）中的全部页位。 */
export function flattenPlacedPages(result) {
  const cells = [];
  for (const signature of result.signatures) {
    for (const sheet of signature.sheets) {
      for (const side of ["front", "back"]) {
        for (const position of ["left", "right"]) {
          cells.push({
            signatureIndex: signature.index,
            isLastSignature:
              signature.index === result.signatures.length - 1,
            sheetIndex: sheet.index,
            side,
            position,
            page: sheet[side][position],
          });
        }
      }
    }
  }
  return cells;
}

/** 印前自检：每个正文页恰好出现一次，空白页位为 null 且只落在末帖。 */
export function auditResult(result) {
  const cells = flattenPlacedPages(result);
  const pages = cells
    .filter((cell) => cell.page !== null)
    .map((cell) => cell.page)
    .sort((a, b) => a - b);

  const expected = Array.from(
    { length: result.total_pages },
    (_, i) => i + 1
  );
  const everyPageOnce =
    pages.length === expected.length &&
    pages.every((page, i) => page === expected[i]);

  const blanks = cells.filter((cell) => cell.page === null);
  const blanksOnlyInTail = blanks.every((cell) => cell.isLastSignature);

  return {
    everyPageOnce,
    blanksOnlyInTail,
    placedCount: pages.length,
    blankCount: blanks.length,
  };
}
