import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useSensor, useSensors, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { apiFetch } from "../lib/api";
import { dateKey, useTodayKey } from "../lib/utils";
import {
  normalizeTasks, completionKey, taskAppearsOnDay,
  applyThisWeekMove, applyEveryWeekMove, applyEveryMonthMove, applyOnceMove, applyDayMove, pruneStaleMoves,
} from "../lib/taskSchedule";

const WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const DAY_TONES = ["blush", "peach", "sage", "linen", "moss", "cloud", "rose"];

// Completion key slot for tasks that belong to no day.
const ANYTIME = "anytime";

const taskKindLabel = (task) => {
  if (task.sourceId) return "Extra";
  if (task.type === "weekday") return "Recurring";
  if (task.type === "monthly") return "Monthly";
  if (task.type === "misc") return "No deadline";
  return "One time";
};

const ordinal = (n) => {
  const num = Number(n);
  if (!Number.isInteger(num)) return "—";
  const tens = num % 100;
  if (tens >= 11 && tens <= 13) return `${num}th`;
  return `${num}${["th", "st", "nd", "rd"][num % 10] || "th"}`;
};

const initialsFor = (name) => {
  if (!name) return "?";
  const parts = String(name).trim().split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
};

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const parseDay = (dayKey) => new Date(`${dayKey}T12:00:00`);

const shiftDays = (dayKey, days) => {
  const date = parseDay(dayKey);
  date.setDate(date.getDate() + days);
  return dateKey(date);
};

const weekStartKey = (dayKey) => {
  const date = parseDay(dayKey);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return dateKey(date);
};

function getPlannerWeekDays(weekAnchorKey, todayKey) {
  const monday = parseDay(weekStartKey(weekAnchorKey));

  return Array.from({ length: 7 }).map((_, idx) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + idx);
    const key = dateKey(day);
    return {
      key,
      label: day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
      dateLabel: day.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      name: day.toLocaleDateString("en-US", { weekday: "long" }),
      short: day.toLocaleDateString("en-US", { weekday: "short" }),
      isToday: key === todayKey,
    };
  });
}

