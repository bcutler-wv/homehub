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

test("accepts monthly tasks with a valid day of month", () => {
  assert.doesNotThrow(() => validateTasksData({
    ...base,
    items: [{ id: 1, title: "Change filters", type: "monthly", monthDay: 15 }],
  }));
  assert.doesNotThrow(() => validateTasksData({
    ...base,
    items: [{ id: 1, title: "Rent", type: "monthly", monthDay: 1 }],
  }));
  assert.doesNotThrow(() => validateTasksData({
    ...base,
    items: [{ id: 1, title: "Deep clean", type: "monthly", monthDay: 31 }],
  }));
});

test("rejects a monthly task with a missing or out-of-range day", () => {
  for (const monthDay of [undefined, null, 0, 32, 1.5, "15"]) {
    assert.throws(
      () => validateTasksData({ ...base, items: [{ id: 1, title: "x", type: "monthly", monthDay }] }),
      /monthDay/
    );
  }
});

test("accepts no-deadline tasks without a date or weekdays", () => {
  assert.doesNotThrow(() => validateTasksData({
    ...base,
    items: [{ id: 1, title: "Sort the loft", type: "misc" }],
  }));
});

test("still rejects an unknown task type", () => {
  assert.throws(
    () => validateTasksData({ ...base, items: [{ id: 1, title: "x", type: "yearly" }] }),
    /task type/
  );
});
