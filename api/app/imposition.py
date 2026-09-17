"""骑马订书帖编排核心算法。

规则（每个书帖独立处理，帖内位置从 1 开始）：

1. 若正文页数不能被每帖页数整除，在正文末尾补空白位至最后一帖的容量；
   空白位用 ``None`` 表示，永远不会变成页码。
2. 帖内每张纸（令 N 为该帖容量，k 从 0 递增）：

   - 正面左、右：N-2k、1+2k
   - 背面左、右：2+2k、N-1-2k（长边翻转）
   - 短边翻转时交换背面左右页位。

3. 帖内位置加上此前书帖的容量偏移即得正文页码；超过正文总页数的位置为空白。

自动混合容量模式（``auto_mode``）：以当前每帖页数为容量上限，在
{8,16,32} 中取不超过上限的容量作为候选；按正文顺序连续装入各帖，
书帖边界不得落在任何不可拆页段内部。方案按（补白数、书帖数、
容量序列从前向后较大者优先）唯一定序。
"""

from bisect import bisect_right
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


def merge_intervals(
    intervals: list[tuple[int, int]] | list[list[int]],
) -> list[tuple[int, int]]:
    """合并重叠或相邻（首尾相接）的闭区间，返回升序 ``(起点, 终点)`` 列表。"""
    if not intervals:
        return []
    ordered = sorted((int(a), int(b)) for a, b in intervals)
    merged: list[tuple[int, int]] = [ordered[0]]
    for start, end in ordered[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 1:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def plan_auto_capacities(
    total_pages: int,
    max_capacity: int,
    protected_intervals: list[tuple[int, int]] | list[list[int]]
    | None = None,
) -> list[int] | None:
    """自动混合容量规划：返回逐帖容量；约束下无解时返回 ``None``。

    候选容量为 {8,16,32} 中不超过 ``max_capacity`` 者。各帖按正文顺序
    连续装入，除末帖外必须恰好装满某个候选容量，末帖可较短并补白至所选
    容量；任何书帖边界都不能落在不可拆页段内部。

    方案按（补白总数最少、书帖数最少、容量序列从前向后较大者优先）
    定序，因此结果唯一。
    """
    candidates = tuple(
        size for size in ALLOWED_SIGNATURE_SIZES if size <= max_capacity
    )
    segments = merge_intervals(protected_intervals or [])
    segment_starts = [a for a, _ in segments]

    def boundary_forbidden(position: int) -> bool:
        """书帖边界（位于第 position 页与第 position+1 页之间）是否落在页段内部。

        页段 [a,b] 覆盖书页 a…b；在其内部下刀的位置为 a ≤ position < b
        （段首页前的边界在段外、段末页后的边界也在段外）。
        """
        if position <= 0 or position >= total_pages:
            return False
        index = bisect_right(segment_starts, position) - 1
        if index < 0:
            return False
        _, end = segments[index]
        return position < end

    # best[p]：到达边界位置 p 的最优“完整书帖前缀”——书帖数最少，
    # 同数时容量序列字典序更大（从前向后较大者优先）。
    best: dict[int, tuple[int, tuple[int, ...]]] = {0: (0, ())}
    for position in range(total_pages):
        current = best.get(position)
        if current is None:
            continue
        steps, sequence = current
        for capacity in candidates:
            landing = position + capacity
            if landing >= total_pages:
                continue
            if boundary_forbidden(landing):
                continue
            candidate_state = (steps + 1, sequence + (capacity,))
            previous = best.get(landing)
            if previous is None or _prefix_better(candidate_state, previous):
                best[landing] = candidate_state

    plans: list[tuple[int, int, tuple[int, ...]]] = []
    for position, (steps, sequence) in best.items():
        last_content = total_pages - position
        if not 1 <= last_content <= max_capacity:
            continue
        last_capacity = next(
            capacity for capacity in candidates if capacity >= last_content
        )
        padding = last_capacity - last_content
        plans.append(
            (padding, steps + 1, sequence + (last_capacity,))
        )

    if not plans:
        return None
    _, _, winner = min(plans, key=lambda plan: _plan_sort_key(plan))
    return list(winner)


def _prefix_better(
    candidate: tuple[int, tuple[int, ...]],
    incumbent: tuple[int, tuple[int, ...]],
) -> bool:
    """完整书帖前缀的优劣：书帖数更少；同数时容量序列从前向后较大者优先。"""
    candidate_steps, candidate_sequence = candidate
    incumbent_steps, incumbent_sequence = incumbent
    if candidate_steps != incumbent_steps:
        return candidate_steps < incumbent_steps
    return candidate_sequence > incumbent_sequence


def _plan_sort_key(
    plan: tuple[int, int, tuple[int, ...]],
) -> tuple[int, int, tuple[int, ...]]:
    """全局定序：补白最少、书帖数最少、容量序列从前向后较大者优先。"""
    padding, signature_count, sequence = plan
    return padding, signature_count, tuple(-capacity for capacity in sequence)


def _build_signature(
    signature_index: int,
    offset: int,
    capacity: int,
    total_pages: int,
    flip: str,
) -> dict[str, Any]:
    """按给定帖容量与累计偏移生成一帖的全部纸张页位。"""
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

    return {
        "index": signature_index,
        "offset": offset,
        "capacity": capacity,
        "content_pages": content_pages,
        "sheets": sheets,
    }


def impose(
    total_pages: int,
    pages_per_signature: int,
    flip: str,
    special_pages: set[int] | None = None,
    auto_mode: bool = False,
    protected_segments: list[tuple[int, int]] | list[list[int]] | None = None,
) -> dict[str, Any]:
    """生成全部书帖的纸张页位编排结果。

    固定模式（``auto_mode=False``）下响应结构保持不变：每帖容量均为
    ``pages_per_signature``。``special_pages`` 为 ``None`` 时不附加材料
    标记；提供（归一化后的页码集合）时为每张纸附加 ``material`` 标记，
    并在顶层给出 ``material_plan``。

    自动模式（``auto_mode=True``）下 ``pages_per_signature`` 作为容量
    上限，由 :func:`plan_auto_capacities` 决定逐帖容量，逐帖容量与累计偏移
    驱动同一套页位公式；另返回 ``auto_plan``，每帖附加补白与约束命中。
    """
    if not auto_mode:
        capacities = [pages_per_signature] * (
            (total_pages + pages_per_signature - 1) // pages_per_signature
        )
        segments: list[tuple[int, int]] = []
    else:
        planned = plan_auto_capacities(
            total_pages, pages_per_signature, protected_segments
        )
        if planned is None:
            raise ValueError("自动容量规划在当前不可拆页段约束下无解")
        capacities = planned
        segments = merge_intervals(protected_segments or [])

    signatures: list[dict[str, Any]] = []
    total_sheets = 0
    offset = 0

    for signature_index, capacity in enumerate(capacities):
        signature = _build_signature(
            signature_index, offset, capacity, total_pages, flip
        )
        if auto_mode:
            signature["padding"] = capacity - signature["content_pages"]
            signature["protected_segments"] = [
                list(segment)
                for segment in segments
                if offset < segment[0] and segment[1] <= offset + capacity
            ]
        signatures.append(signature)
        total_sheets += len(signature["sheets"])
        offset += capacity

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
        result["auto_mode"] = True
        result["auto_plan"] = {
            "max_capacity": pages_per_signature,
            "candidate_capacities": [
                size
                for size in ALLOWED_SIGNATURE_SIZES
                if size <= pages_per_signature
            ],
            "protected_pages": [list(segment) for segment in segments],
            "capacities": list(capacities),
            "blank_count": blank_count,
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
