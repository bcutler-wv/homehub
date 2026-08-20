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

test("re-drag chain from rendered day collapses to one base-keyed move", () => {
  const WED = "2026-08-26";
  const first = applyThisWeekMove(data(), grocery, MON, TUE);
  // Kanban UI passes the rendered column (Tue) as fromDay
  const second = applyThisWeekMove(first, grocery, TUE, WED);
  expect(second.moves).toEqual({ [`1:${MON}`]: WED });
  expect(taskAppearsOnDay(grocery, MON, second.moves)).toBe(false);
  expect(taskAppearsOnDay(grocery, TUE, second.moves)).toBe(false);
  expect(taskAppearsOnDay(grocery, WED, second.moves)).toBe(true);
  // pruning must not revert the user's drag
  expect(pruneStaleMoves(second).moves).toEqual({ [`1:${MON}`]: WED });
});

test("re-drag back to base day from rendered day clears the move", () => {
  const first = applyThisWeekMove(data(), grocery, MON, TUE);
  const back = applyThisWeekMove(first, grocery, TUE, MON);
  expect(back.moves).toEqual({});
});

test("every-week move from rendered day rewrites base weekday and clears moves", () => {
  const first = applyThisWeekMove(data(), grocery, MON, TUE);
  const d = applyEveryWeekMove(first, grocery, TUE, THU);
  expect(d.items.find(t => t.id === 1).weekdays).toEqual([4]);
  expect(Object.keys(d.moves).filter(k => k.startsWith("1:"))).toEqual([]);
});

test("completion set on rendered day follows a re-drag", () => {
  const WED = "2026-08-26";
  const first = applyThisWeekMove(data(), grocery, MON, TUE);
  // user completes the task while it sits on Tuesday
  const withDone = { ...first, completions: { [completionKey(1, TUE)]: { completed: true } } };
  const second = applyThisWeekMove(withDone, grocery, TUE, WED);
  expect(second.completions[completionKey(1, TUE)]).toBeUndefined();
  expect(second.completions[completionKey(1, WED)]?.completed).toBe(true);
});
