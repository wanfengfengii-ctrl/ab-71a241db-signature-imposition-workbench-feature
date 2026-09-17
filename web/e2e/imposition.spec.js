import { expect, test } from "@playwright/test";

async function submitForm(
  page,
  { total, size = "8", flip = "long_edge", special, auto, segments }
) {
  await page.getByTestId("input-total-pages").fill(total);
  await page.getByTestId("select-size").selectOption(size);
  await page.getByTestId("select-flip").selectOption(flip);
  if (special !== undefined) {
    await page.getByTestId("input-special-pages").fill(special);
  }
  if (auto) {
    await page.getByTestId("toggle-auto").check();
    if (segments !== undefined) {
      await page.getByTestId("input-protected-segments").fill(segments);
    }
  }
  await page.getByTestId("submit-btn").click();
}

async function downloadJson(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-json").click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { download, json: JSON.parse(Buffer.concat(chunks).toString("utf-8")) };
}

test.describe("骑马订书帖编排页面", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("8 页长边翻转：按帖展示两张纸，正背面页位与规则一致", async ({ page }) => {
    await submitForm(page, { total: "8" });

    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("signature-card")).toHaveCount(1);

    const firstRow = page.locator("tr[data-sheet='0']");
    await expect(firstRow.getByTestId("cell-front-left")).toHaveText("8");
    await expect(firstRow.getByTestId("cell-front-right")).toHaveText("1");
    await expect(firstRow.getByTestId("cell-back-left")).toHaveText("2");
    await expect(firstRow.getByTestId("cell-back-right")).toHaveText("7");

    const secondRow = page.locator("tr[data-sheet='1']");
    await expect(secondRow.getByTestId("cell-front-left")).toHaveText("6");
    await expect(secondRow.getByTestId("cell-front-right")).toHaveText("3");
    await expect(secondRow.getByTestId("cell-back-left")).toHaveText("4");
    await expect(secondRow.getByTestId("cell-back-right")).toHaveText("5");

    // 自检：1..8 各一次、无空白
    await expect(page.getByTestId("audit")).toContainText("恰好出现一次");
    await expect(page.locator(".check.bad")).toHaveCount(0);
    await expect(page.getByTestId("summary-blanks")).toContainText("0 处");
  });

  test("短边翻转交换背面左右，正面保持不变", async ({ page }) => {
    await submitForm(page, { total: "8", flip: "short_edge" });
    const firstRow = page.locator("tr[data-sheet='0']");
    await expect(firstRow.getByTestId("cell-front-left")).toHaveText("8");
    await expect(firstRow.getByTestId("cell-front-right")).toHaveText("1");
    await expect(firstRow.getByTestId("cell-back-left")).toHaveText("7");
    await expect(firstRow.getByTestId("cell-back-right")).toHaveText("2");
    await expect(page.getByTestId("audit")).toContainText("背面左右已交换");
  });

  test("5 页：补白 3 处且只落在末帖尾部，显示为空白而非页码", async ({ page }) => {
    await submitForm(page, { total: "5" });
    await expect(page.getByTestId("summary-blanks")).toContainText("3 处");
    const firstRow = page.locator("tr[data-sheet='0']");
    await expect(firstRow.getByTestId("cell-front-left")).toHaveText("空白");
    await expect(firstRow.getByTestId("cell-back-right")).toHaveText("空白");
    // 正文 5 页均在版面上
    for (const n of [1, 2, 3, 4, 5]) {
      await expect(page.getByRole("cell", { exact: true, name: String(n) }).first()).toBeVisible();
    }
    await expect(page.locator(".check.bad")).toHaveCount(0);
  });

  test("多帖：9 页两帖，第二帖页码从 9 起并带 7 处空白", async ({ page }) => {
    await submitForm(page, { total: "9" });
    await expect(page.getByTestId("signature-card")).toHaveCount(2);
    await expect(page.getByTestId("summary-signatures")).toContainText("2 帖");
    const secondCard = page.getByTestId("signature-card").nth(1);
    await expect(secondCard).toContainText("第 2 帖");
    await expect(secondCard).toContainText("9");
    await expect(secondCard.locator(".blank")).toHaveCount(7);
  });

  test("非法输入返回字段错误并清除旧版面", async ({ page }) => {
    await submitForm(page, { total: "8" });
    await expect(page.getByTestId("result-panel")).toBeVisible();

    await submitForm(page, { total: "12.5" });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toBeVisible();

    // 越界
    await submitForm(page, { total: "2001" });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText("1 至 2000");

    // 清空输入：旧版面立即消失
    await submitForm(page, { total: "8" });
    await page.getByTestId("input-total-pages").fill("");
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
  });

  test("下载按钮导出与页面同内容的 JSON 文件", async ({ page }) => {
    await submitForm(page, { total: "12", size: "16", flip: "long_edge" });
    const { download, json } = await downloadJson(page);
    expect(download.suggestedFilename()).toMatch(
      /^imposition-12p-16-long_edge\.json$/
    );
    expect(json.total_pages).toBe(12);
    expect(json.pages_per_signature).toBe(16);
    expect(json.signatures).toHaveLength(1);
    expect(json.summary.blank_count).toBe(4);
  });

  test("未填写特种纸范围：保持原版面，不出现材料标记", async ({ page }) => {
    await submitForm(page, { total: "8" });
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("material-plan")).toHaveCount(0);
    await expect(page.getByTestId("cell-material")).toHaveCount(0);
    await expect(page.locator("th", { hasText: "材料" })).toHaveCount(0);
  });

  test("有效换料：整纸特种标记、汇总换料数，下载 JSON 含材料计划", async ({
    page,
  }) => {
    await submitForm(page, { total: "8", special: "1,2,7-8" });

    await expect(page.getByTestId("material-plan")).toBeVisible();
    await expect(page.getByTestId("summary-special-sheets")).toContainText(
      "1 张"
    );
    await expect(page.getByTestId("summary-mixed-sheets")).toContainText(
      "0 张"
    );
    await expect(page.getByTestId("no-conflict")).toBeVisible();
    await expect(page.getByTestId("conflict-list")).toHaveCount(0);

    const materials = page.getByTestId("cell-material");
    await expect(materials).toHaveCount(2);
    await expect(materials.nth(0)).toHaveText("特种纸");
    await expect(materials.nth(0)).toHaveAttribute("data-material", "special");
    await expect(materials.nth(1)).toHaveText("普通纸");
    await expect(materials.nth(1)).toHaveAttribute("data-material", "normal");

    const { json } = await downloadJson(page);
    expect(json.material_plan.special_pages).toEqual([1, 2, 7, 8]);
    expect(json.material_plan.special_sheet_count).toBe(1);
    expect(json.material_plan.mixed_sheet_count).toBe(0);
    expect(json.material_plan.conflicts).toEqual([]);
    expect(json.signatures[0].sheets[0].material).toBe("special");
    expect(json.signatures[0].sheets[1].material).toBe("normal");
  });

  test("混纸冲突：突出对应帖、纸张及两类页码", async ({ page }) => {
    await submitForm(page, { total: "8", special: "3-5" });

    await expect(page.getByTestId("summary-mixed-sheets")).toContainText(
      "1 张"
    );
    await expect(page.getByTestId("summary-special-sheets")).toContainText(
      "0 张"
    );

    // 冲突明细：第 1 帖第 2 张纸，特种页 3/4/5，普通页 6
    const conflicts = page.getByTestId("conflict-item");
    await expect(conflicts).toHaveCount(1);
    await expect(conflicts.first()).toContainText("第 1 帖");
    await expect(conflicts.first()).toContainText("第 2 张纸");
    await expect(conflicts.first().locator(".special-pages")).toHaveText(
      "3、4、5"
    );
    await expect(conflicts.first().locator(".normal-pages")).toHaveText("6");

    // 对应帖与纸张行被突出
    await expect(page.getByTestId("signature-card").first()).toHaveClass(
      /has-conflict/
    );
    const mixedRow = page.locator("tr.is-mixed");
    await expect(mixedRow).toHaveCount(1);
    await expect(mixedRow.getByTestId("cell-material")).toHaveText("混纸冲突");

    // 两类页码在冲突行内分别标出，空白位不参与
    const specialCells = mixedRow.locator('[data-material-role="special"]');
    await expect(specialCells).toHaveCount(3);
    await expect(specialCells).toHaveText(["3", "4", "5"]);
    const normalCells = mixedRow.locator('[data-material-role="normal"]');
    await expect(normalCells).toHaveCount(1);
    await expect(normalCells).toHaveText(["6"]);
  });

  test("非法特种纸范围：字段报中文错误并清除旧结果", async ({ page }) => {
    await submitForm(page, { total: "8", special: "1,2,7-8" });
    await expect(page.getByTestId("material-plan")).toBeVisible();

    // 倒序区间
    await submitForm(page, { total: "8", special: "5-3" });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText("倒序");

    // 超出正文页数
    await submitForm(page, { total: "8", special: "9" });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText(
      "1 至 8"
    );

    // 格式错误
    await submitForm(page, { total: "8", special: "abc" });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText("格式");

    // 改回合法范围后结果恢复
    await submitForm(page, { total: "8", special: "1,2,7-8" });
    await expect(page.getByTestId("material-plan")).toBeVisible();
  });
});

