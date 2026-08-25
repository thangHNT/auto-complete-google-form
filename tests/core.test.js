"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../src/shared/core.js");

function dataParams(payload) {
  return `%.@.${JSON.stringify(payload)}`;
}

function publicLoadData(items, title = "Form nhiều trang") {
  const formData = [];
  formData[0] = "Mô tả biểu mẫu";
  formData[1] = items;
  formData[8] = title;
  return `window.FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, formData])};`;
}

test("parseGoogleFormUrl accepts response, preview, edit and short URLs", () => {
  assert.deepEqual(
    Core.parseGoogleFormUrl("https://docs.google.com/forms/d/e/PUBLIC_ID/viewform?usp=sharing"),
    {
      valid: true,
      kind: "response",
      canonicalUrl: "https://docs.google.com/forms/d/e/PUBLIC_ID/viewform?usp=sharing",
      formId: "PUBLIC_ID",
      isPublicId: true,
      accountIndex: null
    }
  );

  const preview = Core.parseGoogleFormUrl(
    "https://docs.google.com/forms/d/INTERNAL_ID/preview"
  );
  assert.equal(preview.valid, true);
  assert.equal(preview.kind, "preview");
  assert.equal(preview.formId, "INTERNAL_ID");

  const edit = Core.parseGoogleFormUrl(
    "https://docs.google.com/forms/u/1/d/INTERNAL_ID/edit"
  );
  assert.equal(edit.kind, "edit");
  assert.equal(edit.accountIndex, 1);

  const short = Core.parseGoogleFormUrl("https://forms.gle/abc123");
  assert.equal(short.valid, true);
  assert.equal(short.kind, "short");

  const reportedLink = Core.parseGoogleFormUrl(
    "https://docs.google.com/forms/d/e/1FAIpQLScncF7xi9lCFIj8B-mFYvIm3x7qS93Dxiwxf1rnzYP0Ftt72g/viewform?usp=dialog"
  );
  assert.equal(reportedLink.valid, true);
  assert.equal(reportedLink.kind, "response");

  const responseStep = Core.parseGoogleFormUrl(
    "https://docs.google.com/forms/d/e/PUBLIC_ID/formResponse"
  );
  assert.equal(responseStep.valid, true);
  assert.equal(responseStep.kind, "response");
});

test("parseGoogleFormUrl rejects unrelated and malformed URLs", () => {
  assert.equal(Core.parseGoogleFormUrl("https://example.com/form").valid, false);
  assert.equal(Core.parseGoogleFormUrl("javascript:alert(1)").valid, false);
  assert.equal(Core.parseGoogleFormUrl("not-a-url").valid, false);
});

test("previewUrlFromEdit preserves account route and removes query", () => {
  assert.equal(
    Core.previewUrlFromEdit(
      "https://docs.google.com/forms/u/0/d/FORM_ID/edit?usp=drive_web"
    ),
    "https://docs.google.com/forms/u/0/d/FORM_ID/preview"
  );
});

test("responseStartUrl resets an in-progress formResponse URL", () => {
  assert.equal(
    Core.responseStartUrl(
      "https://docs.google.com/forms/d/e/PUBLIC_ID/formResponse?pageHistory=0,1&usp=dialog"
    ),
    "https://docs.google.com/forms/d/e/PUBLIC_ID/viewform?usp=dialog"
  );
});

test("parseDataParams recognizes basic question types", () => {
  const short = Core.parseDataParams(
    dataParams([101, "Họ và tên", null, 0, [[201, null, true]]])
  );
  assert.equal(short.type, "short_text");
  assert.equal(short.required, true);
  assert.equal(short.id, "q-101");

  const choice = Core.parseDataParams(
    dataParams([
      102,
      "Hệ điều hành",
      null,
      2,
      [[202, [["Windows", null, null, null, false], ["Linux", null, null, null, false]], false]]
    ])
  );
  assert.equal(choice.type, "multiple_choice");
  assert.deepEqual(choice.options, ["Windows", "Linux"]);
});

test("parseDataParams ignores Google metadata appended after the question array", () => {
  const raw = `${dataParams([107, "Câu hỏi thật", null, 0, [[207, null, false]]])},"i3","i4",false`;
  const question = Core.parseDataParams(raw);
  assert.equal(question.title, "Câu hỏi thật");
  assert.equal(question.type, "short_text");
});

