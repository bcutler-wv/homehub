const test = require("node:test");
const assert = require("node:assert");
const { validateTasksData } = require("../middleware/validate");

const base = { items: [], completions: {} };

test("accepts missing moves", () => {
  assert.doesNotThrow(() => validateTasksData({ ...base }));
});

test("accepts well-formed moves", () => {
  assert.doesNotThrow(() => validateTasksData({ ...base, moves: { "123:2026-08-24": "2026-08-25" } }));
});

test("rejects non-object moves", () => {
  assert.throws(() => validateTasksData({ ...base, moves: [] }), /moves/);
  assert.throws(() => validateTasksData({ ...base, moves: "x" }), /moves/);
});

test("rejects malformed move keys and values", () => {
  assert.throws(() => validateTasksData({ ...base, moves: { "123": "2026-08-25" } }), /moves/);
  assert.throws(() => validateTasksData({ ...base, moves: { "123:2026-08-24": "not-a-date" } }), /moves/);
});

test("accepts items with sourceId", () => {
  assert.doesNotThrow(() => validateTasksData({
    ...base,
    items: [{ id: 1, title: "Extra run", type: "once", date: "2026-08-25", sourceId: 99 }],
  }));
});
