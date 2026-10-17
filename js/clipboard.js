function copyWithSelection(text, documentRef) {
  if (typeof documentRef.execCommand !== "function") return false;
  const active = documentRef.activeElement;
  const selection = documentRef.getSelection?.();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const field = documentRef.createElement("textarea");
  field.value = text;
  field.tabIndex = -1;
  field.setAttribute("inputmode", "none");
  field.setAttribute("aria-hidden", "true");
  field.setAttribute("data-clipboard-buffer", "");
  // Safari needs an attached, selectable field. A closed <details> or a
  // display:none source cannot reliably serve as the clipboard selection.
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;pointer-events:none";
  const onCopy = (event) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
  };
  try {
    documentRef.body.append(field);
    documentRef.addEventListener("copy", onCopy);
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    return documentRef.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    documentRef.removeEventListener("copy", onCopy);
    field.remove();
    try {
      active?.focus?.({ preventScroll: true });
      if (selection) {
        selection.removeAllRanges();
        for (const range of ranges) selection.addRange(range);
      }
    } catch {
      /* Selection restoration must not invalidate a successful copy. */
    }
  }
}

async function writeClipboardText(text, windowRef = window) {
  if (!text) throw new Error("EMPTY_CLIPBOARD_TEXT");
  // Keep the HTTP fallback inside the original click, before any await:
  // Safari's clipboard access depends on the user gesture.
  const preferSelection = windowRef.isSecureContext !== true;
  if (preferSelection && copyWithSelection(text, windowRef.document)) return;
  try {
    const clipboard = windowRef.navigator.clipboard;
    if (typeof clipboard?.writeText === "function") {
      await clipboard.writeText(text);
      return;
    }
  } catch {
    /* A rejected Clipboard API call can still use the fallback. */
  }
  if (!preferSelection && copyWithSelection(text, windowRef.document)) return;
  throw new Error("CLIPBOARD_UNAVAILABLE");
}

function bindCopyButton({
  button,
  source,
  feedback,
  getText = () => source.value,
  successText = "Скопировано.",
  windowRef = window,
}) {
  const label = button.textContent;
  let busy = false;
  let resetTimer;
  feedback.classList.add("copy-status");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  feedback.setAttribute("aria-atomic", "true");
  if (feedback.id) button.setAttribute("aria-describedby", feedback.id);
  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    windowRef.clearTimeout(resetTimer);
    // Keep the focused button enabled while the selection fallback restores
    // focus. The busy guard ignores repeated taps without making Safari blur.
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-busy", "true");
    button.textContent = "Копируем…";
    feedback.dataset.state = "pending";
    feedback.textContent = "Копируем…";
    try {
      const text = String(getText() || "");
      source.value = text;
      await writeClipboardText(text, windowRef);
      button.textContent = "Скопировано ✓";
      feedback.dataset.state = "success";
      feedback.textContent = successText;
    } catch {
      source.closest("details")?.setAttribute("open", "");
      source.focus({ preventScroll: true });
      source.select();
      source.setSelectionRange(0, source.value.length);
      button.textContent = label;
      feedback.dataset.state = "error";
      feedback.textContent =
        "Браузер не разрешил копирование. Текст выделен — нажми на него и выбери «Скопировать».";
    } finally {
      busy = false;
      button.removeAttribute("aria-disabled");
      button.removeAttribute("aria-busy");
      resetTimer = windowRef.setTimeout(() => {
        button.textContent = label;
      }, 2500);
    }
  });
}

export { bindCopyButton, writeClipboardText };
