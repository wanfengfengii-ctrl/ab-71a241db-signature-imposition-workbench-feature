import { expect, test } from "@playwright/test";

async function readDownload(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

async function submitForm(
  page,
  { total, size = "8", flip = "long_edge", special, auto = false, segments }
) {
  await page.getByTestId("input-total-pages").fill(total);
  await page.getByTestId("select-size").selectOption(size);
  await page.getByTestId("select-flip").selectOption(flip);
  const checkbox = page.getByTestId("checkbox-auto-mode");
  await checkbox.setChecked(auto);
  if (segments !== undefined) {
    await page.getByTestId("input-segments").fill(segments);
  }
  if (special !== undefined) {
    await page.getByTestId("input-special-pages").fill(special);
  }
  await page.getByTestId("submit-btn").click();
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
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-json").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      /^imposition-12p-16-long_edge\.json$/
    );
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const json = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
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

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-json").click(),
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const json = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
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

  test.describe("自动混合容量", () => {
    test("场景一：未勾选自动模式时版面与下载 JSON 保持原结构", async ({
      page,
    }) => {
      await submitForm(page, { total: "24", size: "32" });
      await expect(page.getByTestId("result-panel")).toBeVisible();
      await expect(page.getByTestId("auto-plan")).toHaveCount(0);
      await expect(page.getByTestId("sig-auto")).toHaveCount(0);
      const cards = page.getByTestId("signature-card");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("容量 32");
      await expect(page.getByTestId("summary-blanks")).toContainText("8 处");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("download-json").click(),
      ]);
      const json = await readDownload(download);
      expect(json.auto_mode).toBeUndefined();
      expect(json.auto_plan).toBeUndefined();
    });

    test("场景二：24 页上限 32 同成本候选决胜唯一，选 [16,8]", async ({
      page,
    }) => {
      await submitForm(page, { total: "24", size: "32", auto: true });

      await expect(page.getByTestId("auto-plan")).toBeVisible();
      await expect(page.getByTestId("auto-capacities")).toContainText(
        "16、8"
      );
      await expect(page.getByTestId("auto-protected")).toContainText("无");
      await expect(page.getByTestId("summary-signatures")).toContainText(
        "2 帖"
      );
      await expect(page.getByTestId("summary-blanks")).toContainText("0 处");

      const cards = page.getByTestId("signature-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toContainText("规划容量 16");
      await expect(cards.nth(1)).toContainText("规划容量 8");
      // 逐帖补白
      const padding = page.getByTestId("sig-padding");
      await expect(padding.nth(0)).toContainText("0 处");
      await expect(padding.nth(1)).toContainText("0 处");
      // 无约束命中
      await expect(page.getByTestId("sig-protected-hit")).toHaveCount(0);
      // 页码唯一、无自检失败
      await expect(page.locator(".check.bad")).toHaveCount(0);

      // 第二帖为 8 页容量、帖偏移 16：首纸正面 24|17，背面 18|23
      const secondFirstRow = cards.nth(1).locator("tr[data-sheet='0']");
      await expect(
        secondFirstRow.getByTestId("cell-front-left")
      ).toHaveText("24");
      await expect(
        secondFirstRow.getByTestId("cell-front-right")
      ).toHaveText("17");
      await expect(
        secondFirstRow.getByTestId("cell-back-left")
      ).toHaveText("18");
      await expect(
        secondFirstRow.getByTestId("cell-back-right")
      ).toHaveText("23");
    });

    test("场景三：受保护页段 16-17 迫使容量次序改为 [8,16]，逐帖显示约束命中", async ({
      page,
    }) => {
      await submitForm(page, {
        total: "24",
        size: "32",
        auto: true,
        segments: "17-20,16-17",
      });

      await expect(page.getByTestId("auto-capacities")).toContainText("8、16");
      // 相邻/重叠项已合并为 16-20
      await expect(page.getByTestId("auto-protected")).toContainText("16-20");

      const cards = page.getByTestId("signature-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toContainText("规划容量 8");
      await expect(cards.nth(1)).toContainText("规划容量 16");

      // 第一帖无约束命中，第二帖命中 16-20
      await expect(cards.nth(0).getByTestId("sig-protected-hit")).toHaveCount(
        0
      );
      const hit = cards.nth(1).getByTestId("sig-protected-hit");
      await expect(hit).toHaveText("16-20");

      // 第一帖首纸仍为 8|1 / 2|7
      const firstRow = cards.nth(0).locator("tr[data-sheet='0']");
      await expect(firstRow.getByTestId("cell-front-left")).toHaveText("8");
      await expect(firstRow.getByTestId("cell-front-right")).toHaveText("1");
      await expect(page.locator(".check.bad")).toHaveCount(0);

      // 下载 JSON 与当前画面一致
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("download-json").click(),
      ]);
      const json = await readDownload(download);
      expect(json.auto_plan.capacities).toEqual([8, 16]);
      expect(json.auto_plan.protected_pages).toEqual([[16, 20]]);
      expect(json.signatures[1].protected_segments).toEqual([[16, 20]]);
      expect(json.signatures[0].padding).toBe(0);
      expect(json.signatures[1].padding).toBe(0);
    });

    test("受保护段下末帖补白：18 页段 9-17 选 [8,16]，补白 6 且仅在末帖", async ({
      page,
    }) => {
      await submitForm(page, {
        total: "18",
        size: "32",
        auto: true,
        segments: "9-17",
      });
      await expect(page.getByTestId("auto-capacities")).toContainText("8、16");
      await expect(page.getByTestId("summary-blanks")).toContainText("6 处");
      const cards = page.getByTestId("signature-card");
      await expect(cards.nth(1).getByTestId("sig-padding")).toContainText(
        "6 处"
      );
      // 第一帖无空白；空白全部位于最后一帖
      await expect(
        cards.nth(0).locator(".blank")
      ).toHaveCount(0);
      await expect(cards.nth(1).locator(".blank")).toHaveCount(6);
      await expect(page.locator(".check.bad")).toHaveCount(0);
    });

    test("自动模式与材料计划同时生效（同一结果计算冲突）", async ({
      page,
    }) => {
      await submitForm(page, {
        total: "24",
        size: "32",
        auto: true,
        segments: "16-17",
        special: "1,17",
      });
      await expect(page.getByTestId("auto-capacities")).toContainText("8、16");
      await expect(page.getByTestId("material-plan")).toBeVisible();
      // 第一帖首纸 {8,1,2,7}：特种页 1 混纸
      const firstCard = page.getByTestId("signature-card").nth(0);
      const mixedRow = firstCard.locator("tr.is-mixed");
      await expect(mixedRow).toHaveCount(1);
      await expect(
        mixedRow.getByTestId("cell-material")
      ).toHaveText("混纸冲突");

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("download-json").click(),
      ]);
      const json = await readDownload(download);
      expect(json.auto_plan.capacities).toEqual([8, 16]);
      expect(json.material_plan.special_pages).toEqual([1, 17]);
      expect(json.material_plan.conflicts[0].signature_index).toBe(0);
    });

    test("场景四：全部候选被约束阻断时返回中文无解原因并清除旧结果", async ({
      page,
    }) => {
      // 先得到一个正常结果
      await submitForm(page, { total: "24", size: "32", auto: true });
      await expect(page.getByTestId("result-panel")).toBeVisible();

      // 上限 8、段 5-10 横跨唯一下刀位置 → 无解
      await submitForm(page, {
        total: "16",
        size: "8",
        auto: true,
        segments: "5-10",
      });
      await expect(page.getByTestId("result-panel")).not.toBeAttached();
      // 错误提示位于不可拆页段字段下方
      await expect(page.locator(".field-error").first()).toContainText("无解");

      // 非法格式同样 422 清屏
      await submitForm(page, {
        total: "16",
        size: "8",
        auto: true,
        segments: "abc",
      });
      await expect(page.getByTestId("result-panel")).not.toBeAttached();
      await expect(page.locator(".field-error").first()).toContainText("格式");

      // 倒序
      await submitForm(page, {
        total: "16",
        size: "8",
        auto: true,
        segments: "10-5",
      });
      await expect(page.locator(".field-error").first()).toContainText("倒序");

      // 单段超过容量上限
      await submitForm(page, {
        total: "48",
        size: "16",
        auto: true,
        segments: "1-20",
      });
      await expect(page.locator(".field-error").first()).toContainText(
        "超过容量上限"
      );
    });

    test("关闭自动模式后恢复固定每帖页数，结果随之刷新", async ({
      page,
    }) => {
      await submitForm(page, { total: "24", size: "32", auto: true });
      await expect(page.getByTestId("auto-capacities")).toContainText("16、8");

      // 取消勾选即清除旧版面
      await page.getByTestId("checkbox-auto-mode").setChecked(false);
      await expect(page.getByTestId("result-panel")).not.toBeAttached();
      await expect(page.getByTestId("input-segments")).not.toBeAttached();

      // 重新提交走固定模式
      await page.getByTestId("submit-btn").click();
      const cards = page.getByTestId("signature-card");
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText("容量 32");
      await expect(page.getByTestId("auto-plan")).toHaveCount(0);
    });
  });
});