function getWeekRangeLabel(weekDays) {
  if (!weekDays.length) return "";
  const start = parseDay(weekDays[0].key);
  const end = parseDay(weekDays[weekDays.length - 1].key);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startOptions = sameMonth ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return `${start.toLocaleDateString("en-US", startOptions)} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export default function TodoTasks({ tasks, setTasks, users = [], currentUser, apiEnabled, showToast }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [taskForm, setTaskForm] = useState(null);
  const [deleteTaskId, setDeleteTaskId] = useState(null);
  const [movePrompt, setMovePrompt] = useState(null); // { task, fromDay, toDay }
  const [activeDrag, setActiveDrag] = useState(null); // { task, fromDay }
  const todayKey = useTodayKey();
  const [weekAnchorKey, setWeekAnchorKey] = useState(() => weekStartKey(todayKey));

  const weekDays = useMemo(() => getPlannerWeekDays(weekAnchorKey, todayKey), [todayKey, weekAnchorKey]);
  const weekNum = useMemo(() => getWeekNumber(parseDay(weekAnchorKey)), [weekAnchorKey]);
  const weekRangeLabel = useMemo(() => getWeekRangeLabel(weekDays), [weekDays]);
  const isCurrentWeek = weekStartKey(weekAnchorKey) === weekStartKey(todayKey);
  const data = useMemo(() => normalizeTasks(tasks), [tasks]);

  const assignmentUsers = useMemo(() => {
    const map = new Map();
    users.forEach(user => {
      if (user?.id) map.set(String(user.id), user);
    });
    if (currentUser?.id && !map.has(String(currentUser.id))) map.set(String(currentUser.id), currentUser);
    return Array.from(map.values());
  }, [users, currentUser]);

  const userById = useMemo(() => {
    const map = new Map();
    assignmentUsers.forEach(user => map.set(String(user.id), user));
    return map;
  }, [assignmentUsers]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (movePrompt) { setMovePrompt(null); return; }
      if (deleteTaskId) { setDeleteTaskId(null); return; }
      if (taskForm) { setTaskForm(null); return; }
      if (selectedDay) setSelectedDay(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteTaskId, movePrompt, selectedDay, taskForm]);

  const persistTasks = async (next, toastMessage, toastType = "success") => {
    const previous = data;
    setTasks(next);
    if (apiEnabled) {
      try {
        await apiFetch("/api/tasks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        });
      } catch (err) {
        setTasks(previous);
        showToast(err.message || "Task update failed", "danger");
        return false;
      }
    }
    if (toastMessage) showToast(toastMessage, toastType);
    return true;
  };

  const tasksForDay = (dayKey) => data.items
    .filter(task => taskAppearsOnDay(task, dayKey, data.moves))
    .sort((a, b) => {
      const ac = !!data.completions[completionKey(a.id, dayKey)]?.completed;
      const bc = !!data.completions[completionKey(b.id, dayKey)]?.completed;
      if (ac !== bc) return ac ? 1 : -1;
      return String(a.title).localeCompare(String(b.title));
    });

  const openNewTask = (dayKey = (isCurrentWeek ? todayKey : weekDays[0]?.key || todayKey)) => {
    setTaskForm({
      id: null,
      title: "",
      notes: "",
      assignedUserId: currentUser?.id || assignmentUsers[0]?.id || "",
      type: "once",
      date: dayKey,
      weekdays: [1, 2, 3, 4, 5],
      monthDay: null,
      active: true,
      sourceId: null,
      fromRecurringId: "",
      useTemplate: false,
    });
  };

  const saveTask = async () => {
    const title = (taskForm.title || "").trim();
    if (!title) return;
    if (taskForm.type === "once" && !taskForm.date) {
      showToast("Choose a date", "danger");
      return;
    }
    if (taskForm.type === "weekday" && !(taskForm.weekdays || []).length) {
      showToast("Choose at least one weekday", "danger");
      return;
    }
    const monthDay = Number(taskForm.monthDay);
    if (taskForm.type === "monthly" && (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31)) {
      showToast("Choose a day of the month", "danger");
      return;
    }
    const { fromRecurringId, useTemplate, ...payload } = {
      ...taskForm,
      title,
      notes: (taskForm.notes || "").trim(),
      assignedUserId: taskForm.assignedUserId || null,
      date: taskForm.type === "once" ? taskForm.date : "",
      weekdays: taskForm.type === "weekday" ? taskForm.weekdays : [],
      monthDay: taskForm.type === "monthly" ? monthDay : null,
      active: true,
      sourceId: taskForm.sourceId || null,
    };
    const next = pruneStaleMoves(taskForm.id
      ? { ...data, items: data.items.map(t => t.id === taskForm.id ? payload : t) }
      : { ...data, items: [...data.items, { ...payload, id: Date.now(), createdAt: new Date().toISOString() }] });
    const saved = await persistTasks(next, taskForm.id ? "Task updated" : "Task added");
    if (saved) setTaskForm(null);
  };

  const toggleComplete = async (task, dayKey) => {
    const key = completionKey(task.id, dayKey);
    const wasCompleted = !!data.completions[key]?.completed;
    const nextCompletions = { ...data.completions };
    if (wasCompleted) {
      delete nextCompletions[key];
    } else {
      nextCompletions[key] = {
        completed: true,
        completedAt: new Date().toISOString(),
        completedBy: currentUser?.id || null,
      };
    }
    await persistTasks({ ...data, completions: nextCompletions });
  };

  const confirmDeleteTask = async () => {
    const nextCompletions = Object.fromEntries(
      Object.entries(data.completions).filter(([key]) => !key.startsWith(`${deleteTaskId}:`))
    );
    const next = pruneStaleMoves({
      ...data,
      items: data.items.filter(task => task.id !== deleteTaskId),
      completions: nextCompletions,
    });
    const deleted = await persistTasks(next, "Task deleted", "danger");
    if (deleted) setDeleteTaskId(null);
  };

  const activeTasks = data.items.filter(task => task.active !== false);
  // Loose ends with no date, and the monthly recurrences, in the two panels.
  const miscTasks = activeTasks
    .filter(task => task.type === "misc")
    .sort((a, b) => {
      const ad = !!data.completions[completionKey(a.id, ANYTIME)]?.completed;
      const bd = !!data.completions[completionKey(b.id, ANYTIME)]?.completed;
      if (ad !== bd) return ad ? 1 : -1;
      return String(a.title).localeCompare(String(b.title));
    });
  const monthlyTasks = activeTasks
    .filter(task => task.type === "monthly")
    .sort((a, b) => (a.monthDay || 0) - (b.monthDay || 0) || String(a.title).localeCompare(String(b.title)));
  const selectedDayTasks = selectedDay ? tasksForDay(selectedDay.key) : [];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const moveTask = async (task, fromDayKey, toDayKey, scope) => {
    let next;
    if (task.type === "once") next = applyOnceMove(data, task, toDayKey);
    else if (scope !== "always") next = applyThisWeekMove(data, task, fromDayKey, toDayKey);
    else if (task.type === "monthly") next = applyEveryMonthMove(data, task, fromDayKey, toDayKey);
    else next = applyEveryWeekMove(data, task, fromDayKey, toDayKey);
    await persistTasks(pruneStaleMoves(next), "Task moved");
  };

  // Recurring tasks need a scope choice (this week vs. every week); one-time tasks just move.
  const requestMove = (task, fromDayKey, toDayKey) => {
    if (!toDayKey || toDayKey === fromDayKey) return;
    if (task.type === "once") { moveTask(task, fromDayKey, toDayKey); return; }
    setMovePrompt({ task, fromDay: fromDayKey, toDay: toDayKey });
  };

  const moveDay = async (fromDayKey, toDayKey, scope) => {
    const dayTasks = tasksForDay(fromDayKey);
    if (!dayTasks.length) return;
    const next = applyDayMove(data, dayTasks, fromDayKey, toDayKey, scope);
    await persistTasks(pruneStaleMoves(next), `${dayTasks.length} task${dayTasks.length === 1 ? "" : "s"} moved`);
  };

  const requestDayMove = (fromDayKey, toDayKey) => {
    if (!toDayKey || toDayKey === fromDayKey) return;
    const dayTasks = tasksForDay(fromDayKey);
    if (!dayTasks.length) { showToast("That day has nothing to move", "danger"); return; }
    // Only recurring tasks need the scope question; a day of one-offs just moves.
    if (!dayTasks.some(t => t.type === "weekday")) { moveDay(fromDayKey, toDayKey); return; }
    setMovePrompt({ kind: "day", fromDay: fromDayKey, toDay: toDayKey, count: dayTasks.length });
  };

  const handleDragStart = ({ active }) => setActiveDrag(active.data.current);
  const handleDragEnd = ({ active, over }) => {
    setActiveDrag(null);
    if (!over) return;
    const payload = active.data.current || {};
    const toDay = String(over.id);
    if (payload.kind === "day") { requestDayMove(payload.day.key, toDay); return; }
    requestMove(payload.task, payload.fromDay, toDay);
  };

  const navigateWeek = (direction) => {
    setSelectedDay(null);
    setWeekAnchorKey(prev => shiftDays(prev, direction * 7));
  };

  const goToCurrentWeek = () => {
    setSelectedDay(null);
    setWeekAnchorKey(weekStartKey(todayKey));
  };

  return (
    <div className="page task-planner-page">
      <section className="tasks-board" aria-label="Weekly task planner">
        <header className="tasks-page-header">
          <div>
            <p className="tasks-week-label">Week {weekNum} - household tasks</p>
            <h1>Tasks</h1>
            <p className="tasks-week-range">{weekRangeLabel}</p>
          </div>
          <div className="planner-header-actions">
            <div className="planner-week-nav" aria-label="Week navigation">
              <button onClick={() => navigateWeek(-1)} className="planner-nav-btn" title="Previous week" aria-label="Previous week">&lt;</button>
              <button onClick={goToCurrentWeek} className="planner-today-btn" disabled={isCurrentWeek}>This week</button>
              <button onClick={() => navigateWeek(1)} className="planner-nav-btn" title="Next week" aria-label="Next week">&gt;</button>
            </div>
            <button className="planner-add-btn" onClick={() => openNewTask()}>
              <span aria-hidden="true">+</span>
              New task
            </button>
          </div>
        </header>

        <div className="planner-top-grid">
          <PlannerPanel title="Miscellaneous" className="planner-panel--misc">
            <div className="planner-loose-list">
              {miscTasks.length ? miscTasks.map(task => {
                const done = !!data.completions[completionKey(task.id, ANYTIME)]?.completed;
                const user = userById.get(String(task.assignedUserId));
                return (
                  <div key={task.id} className={`planner-loose-row${done ? " is-done" : ""}`}>
                    <span
                      role="button"
                      tabIndex={0}
                      className="planner-mini-check"
                      aria-label={done ? `Mark ${task.title} incomplete` : `Mark ${task.title} complete`}
                      onClick={() => toggleComplete(task, ANYTIME)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleComplete(task, ANYTIME); }
                      }}
                    />
                    <button className="planner-loose-title" onClick={() => setTaskForm({ ...task })}>
                      {task.title}
                    </button>
                    {user && <Assignee user={user} small />}
                  </div>
                );
              }) : (
                <>
                  <EmptyLine />
                  <EmptyLine />
                  <EmptyLine />
                </>
              )}
            </div>
          </PlannerPanel>

          <PlannerPanel title="Monthly" className="planner-panel--monthly">
            <div className="planner-loose-list">
              {monthlyTasks.length ? monthlyTasks.map(task => {
                const user = userById.get(String(task.assignedUserId));
                return (
                  <div key={task.id} className="planner-loose-row">
                    <span className="planner-monthday" aria-hidden="true">{ordinal(task.monthDay)}</span>
                    <button className="planner-loose-title" onClick={() => setTaskForm({ ...task })}>
                      {task.title}
                    </button>
                    {user && <Assignee user={user} small />}
                  </div>
                );
              }) : (
                <>
                  <EmptyLine />
                  <EmptyLine />
                  <EmptyLine />
                </>
              )}
            </div>
          </PlannerPanel>
        </div>

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDrag(null)}
        >
        <div className="planner-days-grid">
          {weekDays.map((day, idx) => {
            const dayTasks = tasksForDay(day.key);
            const completed = dayTasks.filter(task => data.completions[completionKey(task.id, day.key)]?.completed).length;
            return (
              <DayCard
                key={day.key}
                day={day}
                tone={DAY_TONES[idx]}
                tasks={dayTasks}
                completions={data.completions}
                userById={userById}
                onOpen={() => setSelectedDay(day)}
                onAdd={(e) => {
                  e.stopPropagation();
                  openNewTask(day.key);
                }}
                onToggle={toggleComplete}
                onMove={requestMove}
                weekDays={weekDays}
              >
                <span className="planner-day-count">{completed}/{dayTasks.length}</span>
              </DayCard>
            );
          })}
        </div>
        <DragOverlay>
          {activeDrag ? (
            <div className="planner-day-task is-dragging">
              {activeDrag.kind === "day" ? `${activeDrag.day.name} — whole day` : activeDrag.task.title}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      </section>

      {selectedDay && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setSelectedDay(null)}>
          <div className="modal-box planner-modal">
            <div className="planner-modal-header">
              <div>
                <p>{selectedDay.label}</p>
                <h2>Day checklist</h2>
              </div>
              <button onClick={() => setSelectedDay(null)} className="planner-icon-btn" title="Close">x</button>
            </div>

            <div className="planner-checklist">
              {selectedDayTasks.length === 0 && (
                <div className="planner-empty-state">
                  <p>Nothing assigned for this day yet.</p>
                </div>
              )}
              {selectedDayTasks.map((task) => {
                const done = !!data.completions[completionKey(task.id, selectedDay.key)]?.completed;
                const user = userById.get(String(task.assignedUserId));
                return (
                  <div key={task.id} className={`planner-check-row${done ? " is-done" : ""}`}>
                    <button onClick={() => toggleComplete(task, selectedDay.key)} className="planner-check-toggle" aria-label={done ? "Mark incomplete" : "Mark complete"}>
                      {done ? "OK" : ""}
                    </button>
                    <div className="planner-check-content">
                      <div className="planner-check-title">
                        <span>{task.title}</span>
                        <span className="planner-chip">{taskKindLabel(task)}</span>
                        {user && <Assignee user={user} />}
                      </div>
                      {task.notes && <p>{task.notes}</p>}
                    </div>
                    <div className="planner-check-actions">
                      <button onClick={() => setTaskForm({ ...task })}>Edit</button>
                      <button onClick={() => setDeleteTaskId(task.id)} className="danger">Delete</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="planner-modal-footer">
              <button onClick={() => openNewTask(selectedDay.key)} className="planner-primary-btn">Add task for this day</button>
            </div>
          </div>
        </div>
      )}

      {taskForm && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setTaskForm(null)}>
          <div className="modal-box planner-modal planner-form-modal">
            <h2>{taskForm.id ? "Edit task" : "New task"}</h2>
            <div className="planner-form-grid">
              {!taskForm.id && (
                <div>
                  <label>From recurring task</label>
                  <select value={taskForm.fromRecurringId} onChange={e => {
                    const src = data.items.find(t => String(t.id) === e.target.value && t.type === "weekday");
                    setTaskForm(p => ({
                      ...p,
                      fromRecurringId: e.target.value,
                      title: src ? src.title : p.title,
                      notes: src ? (src.notes || "") : p.notes,
                      type: "once",
                      sourceId: src && !p.useTemplate ? src.id : null,
                    }));
                  }}>
                    <option value="">Start blank</option>
                    {data.items.filter(t => t.type === "weekday" && t.active !== false).map(t =>
                      <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                  {taskForm.fromRecurringId && (
                    <label className="planner-inline-check">
                      <input type="checkbox" checked={taskForm.useTemplate}
                        onChange={e => setTaskForm(p => ({ ...p, useTemplate: e.target.checked, sourceId: e.target.checked ? null : Number(p.fromRecurringId) }))} />
                      Use as template (independent copy)
                    </label>
                  )}
                </div>
              )}
              <div>
                <label>Task</label>
                <input value={taskForm.title} onChange={e => setTaskForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Pack school bags" />
              </div>
              <div>
                <label>Assigned to</label>
                <select value={taskForm.assignedUserId || ""} onChange={e => setTaskForm(p => ({ ...p, assignedUserId: e.target.value }))}>
                  <option value="">Unassigned</option>
                  {assignmentUsers.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}
                </select>
              </div>
              <div>
                <label>Schedule</label>
                <div className="planner-segmented planner-segmented--three">
                  {[
                    { id: "once", label: "One time" },
                    { id: "weekday", label: "Weekly" },
                    { id: "monthly", label: "Monthly" },
                  ].map(option => (
                    <button
                      key={option.id}
                      onClick={() => setTaskForm(p => ({
                        ...p,
                        type: option.id,
                        // Seed whatever the newly chosen schedule needs, so the
                        // value the field displays is the value that gets saved.
                        date: option.id === "once" ? (p.date || todayKey) : p.date,
                        monthDay: option.id === "monthly"
                          ? (p.monthDay || parseDay(p.date || todayKey).getDate())
                          : p.monthDay,
                      }))}
                      className={taskForm.type === option.id || (taskForm.type === "misc" && option.id === "once") ? "is-active" : ""}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {taskForm.type === "once" || taskForm.type === "misc" ? (
                <div>
                  <label>Date</label>
                  <div className="planner-date-row">
                    <input
                      type="date"
                      value={taskForm.date || todayKey}
                      disabled={taskForm.type === "misc"}
                      onChange={e => setTaskForm(p => ({ ...p, date: e.target.value }))}
                    />
                    <button
                      type="button"
                      aria-pressed={taskForm.type === "misc"}
                      className={`planner-nodeadline${taskForm.type === "misc" ? " is-active" : ""}`}
                      onClick={() => setTaskForm(p => ({
                        ...p,
                        type: p.type === "misc" ? "once" : "misc",
                        date: p.type === "misc" ? (p.date || todayKey) : p.date,
                      }))}
                    >
                      No deadline
                    </button>
                  </div>
                  {taskForm.type === "misc" && (
                    <p className="planner-field-hint">Lands in Miscellaneous rather than on a day.</p>
                  )}
                </div>
              ) : taskForm.type === "monthly" ? (
                <div>
                  <label>Day of the month</label>
                  <select
                    aria-label="Day of the month"
                    value={taskForm.monthDay || 1}
                    onChange={e => setTaskForm(p => ({ ...p, monthDay: Number(e.target.value) }))}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <option key={d} value={d}>{ordinal(d)}</option>
                    ))}
                  </select>
                  {taskForm.monthDay > 28 && (
                    <p className="planner-field-hint">
                      Shorter months use their last day, so this never skips a month.
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label>Repeat on</label>
                  <div className="planner-weekday-picker">
                    {WEEKDAY_OPTIONS.map(day => {
                      const active = (taskForm.weekdays || []).includes(day.value);
                      return (
                        <button
                          key={day.value}
                          onClick={() => setTaskForm(p => ({
                            ...p,
                            weekdays: active
                              ? (p.weekdays || []).filter(d => d !== day.value)
                              : [...(p.weekdays || []), day.value],
                          }))}
                          className={active ? "is-active" : ""}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <label>Notes</label>
                <textarea value={taskForm.notes || ""} onChange={e => setTaskForm(p => ({ ...p, notes: e.target.value }))} rows={3} />
              </div>
            </div>
            <div className="planner-modal-footer">
              <button onClick={() => setTaskForm(null)} className="planner-secondary-btn">Cancel</button>
              <button onClick={saveTask} className="planner-primary-btn">Save task</button>
            </div>
          </div>
        </div>
      )}

      {movePrompt && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setMovePrompt(null)}>
          <div className="modal-box planner-modal planner-move-modal">
            <p>
              {movePrompt.kind === "day" ? (
                <>
                  Move all <strong>{movePrompt.count}</strong>{" "}
                  {movePrompt.count === 1 ? "task" : "tasks"} from{" "}
                  {parseDay(movePrompt.fromDay).toLocaleDateString("en-US", { weekday: "long" })} to{" "}
                  {parseDay(movePrompt.toDay).toLocaleDateString("en-US", { weekday: "long" })}?
                </>
              ) : (
                <>
                  Move <strong>{movePrompt.task.title}</strong> to{" "}
                  {parseDay(movePrompt.toDay).toLocaleDateString("en-US", { weekday: "long" })}?
                </>
              )}
            </p>
            <div className="planner-modal-footer">
              <button onClick={() => setMovePrompt(null)} className="planner-secondary-btn">Cancel</button>
              <button
                className="planner-secondary-btn"
                onClick={async () => {
                  if (movePrompt.kind === "day") await moveDay(movePrompt.fromDay, movePrompt.toDay, "week");
                  else await moveTask(movePrompt.task, movePrompt.fromDay, movePrompt.toDay, "week");
                  setMovePrompt(null);
                }}
              >
                {movePrompt.task?.type === "monthly" ? "Just this time" : "Just this week"}
              </button>
              <button
                className="planner-primary-btn"
                onClick={async () => {
                  if (movePrompt.kind === "day") await moveDay(movePrompt.fromDay, movePrompt.toDay, "always");
                  else await moveTask(movePrompt.task, movePrompt.fromDay, movePrompt.toDay, "always");
                  setMovePrompt(null);
                }}
              >
                {movePrompt.task?.type === "monthly" ? "Every month" : "Every week"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTaskId && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setDeleteTaskId(null)}>
          <div className="modal-box planner-modal planner-delete-modal">
            <p>Delete this task?</p>
            <div className="planner-modal-footer">
              <button onClick={() => setDeleteTaskId(null)} className="planner-secondary-btn">Cancel</button>
              <button onClick={confirmDeleteTask} className="planner-danger-btn">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlannerPanel({ title, className = "", children }) {
  return (
    <section className={`planner-panel ${className}`}>
      <div className="planner-panel-title">{title}</div>
      <div className="planner-panel-body">{children}</div>
    </section>
  );
}

function DayCard({ day, tone, tasks, completions, userById, onOpen, onAdd, onToggle, onMove, weekDays, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: day.key });
  // The header is the handle, so dragging a day cannot be confused with
  // dragging one of the task rows inside it.
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: `day:${day.key}`,
    data: { kind: "day", day },
    disabled: tasks.length === 0,
  });
  return (
    <div
      ref={setNodeRef}
      className={`planner-day-card planner-day-card--${tone}${day.isToday ? " is-today" : ""}${isOver ? " is-drop-target" : ""}${isDragging ? " is-drag-source" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="planner-day-header">
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className={`planner-day-heading${tasks.length ? " is-draggable" : ""}`}
          title={tasks.length ? `Drag ${day.name} onto another day to move all ${tasks.length} tasks` : undefined}
        >
          <span className="planner-day-name">{day.name}</span>
          <span className="planner-day-date">{day.dateLabel}</span>
        </span>
        {children}
      </div>
      <div className="planner-day-lines">
        {tasks.map(task => (
          <DraggableTaskRow
            key={task.id}
            task={task}
            day={day}
            done={!!completions[completionKey(task.id, day.key)]?.completed}
            user={userById.get(String(task.assignedUserId))}
            onToggle={onToggle}
            onMove={onMove}
            weekDays={weekDays}
          />
        ))}
        {Array.from({ length: Math.max(0, 6 - tasks.length) }).map((_, idx) => (
          <EmptyLine key={`line-${idx}`} />
        ))}
      </div>
      <div className="planner-day-footer">
        <span>{day.isToday ? "Today" : ""}</span>
        <button onClick={onAdd} className="planner-day-add" title={`Add task for ${day.name}`}>+</button>
      </div>
    </div>
  );
}

