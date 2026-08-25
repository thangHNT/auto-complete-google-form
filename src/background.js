"use strict";

importScripts("shared/core.js");

const Core = globalThis.FormPilotCore;
const MAX_TEST_RESPONSES = 10;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function tabUrl(tab) {
  return String(tab?.url || tab?.pendingUrl || "");
}

async function waitForTabComplete(tabId, timeoutMs = 30000) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return existing;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Trang tải quá lâu. Hãy mở tab form và thử lại."));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function getOrCreateTargetTab(tabId, formUrl) {
  if (tabId) {
    try {
      const existing = await chrome.tabs.get(tabId);
      return { tabId: existing.id, recreated: false };
    } catch {
      // Workspace có thể giữ ID của tab form mà người dùng đã đóng.
    }
  }

  const created = await chrome.tabs.create({ url: formUrl, active: false });
  await waitForTabComplete(created.id);
  return { tabId: created.id, recreated: true };
}

async function resetFormTab(tabId, formUrl) {
  await chrome.tabs.update(tabId, { url: formUrl });
  // Cho phép sự kiện điều hướng chuyển tab sang trạng thái loading trước khi đọc lại.
  await delay(100);
  return waitForTabComplete(tabId);
}

async function ensureContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (response?.ok) return;
  } catch {
    // Tab có thể đã được mở trước khi extension được cài hoặc vừa điều hướng.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/shared/core.js", "src/content.js"]
  });
}

async function sendToFormTab(tabId, message) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

async function scanAfterPageTransition(tabId, previousPageKey = null, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  // Nút được bấm sau khi message trước đã trả về; chờ điều hướng bắt đầu.
  await delay(300);
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "loading") {
        await delay(150);
        continue;
      }

      const response = await sendToFormTab(tabId, { type: "SCAN_FORM" });
      if (
        response?.ok &&
        (!previousPageKey || response.schema?.pageKey !== previousPageKey)
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      // Content script cũ có thể vừa vào back/forward cache; thử lại trên trang mới.
    }
    await delay(150);
  }

  throw new Error(
    lastError?.message ||
      "Không chuyển được sang trang tiếp theo. Hãy kiểm tra đáp án và quy tắc xác thực."
  );
}

async function scanTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tabUrl(tab);

  if (url.startsWith("https://accounts.google.com/")) {
    return {
      ok: false,
      code: "LOGIN_REQUIRED",
      tabId,
      reason: "Google yêu cầu đăng nhập trước khi đọc biểu mẫu."
    };
  }

  const parsed = Core.parseGoogleFormUrl(url);
  if (!parsed.valid) {
    return { ok: false, code: "INVALID_FORM", tabId, reason: parsed.reason };
  }
  if (parsed.kind === "edit") {
    return {
      ok: false,
      code: "RESPONSE_LINK_REQUIRED",
      tabId,
      reason: "Hãy dùng liên kết xem trước hoặc liên kết dành cho người trả lời."
    };
  }

  let response = await sendToFormTab(tabId, { type: "SCAN_FORM" });
  if (!response?.ok) {
    return {
      ok: false,
      code: "SCAN_FAILED",
      tabId,
      reason: response?.reason || "Không thể quét biểu mẫu."
    };
  }

  let introPagesSkipped = 0;
  while (
    !response.schema?.currentQuestions?.length &&
    response.schema?.hasNextPage &&
    introPagesSkipped < 5
  ) {
    const previousPageKey = response.schema?.pageKey;
    const advanced = await sendToFormTab(tabId, { type: "ADVANCE_EMPTY_INTRO" });
    if (!advanced?.ok) break;
    introPagesSkipped += advanced.advanced ? 1 : 0;
    if (!advanced.advanced) break;
    response = await scanAfterPageTransition(tabId, previousPageKey);
  }

  if (!response.schema?.questions?.length) {
    return {
      ok: false,
      code: "NO_QUESTIONS",
      tabId,
      reason: "Không tìm thấy câu hỏi sau phần giới thiệu. Form có thể chưa được cấp quyền truy cập."
    };
  }

  return {
    ok: true,
    tabId,
    formUrl: Core.responseStartUrl(url) || url,
    schema: response.schema,
    introPagesSkipped
  };
}

function schemaFromPublicMetadata(metadata, formUrl) {
  const questions = metadata.questions || [];
  const pages = metadata.pages || [];
  const firstPageId = pages[0]?.id;
  const currentQuestions = firstPageId
    ? questions.filter((question) => question.pageId === firstPageId)
    : questions;
  const pathname = new URL(formUrl).pathname;

  return {
    title: metadata.title || "Google Form",
    description: metadata.description || "",
    url: formUrl,
    pathname,
    questions,
    currentQuestions,
    pages,
    pageCount: pages.length || 1,
    currentPageIndex: currentQuestions.length ? 0 : null,
    currentPageNumber: currentQuestions.length ? 1 : null,
    pageHistory: "",
    pageKey: `background:${questions.map((question) => question.id).join(",")}`,
    fingerprint: Core.makeFingerprint(metadata.title, questions),
    source: "public-load-data",
    isPreview: /\/preview\/?$/.test(pathname),
    canSubmit: pages.length <= 1,
    hasNextPage: pages.length > 1,
    scannedAt: new Date().toISOString()
  };
}

