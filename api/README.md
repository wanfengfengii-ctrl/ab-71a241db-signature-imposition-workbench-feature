# API：书帖编排

实现在本目录 `app/imposition.py`（算法）、`app/validation.py`（校验）、
`app/main.py`（路由）。

## `GET /health`

```json
{ "status": "ok" }
```

## `POST /impose`

### 请求体

| 字段 | 类型 | 取值 |
|---|---|---|
| `total_pages` | int | 正文总页数，**1 – 2000** |
| `pages_per_signature` | int | 每帖页数，只能为 **8 / 16 / 32** |
| `flip` | string | **`long_edge`**（长边翻转）或 **`short_edge`**（短边翻转） |
| `special_pages` | string，可选 | 特种纸页码范围：逗号分隔的单页 / 闭区间，如 **`3,5-8`**；留空或不传即全部普通纸 |
| `auto_mode` | bool，可选 | **`true`** 启用自动混合容量；缺省或 `false` 时按固定每帖页数编排，响应保持原结构 |
| `unbreakable_segments` | string，可选 | 仅 `auto_mode=true` 时生效：逗号分隔的**闭区间**（如 `16-17,33-40`），重叠或相邻项自动合并；书帖边界不会落在任一页面段内部 |

```bash
curl -X POST http://localhost:8000/impose \
  -H 'Content-Type: application/json' \
  -d '{"total_pages": 5, "pages_per_signature": 8, "flip": "long_edge"}'
```

`special_pages` 规则：

- 单页 `3` 与闭区间 `5-8` 可混用，逗号分隔，允许空白字符；
- 重复页先归一化（`1,1,2-3,2` 等价于 `1,2,3`）；
- 格式错误、区间倒序（`5-3`）或页码超出 `1…total_pages` 时返回 422 字段错误；
- 不传、传 `null` 或空白串时按原参数编排，响应保持原结构（无 `material_plan`）。

`auto_mode` / `unbreakable_segments` 规则：

- `auto_mode` 缺省或为 `false` 时，`unbreakable_segments` 一律忽略，
  请求与响应与旧版完全一致；
- 启用后 `pages_per_signature` 视为**容量上限**，逐帖容量自动取
  `8/16/32` 中不超过上限的值，按正文顺序连续装入各帖：
  1. **补白总数最少**；
  2. 补白相同则**书帖数最少**；
  3. 仍相同则**容量序列从前向后较大者优先**（如 `24` 页上限 `32` 时
     `[16,8]` 胜于 `[8,16]`）——方案因此唯一；
- `unbreakable_segments` 只接受闭区间（如 `16-17`，单页 `16` 视为格式错误），
  重叠或相邻（首尾相接）项合并；区间倒序、越界、单段长度超过容量上限时
  返回 422 字段错误；
- 页段 `[a,b]` 覆盖书页 `a…b`，在其内部下刀的位置为 `a ≤ p < b`
  （段首页前、段末页后的接缝都在段外）；
- 约束合法但**全部候选方案都被阻断**（无可行容量序列）时返回
  `422 {"error": "planning_failed", ...}`，字段为 `unbreakable_segments`，
  消息为中文原因。

### 成功响应 `200 OK`

```json
{
  "total_pages": 5,
  "pages_per_signature": 8,
  "flip": "long_edge",
  "signatures": [
    {
      "index": 0,
      "offset": 0,
      "capacity": 8,
      "content_pages": 5,
      "sheets": [
        {
          "index": 0,
          "front": { "left": null, "right": 1 },
          "back":  { "left": 2,    "right": null }
        },
        {
          "index": 1,
          "front": { "left": null, "right": 3 },
          "back":  { "left": 4,    "right": 5 }
        }
      ]
    }
  ],
  "summary": {
    "signature_count": 1,
    "sheet_count": 2,
    "blank_count": 3
  }
}
```

约定：

- `front` / `back` 分别为每张纸的正面 / 背面，`left` / `right` 为左右页位；
- 页位值是**正文页码（从 1 开始）**；
- 补白页位为 **`null`**（JSON 中即 `null`），永远不会被赋予页码；
- `offset` 是该帖之前所有书帖的容量之和，页码 = 帖内位置 + `offset`；
- 短边翻转时，仅每张纸 `back` 的 `left`/`right` 互换。

### 材料计划（仅当传入 `special_pages`）

