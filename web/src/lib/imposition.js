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

/** 容量序列比较：从前向后较大者优先（返回负值表示 a 更优）。 */
function compareSequenceDesc(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return a.length - b.length;
}

/**
 * 自动混合容量规划（镜像 plan_capacities）：
 * 以正文顺序连续装入各帖，书帖边界不落入不可拆页段；
 * 按 补白最少 → 书帖数最少 → 容量序列从前向后较大者优先 选出唯一方案。
 * 无解时返回 null。
 */
export function planCapacities(totalPages, maxCapacity, segments) {
  const candidates = ALLOWED_SIGNATURE_SIZES.filter(
    (size) => size <= maxCapacity
  );
  const blocked = new Set();
  for (const [start, end] of segments) {
    for (let boundary = start; boundary < end; boundary += 1) {
      blocked.add(boundary);
    }
  }

  // best：正文位置 -> 到达该位置的最优前缀 { count, sequence }
  const best = new Map([[0, { count: 0, sequence: [] }]]);
  const finals = [];
  for (let position = 0; position < totalPages; position += 1) {
    const entry = best.get(position);
    if (!entry) continue;
    for (const capacity of candidates) {
      const landing = position + capacity;
      if (landing >= totalPages) {
        finals.push({
          blanks: landing - totalPages,
          count: entry.count + 1,
          sequence: [...entry.sequence, capacity],
        });
      } else if (!blocked.has(landing)) {
        const challenger = {
          count: entry.count + 1,
          sequence: [...entry.sequence, capacity],
        };
        const current = best.get(landing);
        if (
          !current ||
          challenger.count < current.count ||
          (challenger.count === current.count &&
            compareSequenceDesc(challenger.sequence, current.sequence) < 0)
        ) {
          best.set(landing, challenger);
        }
      }
    }
  }

  if (finals.length === 0) return null;
  finals.sort(
    (a, b) =>
      a.blanks - b.blanks ||
      a.count - b.count ||
      compareSequenceDesc(a.sequence, b.sequence)
  );
  return finals[0].sequence;
}

export function impose(totalPages, pagesPerSignature, flip, protectedSegments) {
  const autoMode = protectedSegments != null;
  let capacities;
  if (autoMode) {
    capacities = planCapacities(totalPages, pagesPerSignature, protectedSegments);
    if (!capacities) {
      throw new Error("不可拆页段阻断了所有候选容量组合");
    }
  } else {
    const signatureCount = Math.ceil(totalPages / pagesPerSignature);
    capacities = Array.from({ length: signatureCount }, () => pagesPerSignature);
  }

  const signatures = [];
  let offset = 0;
  capacities.forEach((capacity, index) => {
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

    const contentPages = Math.min(capacity, totalPages - offset);
    const signature = {
      index,
      offset,
      capacity,
      content_pages: contentPages,
      sheets,
    };
    if (autoMode) {
      const firstPage = offset + 1;
      const lastPage = offset + contentPages;
      signature.blank_count = capacity - contentPages;
      signature.protected_segments = protectedSegments
        .filter(([start, end]) => firstPage <= start && end <= lastPage)
        .map(([start, end]) => [start, end]);
    }
    signatures.push(signature);
    offset += capacity;
  });

  const result = {
    total_pages: totalPages,
    pages_per_signature: pagesPerSignature,
    flip,
    signatures,
    summary: {
      signature_count: capacities.length,
      sheet_count: signatures.reduce((sum, s) => sum + s.sheets.length, 0),
      blank_count: capacities.reduce((sum, c) => sum + c, 0) - totalPages,
    },
  };
  if (autoMode) {
    result.auto_plan = {
      max_capacity: pagesPerSignature,
      candidates: ALLOWED_SIGNATURE_SIZES.filter(
        (size) => size <= pagesPerSignature
      ),
      capacities,
      protected_segments: protectedSegments.map(([start, end]) => [start, end]),
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