test.describe("自动混合容量 + 不可拆页段", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("未启用自动模式：不出现自动规划信息", async ({ page }) => {
    await submitForm(page, { total: "24", size: "32" });
    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("auto-plan")).toHaveCount(0);
    await expect(page.getByTestId("sig-blanks")).toHaveCount(0);
    await expect(page.getByTestId("sig-protected")).toHaveCount(0);
    await expect(page.getByTestId("summary-mode")).toContainText("每帖 32 页");
  });

  test("同成本候选决胜唯一：24 页上限 32 → 16 → 8，补白 0", async ({ page }) => {
    await submitForm(page, { total: "24", size: "32", auto: true });

    await expect(page.getByTestId("result-panel")).toBeVisible();
    await expect(page.getByTestId("auto-plan")).toBeVisible();
    await expect(page.getByTestId("plan-capacities")).toContainText("16 → 8");
    await expect(page.getByTestId("plan-segments")).toContainText("无");
    await expect(page.getByTestId("summary-mode")).toContainText(
      "容量上限 32 页"
    );

    const cards = page.getByTestId("signature-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("容量 16");
    await expect(cards.nth(1)).toContainText("容量 8");
    await expect(cards.nth(0).getByTestId("sig-blanks")).toContainText(
      "补白 0 处"
    );
    await expect(cards.nth(1).getByTestId("sig-blanks")).toContainText(
      "补白 0 处"
    );
    await expect(page.getByTestId("summary-blanks")).toContainText("0 处");

    // 页码唯一性自检全部通过
    await expect(page.locator(".check.bad")).toHaveCount(0);

    // 下载 JSON 与当前画面一致
    const { download, json } = await downloadJson(page);
    expect(download.suggestedFilename()).toMatch(
      /^imposition-24p-auto32-long_edge\.json$/
    );
    expect(json.auto_plan.capacities).toEqual([16, 8]);
    expect(json.signatures[0].capacity).toBe(16);
    expect(json.signatures[1].capacity).toBe(8);
    expect(json.summary.blank_count).toBe(0);
  });

  test("受保护页段迫使容量次序改变：24 页 + 页段 16-24 → 8 → 16", async ({
    page,
  }) => {
    await submitForm(page, {
      total: "24",
      size: "32",
      auto: true,
      segments: "16-24",
    });

    await expect(page.getByTestId("plan-capacities")).toContainText("8 → 16");
    await expect(page.getByTestId("plan-segments")).toContainText("16-24");

    const cards = page.getByTestId("signature-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("容量 8");
    await expect(cards.nth(1)).toContainText("容量 16");
    // 约束命中情况逐帖标注：页段落在第 2 帖
    await expect(cards.nth(0).getByTestId("sig-protected")).toHaveCount(0);
    await expect(cards.nth(1).getByTestId("sig-protected")).toContainText(
      "16-24"
    );
    await expect(page.locator(".check.bad")).toHaveCount(0);

    const { json } = await downloadJson(page);
    expect(json.auto_plan.capacities).toEqual([8, 16]);
    expect(json.auto_plan.protected_segments).toEqual([[16, 24]]);
    expect(json.signatures[1].protected_segments).toEqual([[16, 24]]);
  });

  test("末帖补白：33 页 → 32 → 8，补白 7 处只在末帖", async ({ page }) => {
    await submitForm(page, { total: "33", size: "32", auto: true });

    await expect(page.getByTestId("plan-capacities")).toContainText("32 → 8");
    const cards = page.getByTestId("signature-card");
    await expect(cards.nth(0).getByTestId("sig-blanks")).toContainText(
      "补白 0 处"
    );
    await expect(cards.nth(1).getByTestId("sig-blanks")).toContainText(
      "补白 7 处"
    );
    await expect(cards.nth(0).locator(".blank")).toHaveCount(0);
    await expect(cards.nth(1).locator(".blank")).toHaveCount(7);
    await expect(page.getByTestId("summary-blanks")).toContainText("7 处");
    await expect(page.locator(".check.bad")).toHaveCount(0);
  });

  test("自动模式下材料计划照常计算", async ({ page }) => {
    await submitForm(page, {
      total: "24",
      size: "32",
      auto: true,
      special: "1,2,15-16",
    });

    await expect(page.getByTestId("auto-plan")).toBeVisible();
    await expect(page.getByTestId("material-plan")).toBeVisible();
    await expect(page.getByTestId("summary-special-sheets")).toContainText(
      "1 张"
    );
    await expect(page.getByTestId("summary-mixed-sheets")).toContainText(
      "0 张"
    );
    await expect(page.getByTestId("no-conflict")).toBeVisible();

    const { json } = await downloadJson(page);
    expect(json.auto_plan.capacities).toEqual([16, 8]);
    expect(json.material_plan.special_sheet_count).toBe(1);
    expect(json.signatures[0].sheets[0].material).toBe("special");
  });

  test("非法或无解页段：字段报中文错误并清除旧结果", async ({ page }) => {
    await submitForm(page, { total: "24", size: "32", auto: true });
    await expect(page.getByTestId("auto-plan")).toBeVisible();

    // 倒序区间
    await submitForm(page, {
      total: "24",
      size: "32",
      auto: true,
      segments: "20-16",
    });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText("倒序");

    // 超出正文页数
    await submitForm(page, {
      total: "24",
      size: "32",
      auto: true,
      segments: "9-40",
    });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText(
      "1 至 24"
    );

    // 单段长度超过容量上限
    await submitForm(page, {
      total: "24",
      size: "16",
      auto: true,
      segments: "1-20",
    });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText(
      "容量上限"
    );

    // 全部候选均被约束阻断
    await submitForm(page, {
      total: "16",
      size: "8",
      auto: true,
      segments: "3-10",
    });
    await expect(page.getByTestId("result-panel")).not.toBeAttached();
    await expect(page.locator(".field-error").first()).toContainText("阻断");

    // 改回合法输入后结果恢复
    await submitForm(page, { total: "24", size: "32", auto: true });
    await expect(page.getByTestId("auto-plan")).toBeVisible();
  });
});
