import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import Corkboard, { NoteBody, relativeTime } from "./Corkboard";

const NOTE = {
  id: 1, title: "Vet", body: "Call about **Rosie**", color: "sage", pinned: false,
  taskId: null, recipeId: null, image: null,
  authorName: "Alison", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z",
};

const TASKS = { items: [{ id: 5, title: "Sweep kitchen", type: "weekday", weekdays: [1], active: true }] };
const RECIPES = [{ id: 9, name: "Shakshuka" }];

const renderBoard = (notes = [NOTE], overrides = {}) => {
  const setNotes = jest.fn();
  const showToast = jest.fn();
  const onNavigate = jest.fn();
  const utils = render(
    <Corkboard
      notes={notes}
      setNotes={setNotes}
      tasks={TASKS}
      recipes={RECIPES}
      users={[{ id: "u1", username: "Alison" }]}
      currentUser={{ id: "u1", username: "Alison" }}
      apiEnabled={false}
      queueMutation={jest.fn()}
      showToast={showToast}
      onNavigate={onNavigate}
      {...overrides}
    />
  );
  return { setNotes, showToast, onNavigate, ...utils };
};

afterEach(() => { delete global.fetch; });

describe("note rendering", () => {
  test("shows the author and a relative timestamp", () => {
    renderBoard();
    expect(screen.getByText("Alison")).toBeInTheDocument();
    expect(screen.getByText("Vet")).toBeInTheDocument();
  });

  test("renders formatting as real elements", () => {
    const { container } = render(<NoteBody text="Call about **Rosie** and *soon*" />);
    expect(container.querySelector("strong").textContent).toBe("Rosie");
    expect(container.querySelector("em").textContent).toBe("soon");
  });

  test("renders lists", () => {
    const { container } = render(<NoteBody text={"- milk\n- eggs"} />);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  test("markup in a note is shown as text, never as an element", () => {
    const { container } = render(<NoteBody text={'<img src=x onerror=alert(1)> <b>hi</b>'} />);
    // Nothing the note author wrote may become a tag.
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  test("a javascript: link is not rendered as a link", () => {
    const { container } = render(<NoteBody text="[tap](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("tap");
  });

  test("a safe link opens in a new tab without referrer leakage", () => {
    const { container } = render(<NoteBody text="[docs](https://example.com)" />);
    const a = container.querySelector("a");
    expect(a.getAttribute("href")).toBe("https://example.com");
    expect(a.getAttribute("rel")).toContain("noopener");
  });
});

describe("relativeTime", () => {
  const base = new Date("2026-09-02T12:00:00.000Z").getTime();
  test("describes recent times as elapsed", () => {
    expect(relativeTime("2026-09-02T11:59:30.000Z", base)).toBe("just now");
    expect(relativeTime("2026-09-02T11:30:00.000Z", base)).toBe("30m ago");
    expect(relativeTime("2026-09-02T09:00:00.000Z", base)).toBe("3h ago");
    expect(relativeTime("2026-08-31T12:00:00.000Z", base)).toBe("2d ago");
  });

  test("falls back to a date once elapsed time stops helping", () => {
    expect(relativeTime("2026-07-01T12:00:00.000Z", base)).toMatch(/Jul/);
  });

  test("handles a missing or unparseable timestamp", () => {
    expect(relativeTime(null)).toBe("");
    expect(relativeTime("not a date")).toBe("");
  });
});

describe("board behaviour", () => {
  test("pinned notes sort above the rest", () => {
    const { container } = renderBoard([
      { ...NOTE, id: 1, title: "Older" },
      { ...NOTE, id: 2, title: "Pinned", pinned: true, updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);
    const titles = Array.from(container.querySelectorAll(".note-title")).map(n => n.textContent);
    expect(titles).toEqual(["Pinned", "Older"]);
  });

  test("pinning does not open the editor", () => {
    const { setNotes } = renderBoard();
    fireEvent.click(screen.getByLabelText("Pin Vet"));
    expect(setNotes).toHaveBeenCalled();
    expect(screen.queryByLabelText("Note text")).not.toBeInTheDocument();
  });

  test("clicking a note opens it for editing", () => {
    renderBoard();
    fireEvent.click(screen.getByText("Vet"));
    expect(screen.getByLabelText("Note text")).toHaveValue("Call about **Rosie**");
  });

  test("deleting asks first", async () => {
    const { setNotes } = renderBoard();
    fireEvent.click(screen.getByLabelText("Delete Vet"));
    expect(await screen.findByText(/Delete this note/)).toBeInTheDocument();
    expect(setNotes).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(setNotes).toHaveBeenCalled());
    expect(setNotes.mock.calls[0][0]([NOTE])).toEqual([]);
  });

  test("an empty board invites a first note", () => {
    renderBoard([]);
    expect(screen.getByText(/Nothing pinned yet/)).toBeInTheDocument();
  });
});

describe("editor", () => {
  test("a toolbar button wraps the selected text", () => {
    renderBoard([]);
    fireEvent.click(screen.getByRole("button", { name: /New note/ }));

    const body = screen.getByLabelText("Note text");
    fireEvent.change(body, { target: { value: "call Alison today" } });
    body.setSelectionRange(5, 11);
    fireEvent.click(screen.getByTitle("Bold"));

    expect(screen.getByLabelText("Note text")).toHaveValue("call **Alison** today");
  });

  test("the preview shows formatting as you type", () => {
    renderBoard([]);
    fireEvent.click(screen.getByRole("button", { name: /New note/ }));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "**bold**" } });

    const preview = document.querySelector(".note-preview");
    expect(within(preview).getByText("bold").tagName).toBe("STRONG");
  });

  test("a note with nothing in it is refused", () => {
    const { setNotes, showToast } = renderBoard([]);
    fireEvent.click(screen.getByRole("button", { name: /New note/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(setNotes).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/title, some text, or a photo/), "danger");
  });

  test("a note can be linked to a task and a recipe", async () => {
    const { setNotes } = renderBoard([]);
    fireEvent.click(screen.getByRole("button", { name: /New note/ }));
    fireEvent.change(screen.getByLabelText("Note text"), { target: { value: "remember" } });
    fireEvent.change(screen.getByLabelText(/Link a task/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Link a recipe/), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(setNotes).toHaveBeenCalled());
    const created = setNotes.mock.calls[0][0]([]);
    expect(created[0]).toMatchObject({ taskId: 5, recipeId: 9, body: "remember" });
  });

  test("a linked task is shown on the note and navigates when tapped", () => {
    const { onNavigate } = renderBoard([{ ...NOTE, taskId: 5, recipeId: 9 }]);
    fireEvent.click(screen.getByRole("button", { name: /Sweep kitchen/ }));
    expect(onNavigate).toHaveBeenCalledWith("tasks");

    fireEvent.click(screen.getByRole("button", { name: /Shakshuka/ }));
    expect(onNavigate).toHaveBeenCalledWith("meal");
  });
});
