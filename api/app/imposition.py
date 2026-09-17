"""骑马订书帖编排核心算法。

规则（每个书帖独立处理，帖内位置从 1 开始）：

1. 若正文页数不能被书帖容量整除，在正文末尾补空白位至最后一帖的容量；
   空白位用 ``None`` 表示，永远不会变成页码。
2. 帖内每张纸（令 N 为该帖容量，k 从 0 递增）：

   - 正面左、右：N-2k、1+2k
   - 背面左、右：2+2k、N-1-2k（长边翻转）
   - 短边翻转时交换背面左右页位。

3. 帖内位置加上此前书帖的容量偏移即得正文页码；超过正文总页数的位置为空白。

固定模式下所有书帖容量相同；自动混合模式（``protected_segments`` 不为
``None``）把每帖页数视为容量上限，从 8/16/32 中逐帖选择容量，由
``plan_capacities`` 给出唯一的逐帖容量序列。
"""

from typing import Any

LONG_EDGE = "long_edge"
SHORT_EDGE = "short_edge"
FLIP_MODES = (LONG_EDGE, SHORT_EDGE)
ALLOWED_SIGNATURE_SIZES = (8, 16, 32)
MIN_TOTAL_PAGES = 1
MAX_TOTAL_PAGES = 2000

# 纸张材料标记：普通纸 / 特种纸（可换料）/ 混纸冲突（普通页与特种页同纸）
MATERIAL_NORMAL = "normal"
MATERIAL_SPECIAL = "special"
MATERIAL_MIXED = "mixed"


def _page_or_blank(
    position: int, offset: int, total_pages: int
) -> int | None:
    """帖内位置（1..N）加帖偏移映射为正文页码，超出正文末尾即为空白。"""
    page_number = offset + position
    return page_number if page_number <= total_pages else None


def _sheet_content_pages(sheet: dict[str, Any]) -> list[int]:
    """一张纸上全部非空白页码（空白页位不参与材料判断）。"""
    return [
        sheet[side][position]
        for side in ("front", "back")
        for position in ("left", "right")
        if sheet[side][position] is not None
    ]


def _classify_sheet(sheet: dict[str, Any], special_pages: set[int]) -> str:
    """判定一张纸的材料：全部正文页为特种页→特种纸；部分→混纸冲突；否则普通纸。"""
    content = _sheet_content_pages(sheet)
    special_hits = [page for page in content if page in special_pages]
    if not special_hits:
        return MATERIAL_NORMAL
    if len(special_hits) == len(content):
        return MATERIAL_SPECIAL
    return MATERIAL_MIXED


def _apply_material_plan(
    signatures: list[dict[str, Any]], special_pages: set[int]
) -> dict[str, Any]:
    """在既有页位结果上为每张纸打材料标记，并汇总换料纸张数与冲突明细。"""
    conflicts: list[dict[str, Any]] = []
    special_sheet_count = 0
    mixed_sheet_count = 0

    for signature in signatures:
        for sheet in signature["sheets"]:
            material = _classify_sheet(sheet, special_pages)
            sheet["material"] = material
            if material == MATERIAL_SPECIAL:
                special_sheet_count += 1
            elif material == MATERIAL_MIXED:
                mixed_sheet_count += 1
                content = _sheet_content_pages(sheet)
                conflicts.append(
                    {
                        "signature_index": signature["index"],
                        "sheet_index": sheet["index"],
                        "special_pages": sorted(
                            page for page in content if page in special_pages
                        ),
                        "normal_pages": sorted(
                            page
                            for page in content
                            if page not in special_pages
                        ),
                    }
                )

    return {
        "special_pages": sorted(special_pages),
        "special_sheet_count": special_sheet_count,
        "mixed_sheet_count": mixed_sheet_count,
        "conflicts": conflicts,
    }


BLOCKED_PLAN_ERROR = "不可拆页段阻断了所有候选容量组合，无法在不拆分页段的情况下完成编排"


def _prefix_better(challenger: tuple[int, tuple[int, ...]],
                   current: tuple[int, tuple[int, ...]]) -> bool:
    """比较到达同一位置的两条前缀：书帖数更少者优，并列时容量序列从前向后较大者优。"""
    if challenger[0] != current[0]:
        return challenger[0] < current[0]
    return challenger[1] > current[1]


def plan_capacities(
    total_pages: int,
    max_capacity: int,
    segments: list[tuple[int, int]],
) -> tuple[list[int] | None, str | None]:
    """自动混合容量规划：返回 ``(逐帖容量列表, None)``；无解时返回 ``(None, 中文原因)``。

    - 候选容量为不超过 ``max_capacity`` 的 8/16/32；
    - 以正文顺序连续装入各帖，仅最后一帖允许补白；
    - 书帖边界（页码 p 与 p+1 之间）不得落在任一不可拆页段 ``[s, e]`` 内部
      （即 ``s <= p <= e - 1`` 的位置禁止成为边界）；
    - 依次按 补白最少 → 书帖数最少 → 容量序列从前向后较大者优先 选出唯一方案。
    """
    candidates = [size for size in ALLOWED_SIGNATURE_SIZES if size <= max_capacity]

    # 禁边界集合：页段 [s, e] 内部不允许出现书帖边界
    blocked: set[int] = set()
    for start, end in segments:
        blocked.update(range(start, end))

    # 动态规划：best[p] = (书帖数, 容量序列)，到达正文位置 p 的最优前缀
    best: dict[int, tuple[int, tuple[int, ...]]] = {0: (0, ())}
    finals: list[tuple[int, int, tuple[int, ...]]] = []
    for position in range(total_pages):
        entry = best.get(position)
        if entry is None:
            continue
        signature_count, sequence = entry
        for capacity in candidates:
            landing = position + capacity
            if landing >= total_pages:
                finals.append(
                    (landing - total_pages, signature_count + 1, sequence + (capacity,))
                )
            elif landing not in blocked:
                challenger = (signature_count + 1, sequence + (capacity,))
                current = best.get(landing)
                if current is None or _prefix_better(challenger, current):
                    best[landing] = challenger

    if not finals:
        return None, BLOCKED_PLAN_ERROR

    # 补白最少 → 书帖数最少 → 容量序列从前向后较大者优先（取负后按升序取最小）
    winner = min(
        finals,
        key=lambda item: (item[0], item[1], tuple(-capacity for capacity in item[2])),
    )
    return list(winner[2]), None


