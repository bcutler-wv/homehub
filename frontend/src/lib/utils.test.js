import { dateKey, displayStatus, getWeekDays } from "./utils";

describe("utils", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-06-06T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("dateKey formats ISO calendar dates", () => {
    expect(dateKey("2026-06-06T12:34:00Z")).toBe("2026-06-06");
  });

  test("getWeekDays starts today and includes six following days", () => {
    const days = getWeekDays();
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: "2026-06-06", isToday: true });
    expect(days[6].key).toBe("2026-06-12");
  });

  test("displayStatus marks unpaid past invoices overdue", () => {
    expect(displayStatus({ dueDate: "2026-06-05", status: "unpaid" })).toBe("overdue");
    expect(displayStatus({ dueDate: "2026-06-05", status: "paid" })).toBe("paid");
  });
});

describe("dateKey timezone handling", () => {
  test("uses the viewer's calendar day, not UTC", () => {
    // 9:30pm New York is already tomorrow in UTC. The day the user is living
    // in is the one that matters.
    const evening = new Date("2026-09-07T21:30:00-04:00");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-09-08"); // what it used to return
    expect(dateKey(evening)).toBe("2026-09-07");
  });

  test("handles either side of midnight", () => {
    expect(dateKey(new Date("2026-09-07T23:59:00-04:00"))).toBe("2026-09-07");
    expect(dateKey(new Date("2026-09-08T00:01:00-04:00"))).toBe("2026-09-08");
  });

  test("passes a bare calendar day straight through", () => {
    // Parsing "2026-09-07" would read it as UTC midnight and shift it back.
    expect(dateKey("2026-09-07")).toBe("2026-09-07");
  });

  test("pads single-digit months and days", () => {
    expect(dateKey(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });

  test("returns an empty string for an unparseable value", () => {
    expect(dateKey("not a date")).toBe("");
  });
});

describe("all-day event handling", () => {
  test("a floating all-day start lands on its own day, not the one before", () => {
    // What the ICS parser now stores for DTSTART;VALUE=DATE:20260907.
    expect(dateKey("2026-09-07T00:00:00")).toBe("2026-09-07");
    // What it used to store, which is why the calendar was a day out.
    expect(dateKey("2026-09-07T00:00:00Z")).toBe("2026-09-06");
  });
});
