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
`special_pages`），可一次返回多个字段错误；前端据此清除旧版面并逐字段提示。
