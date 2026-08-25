(function initPopup() {
  "use strict";

  const Core = globalThis.FormPilotCore;
  const form = document.querySelector("#open-form");
  const input = document.querySelector("#form-url");
  const status = document.querySelector("#status");

  function showError(message) {
    status.textContent = message;
  }

  async function suggestCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parsed = Core.parseGoogleFormUrl(tab?.url || "");
    if (parsed.valid && parsed.kind !== "edit") {
      input.value = parsed.canonicalUrl;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = Core.parseGoogleFormUrl(input.value);
    if (!parsed.valid) {
      showError(parsed.reason);
      input.focus();
      return;
    }
    if (parsed.kind === "edit") {
      showError("Hãy dán liên kết xem trước hoặc liên kết dành cho người trả lời.");
      return;
    }

    showError("");
    const workspaceUrl = new URL(chrome.runtime.getURL("src/workspace/workspace.html"));
    workspaceUrl.searchParams.set("url", parsed.canonicalUrl);
    await chrome.tabs.create({ url: workspaceUrl.toString(), active: true });
    window.close();
  });

  suggestCurrentTab().catch(() => {
    // Không cần báo lỗi nếu tab hiện tại không thể đọc URL.
  });
})();