请求带上有效的 `special_pages` 后，每张纸新增 `material` 标记，顶层新增
`material_plan`；空白页位（`null`）不参与材料判断：

- `material`：**`normal`**（普通纸）/ **`special`**（特种纸，可整纸换料）/
  **`mixed`**（混纸冲突：同纸承载普通页与特种页，无法按当前编排换料生产）；
- `material_plan.special_pages`：归一化后的特种页码（升序、去重）；
- `material_plan.special_sheet_count` / `mixed_sheet_count`：换料纸张数 / 冲突纸张数；
- `material_plan.conflicts`：冲突明细，逐项给出 `signature_index`、
  `sheet_index` 及该纸上的 `special_pages` 与 `normal_pages`。

```json
{
  "total_pages": 8,
  "pages_per_signature": 8,
  "flip": "long_edge",
  "signatures": [
    {
      "index": 0,
      "offset": 0,
      "capacity": 8,
      "content_pages": 8,
      "sheets": [
        {
          "index": 0,
          "front": { "left": 8, "right": 1 },
          "back":  { "left": 2, "right": 7 },
          "material": "normal"
        },
        {
          "index": 1,
          "front": { "left": 6, "right": 3 },
          "back":  { "left": 4, "right": 5 },
          "material": "mixed"
        }
      ]
    }
  ],
  "summary": { "signature_count": 1, "sheet_count": 2, "blank_count": 0 },
  "material_plan": {
    "special_pages": [3, 4, 5],
    "special_sheet_count": 0,
    "mixed_sheet_count": 1,
    "conflicts": [
      {
        "signature_index": 0,
        "sheet_index": 1,
        "special_pages": [3, 4, 5],
        "normal_pages": [6]
      }
    ]
  }
}
```

### 自动混合容量（仅当 `auto_mode: true`）

启用后顶层新增 `auto_mode` 与 `auto_plan`；每帖新增 `padding`（该帖补白数）
与 `protected_segments`（完整落在该帖内、已合并的不可拆页段，形如
`[起点, 终点]`）。逐帖容量与累计 `offset` 仍驱动同一套页位公式，
`material_plan`（若同时传 `special_pages`）也由这一结果计算。

```json
{
  "total_pages": 24,
  "pages_per_signature": 32,
  "flip": "long_edge",
  "signatures": [
    {
      "index": 0,
      "offset": 0,
      "capacity": 8,
      "content_pages": 8,
      "padding": 0,
      "protected_segments": [],
      "sheets": [
        { "index": 0, "front": { "left": 8, "right": 1 }, "back": { "left": 2, "right": 7 } }
      ]
    },
    {
      "index": 1,
      "offset": 8,
      "capacity": 16,
      "content_pages": 16,
      "padding": 0,
      "protected_segments": [[16, 20]],
      "sheets": [
        { "index": 0, "front": { "left": 24, "right": 9 }, "back": { "left": 10, "right": 23 } }
      ]
    }
  ],
  "summary": { "signature_count": 2, "sheet_count": 6, "blank_count": 0 },
  "auto_mode": true,
  "auto_plan": {
    "max_capacity": 32,
    "candidate_capacities": [8, 16, 32],
    "protected_pages": [[16, 20]],
    "capacities": [8, 16],
    "blank_count": 0
  }
}
```

约定：

- `auto_plan.capacities` 为逐帖规划容量，`protected_pages` 为合并后的全部页段；
- 补白只出现在最后一帖尾部（空白位仍为 `null`），补白总数 = 末帖容量 − 末帖正文页数；
- 非末帖均恰好装满，任一帖容量不超过 `pages_per_signature`。

### 字段错误 `422 Unprocessable Entity`

任一输入为空、非整数（含字符串、浮点、布尔）、越界或取值不在允许集合内：

```json
{
  "error": "validation_failed",
  "fields": {
    "total_pages": "必须为 1 至 2000 的整数"
  }
}
```

`fields` 的键为出错字段（`total_pages` / `pages_per_signature` / `flip` /
`special_pages` / `auto_mode` / `unbreakable_segments`），可一次返回多个字段
错误；前端据此清除旧版面并逐字段提示。

不可拆页段**格式合法但约束阻断**（全部容量候选都被页段拦死）时，错误码为
`planning_failed`（同为 HTTP 422）：

```json
{
  "error": "planning_failed",
  "fields": {
    "unbreakable_segments": "自动容量规划在当前不可拆页段约束下无解"
  }
}
```
