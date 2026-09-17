const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * 调用后端 /impose。
 * 成功：{ ok: true, data }
 * 字段错误（HTTP 422）：{ ok: false, fields }
 * 网络/服务错误：抛出，由调用方提示。
 * specialPages 留空时不带该字段，请求与原参数保持一致。
 */
export async function requestImposition({ totalPages, pagesPerSignature, flip, specialPages }) {
  const payload = {
    total_pages: totalPages,
    pages_per_signature: pagesPerSignature,
    flip,
  };
  if (specialPages) {
    payload.special_pages = specialPages;
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
  anchor.download = `imposition-${result.total_pages}p-${result.pages_per_signature}-${result.flip}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
