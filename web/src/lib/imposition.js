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

export function impose(totalPages, pagesPerSignature, flip) {
  const signatureCount = Math.ceil(totalPages / pagesPerSignature);
  const signatures = [];

  for (let i = 0; i < signatureCount; i += 1) {
    const offset = i * pagesPerSignature;
    const sheets = [];

    for (let k = 0; k < pagesPerSignature / 4; k += 1) {
      let backLeft = 2 + 2 * k;
      let backRight = pagesPerSignature - 1 - 2 * k;
      if (flip === SHORT_EDGE) {
        [backLeft, backRight] = [backRight, backLeft];
      }

      sheets.push({
        index: k,
        front: {
          left: pageOrBlank(pagesPerSignature - 2 * k, offset, totalPages),
          right: pageOrBlank(1 + 2 * k, offset, totalPages),
        },
        back: {
          left: pageOrBlank(backLeft, offset, totalPages),
          right: pageOrBlank(backRight, offset, totalPages),
        },
      });
    }

    signatures.push({
      index: i,
      offset,
      capacity: pagesPerSignature,
      content_pages: Math.min(pagesPerSignature, totalPages - offset),
      sheets,
    });
  }

  return {
    total_pages: totalPages,
    pages_per_signature: pagesPerSignature,
    flip,
    signatures,
    summary: {
      signature_count: signatureCount,
      sheet_count: signatureCount * (pagesPerSignature / 4),
      blank_count: signatureCount * pagesPerSignature - totalPages,
    },
  };
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
