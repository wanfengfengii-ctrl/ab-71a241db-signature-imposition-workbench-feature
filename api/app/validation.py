"""入参校验：任一输入为空、非整数、越界或取值不在允许集合内都会给出字段错误。"""

import re
from typing import Any

from .imposition import (
    ALLOWED_SIGNATURE_SIZES,
    FLIP_MODES,
    MAX_TOTAL_PAGES,
    MIN_TOTAL_PAGES,
    merge_intervals,
)

_PAGE_NUMBER = re.compile(r"^[0-9]+$")

SPECIAL_PAGES_FORMAT_ERROR = "格式不正确：请用逗号分隔单页或闭区间，如 3,5-8"
SEGMENTS_FORMAT_ERROR = "格式不正确：请用逗号分隔闭区间，如 9-16,33-40"
SEGMENTS_TOO_LONG_ERROR = (
    "不可拆页段 {start}-{end} 长度 {length} 页，超过容量上限 {capacity} 页"
)
AUTO_MODE_TYPE_ERROR = "必须为布尔值 true 或 false"


def parse_intervals(
    raw: str,
    *,
    allow_singletons: bool,
    total_pages: int | None = None,
    format_error: str = SPECIAL_PAGES_FORMAT_ERROR,
) -> tuple[list[tuple[int, int]] | None, str | None]:
    """解析逗号分隔的单页 / 闭区间为 ``(起点, 终点)`` 列表（不做合并）。

    ``allow_singletons`` 为 ``False`` 时只接受闭区间（不可拆页段必须是
    至少两页的页段）。``total_pages`` 用于越界检查，为 ``None`` 时只校验
    格式与倒序。解析失败返回 ``(None, 中文错误)``。
    """
    intervals: list[tuple[int, int]] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            return None, format_error
        if "-" in token:
            bounds = token.split("-")
            if len(bounds) != 2:
                return None, format_error
            start_text, end_text = bounds[0].strip(), bounds[1].strip()
            if not _PAGE_NUMBER.match(start_text) or not _PAGE_NUMBER.match(
                end_text
            ):
                return None, format_error
            start, end = int(start_text), int(end_text)
            if start > end:
                return None, f"区间 {start}-{end} 倒序：起点不能大于终点"
            intervals.append((start, end))
        else:
            if not allow_singletons:
                return None, format_error
            if not _PAGE_NUMBER.match(token):
                return None, format_error
            page = int(token)
            intervals.append((page, page))
    if total_pages is not None:
        for start, end in intervals:
            if start < 1 or end > total_pages:
                return None, (
                    f"页码超出正文范围：必须在 1 至 {total_pages} 之间"
                )
    return intervals, None


def parse_special_pages(
    raw: str, total_pages: int | None = None
) -> tuple[set[int] | None, str | None]:
    """解析特种纸页码范围（逗号分隔的单页 / 闭区间），重复页先归一化。

    返回 ``(页码集合, None)``；解析失败时返回 ``(None, 中文错误)``。
    ``total_pages`` 用于越界检查，为 ``None`` 时只校验格式与倒序。
    """
    intervals, error = parse_intervals(
        raw, allow_singletons=True, total_pages=total_pages
    )
    if error is not None:
        return None, error
    pages: set[int] = set()
    for start, end in intervals or []:
        pages.update(range(start, end + 1))
    return pages, None


def parse_page_segments(
    raw: str,
    total_pages: int | None = None,
    max_capacity: int | None = None,
) -> tuple[list[tuple[int, int]] | None, str | None]:
    """解析不可拆页段：逗号分隔的闭区间，重叠或相邻项合并。

    成功返回 ``(合并后的升序区间列表, None)``；格式错误、区间倒序、
    越界或单段长度超过容量上限时返回 ``(None, 中文错误)``。
    """
    intervals, error = parse_intervals(
        raw,
        allow_singletons=False,
        total_pages=total_pages,
        format_error=SEGMENTS_FORMAT_ERROR,
    )
    if error is not None:
        return None, error

    merged = merge_intervals(intervals or [])
    if max_capacity is not None:
        for start, end in merged:
            length = end - start + 1
            if length > max_capacity:
                return None, SEGMENTS_TOO_LONG_ERROR.format(
                    start=start, end=end, length=length, capacity=max_capacity
                )
    return merged, None


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    return False


