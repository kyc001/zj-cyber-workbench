export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error("没有可复制的内容");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Desktop webviews and non-secure origins may deny the async API.
    }
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("复制失败，请手动选择内容");
    }
  } finally {
    textarea.remove();
    activeElement?.focus();
  }
}
