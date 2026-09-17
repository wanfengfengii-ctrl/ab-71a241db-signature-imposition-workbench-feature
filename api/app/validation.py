"""入参校验：任一输入为空、非整数、越界或取值不在允许集合内都会给出字段错误。"""

import re
from typing import Any

from .imposition import (
    ALLOWED_SIGNATURE_SIZES,
    FLIP_MODES,
    MAX_TOTAL_PAGES,
    MIN_TOTAL_PAGES,
    plan_capacities,
)

_PAGE_NUMBER = re.compile(r"^[0-9]+$")

SPECIAL_PAGES_FORMAT_ERROR = "格式不正确：请用逗号分隔单页或闭区间，如 3,5-8"
SEGMENTS_FORMAT_ERROR = "格式不正确：请用逗号分隔单页或闭区间，如 9-16,20-22"


def parse_special_pages(
    raw: str, total_pages: int | None = None
) -> tuple[set[int] | None, str | None]:
    """解析特种纸页码范围（逗号分隔的单页 / 闭区间），重复页先归一化。

    返回 ``(页码集合, None)``；解析失败时返回 ``(None, 中文错误)``。
    ``total_pages`` 用于越界检查，为 ``None`` 时只校验格式与倒序。
    """
    pages: set[int] = set()
    for part in raw.split(","):
        token = part.strip()
        if not token:
            return None, SPECIAL_PAGES_FORMAT_ERROR
        if "-" in token:
            bounds = token.split("-")
            if len(bounds) != 2:
                return None, SPECIAL_PAGES_FORMAT_ERROR
            start_text, end_text = bounds[0].strip(), bounds[1].strip()
            if not _PAGE_NUMBER.match(start_text) or not _PAGE_NUMBER.match(
                end_text
            ):
                return None, SPECIAL_PAGES_FORMAT_ERROR
            start, end = int(start_text), int(end_text)
            if start > end:
                return None, f"区间 {start}-{end} 倒序：起点不能大于终点"
            pages.update(range(start, end + 1))
        else:
            if not _PAGE_NUMBER.match(token):
                return None, SPECIAL_PAGES_FORMAT_ERROR
            pages.add(int(token))
    if total_pages is not None:
        for page in pages:
            if page < 1 or page > total_pages:
                return None, (
                    f"页码超出正文范围：必须在 1 至 {total_pages} 之间"
                )
    return pages, None


def _merge_segments(
    segments: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """重叠或相邻（后一段起点 ≤ 前一段终点 +1）的闭区间合并为一个。"""
    merged: list[tuple[int, int]] = []
    for start, end in sorted(segments):
        if merged and start <= merged[-1][1] + 1:
            last_start, last_end = merged[-1]
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def parse_protected_segments(
    raw: str,
    total_pages: int | None = None,
    max_capacity: int | None = None,
) -> tuple[list[tuple[int, int]] | None, str | None]:
    """解析不可拆页段（逗号分隔的单页 / 闭区间），重叠或相邻项先合并。

    返回 ``(归并后的 [(起点, 终点), ...], None)``；解析失败时返回
    ``(None, 中文错误)``。``total_pages`` 用于越界检查，``max_capacity``
    用于“单段长度超过容量上限”检查，为 ``None`` 时跳过对应检查。
    """
    segments: list[tuple[int, int]] = []
    for part in raw.split(","):
        token = part.strip()
        if not token:
            return None, SEGMENTS_FORMAT_ERROR
        if "-" in token:
            bounds = token.split("-")
            if len(bounds) != 2:
                return None, SEGMENTS_FORMAT_ERROR
            start_text, end_text = bounds[0].strip(), bounds[1].strip()
            if not _PAGE_NUMBER.match(start_text) or not _PAGE_NUMBER.match(
                end_text
            ):
                return None, SEGMENTS_FORMAT_ERROR
            start, end = int(start_text), int(end_text)
            if start > end:
                return None, f"区间 {start}-{end} 倒序：起点不能大于终点"
            segments.append((start, end))
        else:
            if not _PAGE_NUMBER.match(token):
                return None, SEGMENTS_FORMAT_ERROR
            page = int(token)
            segments.append((page, page))
    if total_pages is not None:
        for start, end in segments:
            if start < 1 or end > total_pages:
                return None, (
                    f"页段超出正文范围：必须在 1 至 {total_pages} 之间"
                )
    merged = _merge_segments(segments)
    if max_capacity is not None:
        for start, end in merged:
            length = end - start + 1
            if length > max_capacity:
                return None, (
                    f"页段 {start}-{end} 共 {length} 页，"
                    f"超过容量上限 {max_capacity}，无法装入同一书帖"
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

    # 自动混合容量开关：缺省 / false 为固定模式（保持兼容）；
    # 提供时必须是真正的布尔值。
    raw_auto = values.get("auto_mode")
    auto_mode = False
    if not _is_empty(raw_auto):
        if not isinstance(raw_auto, bool):
            errors["auto_mode"] = "必须为布尔值（true 或 false）"
        else:
            auto_mode = raw_auto

    # 不可拆页段仅在自动模式下参与校验与编排；未启用自动模式时忽略，
    # 请求 / 响应保持原结构。
    raw_segments = values.get("protected_segments")
    if auto_mode and not _is_empty(raw_segments):
        if not isinstance(raw_segments, str):
            errors["protected_segments"] = "必须为字符串，如 9-16,20-22"
        else:
            total_for_range = (
                raw_total if "total_pages" not in errors else None
            )
            capacity_cap = (
                raw_size if "pages_per_signature" not in errors else None
            )
            _, segment_error = parse_protected_segments(
                raw_segments, total_for_range, capacity_cap
            )
            if segment_error:
                errors["protected_segments"] = segment_error

    # 全部候选均被约束阻断：依赖 total_pages / pages_per_signature /
    # protected_segments 均已通过校验，此时做一次可行性试排。
    if (
        auto_mode
        and "total_pages" not in errors
        and "pages_per_signature" not in errors
        and "protected_segments" not in errors
        and isinstance(raw_segments, str)
        and raw_segments.strip()
    ):
        segments, _ = parse_protected_segments(
            raw_segments, raw_total, raw_size
        )
        _, plan_error = plan_capacities(raw_total, raw_size, segments or [])
        if plan_error:
            errors["protected_segments"] = plan_error

    return errors