async function scanUrlWithoutOpeningTab(url) {
  const parsed = Core.parseGoogleFormUrl(url);
  if (!parsed.valid) return { ok: false, code: "INVALID_URL", reason: parsed.reason };
  if (parsed.kind === "edit") {
    return {
      ok: false,
      code: "RESPONSE_LINK_REQUIRED",
      reason: "Hãy dùng liên kết xem trước hoặc liên kết dành cho người trả lời."
    };
  }

  let response;
  try {
    response = await fetch(parsed.canonicalUrl, {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store"
    });
  } catch (error) {
    return {
      ok: false,
      code: "BACKGROUND_SCAN_FAILED",
      formUrl: parsed.canonicalUrl,
      reason: `Không thể quét form trong nền: ${error.message}`
    };
  }

  const finalUrl = response.url || parsed.canonicalUrl;
  if (finalUrl.startsWith("https://accounts.google.com/")) {
    return {
      ok: false,
      code: "LOGIN_REQUIRED",
      formUrl: parsed.canonicalUrl,
      reason: "Google yêu cầu đăng nhập. Hãy chủ động mở form, đăng nhập rồi quét lại."
    };
  }

  const finalParsed = Core.parseGoogleFormUrl(finalUrl);
  if (!finalParsed.valid || finalParsed.kind === "edit") {
    return {
      ok: false,
      code: "INVALID_REDIRECT",
      formUrl: parsed.canonicalUrl,
      reason: "Liên kết không chuyển tới trang trả lời Google Form hợp lệ."
    };
  }

  const html = await response.text();
  const metadata = Core.parsePublicLoadData(html);
  const formUrl = Core.responseStartUrl(finalUrl) || finalUrl;
  if (!response.ok || !metadata?.questions?.length) {
    return {
      ok: false,
      code: "NO_QUESTIONS",
      formUrl,
      reason:
        "Không thể đọc câu hỏi trong nền. Form có thể yêu cầu đăng nhập hoặc chưa cấp quyền truy cập."
    };
  }

  return {
    ok: true,
    tabId: null,
    formUrl,
    schema: schemaFromPublicMetadata(metadata, formUrl),
    introPagesSkipped: 0,
    scannedInBackground: true
  };
}

async function openFormTab(url) {
  const parsed = Core.parseGoogleFormUrl(url);
  if (!parsed.valid || parsed.kind === "edit") {
    return { ok: false, reason: parsed.reason || "URL Google Form không hợp lệ." };
  }
  const tab = await chrome.tabs.create({ url: parsed.canonicalUrl, active: true });
  return { ok: true, tabId: tab.id };
}

async function notifyProgress(payload) {
  try {
    await chrome.runtime.sendMessage({ type: "RUN_PROGRESS", ...payload });
  } catch {
    // Workspace có thể đã bị đóng trong lúc chạy.
  }
}

async function waitAfterSubmit(tabId, previousUrl, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let observedLoading = false;

  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "loading") observedLoading = true;
      if (
        tab.status === "complete" &&
        (observedLoading || tabUrl(tab) !== previousUrl)
      ) {
        return tab;
      }
    } catch {
      throw new Error("Tab Google Form đã bị đóng.");
    }
    await delay(150);
  }

  throw new Error("Không nhận được xác nhận sau khi gửi form.");
}

function runtimeQuestions(templateSchema, runtimeSchema) {
  const visible = Array.isArray(runtimeSchema?.currentQuestions)
    ? runtimeSchema.currentQuestions
    : runtimeSchema?.questions || [];
  const templateById = new Map(
    (templateSchema?.questions || []).map((question) => [question.id, question])
  );
  return visible.map((question) => templateById.get(question.id) || question);
}

