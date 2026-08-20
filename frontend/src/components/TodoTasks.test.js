import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TodoTasks from "./TodoTasks";

describe("TodoTasks", () => {
  test("renders New Task modal with 'From recurring task' select when creating", async () => {
    const weekdayTask = {
      id: 1,
      title: "Sweep kitchen",
      type: "weekday",
      weekdays: [1, 2, 3, 4, 5],
      active: true,
      notes: "Every weekday",
    };

    const tasks = {
      items: [weekdayTask],
      completions: {},
      moves: {},
    };

    const mockSetTasks = jest.fn();
    const mockShowToast = jest.fn();

    render(
      <TodoTasks
        tasks={tasks}
        setTasks={mockSetTasks}
        users={[]}
        currentUser={{ id: "user1", username: "Test User" }}
        apiEnabled={false}
        showToast={mockShowToast}
      />
    );

    // Click "New task" button
    const newTaskBtn = screen.getByRole("button", { name: /New task/i });
    fireEvent.click(newTaskBtn);

    // Wait for modal to appear and check for the dropdown
    await waitFor(() => {
      const selectElements = screen.getAllByRole("combobox");
      // First combobox is "From recurring task" (before "Assigned to")
      expect(selectElements.length).toBeGreaterThan(0);
    });

    // Verify the dropdown options
    const selects = screen.getAllByRole("combobox");
    const fromRecurringSelect = selects[0]; // First select in the modal
    expect(fromRecurringSelect).toBeInTheDocument();

    // Verify "Start blank" option exists
    const options = fromRecurringSelect.querySelectorAll("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0].textContent).toBe("Start blank");
    expect(options[1].textContent).toBe("Sweep kitchen");
  });

  // Week columns are derived from the real "today", so derive the same keys here.
  const dayKeyOf = (date) => {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  };
  const weekDayKey = (offsetFromMonday) => {
    const date = new Date();
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offsetFromMonday);
    return dayKeyOf(date);
  };

  const renderBoard = (tasks, setTasks) => render(
    <TodoTasks
      tasks={tasks}
      setTasks={setTasks}
      users={[]}
      currentUser={{ id: "user1", username: "Test User" }}
      apiEnabled={false}
      showToast={jest.fn()}
    />
  );

  test("move menu on a recurring task prompts for scope and records a this-week move", async () => {
    const monday = weekDayKey(0);
    const tuesday = weekDayKey(1);
    const setTasks = jest.fn();

    renderBoard({
      items: [{ id: 1, title: "Sweep kitchen", type: "weekday", weekdays: [1], active: true }],
      completions: {},
      moves: {},
    }, setTasks);

    fireEvent.click(screen.getAllByLabelText("Move Sweep kitchen to another day")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tue" }));

    const thisWeek = await screen.findByRole("button", { name: "Just this week" });
    expect(screen.getByRole("button", { name: "Every week" })).toBeInTheDocument();

    fireEvent.click(thisWeek);

    await waitFor(() => expect(setTasks).toHaveBeenCalled());
    const next = setTasks.mock.calls[0][0];
    expect(next.moves).toEqual({ [`1:${monday}`]: tuesday });
    expect(next.items[0].weekdays).toEqual([1]);
  });

  test("move menu on a recurring task can reschedule every week", async () => {
    const setTasks = jest.fn();

    renderBoard({
      items: [{ id: 1, title: "Sweep kitchen", type: "weekday", weekdays: [1], active: true }],
      completions: {},
      moves: {},
    }, setTasks);

    fireEvent.click(screen.getAllByLabelText("Move Sweep kitchen to another day")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tue" }));
    fireEvent.click(await screen.findByRole("button", { name: "Every week" }));

    await waitFor(() => expect(setTasks).toHaveBeenCalled());
    const next = setTasks.mock.calls[0][0];
    expect(next.items[0].weekdays).toEqual([2]);
    expect(next.moves).toEqual({});
  });

  test("moving a one-time task changes its date without prompting", async () => {
    const monday = weekDayKey(0);
    const tuesday = weekDayKey(1);
    const setTasks = jest.fn();

    renderBoard({
      items: [{ id: 7, title: "Return library books", type: "once", date: monday, active: true }],
      completions: {},
      moves: {},
    }, setTasks);

    fireEvent.click(screen.getAllByLabelText("Move Return library books to another day")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Tue" }));

    await waitFor(() => expect(setTasks).toHaveBeenCalled());
    expect(setTasks.mock.calls[0][0].items[0].date).toBe(tuesday);
    expect(screen.queryByRole("button", { name: "Just this week" })).not.toBeInTheDocument();
  });
});