def _build_signatures(
    total_pages: int, capacities: list[int], flip: str
) -> list[dict[str, Any]]:
    """按逐帖容量与累计偏移生成全部书帖的纸张页位（原页位公式不变）。"""
    signatures: list[dict[str, Any]] = []
    offset = 0

    for signature_index, capacity in enumerate(capacities):
        content_pages = min(capacity, total_pages - offset)
        sheets: list[dict[str, Any]] = []

        for k in range(capacity // 4):
            front_left_position = capacity - 2 * k
            front_right_position = 1 + 2 * k
            back_left_position = 2 + 2 * k
            back_right_position = capacity - 1 - 2 * k
            if flip == SHORT_EDGE:
                back_left_position, back_right_position = (
                    back_right_position,
                    back_left_position,
                )

            sheets.append(
                {
                    "index": k,
                    "front": {
                        "left": _page_or_blank(
                            front_left_position, offset, total_pages
                        ),
                        "right": _page_or_blank(
                            front_right_position, offset, total_pages
                        ),
                    },
                    "back": {
                        "left": _page_or_blank(
                            back_left_position, offset, total_pages
                        ),
                        "right": _page_or_blank(
                            back_right_position, offset, total_pages
                        ),
                    },
                }
            )

        signatures.append(
            {
                "index": signature_index,
                "offset": offset,
                "capacity": capacity,
                "content_pages": content_pages,
                "sheets": sheets,
            }
        )
        offset += capacity

    return signatures


def impose(
    total_pages: int,
    pages_per_signature: int,
    flip: str,
    special_pages: set[int] | None = None,
    protected_segments: list[tuple[int, int]] | None = None,
) -> dict[str, Any]:
    """生成全部书帖的纸张页位编排结果。

    ``special_pages`` 为 ``None`` 时响应保持原结构；提供（归一化后的页码
    集合）时为每张纸附加 ``material`` 标记，并在顶层给出 ``material_plan``
    （归一化页码、换料纸张数、混纸冲突明细）。

    ``protected_segments`` 为 ``None`` 时是固定模式（所有书帖容量相同，
    请求 / 响应保持兼容）；提供（归一化后的不可拆页段，可为空列表）时
    启用自动混合容量：``pages_per_signature`` 作为容量上限，由
    ``plan_capacities`` 选出逐帖容量，响应附加 ``auto_plan``，且每帖
    附带 ``blank_count`` 与落在帖内的 ``protected_segments``。
    """
    auto_mode = protected_segments is not None
    if auto_mode:
        capacities, plan_error = plan_capacities(
            total_pages, pages_per_signature, protected_segments
        )
        if plan_error is not None:
            # 校验层已保证可解；此处兜底，避免静默产出错误版面
            raise ValueError(plan_error)
    else:
        signature_count = (total_pages + pages_per_signature - 1) // pages_per_signature
        capacities = [pages_per_signature] * signature_count

    signatures = _build_signatures(total_pages, capacities, flip)
    total_sheets = sum(len(signature["sheets"]) for signature in signatures)
    blank_count = sum(capacities) - total_pages

    result: dict[str, Any] = {
        "total_pages": total_pages,
        "pages_per_signature": pages_per_signature,
        "flip": flip,
        "signatures": signatures,
        "summary": {
            "signature_count": len(capacities),
            "sheet_count": total_sheets,
            "blank_count": blank_count,
        },
    }

    if auto_mode:
        merged = [[start, end] for start, end in protected_segments]
        for signature in signatures:
            first_page = signature["offset"] + 1
            last_page = signature["offset"] + signature["content_pages"]
            signature["blank_count"] = (
                signature["capacity"] - signature["content_pages"]
            )
            signature["protected_segments"] = [
                [start, end]
                for start, end in merged
                if first_page <= start and end <= last_page
            ]
        result["auto_plan"] = {
            "max_capacity": pages_per_signature,
            "candidates": [
                size for size in ALLOWED_SIGNATURE_SIZES if size <= pages_per_signature
            ],
            "capacities": capacities,
            "protected_segments": merged,
        }

    if special_pages is not None:
        result["material_plan"] = _apply_material_plan(
            signatures, set(special_pages)
        )

    return result


def iter_placed_pages(result: dict[str, Any]):
    """按 (书帖, 纸张, 面, 左右) 遍历所有页位，值为页码或 None。"""
    for signature in result["signatures"]:
        for sheet in signature["sheets"]:
            for side in ("front", "back"):
                for position in ("left", "right"):
                    yield signature, sheet, side, position, sheet[side][position]
