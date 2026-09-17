# 骑马订书帖编排（Saddle-stitched Imposition）

骑马订样册送印前，连续页码必须拆进若干**书帖**，并落到每张纸的**正反面与左右页位**。
本仓库只实现“**书帖编排**”这一条纵向链路：用户输入 → FastAPI 编排 → React 按帖展示 →
同内容 JSON 下载，并用 pytest / Vitest / Playwright 三层测试覆盖同一套规则。

## 目录结构

```
.
├── api/                  FastAPI 后端
│   ├── app/
│   │   ├── imposition.py     # 编排核心算法（规则唯一实现）
│   │   ├── validation.py     # 字段级严格校验
│   │   └── main.py           # POST /impose、GET /health
│   ├── tests/                # pytest
│   ├── Dockerfile
│   └── requirements.txt
├── web/                  React + Vite 前端
│   ├── src/
│   │   ├── lib/imposition.js # 规则的前端镜像（仅用于自测/自检，展示以 API 为准）
│   │   ├── lib/api.js        # 调用 API + JSON 下载
│   │   └── App.jsx           # 表单 + 按帖展示全部纸张
│   ├── e2e/                  # Playwright（真实 web+api 联调）
│   ├── nginx.conf            # 容器内 /api/* 反代到 api 服务
│   └── Dockerfile
├── verify/               一次性验收服务（pytest + Vitest + Playwright）
│   ├── Dockerfile
│   └── run.sh
└── docker-compose.yml
```

## 编排规则（每帖独立处理）

1. 若正文页数不能被书帖容量整除，在**正文末尾补空白位**至该帖容量；
   空白位用 `null` 表示，**不会变成页码**。
2. 令帖内位置从 **1** 开始，`N` 为该帖容量，纸张序号 `k` 从 0 递增：

   | 面 / 页位 | 帖内位置 |
   |---|---|
   | 正面左 | `N − 2k` |
   | 正面右 | `1 + 2k` |
   | 背面左（长边） | `2 + 2k` |
   | 背面右（长边） | `N − 1 − 2k` |

3. **长边翻转**保持背面次序；**短边翻转**交换每张纸背面的左右页位。
4. 帖内位置再加**此前书帖容量偏移**（第 1 帖 +0，其后逐帖累加容量）即得正文页码。

因此 8 页一帖、长边翻转时：第 1 张纸为 `8|1`（正）/ `2|7`（背），
第 2 张纸为 `6|3`（正）/ `4|5`（背）。短边翻转只把背面换成 `7|2`、`5|4`。

### 自动混合容量（可选）

折页或连版插图所在页段不能跨书帖时，可切换**自动模式**并录入**不可拆页段**：

- 当前每帖页数视为**容量上限**，候选容量为不超过上限的 8 / 16 / 32；
- 以正文顺序连续装入各帖（仅末帖补白），**任何书帖边界都不落在不可拆页段内部**；
- 按 **补白最少 → 书帖数最少 → 容量序列从前向后较大者优先** 选出唯一方案；
- 页段用逗号分隔的闭区间录入（如 `9-16,20-22`），**重叠或相邻项先合并**；
- 选出的逐帖容量与累计偏移驱动上面的同一套页位公式，材料标记与冲突
  也由同一结果计算；页面逐帖显示规划容量、补白与约束命中情况；
- 区间倒序、越界、单段长度超过容量上限，或全部候选均被约束阻断时，
  返回该字段的中文错误，页面清除旧结果。

未启用自动模式时，请求与响应保持原结构（固定每帖页数）。

## 用 Docker Compose 启动

```bash
docker compose up --build
# Web:  http://localhost:8080
# API:  http://localhost:8000  （文档 /docs）
```

宿主端口可用环境变量覆盖：

```bash
WEB_PORT=9090 API_PORT=9000 docker compose up --build
```

## 一次性验收（verify 服务）

`verify` 是一次性服务：自动等待 web/api 就绪，依次运行 pytest、Vitest、Playwright，
全部成功后退出（退出码 0）。

```bash
docker compose --profile verify up --build verify
```

## 本机开发（不使用 Docker）

```bash
# API（需要 fastapi/uvicorn/httpx/pytest）
cd api && uvicorn app.main:app --port 8123

# Web（Vite dev/preview 会把 /api 代理到 127.0.0.1:8123）
cd web && npm install && npm run dev      # http://127.0.0.1:5173

# 测试
cd api && pytest
cd web && npx vitest run
cd web && npx playwright test             # 需先在 :8123 启动 API
```

## 输入约束与错误行为

| 字段 | 要求 |
|---|---|
| `total_pages` | 1 至 2000 的整数 |
| `pages_per_signature` | 只能为 `8`、`16` 或 `32` |
| `flip` | `long_edge`（长边）或 `short_edge`（短边） |
| `special_pages` | 可选；逗号分隔的单页 / 闭区间（如 `3,5-8`），重复页先归一化 |
| `auto_mode` | 可选；布尔值，`true` 时启用自动混合容量 |
| `protected_segments` | 可选；仅自动模式生效，逗号分隔的闭区间（如 `9-16,20-22`），重叠或相邻项先合并 |

任一输入**为空、非整数、越界或取值不在集合内**：API 返回 HTTP 422 与字段错误，
页面**清除旧版面**并在对应字段下显示中文错误。`special_pages` 格式错误、
区间倒序或超出正文页数时同样返回该字段的中文错误；留空则不参与编排。
`protected_segments` 格式错误、区间倒序、越界、单段长度超过容量上限，
或全部候选容量均被页段阻断时，同样返回该字段的中文错误。

成功后页面：按帖展示**全部纸张**的正背面与左右页位（空白位标记为“空白”），
可一键**下载与页面同内容的 JSON**；并给出印前自检——每个正文页 `1…N` 恰好出现一次
（无倒页/重页/漏页），补白只位于最后一帖尾部，印前员可直接区分正背面与翻转结果。

填写 `special_pages` 后，结果按纸张给出材料标记——**普通纸 / 特种纸（可整纸换料）
/ 混纸冲突**，并汇总可换料纸张数与冲突明细（帖、纸张及该纸上的特种页与普通页，
空白页位不参与判断）；混纸冲突的帖与纸张会突出显示，下载的 JSON 含同一份
`material_plan`。

请求 / 响应结构详见 [`api/README.md`](./api/README.md)。
