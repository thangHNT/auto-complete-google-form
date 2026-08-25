(function initFormPilotCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.FormPilotCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const QUESTION_TYPES = Object.freeze({
    0: "short_text",
    1: "paragraph",
    2: "multiple_choice",
    3: "dropdown",
    4: "checkboxes",
    5: "linear_scale",
    7: "grid",
    9: "date",
    10: "time",
    13: "file_upload",
    18: "rating"
  });

  const TYPE_LABELS = Object.freeze({
    short_text: "Trả lời ngắn",
    paragraph: "Đoạn văn",
    multiple_choice: "Trắc nghiệm",
    dropdown: "Menu thả xuống",
    checkboxes: "Hộp kiểm",
    linear_scale: "Phạm vi tuyến tính",
    rating: "Xếp hạng",
    grid_choice: "Lưới trắc nghiệm",
    grid_checkbox: "Lưới hộp kiểm",
    date: "Ngày",
    time: "Giờ",
    file_upload: "Tải tệp",
    page_break: "Phần mới",
    unknown: "Không xác định"
  });

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("vi");
  }

  function dedupeRepeatedText(value) {
    const text = String(value || "").trim();
    if (!text || text.length % 2 !== 0) return text;
    const half = text.length / 2;
    return text.slice(0, half) === text.slice(half) ? text.slice(0, half) : text;
  }

  function parseGoogleFormUrl(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      return { valid: false, reason: "Vui lòng nhập liên kết Google Form." };
    }

    let url;
    try {
      url = new URL(raw);
    } catch {
      return { valid: false, reason: "Liên kết không đúng định dạng URL." };
    }

    if (url.protocol !== "https:") {
      return { valid: false, reason: "Google Form phải sử dụng HTTPS." };
    }

    if (url.hostname === "forms.gle") {
      const slug = url.pathname.split("/").filter(Boolean)[0];
      if (!slug) {
        return { valid: false, reason: "Liên kết forms.gle chưa đầy đủ." };
      }
      return {
        valid: true,
        kind: "short",
        canonicalUrl: url.toString(),
        formId: slug,
        isPublicId: true
      };
    }

    if (url.hostname !== "docs.google.com") {
      return { valid: false, reason: "Đây không phải liên kết Google Forms." };
    }

    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] !== "forms") {
      return { valid: false, reason: "Đây không phải liên kết Google Forms." };
    }

    const dIndex = segments.indexOf("d");
    if (dIndex < 0 || !segments[dIndex + 1]) {
      return { valid: false, reason: "Không tìm thấy mã Google Form trong liên kết." };
    }

    const isPublicId = segments[dIndex + 1] === "e";
    const formId = isPublicId ? segments[dIndex + 2] : segments[dIndex + 1];
    const action = isPublicId ? segments[dIndex + 3] : segments[dIndex + 2];

    if (!formId) {
      return { valid: false, reason: "Mã Google Form không hợp lệ." };
    }

    const actionMap = {
      edit: "edit",
      preview: "preview",
      viewform: "response",
      formResponse: "response"
    };
    const kind = actionMap[action];
    if (!kind) {
      return {
        valid: false,
        reason: "Hãy dùng liên kết chỉnh sửa, xem trước hoặc liên kết dành cho người trả lời."
      };
    }

    return {
      valid: true,
      kind,
      canonicalUrl: url.toString(),
      formId,
      isPublicId,
      accountIndex:
        segments[1] === "u" && /^\d+$/.test(segments[2] || "")
          ? Number(segments[2])
          : null
    };
  }

  function previewUrlFromEdit(editUrl) {
    const parsed = parseGoogleFormUrl(editUrl);
    if (!parsed.valid || parsed.kind !== "edit" || parsed.isPublicId) return null;
    const url = new URL(parsed.canonicalUrl);
    url.pathname = url.pathname.replace(/\/edit\/?$/, "/preview");
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function responseStartUrl(responseUrl) {
    const parsed = parseGoogleFormUrl(responseUrl);
    if (!parsed.valid || parsed.kind !== "response") return null;
    const url = new URL(parsed.canonicalUrl);
    url.pathname = url.pathname.replace(/\/formResponse\/?$/, "/viewform");
    url.searchParams.delete("pageHistory");
    url.hash = "";
    return url.toString();
  }

  function extractFirstJsonArray(value) {
    const source = String(value || "");
    const start = source.indexOf("[");
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "[" || character === "{") depth += 1;
      if (character === "]" || character === "}") depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }

    return null;
  }

  function parseQuestionPayload(payload, source = "data-params") {
    if (!Array.isArray(payload) || payload.length < 5) return null;

    const questionId = payload[0];
    const title = String(payload[1] || "").trim();
    const description = String(payload[2] || "").trim();
    const typeCode = Number(payload[3]);
    const entries = Array.isArray(payload[4]) ? payload[4] : [];

    if (!title || !Number.isFinite(typeCode) || entries.length === 0) return null;

    const firstEntry = entries[0] || [];
    const rawOptions = Array.isArray(firstEntry[1]) ? firstEntry[1] : [];
    const options = rawOptions
      .filter(Array.isArray)
      .map((option) => String(option[0] ?? ""))
      .filter(Boolean);
    const hasOther = rawOptions.some(
      (option) => Array.isArray(option) && Boolean(option[4])
    );

    let type = QUESTION_TYPES[typeCode] || "unknown";
    const gridIsCheckbox =
      typeCode === 7 &&
      entries.some(
        (entry) => Array.isArray(entry?.[11]) && Boolean(entry[11][0])
      );
    if (typeCode === 7) {
      type = gridIsCheckbox ? "grid_checkbox" : "grid_choice";
    }

    const rows =
      typeCode === 7
        ? entries.map((entry, index) => ({
            id: String(entry?.[0] ?? `row-${index + 1}`),
            label: String(entry?.[3]?.[0] || `Hàng ${index + 1}`)
          }))
        : [];

    const scaleValues =
      typeCode === 5 || typeCode === 18
        ? options.map(Number).filter(Number.isFinite)
        : [];

    return {
      id: `q-${questionId}`,
      questionId: String(questionId),
      entryIds: entries.map((entry) => String(entry?.[0] ?? "")).filter(Boolean),
      type,
      typeCode,
      title,
      description,
      required: entries.some((entry) => Boolean(entry?.[2])),
      options,
      hasOther,
      rows,
      columns: typeCode === 7 ? options : [],
      scale:
        scaleValues.length > 0
          ? {
              min: Math.min(...scaleValues),
              max: Math.max(...scaleValues),
              minLabel: String(firstEntry?.[3]?.[0] || ""),
              maxLabel: String(firstEntry?.[3]?.[1] || "")
            }
          : null,
      ratingStyle: typeCode === 18 ? Number(firstEntry?.[14]?.[0] ?? 1) : null,
      source
    };
  }

  function parseDataParams(rawValue) {
    const raw = String(rawValue || "");
    const jsonText = extractFirstJsonArray(raw.startsWith("%.@.") ? raw.slice(4) : raw);
    if (!jsonText) return null;
    let payload;

    try {
      payload = JSON.parse(jsonText);
    } catch {
      return null;
    }

    return parseQuestionPayload(payload);
  }

  function parsePublicLoadData(rawScript) {
    const source = String(rawScript || "");
    const markerIndex = source.indexOf("FB_PUBLIC_LOAD_DATA_");
    if (markerIndex < 0) return null;

    const assignment = source.indexOf("=", markerIndex);
    const jsonText = extractFirstJsonArray(
      assignment >= 0 ? source.slice(assignment + 1) : source.slice(markerIndex)
    );
    if (!jsonText) return null;

    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return null;
    }

    const formData = Array.isArray(payload?.[1]) ? payload[1] : null;
    const items = Array.isArray(formData?.[1]) ? formData[1] : [];
    if (!formData || items.length === 0) return null;

    const pages = [];
    const questions = [];
    let currentPage = null;

    function startPage(item = null) {
      const sectionId = item?.[0];
      const page = {
        id: sectionId === null || sectionId === undefined
          ? `page-${pages.length + 1}`
          : `page-${sectionId}`,
        index: pages.length,
        title: String(item?.[1] || "").trim(),
        description: String(item?.[2] || "").trim(),
        questionIds: []
      };
      pages.push(page);
      currentPage = page;
      return page;
    }

    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const typeCode = Number(item[3]);
      if (typeCode === 8) {
        startPage(item);
        continue;
      }

      const question = parseQuestionPayload(item, "public-load-data");
      if (!question) continue;
      if (!currentPage) startPage();

      const questionWithPage = {
        ...question,
        pageId: currentPage.id,
        pageIndex: currentPage.index
      };
      questions.push(questionWithPage);
      currentPage.questionIds.push(questionWithPage.id);
    }

    if (questions.length === 0) return null;

    return {
      title: String(formData[8] || "").trim(),
      description: String(formData[0] || "").trim(),
      questions,
      pages
    };
  }

  function questionSignature(question) {
    return `${normalizeText(question?.title)}::${String(question?.type || "unknown")}`;
  }

  function makeFingerprint(title, questions) {
    const source = [normalizeText(title), ...questions.map(questionSignature)].join("|");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fp-${(hash >>> 0).toString(16)}`;
  }

  function compareSchemas(target, candidate) {
    if (!target || !candidate) {
      return { match: false, score: 0, reason: "Thiếu dữ liệu biểu mẫu." };
    }

    const targetQuestions = Array.isArray(target.questions) ? target.questions : [];
    const candidateQuestions = Array.isArray(candidate.questions) ? candidate.questions : [];
    if (targetQuestions.length === 0 || candidateQuestions.length === 0) {
      return { match: false, score: 0, reason: "Không đọc được danh sách câu hỏi." };
    }

    const candidateSignatures = new Set(candidateQuestions.map(questionSignature));
    const matchedQuestions = targetQuestions.filter((question) =>
      candidateSignatures.has(questionSignature(question))
    ).length;
    const questionScore = matchedQuestions / targetQuestions.length;
    const titleMatches = normalizeText(target.title) === normalizeText(candidate.title);
    const score = questionScore * 0.85 + (titleMatches ? 0.15 : 0);

    return {
      match: titleMatches && questionScore >= 0.8,
      score,
      titleMatches,
      matchedQuestions,
      totalQuestions: targetQuestions.length,
      reason:
        titleMatches && questionScore >= 0.8
          ? "Biểu mẫu khớp với bản chỉnh sửa."
          : "Tiêu đề hoặc danh sách câu hỏi không khớp."
    };
  }

  function isAnswerEmpty(question, answer) {
    if (question.type === "checkboxes") {
      return !Array.isArray(answer) || answer.length === 0;
    }
    if (question.type === "grid_choice" || question.type === "grid_checkbox") {
      if (!answer || typeof answer !== "object") return true;
      return question.rows.some((row) => {
        const value = answer[row.id];
        return question.type === "grid_checkbox"
          ? !Array.isArray(value) || value.length === 0
          : !String(value || "").trim();
      });
    }
    return !String(answer ?? "").trim();
  }

  function validateRequiredAnswers(schema, answers) {
    const questions = Array.isArray(schema?.questions) ? schema.questions : [];
    return questions
      .filter((question) => question.required && isAnswerEmpty(question, answers?.[question.id]))
      .map((question) => ({ id: question.id, title: question.title }));
  }

  return Object.freeze({
    QUESTION_TYPES,
    TYPE_LABELS,
    compareSchemas,
    dedupeRepeatedText,
    extractFirstJsonArray,
    makeFingerprint,
    normalizeText,
    parseDataParams,
    parsePublicLoadData,
    parseQuestionPayload,
    parseGoogleFormUrl,
    previewUrlFromEdit,
    questionSignature,
    responseStartUrl,
    validateRequiredAnswers
  });
});
