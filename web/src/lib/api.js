const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * 调用后端 /impose。
 * 成功：{ ok: true, data }
 * 字段错误（HTTP 422）：{ ok: false, fields }
 * 网络/服务错误：抛出，由调用方提示。
 * specialPages 留空时不带该字段，请求与原参数保持一致；
 * autoMode 为 true 时追加 auto_mode 与（非空的）protected_segments，
 * 未启用自动模式时两者都不发送，请求保持原结构。
 */
export async function requestImposition({ totalPages, pagesPerSignature, flip, specialPages, autoMode, protectedSegments }) {
  const payload = {
    total_pages: totalPages,
    pages_per_signature: pagesPerSignature,
    flip,
  };
  if (specialPages) {
    payload.special_pages = specialPages;
  }
  if (autoMode) {
    payload.auto_mode = true;
    if (protectedSegments) {
      payload.protected_segments = protectedSegments;
    }
  }
  const response = await fetch(`${API_BASE}/impose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (response.ok) {
    return { ok: true, data: body };
  }
  if (response.status === 422 && body?.fields) {
    return { ok: false, fields: body.fields };
  }
  throw new Error(`API 异常（HTTP ${response.status}）`);
}

/** 把编排结果以同内容 JSON 下载到本地。 */
export function downloadResultJson(result) {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const sizeTag = result.auto_plan
    ? `auto${result.pages_per_signature}`
    : `${result.pages_per_signature}`;
  anchor.download = `imposition-${result.total_pages}p-${sizeTag}-${result.flip}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