def _as_strict_int(value: Any) -> int | None:
    """只接受真正的 int；布尔值、浮点、字符串一律不算整数。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    return None


def _is_strict_bool(value: Any) -> bool:
    """JSON 布尔：只接受真正的 bool；字符串、数字、null 都不算。"""
    return isinstance(value, bool)


def validate_imposition_request(values: dict[str, Any]) -> dict[str, str]:
    """返回 字段名 -> 中文错误信息；无错误时返回空字典。"""
    errors: dict[str, str] = {}

    raw_total = values.get("total_pages")
    if _is_empty(raw_total):
        errors["total_pages"] = "请输入正文总页数"
    else:
        total_pages = _as_strict_int(raw_total)
        if total_pages is None:
            errors["total_pages"] = "必须为整数"
        elif not MIN_TOTAL_PAGES <= total_pages <= MAX_TOTAL_PAGES:
            errors["total_pages"] = (
                f"必须为 {MIN_TOTAL_PAGES} 至 {MAX_TOTAL_PAGES} 的整数"
            )

    raw_size = values.get("pages_per_signature")
    if _is_empty(raw_size):
        errors["pages_per_signature"] = "请选择每帖页数"
    else:
        size = _as_strict_int(raw_size)
        if size is None:
            errors["pages_per_signature"] = "必须为整数"
        elif size not in ALLOWED_SIGNATURE_SIZES:
            errors["pages_per_signature"] = (
                f"只能为 {ALLOWED_SIGNATURE_SIZES[0]}、"
                f"{ALLOWED_SIGNATURE_SIZES[1]} 或 {ALLOWED_SIGNATURE_SIZES[2]}"
            )

    raw_flip = values.get("flip")
    if _is_empty(raw_flip):
        errors["flip"] = "请选择翻转方式"
    elif raw_flip not in FLIP_MODES:
        errors["flip"] = f"只支持 {FLIP_MODES[0]} 或 {FLIP_MODES[1]}"

    # 自动混合容量开关：缺省视为关闭；显式传入时必须是真正的布尔值。
    # 不可拆页段等自动模式字段仅在开关启用时才校验，未启用时一律忽略，
    # 保证旧请求（不含这些字段）的行为完全不变。
    raw_auto = values.get("auto_mode")
    auto_enabled = raw_auto is True
    if raw_auto is not None and not _is_strict_bool(raw_auto):
        errors["auto_mode"] = AUTO_MODE_TYPE_ERROR

    # 特种纸页码范围为可选：留空（None / 空白串）即不启用；
    # 越界检查依赖有效的 total_pages，其本身出错时只校验格式与倒序。
    raw_special = values.get("special_pages")
    if not _is_empty(raw_special):
        if not isinstance(raw_special, str):
            errors["special_pages"] = "必须为字符串，如 3,5-8"
        else:
            total_for_range = (
                raw_total if "total_pages" not in errors else None
            )
            _, special_error = parse_special_pages(raw_special, total_for_range)
            if special_error:
                errors["special_pages"] = special_error

    # 不可拆页段仅自动模式启用时参与：留空即无约束；非法格式 / 倒序 /
    # 越界 / 单段超过容量上限均返回该字段中文错误。约束阻断（规划无解）
    # 是语义错误，在校验通过后由规划阶段返回。
    raw_segments = values.get("unbreakable_segments")
    if auto_enabled and not _is_empty(raw_segments):
        if not isinstance(raw_segments, str):
            errors["unbreakable_segments"] = "必须为字符串，如 9-16,33-40"
        else:
            total_for_range = (
                raw_total if "total_pages" not in errors else None
            )
            capacity_for_check = (
                raw_size
                if "pages_per_signature" not in errors
                else max(ALLOWED_SIGNATURE_SIZES)
            )
            _, segment_error = parse_page_segments(
                raw_segments, total_for_range, capacity_for_check
            )
            if segment_error:
                errors["unbreakable_segments"] = segment_error

    return errors
