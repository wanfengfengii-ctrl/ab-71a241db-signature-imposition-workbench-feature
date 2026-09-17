"""骑马订书帖编排核心算法。

规则（每个书帖独立处理，帖内位置从 1 开始）：

1. 若正文页数不能被每帖页数整除，在正文末尾补空白位至最后一帖的容量；
   空白位用 ``None`` 表示，永远不会变成页码。
2. 帖内每张纸（令 N 为该帖容量，k 从 0 递增）：

   - 正面左、右：N-2k、1+2k
   - 背面左、右：2+2k、N-1-2k（长边翻转）
   - 短边翻转时交换背面左右页位。

3. 帖内位置加上此前书帖的容量偏移即得正文页码；超过正文总页数的位置为空白。
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


def impose(
    total_pages: int,
    pages_per_signature: int,
    flip: str,
    special_pages: set[int] | None = None,
) -> dict[str, Any]:
    """生成全部书帖的纸张页位编排结果。

    ``special_pages`` 为 ``None`` 时响应保持原结构；提供（归一化后的页码
    集合）时为每张纸附加 ``material`` 标记，并在顶层给出 ``material_plan``
    （归一化页码、换料纸张数、混纸冲突明细）。
    """
    signature_count = (total_pages + pages_per_signature - 1) // pages_per_signature
    signatures: list[dict[str, Any]] = []
    total_sheets = 0

    for signature_index in range(signature_count):
        offset = signature_index * pages_per_signature
        content_pages = min(pages_per_signature, total_pages - offset)
        sheets: list[dict[str, Any]] = []

        for k in range(pages_per_signature // 4):
            front_left_position = pages_per_signature - 2 * k
            front_right_position = 1 + 2 * k
            back_left_position = 2 + 2 * k
            back_right_position = pages_per_signature - 1 - 2 * k
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
                "capacity": pages_per_signature,
                "content_pages": content_pages,
                "sheets": sheets,
            }
        )
        total_sheets += len(sheets)

    blank_count = signature_count * pages_per_signature - total_pages

    result: dict[str, Any] = {
        "total_pages": total_pages,
        "pages_per_signature": pages_per_signature,
        "flip": flip,
        "signatures": signatures,
        "summary": {
            "signature_count": signature_count,
            "sheet_count": total_sheets,
            "blank_count": blank_count,
        },
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
