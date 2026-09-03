import {
  taskAppearsOnDay, applyThisWeekMove, applyEveryWeekMove, applyOnceMove,
  pruneStaleMoves, completionKey, normalizeTasks, applyDayMove, isTaskOnDay, monthlyDayFor,
  applyEveryMonthMove,
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

describe("applyDayMove", () => {
  const mon = "2026-08-17", tue = "2026-08-18";
  const weekday = (id, title, weekdays = [1]) => ({ id, title, type: "weekday", weekdays, active: true });

  test("moves a whole day this week without touching the schedule", () => {
    const data = {
      items: [weekday(1, "A"), weekday(2, "B")],
      completions: {},
      moves: {},
    };
    const next = applyDayMove(data, data.items, mon, tue, "week");

    expect(next.moves).toEqual({ [`1:${mon}`]: tue, [`2:${mon}`]: tue });
    expect(next.items.every(t => t.weekdays.includes(1))).toBe(true);
  });

  test("every-week rewrites each task's weekdays and clears the week's moves", () => {
    const data = { items: [weekday(1, "A"), weekday(2, "B")], completions: {}, moves: {} };
    const next = applyDayMove(data, data.items, mon, tue, "always");

    expect(next.items.map(t => t.weekdays)).toEqual([[2], [2]]);
    expect(next.moves).toEqual({});
  });

  test("mixed days move one-time tasks by date and recurring by scope", () => {
    const once = { id: 3, title: "C", type: "once", date: mon, active: true };
    const data = { items: [weekday(1, "A"), once], completions: {}, moves: {} };
    const next = applyDayMove(data, data.items, mon, tue, "week");

    expect(next.items.find(t => t.id === 3).date).toBe(tue);
    expect(next.moves).toEqual({ [`1:${mon}`]: tue });
  });

  test("completions follow their task to the new day", () => {
    const data = {
      items: [weekday(1, "A")],
      completions: { [`1:${mon}`]: { completed: true } },
      moves: {},
    };
    const next = applyDayMove(data, data.items, mon, tue, "week");

    expect(next.completions[`1:${tue}`]).toEqual({ completed: true });
    expect(next.completions[`1:${mon}`]).toBeUndefined();
  });

  test("a move onto the same day, or with no target, is a no-op", () => {
    const data = { items: [weekday(1, "A")], completions: {}, moves: {} };
    expect(applyDayMove(data, data.items, mon, mon, "week")).toBe(data);
    expect(applyDayMove(data, data.items, mon, "", "week")).toBe(data);
  });

  test("an empty day changes nothing", () => {
    const data = { items: [weekday(1, "A")], completions: {}, moves: {} };
    expect(applyDayMove(data, [], mon, tue, "week")).toBe(data);
  });
});

describe("monthly and no-deadline tasks", () => {
  const monthly = (monthDay) => ({ id: 10, title: "Filters", type: "monthly", monthDay, active: true });

  test("a monthly task lands on its day of the month", () => {
    expect(isTaskOnDay(monthly(15), "2026-09-15")).toBe(true);
    expect(isTaskOnDay(monthly(15), "2026-09-14")).toBe(false);
    expect(isTaskOnDay(monthly(15), "2026-10-15")).toBe(true);
  });

  test("a day-31 task still happens in a short month, on the last day", () => {
    // February 2026 has 28 days; the task must not silently skip the month.
    expect(monthlyDayFor(monthly(31), "2026-02-10")).toBe(28);
    expect(isTaskOnDay(monthly(31), "2026-02-28")).toBe(true);
    expect(isTaskOnDay(monthly(31), "2026-02-27")).toBe(false);

    expect(monthlyDayFor(monthly(31), "2026-04-10")).toBe(30);
    expect(isTaskOnDay(monthly(31), "2026-04-30")).toBe(true);

    // A leap year gains the 29th.
    expect(monthlyDayFor(monthly(30), "2028-02-10")).toBe(29);
  });

  test("a monthly task with no day set never lands", () => {
    expect(monthlyDayFor({ type: "monthly" }, "2026-09-15")).toBeNull();
    expect(isTaskOnDay({ id: 1, type: "monthly", active: true }, "2026-09-15")).toBe(false);
  });

  test("an inactive monthly task does not land", () => {
    expect(isTaskOnDay({ ...monthly(15), active: false }, "2026-09-15")).toBe(false);
  });

  test("a no-deadline task never belongs to a day", () => {
    const misc = { id: 11, title: "Sort the loft", type: "misc", active: true };
    expect(isTaskOnDay(misc, "2026-09-15")).toBe(false);
    expect(isTaskOnDay(misc, "2026-09-16")).toBe(false);
  });
});

describe("moving a monthly task", () => {
  const monthly = { id: 20, title: "Filters", type: "monthly", monthDay: 15, active: true };
  const from = "2026-09-15", to = "2026-09-17";

  test("permanently moving one rewrites its day of the month", () => {
    const data = { items: [monthly], completions: {}, moves: {} };
    const next = applyEveryMonthMove(data, monthly, from, to);

    expect(next.items[0].monthDay).toBe(17);
    expect(isTaskOnDay(next.items[0], to)).toBe(true);
    expect(isTaskOnDay(next.items[0], from)).toBe(false);
  });

  test("the completion follows and the task still renders where it landed", () => {
    const data = {
      items: [monthly],
      completions: { [`20:${from}`]: { completed: true } },
      moves: {},
    };
    const next = applyEveryMonthMove(data, monthly, from, to);

    expect(next.completions[`20:${to}`]).toEqual({ completed: true });
    expect(next.completions[`20:${from}`]).toBeUndefined();
    // The bug this guards: a rewritten schedule that no longer matches the day
    // the completion was moved to.
    expect(isTaskOnDay(next.items[0], to)).toBe(true);
  });

  test("a whole-day permanent move reschedules monthly and weekly tasks each on their own terms", () => {
    const weekly = { id: 21, title: "Sweep", type: "weekday", weekdays: [2], active: true };
    const data = { items: [monthly, weekly], completions: {}, moves: {} };
    const next = applyDayMove(data, data.items, from, to, "always");

    // Tuesday the 15th -> Thursday the 17th.
    expect(next.items.find(t => t.id === 20).monthDay).toBe(17);
    expect(next.items.find(t => t.id === 21).weekdays).toEqual([4]);
    // The monthly task must not have had its weekdays rewritten instead.
    expect(next.items.find(t => t.id === 20).weekdays).toBeUndefined();
  });

  test("a this-week move leaves the monthly schedule alone", () => {
    const data = { items: [monthly], completions: {}, moves: {} };
    const next = applyDayMove(data, [monthly], from, to, "week");

    expect(next.items[0].monthDay).toBe(15);
    expect(next.moves).toEqual({ [`20:${from}`]: to });
  });
});
