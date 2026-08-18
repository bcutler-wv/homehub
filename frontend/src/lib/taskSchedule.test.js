import {
  taskAppearsOnDay, applyThisWeekMove, applyEveryWeekMove, applyOnceMove,
  pruneStaleMoves, completionKey, normalizeTasks,
} from "./taskSchedule";

const MON = "2026-08-24", TUE = "2026-08-25", THU = "2026-08-27";
const grocery = { id: 1, title: "Grocery run", type: "weekday", weekdays: [1], active: true };
const errand  = { id: 2, title: "Errand", type: "once", date: MON, active: true };
const data = (over = {}) => ({ items: [grocery, errand], completions: {}, moves: {}, ...over });

test("weekday task appears on its base day with no moves", () => {
  expect(taskAppearsOnDay(grocery, MON, {})).toBe(true);
  expect(taskAppearsOnDay(grocery, TUE, {})).toBe(false);
});

test("this-week move redirects a single occurrence", () => {
  const d = applyThisWeekMove(data(), grocery, MON, TUE);
  expect(d.moves["1:2026-08-24"]).toBe(TUE);
  expect(taskAppearsOnDay(grocery, MON, d.moves)).toBe(false);
  expect(taskAppearsOnDay(grocery, TUE, d.moves)).toBe(true);
  // a different Monday is unaffected
  expect(taskAppearsOnDay(grocery, "2026-08-31", d.moves)).toBe(true);
});

test("moving back to the base day removes the moves entry", () => {
  const moved = applyThisWeekMove(data(), grocery, MON, TUE);
  const back = applyThisWeekMove(moved, grocery, MON, MON);
  expect(back.moves["1:2026-08-24"]).toBeUndefined();
});

test("completion relocates with a this-week move", () => {
  const withDone = data({ completions: { [completionKey(1, MON)]: { completed: true } } });
  const d = applyThisWeekMove(withDone, grocery, MON, TUE);
  expect(d.completions[completionKey(1, MON)]).toBeUndefined();
  expect(d.completions[completionKey(1, TUE)]?.completed).toBe(true);
});

test("every-week move rewrites weekdays and clears that week's move", () => {
  const moved = applyThisWeekMove(data(), grocery, MON, TUE);
  const d = applyEveryWeekMove(moved, grocery, MON, THU);
  const updated = d.items.find(t => t.id === 1);
  expect(updated.weekdays).toEqual([4]);          // Mon removed, Thu added
  expect(d.moves["1:2026-08-24"]).toBeUndefined();
});

test("once task move changes date and relocates completion", () => {
  const withDone = data({ completions: { [completionKey(2, MON)]: { completed: true } } });
  const d = applyOnceMove(withDone, errand, TUE);
  expect(d.items.find(t => t.id === 2).date).toBe(TUE);
  expect(d.completions[completionKey(2, TUE)]?.completed).toBe(true);
});

test("stale moves are ignored and pruned", () => {
  // task not scheduled on fromDay → entry invalid
  const stale = { "1:2026-08-25": THU };  // grocery isn't on Tuesdays
  expect(taskAppearsOnDay(grocery, THU, stale)).toBe(false);
  const d = pruneStaleMoves(data({ moves: { ...stale, "999:2026-08-24": TUE } }));
  expect(d.moves).toEqual({});
});

test("normalizeTasks defaults moves to empty object", () => {
  expect(normalizeTasks({ items: [] }).moves).toEqual({});
});