function DraggableTaskRow({ task, day, done, user, onToggle, onMove, weekDays }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${task.id}:${day.key}`,
    data: { task, fromDay: day.key },
  });
  return (
    <div
      ref={setNodeRef}
      className={`planner-day-task${done ? " is-done" : ""}${isDragging ? " is-drag-source" : ""}`}
    >
      <span
        role="button"
        tabIndex={0}
        className="planner-mini-check"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task, day.key);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onToggle(task, day.key);
          }
        }}
        aria-label={done ? "Mark incomplete" : "Mark complete"}
      />
      <span className="planner-day-task-title" {...attributes} {...listeners}>
        <span className="planner-day-task-title-text">{task.title}</span>
        {task.sourceId && <span className="planner-chip planner-chip--small">Extra</span>}
      </span>
      {user && <Assignee user={user} small />}
      <MoveMenu task={task} day={day} weekDays={weekDays} onMove={onMove} />
    </div>
  );
}

// Keyboard- and touch-friendly alternative to dragging.
function MoveMenu({ task, day, weekDays = [], onMove }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocPointerDown = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <span className="planner-move-menu" ref={ref} onClick={e => e.stopPropagation()}>
      <button
        type="button"
        className="planner-move-trigger"
        title={`Move ${task.title} to another day`}
        aria-label={`Move ${task.title} to another day`}
        aria-expanded={open}
        onPointerDown={e => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
      >
        ...
      </button>
      {open && (
        <span className="planner-move-list" role="menu">
          {weekDays.map(d => (
            <button
              key={d.key}
              type="button"
              role="menuitem"
              disabled={d.key === day.key}
              onPointerDown={e => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onMove(task, day.key, d.key);
              }}
            >
              {d.short}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function EmptyLine({ as: Tag = "div" }) {
  return <Tag className="planner-empty-line" />;
}

function Assignee({ user, small = false }) {
  return (
    <span className={`planner-assignee${small ? " planner-assignee--small" : ""}`} title={user.username}>
      {initialsFor(user.username)}
    </span>
  );
}
