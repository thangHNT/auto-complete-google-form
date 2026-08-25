(function initFormPilotContent() {
  "use strict";

  if (globalThis.__FORM_PILOT_CONTENT__) return;
  globalThis.__FORM_PILOT_CONTENT__ = true;

  const Core = globalThis.FormPilotCore;
  if (!Core) {
    throw new Error("FormPilotCore chưa được tải.");
  }

  const RESPONSE_ROLES = ["radio", "checkbox", "listbox", "textbox", "combobox"];

  function textOf(element) {
    return String(element?.innerText || element?.textContent || "").trim();
  }

  function controlLabel(element) {
    return String(
      element?.getAttribute?.("aria-label") ||
        element?.getAttribute?.("data-value") ||
        textOf(element)
    ).trim();
  }

  function isVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function findButtonByText(labels) {
    const normalized = labels.map(Core.normalizeText);
    return [...document.querySelectorAll('button, [role="button"]')].find((button) => {
      if (!isVisible(button)) return false;
      if (button.disabled || button.getAttribute("aria-disabled") === "true") return false;
      return normalized.includes(Core.normalizeText(textOf(button)));
    });
  }

  function getFormTitle() {
    const ignored = new Set([
      "chế độ xem trước",
      "preview mode",
      "google biểu mẫu",
      "google forms"
    ]);
    const headings = [...document.querySelectorAll("h1, [role='heading'][aria-level='1']")]
      .map(textOf)
      .map(Core.dedupeRepeatedText)
      .filter((title) => title && !ignored.has(Core.normalizeText(title)));
    if (headings.length > 0) return headings[headings.length - 1];

    return Core.dedupeRepeatedText(
      document.title
        .replace(/\s+-\s+Google (Forms|Biểu mẫu).*$/i, "")
        .trim()
    );
  }

  function scanDataParamsQuestions() {
    const seen = new Set();
    const result = [];

    for (const element of document.querySelectorAll("[data-params]")) {
      const question = Core.parseDataParams(element.getAttribute("data-params"));
      if (!question || seen.has(question.id)) continue;
      seen.add(question.id);
      result.push({ question, element });
    }

    return result;
  }

  function readPublicFormMetadata() {
    for (const script of document.scripts) {
      const source = String(script.textContent || "");
      if (!source.includes("FB_PUBLIC_LOAD_DATA_")) continue;
      const metadata = Core.parsePublicLoadData(source);
      if (metadata) return metadata;
    }
    return null;
  }

  function enrichLiveQuestions(liveQuestions, metadata) {
    if (!metadata?.questions?.length) return liveQuestions;
    const byId = new Map(metadata.questions.map((question) => [question.id, question]));
    const bySignature = new Map(
      metadata.questions.map((question) => [Core.questionSignature(question), question])
    );

    return liveQuestions.map((question) => {
      const complete = byId.get(question.id) || bySignature.get(Core.questionSignature(question));
      return complete ? { ...question, ...complete } : question;
    });
  }

  function closestQuestionRoot(heading) {
    let node = heading;
    for (let level = 0; node && level < 8; level += 1, node = node.parentElement) {
      if (
        RESPONSE_ROLES.some((role) => node.querySelector?.(`[role="${role}"]`)) ||
        node.querySelector?.("input, textarea, select")
      ) {
        return node;
      }
    }
    return heading.parentElement;
  }

  function fallbackType(root) {
    if (!root) return "unknown";
    if (root.querySelector('input[type="file"]')) return "file_upload";
    if (root.querySelector('input[type="date"], [aria-label="Ngày"], [aria-label="Date"]')) {
      return "date";
    }

    const timeFields = root.querySelectorAll(
      '[aria-label="Giờ"], [aria-label="Phút"], [aria-label="Hour"], [aria-label="Minute"]'
    );
    if (timeFields.length >= 2) return "time";
    if (root.querySelector('[role="listbox"], select')) return "dropdown";

    const radioGroups = root.querySelectorAll('[role="radiogroup"]');
    if (radioGroups.length > 1) return "grid_choice";

    const checkboxes = root.querySelectorAll('[role="checkbox"], input[type="checkbox"]');
    if (checkboxes.length > 0) {
      const labels = [...checkboxes].map(controlLabel);
      const looksLikeGrid = labels.some((label) => /câu trả lời cho|answer for/i.test(label));
      return looksLikeGrid ? "grid_checkbox" : "checkboxes";
    }

    const radios = root.querySelectorAll('[role="radio"], input[type="radio"]');
    if (radios.length > 0) {
      const labels = [...radios].map(controlLabel);
      const allNumeric = labels.every((label) => /^\d+$/.test(label));
      return allNumeric ? "linear_or_rating" : "multiple_choice";
    }

    if (root.querySelector("textarea")) return "paragraph";
    if (root.querySelector('input:not([type="hidden"])')) return "short_text";
    return "unknown";
  }

  function scanFallbackQuestions() {
    const headings = [
      ...document.querySelectorAll("h3, [role='heading'][aria-level='3']")
    ];

    return headings
      .map((heading, index) => {
        if (!isVisible(heading)) return null;
        const root = closestQuestionRoot(heading);
        const title = textOf(heading).replace(/\s*\*\s*$/, "").trim();
        if (!title || !root) return null;

        const type = fallbackType(root);
        if (type === "unknown") return null;
        const options = [
          ...root.querySelectorAll(
            '[role="radio"], [role="checkbox"], [role="option"], option'
          )
        ]
          .map(controlLabel)
          .filter(Boolean);

        return {
          question: {
            id: `fallback-${index + 1}`,
            questionId: `fallback-${index + 1}`,
            entryIds: [],
            type,
            typeCode: null,
            title,
            description: "",
            required: /bắt buộc|required/i.test(textOf(heading)),
            options: [...new Set(options)],
            hasOther: false,
            rows: [],
            columns: [],
            scale: null,
            ratingStyle: null,
            source: "aria-fallback"
          },
          element: root
        };
      })
      .filter(Boolean);
  }

  function scanForm() {
    const parsedQuestions = scanDataParamsQuestions();
    const entries = parsedQuestions.length > 0 ? parsedQuestions : scanFallbackQuestions();
    const metadata = readPublicFormMetadata();
    const currentQuestions = enrichLiveQuestions(
      entries.map(({ question }) => question),
      metadata
    );
    const questions = metadata?.questions?.length ? metadata.questions : currentQuestions;
    const pages = metadata?.pages?.length
      ? metadata.pages
      : questions.length
        ? [{
            id: "page-1",
            index: 0,
            title: "",
            description: "",
            questionIds: questions.map((question) => question.id)
          }]
        : [];
    const title = metadata?.title || getFormTitle();
    const pathname = location.pathname;
    const submitButton = findButtonByText(["Gửi", "Submit"]);
    const nextButton = findButtonByText(["Tiếp", "Next"]);
    const currentPageIndex = currentQuestions.find(
      (question) => Number.isInteger(question.pageIndex)
    )?.pageIndex ?? null;
    const pageHistory = String(
      document.querySelector('input[name="pageHistory"]')?.value || ""
    );
    const visibleHeadings = [...document.querySelectorAll("h1, h2, [role='heading']")]
      .filter(isVisible)
      .map(textOf)
      .map(Core.normalizeText)
      .filter(Boolean)
      .join("|");
    const pageKey = [
      `history:${pageHistory}`,
      `questions:${currentQuestions.map((question) => question.id).join(",")}`,
      `headings:${visibleHeadings}`
    ].join(";");

    return {
      title,
      description:
        metadata?.description ||
        textOf(
          document.querySelector("[data-form-description], .freebirdFormviewerViewDescription")
        ),
      url: location.href,
      pathname,
      questions,
      currentQuestions,
      pages,
      pageCount: pages.length,
      currentPageIndex,
      currentPageNumber: currentPageIndex === null ? null : currentPageIndex + 1,
      pageHistory,
      pageKey,
      fingerprint: Core.makeFingerprint(title, questions),
      source: metadata
        ? "public-load-data"
        : parsedQuestions.length > 0
          ? "data-params"
          : "aria-fallback",
      isPreview: /\/preview\/?$/.test(pathname),
      canSubmit: Boolean(submitButton),
      hasNextPage: Boolean(nextButton),
      scannedAt: new Date().toISOString()
    };
  }

  function scheduleClickAfterResponse(button) {
    setTimeout(() => {
      if (button?.isConnected) button.click();
    }, 120);
  }

  function advanceEmptyIntroPage() {
    const initial = scanForm();
    if (initial.questions.length > 0) {
      return { ok: true, advanced: false };
    }

    const nextButton = findButtonByText(["Tiếp", "Next"]);
    if (!nextButton) {
      return {
        ok: false,
        reason: "Trang hiện tại không có câu hỏi và cũng không có nút Tiếp."
      };
    }

    // Trả message trước khi điều hướng để port không bị đóng bởi back/forward cache.
    scheduleClickAfterResponse(nextButton);
    return { ok: true, advanced: true, scheduled: true };
  }

  function advanceFormPage() {
    const initial = scanForm();
    const nextButton = findButtonByText(["Tiếp", "Next"]);
    if (!nextButton) {
      return {
        ok: false,
        code: "NO_NEXT_PAGE",
        reason: "Không tìm thấy nút Tiếp trên trang hiện tại."
      };
    }

    scheduleClickAfterResponse(nextButton);
    return {
      ok: true,
      advanced: true,
      scheduled: true,
      previousPageKey: initial.pageKey
    };
  }

  function findQuestionRoot(question) {
    if (!question) return null;
    if (question.questionId && !question.questionId.startsWith("fallback-")) {
      for (const element of document.querySelectorAll("[data-params]")) {
        const parsed = Core.parseDataParams(element.getAttribute("data-params"));
        if (parsed?.questionId === question.questionId) return element;
      }
    }

    const expectedTitle = Core.normalizeText(question.title);
    const headings = [
      ...document.querySelectorAll("h3, [role='heading'][aria-level='3']")
    ];
    const heading = headings.find((candidate) =>
      Core.normalizeText(textOf(candidate)).includes(expectedTitle)
    );
    return heading ? closestQuestionRoot(heading) : null;
  }

  function setNativeValue(element, value) {
    if (!element) return false;
    const nextValue = String(value ?? "");

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, nextValue);
      else element.value = nextValue;
    } else if (element.isContentEditable) {
      element.textContent = nextValue;
    } else {
      return false;
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function isControlChecked(control) {
    return (
      control.checked === true ||
      control.getAttribute("aria-checked") === "true" ||
      control.getAttribute("data-checked") === "true"
    );
  }

  function setControlChecked(control, shouldBeChecked) {
    if (!control || isControlChecked(control) === shouldBeChecked) return false;
    control.click();
    return true;
  }

  function findControl(root, role, value, rowLabel) {
    const expected = Core.normalizeText(value);
    const row = Core.normalizeText(rowLabel);
    return [...root.querySelectorAll(`[role="${role}"], input[type="${role}"]`)].find(
      (control) => {
        const label = Core.normalizeText(controlLabel(control));
        return row ? label.includes(expected) && label.includes(row) : label === expected;
      }
    );
  }

  function fillText(root, answer, multiline) {
    const selector = multiline
      ? "textarea, [role='textbox'][aria-multiline='true']"
      : "input:not([type='hidden']):not([type='radio']):not([type='checkbox']), [role='textbox']:not([aria-multiline='true'])";
    const element = [...root.querySelectorAll(selector)].find(
      (candidate) => !candidate.disabled && isVisible(candidate)
    );
    return setNativeValue(element, answer);
  }

  function fillChoice(root, answer) {
    const control = findControl(root, "radio", answer);
    if (!control) return false;
    setControlChecked(control, true);
    return true;
  }

  function fillCheckboxes(root, answer) {
    const selected = new Set((Array.isArray(answer) ? answer : []).map(Core.normalizeText));
    const controls = [
      ...root.querySelectorAll('[role="checkbox"], input[type="checkbox"]')
    ];
    for (const control of controls) {
      const label = Core.normalizeText(controlLabel(control));
      setControlChecked(control, selected.has(label));
    }
    return controls.length > 0;
  }

  async function fillDropdown(root, answer) {
    const listbox = root.querySelector('[role="listbox"], select');
    if (!listbox) return false;
    if (listbox instanceof HTMLSelectElement) {
      const option = [...listbox.options].find(
        (candidate) => Core.normalizeText(candidate.textContent) === Core.normalizeText(answer)
      );
      return option ? setNativeValue(listbox, option.value) : false;
    }

    listbox.click();
    const expected = Core.normalizeText(answer);
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (candidate) =>
          isVisible(candidate) && Core.normalizeText(textOf(candidate)) === expected
      );
      if (option) {
        option.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return false;
  }

  function fillDate(root, answer) {
    const input =
      root.querySelector('input[type="date"]') ||
      root.querySelector('[aria-label="Ngày"], [aria-label="Date"]');
    return setNativeValue(input, answer);
  }

  function fillTime(root, answer) {
    const [hour = "", minute = ""] = String(answer || "").split(":");
    const hourInput = root.querySelector('[aria-label="Giờ"], [aria-label="Hour"]');
    const minuteInput = root.querySelector('[aria-label="Phút"], [aria-label="Minute"]');
    const hourSet = setNativeValue(hourInput, hour.replace(/^0/, ""));
    const minuteSet = setNativeValue(minuteInput, minute);
    return hourSet && minuteSet;
  }

  function fillGrid(root, question, answer, checkboxMode) {
    if (!answer || typeof answer !== "object") return false;
    let touched = false;

    for (const row of question.rows) {
      const value = answer[row.id];
      if (checkboxMode) {
        const selected = new Set((Array.isArray(value) ? value : []).map(Core.normalizeText));
        const controls = [...root.querySelectorAll('[role="checkbox"]')].filter((control) =>
          Core.normalizeText(controlLabel(control)).includes(Core.normalizeText(row.label))
        );
        for (const control of controls) {
          const label = Core.normalizeText(controlLabel(control));
          const shouldCheck = [...selected].some((column) => label.includes(column));
          setControlChecked(control, shouldCheck);
          touched = true;
        }
      } else if (value) {
        const control = findControl(root, "radio", value, row.label);
        if (control) {
          setControlChecked(control, true);
          touched = true;
        }
      }
    }

    return touched;
  }

  async function fillQuestion(question, answer) {
    const root = findQuestionRoot(question);
    if (!root) return { ok: false, reason: "Không tìm thấy câu hỏi trên trang." };

    let ok = false;
    switch (question.type) {
      case "short_text":
        ok = fillText(root, answer, false);
        break;
      case "paragraph":
        ok = fillText(root, answer, true);
        break;
      case "multiple_choice":
      case "linear_scale":
      case "rating":
      case "linear_or_rating":
        ok = fillChoice(root, answer);
        break;
      case "checkboxes":
        ok = fillCheckboxes(root, answer);
        break;
      case "dropdown":
        ok = await fillDropdown(root, answer);
        break;
      case "date":
        ok = fillDate(root, answer);
        break;
      case "time":
        ok = fillTime(root, answer);
        break;
      case "grid_choice":
        ok = fillGrid(root, question, answer, false);
        break;
      case "grid_checkbox":
        ok = fillGrid(root, question, answer, true);
        break;
      case "file_upload":
        return { ok: false, reason: "Tải tệp cần người dùng chọn tệp thủ công." };
      default:
        return { ok: false, reason: "Loại câu hỏi chưa được hỗ trợ." };
    }

    return { ok, reason: ok ? "" : "Không tìm thấy điều khiển phù hợp." };
  }

  async function fillForm(schema, answers) {
    const report = [];
    for (const question of schema.questions || []) {
      const answer = answers?.[question.id];
      if (
        answer === undefined ||
        answer === null ||
        answer === "" ||
        (Array.isArray(answer) && answer.length === 0)
      ) {
        report.push({ id: question.id, ok: !question.required, skipped: true });
        continue;
      }
      const result = await fillQuestion(question, answer);
      report.push({ id: question.id, ...result });
    }
    return report;
  }

  function submitForm() {
    const nextButton = findButtonByText(["Tiếp", "Next"]);
    if (nextButton) {
      return {
        ok: false,
        code: "NEXT_PAGE_REQUIRED",
        reason: "Biểu mẫu vẫn còn trang tiếp theo."
      };
    }

    const submitButton = findButtonByText(["Gửi", "Submit"]);
    if (!submitButton) {
      return {
        ok: false,
        code: "NO_SUBMIT",
        reason: "Không tìm thấy nút gửi hoặc biểu mẫu chưa được xuất bản."
      };
    }

    // Trả message trước khi điều hướng để port không bị đóng bởi back/forward cache.
    scheduleClickAfterResponse(submitButton);
    return { ok: true, scheduled: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case "PING":
          return { ok: true, url: location.href };
        case "SCAN_FORM":
          return { ok: true, schema: scanForm() };
        case "ADVANCE_EMPTY_INTRO":
          return advanceEmptyIntroPage();
        case "ADVANCE_FORM_PAGE":
          return advanceFormPage();
        case "FILL_FORM":
          return {
            ok: true,
            report: await fillForm(message.schema, message.answers)
          };
        case "SUBMIT_FORM":
          return submitForm();
        default:
          return { ok: false, reason: "Thông điệp không được hỗ trợ." };
      }
    })()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  });
})();
