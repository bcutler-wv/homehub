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
});
