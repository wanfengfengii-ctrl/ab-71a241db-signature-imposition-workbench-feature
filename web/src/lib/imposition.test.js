import { describe, expect, it } from "vitest";

import {
  LONG_EDGE,
  SHORT_EDGE,
  auditResult,
  flattenPlacedPages,
  impose,
  mergeIntervals,
  planAutoCapacities,
} from "./imposition.js";

describe("骑马订书帖编排（与 pytest 同一套规则）", () => {
  it("8 页一帖、长边翻转：首纸 8|1 / 2|7，次纸 6|3 / 4|5", () => {
    const result = impose(8, 8, LONG_EDGE);
    const [sheet0, sheet1] = result.signatures[0].sheets;
    expect(sheet0.front).toEqual({ left: 8, right: 1 });
    expect(sheet0.back).toEqual({ left: 2, right: 7 });
    expect(sheet1.front).toEqual({ left: 6, right: 3 });
    expect(sheet1.back).toEqual({ left: 4, right: 5 });
    expect(result.summary.blank_count).toBe(0);
  });

  it("短边翻转交换背面左右，正面不变", () => {
    const longEdge = impose(8, 8, LONG_EDGE);
    const shortEdge = impose(8, 8, SHORT_EDGE);
    longEdge.signatures[0].sheets.forEach((longSheet, i) => {
      const shortSheet = shortEdge.signatures[0].sheets[i];
      expect(shortSheet.front).toEqual(longSheet.front);
      expect(shortSheet.back.left).toBe(longSheet.back.right);
      expect(shortSheet.back.right).toBe(longSheet.back.left);
    });
  });

  it("补白只在末帖尾部：5 页 + 3 空白，空白不得变成页码", () => {
    const result = impose(5, 8, LONG_EDGE);
    const sheets = result.signatures[0].sheets;
    expect(result.summary.blank_count).toBe(3);
    expect(sheets[0].front).toEqual({ left: null, right: 1 });
    expect(sheets[0].back).toEqual({ left: 2, right: null });
    expect(sheets[1].front).toEqual({ left: null, right: 3 });
    expect(sheets[1].back).toEqual({ left: 4, right: 5 });
    const audit = auditResult(result);
    expect(audit.everyPageOnce).toBe(true);
    expect(audit.blanksOnlyInTail).toBe(true);
  });

  it("多帖时页码加帖容量偏移（9 页 = 8 + 1）", () => {
    const result = impose(9, 8, LONG_EDGE);
    expect(result.summary.signature_count).toBe(2);
    const second = result.signatures[1];
    expect(second.offset).toBe(8);
    expect(second.sheets[0].front).toEqual({ left: null, right: 9 });
    const pages = flattenPlacedPages(result)
      .filter((cell) => cell.page !== null)
      .map((cell) => cell.page)
      .sort((a, b) => a - b);
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("16 页帖每帖 4 张纸", () => {
    const result = impose(16, 16, LONG_EDGE);
    expect(result.signatures[0].sheets).toHaveLength(4);
    expect(result.signatures[0].sheets[0].front).toEqual({
      left: 16,
      right: 1,
    });
  });

  it.each([
    [1],
    [7],
    [8],
    [9],
    [33],
    [2000],
  ])("总页数 %s：每个正文页恰好出现一次", (total) => {
    for (const size of [8, 16, 32]) {
      for (const flip of [LONG_EDGE, SHORT_EDGE]) {
        const result = impose(total, size, flip);
        const audit = auditResult(result);
        expect(audit.everyPageOnce).toBe(true);
        expect(audit.blanksOnlyInTail).toBe(true);
        expect(audit.placedCount).toBe(total);
        expect(audit.blankCount).toBe(
          result.summary.signature_count * size - total
        );
      }
    }
  });
});

describe("自动混合 8/16/32 容量 + 不可拆页段（与 pytest 同一套规则）", () => {
  it("重叠或相邻闭区间合并为升序页段", () => {
    expect(
      mergeIntervals([
        [17, 20],
        [16, 17],
      ])
    ).toEqual([
      [16, 20],
    ]);
    expect(
      mergeIntervals([
        [5, 8],
        [9, 12],
        [20, 24],
      ])
    ).toEqual([
      [5, 12],
      [20, 24],
    ]);
    expect(mergeIntervals([])).toEqual([]);
  });

  it("同成本候选决胜唯一：24 页上限 32，[16,8] 从前向后较大者胜", () => {
    expect(planAutoCapacities(24, 32, null)).toEqual([16, 8]);
    expect(planAutoCapacities(40, 32, null)).toEqual([32, 8]);
    expect(planAutoCapacities(48, 32, null)).toEqual([32,16]);
  });

  it("补白优先于书帖数：9 页选单帖 16，17 页选 [16,8]", () => {
    expect(planAutoCapacities(9, 32, null)).toEqual([16]);
    expect(planAutoCapacities(17, 32, null)).toEqual([16, 8]);
  });

  it("受保护页段迫使容量次序改变：段 16-17 阻断接缝后 [16,8]→[8,16]", () => {
    expect(planAutoCapacities(24, 32, [[16, 17]])).toEqual([8, 16]);
    expect(planAutoCapacities(24, 32, [[9, 17]])).toEqual([8, 16]);
    // 段末为 16：接缝在段外，不改变方案
    expect(planAutoCapacities(24, 32, [[9, 16]])).toEqual([16, 8]);
  });

  it("无解（全部候选被约束阻断）返回 null", () => {
    expect(planAutoCapacities(16, 8, [[5, 10]])).toBeNull();
    expect(planAutoCapacities(24, 16, [[7, 17]])).toBeNull();
  });

  it("自动模式结果：逐帖容量/偏移驱动同一套页位公式，补白与约束命中", () => {
    const result = impose(24, 32, LONG_EDGE, {
      autoMode: true,
      protectedSegments: [[9, 17]],
    });
    expect(result.auto_plan.capacities).toEqual([8, 16]);
    expect(result.signatures[0].offset).toBe(0);
    expect(result.signatures[1].offset).toBe(8);
    expect(result.signatures[0].padding).toBe(0);
    expect(result.signatures[1].padding).toBe(0);
    expect(result.signatures[0].protected_segments).toEqual([]);
    expect(result.signatures[1].protected_segments).toEqual([[9, 17]]);
    expect(result.summary.blank_count).toBe(0);
    expect(auditResult(result).everyPageOnce).toBe(true);
  });

  it("末帖补白：18 页段 9-17 → [8,16]，补白 6 且只在末帖尾部", () => {
    const result = impose(18, 32, LONG_EDGE, {
      autoMode: true,
      protectedSegments: [[9, 17]],
    });
    expect(result.auto_plan.capacities).toEqual([8, 16]);
    expect(result.summary.blank_count).toBe(6);
    expect(result.signatures[1].padding).toBe(6);
    expect(auditResult(result).blanksOnlyInTail).toBe(true);
  });

  it("短边翻转在混合容量下逐帖生效", () => {
    const result = impose(24, 32, SHORT_EDGE, {
      autoMode: true,
      protectedSegments: [[16, 17]],
    });
    const first = result.signatures[0].sheets[0];
    expect(first.front).toEqual({ left: 8, right: 1 });
    expect(first.back).toEqual({ left: 7, right: 2 });
    const secondFirst = result.signatures[1].sheets[0];
    // 16 页帖首纸：正 24|9，短边背 23|10
    expect(secondFirst.front).toEqual({ left: 24, right: 9 });
    expect(secondFirst.back).toEqual({ left: 23, right: 10 });
  });

  it("未启用自动模式时结构不含 auto 字段", () => {
    const result = impose(24, 32, LONG_EDGE);
    expect(result.auto_mode).toBeUndefined();
    expect(result.auto_plan).toBeUndefined();
    expect(result.signatures[0].padding).toBeUndefined();
    expect(result.signatures[0].protected_segments).toBeUndefined();
  });

  it("自动模式无解时抛出中文错误", () => {
    expect(() =>
      impose(16, 8, LONG_EDGE, {
        autoMode: true,
        protectedSegments: [[5, 10]],
      })
    ).toThrow(/无解/);
  });
});
