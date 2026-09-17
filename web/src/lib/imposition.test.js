import { describe, expect, it } from "vitest";

import {
  LONG_EDGE,
  SHORT_EDGE,
  auditResult,
  flattenPlacedPages,
  impose,
  planCapacities,
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

describe("自动混合容量 + 不可拆页段（与 pytest 同一套规则）", () => {
  it("同成本候选决胜唯一：24 页上限 32 → 16 → 8", () => {
    // 补白 0 且 2 帖的候选为 [8,16] 与 [16,8]，容量序列从前向后较大者优先
    expect(planCapacities(24, 32, [])).toEqual([16, 8]);
    expect(planCapacities(40, 32, [])).toEqual([32, 8]);
    expect(planCapacities(33, 32, [])).toEqual([32, 8]);
    expect(planCapacities(8, 32, [])).toEqual([8]);
    expect(planCapacities(24, 8, [])).toEqual([8, 8, 8]);
  });

  it("受保护页段迫使容量次序改变：24 页 + 页段 16-24 → 8 → 16", () => {
    expect(planCapacities(24, 32, [[16, 24]])).toEqual([8, 16]);
  });

  it("全部候选被页段阻断时返回 null", () => {
    expect(planCapacities(16, 8, [[3, 10]])).toBeNull();
  });

  it("自动模式结果：逐帖容量与累计偏移驱动原页位公式", () => {
    const result = impose(24, 32, LONG_EDGE, []);
    expect(result.auto_plan.capacities).toEqual([16, 8]);
    const [first, second] = result.signatures;
    expect(first.capacity).toBe(16);
    expect(first.offset).toBe(0);
    expect(first.sheets[0].front).toEqual({ left: 16, right: 1 });
    expect(first.sheets[0].back).toEqual({ left: 2, right: 15 });
    expect(second.capacity).toBe(8);
    expect(second.offset).toBe(16);
    expect(second.sheets[0].front).toEqual({ left: 24, right: 17 });
    expect(second.sheets[0].back).toEqual({ left: 18, right: 23 });
    expect(first.blank_count).toBe(0);
    expect(second.blank_count).toBe(0);
    expect(result.summary.blank_count).toBe(0);
    const audit = auditResult(result);
    expect(audit.everyPageOnce).toBe(true);
    expect(audit.blanksOnlyInTail).toBe(true);
  });

  it("约束命中逐帖标注：页段 16-24 落在第 2 帖", () => {
    const result = impose(24, 32, LONG_EDGE, [[16, 24]]);
    expect(result.auto_plan.capacities).toEqual([8, 16]);
    expect(result.auto_plan.protected_segments).toEqual([[16, 24]]);
    expect(result.signatures[0].protected_segments).toEqual([]);
    expect(result.signatures[1].protected_segments).toEqual([[16, 24]]);
    expect(auditResult(result).everyPageOnce).toBe(true);
  });

  it("末帖补白：33 页 → 32 → 8，补白 7 处只在末帖", () => {
    const result = impose(33, 32, LONG_EDGE, []);
    expect(result.auto_plan.capacities).toEqual([32, 8]);
    expect(result.signatures[0].blank_count).toBe(0);
    expect(result.signatures[1].blank_count).toBe(7);
    expect(result.summary.blank_count).toBe(7);
    const audit = auditResult(result);
    expect(audit.everyPageOnce).toBe(true);
    expect(audit.blanksOnlyInTail).toBe(true);
  });

  it.each([[1], [7], [24], [33], [2000]])(
    "自动模式总页数 %s：每个正文页恰好出现一次",
    (total) => {
      for (const size of [8, 16, 32]) {
        for (const flip of [LONG_EDGE, SHORT_EDGE]) {
          const result = impose(total, size, flip, []);
          const audit = auditResult(result);
          expect(audit.everyPageOnce).toBe(true);
          expect(audit.blanksOnlyInTail).toBe(true);
          expect(audit.blankCount).toBe(
            result.auto_plan.capacities.reduce((sum, c) => sum + c, 0) - total
          );
        }
      }
    }
  );
});