test("parseDataParams distinguishes choice and checkbox grids", () => {
  const choiceGrid = Core.parseDataParams(
    dataParams([
      103,
      "Đánh giá",
      null,
      7,
      [
        [301, [["Kém"], ["Tốt"]], true, ["Tốc độ"], null, null, null, null, null, null, [], [false]],
        [302, [["Kém"], ["Tốt"]], true, ["Giao diện"], null, null, null, null, null, null, [], [false]]
      ]
    ])
  );
  assert.equal(choiceGrid.type, "grid_choice");
  assert.deepEqual(choiceGrid.rows.map((row) => row.label), ["Tốc độ", "Giao diện"]);
  assert.deepEqual(choiceGrid.columns, ["Kém", "Tốt"]);

  const checkboxGrid = Core.parseDataParams(
    dataParams([
      104,
      "Nền tảng",
      null,
      7,
      [[401, [["Desktop"], ["Mobile"]], true, ["Tự động điền"], null, null, null, null, null, null, [], [true]]]
    ])
  );
  assert.equal(checkboxGrid.type, "grid_checkbox");
});

test("parseDataParams recognizes rating and scale metadata", () => {
  const scale = Core.parseDataParams(
    dataParams([
      105,
      "Mức hài lòng",
      null,
      5,
      [[501, [["1"], ["2"], ["3"], ["4"], ["5"]], true, ["Thấp", "Cao"]]]
    ])
  );
  assert.equal(scale.type, "linear_scale");
  assert.deepEqual(scale.scale, {
    min: 1,
    max: 5,
    minLabel: "Thấp",
    maxLabel: "Cao"
  });

  const ratingEntry = [601, [["1"], ["2"], ["3"]], false];
  ratingEntry[14] = [1];
  const rating = Core.parseDataParams(
    dataParams([106, "Độ hữu ích", null, 18, [ratingEntry]])
  );
  assert.equal(rating.type, "rating");
  assert.equal(rating.ratingStyle, 1);
});

test("parsePublicLoadData extracts every question and page break", () => {
  const script = publicLoadData([
    [900, "A. Thông tin chung", "Giới thiệu phần A", 8, null],
    [101, "Họ và tên", null, 0, [[201, null, true]]],
    [102, "Bộ phận", null, 2, [[202, [["Tech"], ["Sales"]], true]]],
    [901, "B. Đánh giá", null, 8, null],
    [103, "Góp ý", null, 1, [[203, null, false]]]
  ]);

  const metadata = Core.parsePublicLoadData(script);
  assert.equal(metadata.title, "Form nhiều trang");
  assert.equal(metadata.description, "Mô tả biểu mẫu");
  assert.equal(metadata.pages.length, 2);
  assert.deepEqual(metadata.pages[0].questionIds, ["q-101", "q-102"]);
  assert.deepEqual(metadata.pages[1].questionIds, ["q-103"]);
  assert.equal(metadata.questions.length, 3);
  assert.equal(metadata.questions[0].pageIndex, 0);
  assert.equal(metadata.questions[2].pageIndex, 1);
  assert.equal(metadata.questions[1].type, "multiple_choice");
  assert.equal(metadata.questions[1].required, true);
});

test("compareSchemas requires matching title and at least 80 percent questions", () => {
  const target = {
    title: "Form kiểm thử",
    questions: [
      { title: "Họ tên", type: "short_text" },
      { title: "Trình duyệt", type: "checkboxes" },
      { title: "Đánh giá", type: "rating" },
      { title: "Ngày dùng", type: "date" },
      { title: "Góp ý", type: "paragraph" }
    ]
  };
  const same = structuredClone(target);
  assert.equal(Core.compareSchemas(target, same).match, true);

  const different = structuredClone(target);
  different.questions[0].title = "Email";
  different.questions[1].title = "Hệ điều hành";
  assert.equal(Core.compareSchemas(target, different).match, false);
});

test("validateRequiredAnswers checks scalar, array and grid answers", () => {
  const schema = {
    questions: [
      { id: "q1", title: "Tên", type: "short_text", required: true },
      { id: "q2", title: "Trình duyệt", type: "checkboxes", required: true },
      {
        id: "q3",
        title: "Lưới",
        type: "grid_choice",
        required: true,
        rows: [{ id: "r1" }, { id: "r2" }]
      }
    ]
  };

  assert.equal(Core.validateRequiredAnswers(schema, {}).length, 3);
  assert.equal(
    Core.validateRequiredAnswers(schema, {
      q1: "An",
      q2: ["Chrome"],
      q3: { r1: "Tốt", r2: "Khá" }
    }).length,
    0
  );
});
