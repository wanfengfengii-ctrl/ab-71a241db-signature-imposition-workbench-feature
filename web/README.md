# Web：骑马订书帖编排页面

React 18 + Vite。页面只做“书帖编排”一条链路：

- 表单输入**正文总页数**（1–2000 整数）、**每帖页数**（8/16/32）、
  **翻转方式**（长边/短边），可选填**特种纸页码范围**（如 `3,5-8`），
  提交到 `POST /api/impose`；范围留空时请求不带该字段；
- 成功后**按帖展示全部纸张**，每张纸列出正面/背面 × 左/右四个页位，
  补白页位显示“空白”（永不为页码）；
- 填了特种纸范围时，结果附**材料计划**：每张纸标记普通纸 / 特种纸 /
  混纸冲突，汇总可换料纸张数，混纸冲突的帖、纸张及两类页码会突出显示；
- “下载 JSON”导出的就是 API 返回的**同内容** JSON（含 `material_plan`，
  `src/lib/api.js` 的 `downloadResultJson`）；
- 任一字段返回 422 时**清除旧版面**并逐字段显示错误；输入框被清空时也立即清版面。

## 请求结构

见仓库根 [`../api/README.md`](../api/README.md)。前端固定发：

```json
{ "total_pages": 12, "pages_per_signature": 8, "flip": "long_edge" }
```

填写特种纸范围时追加 `"special_pages": "3,5-8"`。

页面所有展示以 API 返回为准；`src/lib/imposition.js` 中保留了一份规则镜像，
仅用于 Vitest 与页面上的印前自检（每页恰好一次、补白只在末帖尾部）。

## 开发

```bash
npm install
npm run dev        # http://127.0.0.1:5173 ，/api 代理到 127.0.0.1:8123
npm run test       # Vitest（编排规则）
npx playwright test   # E2E，需先在本机 :8123 启动 API
```