async function runSingleResponse({
  tabId,
  formUrl,
  templateSchema,
  answers,
  autoSubmit,
  responseNumber,
  responseTotal
}) {
  await resetFormTab(tabId, formUrl);
  const initialScan = await scanTab(tabId);
  if (!initialScan.ok) {
    return { ok: false, reason: initialScan.reason || "Không thể đọc trang đầu của form." };
  }

  let runtimeSchema = initialScan.schema;
  const visitedPageKeys = new Set();
  let filledPageCount = 0;

  while (filledPageCount < 30) {
    const pageKey = runtimeSchema.pageKey || `page-${filledPageCount + 1}`;
    if (visitedPageKeys.has(pageKey)) {
      return {
        ok: false,
        reason: "Phát hiện vòng lặp khi chuyển trang Google Form."
      };
    }
    visitedPageKeys.add(pageKey);

    const questions = runtimeQuestions(templateSchema, runtimeSchema);
    let fillResult = { ok: true, report: [] };
    if (questions.length > 0) {
      fillResult = await sendToFormTab(tabId, {
        type: "FILL_FORM",
        schema: { ...runtimeSchema, questions },
        answers
      });
    }
    if (!fillResult?.ok) {
      return { ok: false, reason: fillResult?.reason || "Không thể điền biểu mẫu." };
    }

    const failedRequired = (fillResult.report || []).filter((item) => {
      const question = questions.find((candidate) => candidate.id === item.id);
      return question?.required && !item.ok;
    });
    if (failedRequired.length > 0) {
      return {
        ok: false,
        reason: "Một số câu bắt buộc trên trang hiện tại không thể tự động điền.",
        report: fillResult.report
      };
    }

    filledPageCount += 1;
    await notifyProgress({
      current: responseNumber,
      total: responseTotal,
      stage: "page_filled",
      page: runtimeSchema.currentPageNumber || filledPageCount,
      pageTotal: templateSchema.pageCount || templateSchema.pages?.length || null
    });

    if (runtimeSchema.hasNextPage) {
      const advanced = await sendToFormTab(tabId, { type: "ADVANCE_FORM_PAGE" });
      if (!advanced?.ok) {
        return {
          ok: false,
          reason: advanced?.reason || "Không thể chuyển sang trang tiếp theo."
        };
      }
      const nextScan = await scanAfterPageTransition(tabId, pageKey, 12000);
      runtimeSchema = nextScan.schema;
      continue;
    }

    if (!autoSubmit) {
      return { ok: true, filledPageCount, submitted: false };
    }
    if (!runtimeSchema.canSubmit) {
      return {
        ok: false,
        reason: "Không tìm thấy nút Gửi ở trang cuối của biểu mẫu."
      };
    }

    const beforeSubmit = tabUrl(await chrome.tabs.get(tabId));
    const submitResult = await sendToFormTab(tabId, { type: "SUBMIT_FORM" });
    if (!submitResult?.ok) {
      return {
        ok: false,
        reason: submitResult?.reason || "Không thể gửi biểu mẫu."
      };
    }
    await waitAfterSubmit(tabId, beforeSubmit);
    await notifyProgress({
      current: responseNumber,
      total: responseTotal,
      stage: "submitted",
      page: filledPageCount,
      pageTotal: templateSchema.pageCount || templateSchema.pages?.length || null
    });
    return { ok: true, filledPageCount, submitted: true };
  }

  return {
    ok: false,
    reason: "Biểu mẫu vượt quá giới hạn an toàn 30 trang."
  };
}

async function runForm({
  tabId,
  formUrl,
  schema,
  answers,
  count,
  autoSubmit
}) {
  const runCount = Number.parseInt(count, 10);
  if (!Number.isInteger(runCount) || runCount < 1 || runCount > MAX_TEST_RESPONSES) {
    return {
      ok: false,
      reason: `Số lượt kiểm thử phải từ 1 đến ${MAX_TEST_RESPONSES}.`
    };
  }

  const target = await getOrCreateTargetTab(tabId, formUrl);
  const targetTabId = target.tabId;

  const missing = Core.validateRequiredAnswers(schema, answers);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Chưa trả lời ${missing.length} câu bắt buộc.`,
      missing
    };
  }

  let totalFilledPages = 0;
  for (let index = 0; index < runCount; index += 1) {
    const result = await runSingleResponse({
      tabId: targetTabId,
      formUrl,
      templateSchema: schema,
      answers,
      autoSubmit,
      responseNumber: index + 1,
      responseTotal: runCount
    });
    if (!result.ok) return result;
    totalFilledPages += result.filledPageCount;
  }

  await chrome.tabs.update(targetTabId, { active: true });
  return {
    ok: true,
    tabId: targetTabId,
    recreatedTab: target.recreated,
    completed: runCount,
    submitted: Boolean(autoSubmit),
    filledPages: totalFilledPages
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "OPEN_AND_SCAN":
        return scanUrlWithoutOpeningTab(message.url);
      case "OPEN_FORM_TAB":
        return openFormTab(message.url);
      case "RESCAN_TAB":
        await waitForTabComplete(message.tabId);
        return scanTab(message.tabId);
      case "ACTIVATE_TAB":
        await chrome.tabs.update(message.tabId, { active: true });
        return { ok: true };
      case "RUN_FORM":
        return runForm(message);
      default:
        return { ok: false, reason: "Thông điệp không được hỗ trợ." };
    }
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, reason: error.message }));

  return true;
});
