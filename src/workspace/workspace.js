(function initWorkspace() {
  "use strict";

  const Core = globalThis.FormPilotCore;
  const state = {
    tabId: null,
    formUrl: "",
    schema: null,
    answers: {},
    busy: false
  };

  const elements = {
    sourceForm: document.querySelector("#source-form"),
    formUrl: document.querySelector("#form-url"),
    scanButton: document.querySelector("#scan-button"),
    status: document.querySelector("#status"),
    connectionBadge: document.querySelector("#connection-badge"),
    accessActions: document.querySelector("#access-actions"),
    openFormTab: document.querySelector("#open-form-tab"),
    rescanForm: document.querySelector("#rescan-form"),
    workspace: document.querySelector("#workspace"),
    formTitle: document.querySelector("#form-title"),
    questionCount: document.querySelector("#question-count"),
    scanSource: document.querySelector("#scan-source"),
    pageWarning: document.querySelector("#page-warning"),
    answerForm: document.querySelector("#answer-form"),
    saveTemplate: document.querySelector("#save-template"),
    fillOnly: document.querySelector("#fill-only"),
    responseCount: document.querySelector("#response-count"),
    submitConsent: document.querySelector("#submit-consent"),
    runSubmit: document.querySelector("#run-submit"),
    runProgress: document.querySelector("#run-progress")
  };

  function setStatus(message, tone = "neutral") {
    elements.status.textContent = message;
    elements.status.className = `status ${tone}`;
  }

  function setConnection(label, tone = "neutral") {
    elements.connectionBadge.textContent = label;
    elements.connectionBadge.className = `badge ${tone}`;
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.scanButton.disabled = busy;
    elements.fillOnly.disabled = busy;
    elements.runSubmit.disabled = busy;
    elements.openFormTab.disabled = busy;
    elements.rescanForm.disabled = busy || !state.tabId;
  }

  function sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  }

  function element(tagName, attributes = {}, text = "") {
    const node = document.createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "className") node.className = value;
      else if (name === "checked") node.checked = Boolean(value);
      else if (name === "value") node.value = value ?? "";
      else if (name === "disabled") node.disabled = Boolean(value);
      else if (value !== undefined && value !== null) node.setAttribute(name, String(value));
    }
    if (text) node.textContent = text;
    return node;
  }

  function updateScalar(questionId, value) {
    state.answers[questionId] = value;
  }

  function updateArray(questionId, value, checked) {
    const current = new Set(Array.isArray(state.answers[questionId]) ? state.answers[questionId] : []);
    if (checked) current.add(value);
    else current.delete(value);
    state.answers[questionId] = [...current];
  }

  function updateGrid(questionId, rowId, value, checked, checkboxMode) {
    const grid = { ...(state.answers[questionId] || {}) };
    if (checkboxMode) {
      const current = new Set(Array.isArray(grid[rowId]) ? grid[rowId] : []);
      if (checked) current.add(value);
      else current.delete(value);
      grid[rowId] = [...current];
    } else {
      grid[rowId] = value;
    }
    state.answers[questionId] = grid;
  }

  function makeChoiceControl(question, value, type) {
    const row = element("label", { className: "choice-row" });
    const input = element("input", {
      type,
      name: type === "radio" ? question.id : `${question.id}-${value}`,
      value,
      checked:
        type === "radio"
          ? state.answers[question.id] === value
          : Array.isArray(state.answers[question.id]) && state.answers[question.id].includes(value)
    });
    input.addEventListener("change", () => {
      if (type === "radio") updateScalar(question.id, value);
      else updateArray(question.id, value, input.checked);
    });
    row.append(input, element("span", {}, value));
    return row;
  }

  function renderTextQuestion(container, question, multiline) {
    const input = element(multiline ? "textarea" : "input", {
      type: multiline ? undefined : "text",
      placeholder: multiline ? "Nhập câu trả lời mẫu" : "Câu trả lời mẫu",
      value: state.answers[question.id] || ""
    });
    input.addEventListener("input", () => updateScalar(question.id, input.value));
    container.append(input);
  }

  function renderChoiceQuestion(container, question, type) {
    const list = element("div", { className: "choice-list" });
    for (const option of question.options) {
      list.append(makeChoiceControl(question, option, type));
    }
    if (question.hasOther) {
      list.append(
        element(
          "p",
          { className: "field-help" },
          "Mục “Khác” cần được kiểm tra thủ công trong MVP."
        )
      );
    }
    container.append(list);
  }

  function renderDropdown(container, question) {
    const select = element("select");
    select.append(element("option", { value: "" }, "Chọn câu trả lời mẫu"));
    for (const option of question.options) {
      select.append(element("option", { value: option }, option));
    }
    select.value = state.answers[question.id] || "";
    select.addEventListener("change", () => updateScalar(question.id, select.value));
    container.append(select);
  }

  function renderScale(container, question) {
    const values =
      question.options.length > 0
        ? question.options
        : Array.from(
            { length: (question.scale?.max || 5) - (question.scale?.min || 1) + 1 },
            (_, index) => String((question.scale?.min || 1) + index)
          );
    const row = element("div", { className: "scale-row" });
    row.append(element("span", { className: "scale-label" }, question.scale?.minLabel || ""));
    const options = element("div", { className: "scale-options" });
    for (const value of values) {
      const label = element("label", { className: "scale-option" });
      const input = element("input", {
        type: "radio",
        name: question.id,
        value,
        checked: String(state.answers[question.id] || "") === String(value)
      });
      input.addEventListener("change", () => updateScalar(question.id, value));
      label.append(element("span", {}, question.type === "rating" ? "★" : value), input);
      options.append(label);
    }
    row.append(options, element("span", { className: "scale-label" }, question.scale?.maxLabel || ""));
    container.append(row);
  }

  function renderDateOrTime(container, question) {
    const input = element("input", {
      type: question.type === "date" ? "date" : "time",
      value: state.answers[question.id] || ""
    });
    input.addEventListener("change", () => updateScalar(question.id, input.value));
    container.append(input);
  }

  function renderGrid(container, question) {
    const checkboxMode = question.type === "grid_checkbox";
    const wrap = element("div", { className: "grid-wrap" });
    const table = element("table", { className: "answer-grid" });
    const head = element("thead");
    const headRow = element("tr");
    headRow.append(element("th", {}, "Tiêu chí"));
    for (const column of question.columns) headRow.append(element("th", {}, column));
    head.append(headRow);
    table.append(head);

    const body = element("tbody");
    for (const row of question.rows) {
      const tableRow = element("tr");
      tableRow.append(element("th", { scope: "row" }, row.label));
      for (const column of question.columns) {
        const cell = element("td");
        const selected = checkboxMode
          ? Array.isArray(state.answers[question.id]?.[row.id]) &&
            state.answers[question.id][row.id].includes(column)
          : state.answers[question.id]?.[row.id] === column;
        const input = element("input", {
          type: checkboxMode ? "checkbox" : "radio",
          name: checkboxMode ? `${question.id}-${row.id}-${column}` : `${question.id}-${row.id}`,
          value: column,
          checked: selected,
          "aria-label": `${row.label}: ${column}`
        });
        input.addEventListener("change", () =>
          updateGrid(question.id, row.id, column, input.checked, checkboxMode)
        );
        cell.append(input);
        tableRow.append(cell);
      }
      body.append(tableRow);
    }
    table.append(body);
    wrap.append(table);
    container.append(wrap);
  }

  function renderQuestion(question, index) {
    const card = element("fieldset", { className: "question-card", "data-question-id": question.id });
    const legend = element("legend");
    const titleRow = element("div", { className: "question-title-row" });
    const title = element("div", { className: "question-title" });
    title.append(document.createTextNode(`${index + 1}. ${question.title}`));
    if (question.required) title.append(element("span", { className: "required-mark" }, " *"));
    titleRow.append(
      title,
      element("span", { className: "type-label" }, Core.TYPE_LABELS[question.type] || question.type)
    );
    legend.append(titleRow);
    card.append(legend);

    switch (question.type) {
      case "short_text":
        renderTextQuestion(card, question, false);
        break;
      case "paragraph":
        renderTextQuestion(card, question, true);
        break;
      case "multiple_choice":
        renderChoiceQuestion(card, question, "radio");
        break;
      case "checkboxes":
        renderChoiceQuestion(card, question, "checkbox");
        break;
      case "dropdown":
        renderDropdown(card, question);
        break;
      case "linear_scale":
      case "rating":
      case "linear_or_rating":
        renderScale(card, question);
        break;
      case "date":
      case "time":
        renderDateOrTime(card, question);
        break;
      case "grid_choice":
      case "grid_checkbox":
        renderGrid(card, question);
        break;
      case "file_upload":
        card.append(
          element(
            "p",
            { className: "field-help" },
            "Trình duyệt yêu cầu người dùng tự chọn tệp. Extension sẽ bỏ qua câu này."
          )
        );
        break;
      default:
        card.append(
          element(
            "p",
            { className: "field-help" },
            "Chưa nhận diện chắc chắn loại câu hỏi; cần điền thủ công."
          )
        );
    }

    return card;
  }

  function renderPageHeader(page, pageNumber, pageTotal) {
    const header = element("section", { className: "page-divider-card" });
    header.append(
      element("p", { className: "eyebrow" }, `Trang ${pageNumber}/${pageTotal}`),
      element("h3", {}, page.title || `Phần ${pageNumber}`)
    );
    if (page.description) {
      header.append(element("p", { className: "page-description" }, page.description));
    }
    return header;
  }

  function renderSchemaQuestions(schema) {
    const questions = Array.isArray(schema.questions) ? schema.questions : [];
    const pages = Array.isArray(schema.pages) ? schema.pages : [];
    if (pages.length <= 1) {
      return questions.map((question, index) => renderQuestion(question, index));
    }

    const byId = new Map(questions.map((question) => [question.id, question]));
    const renderedIds = new Set();
    const nodes = [];
    let questionNumber = 0;

    pages.forEach((page, pageIndex) => {
      nodes.push(renderPageHeader(page, pageIndex + 1, pages.length));
      for (const questionId of page.questionIds || []) {
        const question = byId.get(questionId);
        if (!question) continue;
        nodes.push(renderQuestion(question, questionNumber));
        renderedIds.add(question.id);
        questionNumber += 1;
      }
    });

    for (const question of questions) {
      if (renderedIds.has(question.id)) continue;
      nodes.push(renderQuestion(question, questionNumber));
      questionNumber += 1;
    }
    return nodes;
  }

  function scanSummary(schema) {
    const pageCount = schema.pageCount || schema.pages?.length || 1;
    return `${schema.questions.length} câu hỏi${
      pageCount > 1 ? ` trên ${pageCount} trang` : ""
    }`;
  }

  async function loadSavedAnswers(schema) {
    const key = `template:${schema.fingerprint}`;
    const stored = await chrome.storage.local.get(key);
    state.answers = stored[key]?.answers || {};
  }

  async function renderSchema(schema) {
    state.schema = schema;
    await loadSavedAnswers(schema);
    elements.formTitle.textContent = schema.title || "Google Form";
    elements.questionCount.textContent = `${schema.questions.length} câu hỏi`;
    elements.scanSource.textContent = schema.source === "public-load-data"
      ? "Metadata toàn biểu mẫu"
      : schema.source === "data-params"
        ? "Nhận diện bằng data-params"
        : "ARIA dự phòng";
    const pageCount = schema.pageCount || schema.pages?.length || 1;
    elements.pageWarning.hidden = pageCount <= 1;
    elements.pageWarning.textContent = `${pageCount} trang`;
    elements.answerForm.replaceChildren(...renderSchemaQuestions(schema));
    elements.workspace.hidden = false;
  }

  function handleScanFailure(response) {
    setConnection("Cần xử lý", "warning");
    setStatus(response.reason || "Không thể quét biểu mẫu.", "error");
    if (response.formUrl) state.formUrl = response.formUrl;
    if (response.tabId) state.tabId = response.tabId;
    elements.accessActions.hidden = !state.formUrl;
    elements.rescanForm.disabled = !state.tabId;
  }

  async function scanNewUrl(url) {
    const parsed = Core.parseGoogleFormUrl(url);
    if (!parsed.valid) {
      setStatus(parsed.reason, "error");
      return;
    }
    if (parsed.kind === "edit") {
      setStatus("Hãy dùng liên kết xem trước hoặc liên kết dành cho người trả lời.", "error");
      return;
    }

    state.tabId = null;
    state.formUrl = parsed.canonicalUrl;
    setBusy(true);
    setConnection("Đang quét", "neutral");
    setStatus("Đang mở Google Form và phân tích câu hỏi…", "neutral");
    elements.accessActions.hidden = true;
    try {
      const response = await sendMessage({ type: "OPEN_AND_SCAN", url: parsed.canonicalUrl });
      if (!response?.ok) {
        handleScanFailure(response || {});
        return;
      }
      state.tabId = response.tabId || null;
      state.formUrl = response.formUrl;
      elements.formUrl.value = response.formUrl;
      await renderSchema(response.schema);
      setConnection("Đã kết nối", "success");
      setStatus(
        `${response.scannedInBackground ? "Đã quét trong nền, không mở tab Google Form. " : ""}Đã nhận diện ${scanSummary(response.schema)}.${
          response.introPagesSkipped
            ? ` Đã tự bỏ qua ${response.introPagesSkipped} trang giới thiệu.`
            : ""
        }`,
        "success"
      );
    } catch (error) {
      setStatus(error.message, "error");
      setConnection("Lỗi", "warning");
    } finally {
      setBusy(false);
    }
  }

  async function rescanCurrentTab() {
    if (!state.tabId) return scanNewUrl(elements.formUrl.value);
    setBusy(true);
    setStatus("Đang quét lại tab Google Form…", "neutral");
    try {
      const response = await sendMessage({ type: "RESCAN_TAB", tabId: state.tabId });
      if (!response?.ok) {
        handleScanFailure(response || {});
        return;
      }
      state.formUrl = response.formUrl;
      await renderSchema(response.schema);
      elements.accessActions.hidden = true;
      setConnection("Đã kết nối", "success");
      setStatus(
        `Đã nhận diện ${scanSummary(response.schema)}.${
          response.introPagesSkipped
            ? ` Đã tự bỏ qua ${response.introPagesSkipped} trang giới thiệu.`
            : ""
        }`,
        "success"
      );
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    if (!state.schema) return;
    const key = `template:${state.schema.fingerprint}`;
    await chrome.storage.local.set({
      [key]: {
        title: state.schema.title,
        formUrl: state.formUrl,
        answers: state.answers,
        savedAt: new Date().toISOString()
      }
    });
    setStatus("Đã lưu mẫu câu trả lời trên thiết bị.", "success");
  }

  function validateBeforeRun() {
    const missing = Core.validateRequiredAnswers(state.schema, state.answers);
    if (missing.length > 0) {
      const first = elements.answerForm.querySelector(`[data-question-id="${missing[0].id}"]`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      setStatus(`Còn ${missing.length} câu bắt buộc chưa có đáp án mẫu.`, "error");
      return false;
    }
    return true;
  }

  async function run({ autoSubmit }) {
    if (!state.schema || !validateBeforeRun()) return;
    const count = autoSubmit ? Number.parseInt(elements.responseCount.value, 10) : 1;

    if (autoSubmit && !elements.submitConsent.checked) {
      setStatus("Hãy xác nhận rằng bạn đã kiểm tra đáp án trước khi gửi.", "error");
      return;
    }
    setBusy(true);
    elements.runProgress.textContent = autoSubmit ? "Đang bắt đầu gửi thử…" : "Đang điền form…";
    try {
      const response = await sendMessage({
        type: "RUN_FORM",
        tabId: state.tabId,
        formUrl: state.formUrl,
        schema: state.schema,
        answers: state.answers,
        count,
        autoSubmit
      });
      if (!response?.ok) {
        setStatus(response?.reason || "Không thể chạy biểu mẫu.", "error");
        elements.runProgress.textContent = "Đã dừng.";
        return;
      }
      if (response.tabId) state.tabId = response.tabId;
      elements.runProgress.textContent = autoSubmit
        ? `Đã gửi ${response.completed} phản hồi thử.`
        : `Đã điền ${response.filledPages || 1} trang. Hãy kiểm tra trong tab Google Form.`;
      setStatus(
        autoSubmit ? "Hoàn tất lượt gửi thử." : "Đã điền form và mở để bạn kiểm tra.",
        "success"
      );
    } catch (error) {
      setStatus(error.message, "error");
      elements.runProgress.textContent = "Đã dừng.";
    } finally {
      setBusy(false);
    }
  }

  elements.sourceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    scanNewUrl(elements.formUrl.value);
  });
  elements.openFormTab.addEventListener("click", async () => {
    if (state.tabId) {
      await sendMessage({ type: "ACTIVATE_TAB", tabId: state.tabId });
      return;
    }

    const url = state.formUrl || elements.formUrl.value;
    setBusy(true);
    try {
      const response = await sendMessage({ type: "OPEN_FORM_TAB", url });
      if (!response?.ok) {
        setStatus(response?.reason || "Không thể mở Google Form.", "error");
        return;
      }
      state.tabId = response.tabId;
      elements.rescanForm.disabled = false;
      setStatus("Đã mở Google Form theo yêu cầu. Sau khi đăng nhập, quay lại và bấm Quét lại.", "neutral");
    } catch (error) {
      setStatus(error.message, "error");
    } finally {
      setBusy(false);
    }
  });
  elements.rescanForm.addEventListener("click", rescanCurrentTab);
  elements.saveTemplate.addEventListener("click", saveTemplate);
  elements.fillOnly.addEventListener("click", () => run({ autoSubmit: false }));
  elements.runSubmit.addEventListener("click", () => run({ autoSubmit: true }));

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "RUN_PROGRESS") return;
    if (message.stage === "submitted") {
      elements.runProgress.textContent = `Đã gửi lượt ${message.current}/${message.total}.`;
      return;
    }
    const page = message.page ? ` · trang ${message.page}${message.pageTotal ? `/${message.pageTotal}` : ""}` : "";
    elements.runProgress.textContent = `Đang điền lượt ${message.current}/${message.total}${page}.`;
  });

  const initialUrl = new URLSearchParams(location.search).get("url") || "";
  elements.formUrl.value = initialUrl;
  if (initialUrl) scanNewUrl(initialUrl);
})();
