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
| `auto_mode` | bool，可选 | **`true`** 时启用自动混合容量（`pages_per_signature` 作为容量上限）；缺省 / `false` 为固定模式 |
| `protected_segments` | string，可选 | 不可拆页段：逗号分隔的单页 / 闭区间，如 **`9-16,20-22`**；仅 `auto_mode` 为 `true` 时生效 |

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

`auto_mode` / `protected_segments` 规则：

- `auto_mode` 只接受布尔值；未启用（缺省 / `false`）时 `protected_segments`
  被忽略，请求与响应保持原结构（无 `auto_plan`）；
- 自动模式把 `pages_per_signature` 视为**容量上限**，候选为不超过上限的
  8 / 16 / 32；以正文顺序连续装入各帖（仅末帖补白），并按
  **补白最少 → 书帖数最少 → 容量序列从前向后较大者优先** 选出唯一的逐帖容量序列；
- 不可拆页段支持单页与闭区间混用，**重叠或相邻项先合并**；
  任何书帖边界（页码 p 与 p+1 之间）都不得落在合并后页段内部；
- 页段格式错误、区间倒序、越界、单段长度超过容量上限，
  或全部候选容量组合均被页段阻断时，返回 422 与 `protected_segments` 字段错误；
- 页段留空则不设约束，仍按自动模式规划容量。

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

### 自动容量规划（仅当 `auto_mode` 为 `true`）

自动模式下，每个书帖的 `capacity` 为规划选出的容量（不再全部等于
`pages_per_signature`），`offset` 为此前书帖容量之和；每帖新增
`blank_count`（该帖补白数）与 `protected_segments`（落在该帖内的不可拆
页段，即约束命中），顶层新增 `auto_plan`：

- `auto_plan.max_capacity` / `candidates`：容量上限与候选容量；
- `auto_plan.capacities`：选出的逐帖容量序列；
- `auto_plan.protected_segments`：归并后的不可拆页段（升序）。

```bash
curl -X POST http://localhost:8000/impose \
  -H 'Content-Type: application/json' \
  -d '{"total_pages": 24, "pages_per_signature": 32, "flip": "long_edge",
       "auto_mode": true, "protected_segments": "16-24"}'
```

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
      "sheets": ["…"],
      "blank_count": 0,
      "protected_segments": []
    },
    {
      "index": 1,
      "offset": 8,
      "capacity": 16,
      "content_pages": 16,
      "sheets": ["…"],
      "blank_count": 0,
      "protected_segments": [[16, 24]]
    }
  ],
  "summary": { "signature_count": 2, "sheet_count": 6, "blank_count": 0 },
  "auto_plan": {
    "max_capacity": 32,
    "candidates": [8, 16, 32],
    "capacities": [8, 16],
    "protected_segments": [[16, 24]]
  }
}
```

页段 `16-24` 禁止书帖边界落在 16…23：同为补白 0、两帖的 `[16, 8]` 被阻断，
唯一方案变为 `[8, 16]`。材料计划（`special_pages`）可与自动模式同时使用，
由同一结果计算。

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
`special_pages` / `auto_mode` / `protected_segments`），可一次返回多个字段错误；
前端据此清除旧版面并逐字段提示。
