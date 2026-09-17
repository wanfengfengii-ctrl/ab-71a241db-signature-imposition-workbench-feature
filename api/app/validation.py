"""入参校验：任一输入为空、非整数、越界或取值不在允许集合内都会给出字段错误。"""

import re
from typing import Any

from .imposition import (
    ALLOWED_SIGNATURE_SIZES,
    FLIP_MODES,
    MAX_TOTAL_PAGES,
    MIN_TOTAL_PAGES,
)

_PAGE_NUMBER = re.compile(r"^[0-9]+$")

SPECIAL_PAGES_FORMAT_ERROR = "格式不正确：请用逗号分隔单页或闭区间，如 3,5-8"


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

    return errors
