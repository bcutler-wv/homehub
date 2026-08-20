export const completionKey = (taskId, dayKey) => `${taskId}:${dayKey}`;
export const moveKeyFor = completionKey;

export const dateWeekday = (dayKey) => new Date(`${dayKey}T12:00:00`).getDay();

export const isTaskOnDay = (task, dayKey) => {
  if (task.active === false) return false;
  if (task.type === "once") return task.date === dayKey;
  if (task.type === "weekday") return (task.weekdays || []).includes(dateWeekday(dayKey));
  return false;
};

export const normalizeTasks = (tasks) => ({
  items: Array.isArray(tasks?.items) ? tasks.items : [],
  completions: tasks?.completions && typeof tasks.completions === "object" ? tasks.completions : {},
  moves: tasks?.moves && typeof tasks.moves === "object" && !Array.isArray(tasks.moves) ? tasks.moves : {},
});

const movePrefix = (taskId) => `${taskId}:`;
const moveFromDay = (key, taskId) => key.slice(movePrefix(taskId).length);

export const taskAppearsOnDay = (task, dayKey, moves = {}) => {
  const outbound = moves[moveKeyFor(task.id, dayKey)];
  if (isTaskOnDay(task, dayKey) && (!outbound || outbound === dayKey)) return true;
  return Object.entries(moves).some(([key, target]) =>
    target === dayKey &&
    key.startsWith(movePrefix(task.id)) &&
    key !== moveKeyFor(task.id, dayKey) &&
    isTaskOnDay(task, moveFromDay(key, task.id))
  );
};

const relocateCompletion = (completions, taskId, fromDayKey, toDayKey) => {
  const fromKey = completionKey(taskId, fromDayKey);
  if (!completions[fromKey] || fromDayKey === toDayKey) return completions;
  const next = { ...completions };
  next[completionKey(taskId, toDayKey)] = next[fromKey];
  delete next[fromKey];
  return next;
};

// Moves are keyed by the task's ORIGINAL (base-schedule) day. Callers may pass
// the rendered day (where the task currently appears after a prior move) as
// fromDayKey; resolve it back to the base day before touching the moves map.
const resolveBaseDay = (moves, taskId, fromDayKey) => {
  const prefix = movePrefix(taskId);
  const entry = Object.entries(moves || {}).find(([key, target]) =>
    key.startsWith(prefix) && target === fromDayKey
  );
  return entry ? moveFromDay(entry[0], taskId) : fromDayKey;
};

export const applyThisWeekMove = (data, task, fromDayKey, toDayKey) => {
  const baseDay = resolveBaseDay(data.moves, task.id, fromDayKey);
  const key = moveKeyFor(task.id, baseDay);
  const moves = { ...data.moves };
  const previousTarget = moves[key] || baseDay;
  if (toDayKey === baseDay) delete moves[key];
  else moves[key] = toDayKey;
  return {
    ...data,
    moves,
    completions: relocateCompletion(data.completions, task.id, previousTarget, toDayKey),
  };
};

const weekStartOf = (dayKey) => {
  const date = new Date(`${dayKey}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
};

export const applyEveryWeekMove = (data, task, fromDayKey, toDayKey) => {
  const baseDay = resolveBaseDay(data.moves, task.id, fromDayKey);
  const fromWd = dateWeekday(baseDay);
  const toWd = dateWeekday(toDayKey);
  const weekdays = Array.from(new Set(
    (task.weekdays || []).filter(d => d !== fromWd).concat(toWd)
  )).sort((a, b) => a - b);
  const week = weekStartOf(baseDay);
  const moves = Object.fromEntries(Object.entries(data.moves || {}).filter(([key]) =>
    !(key.startsWith(movePrefix(task.id)) && weekStartOf(moveFromDay(key, task.id)) === week)
  ));
  const previousTarget = (data.moves || {})[moveKeyFor(task.id, baseDay)] || baseDay;
  return {
    ...data,
    items: data.items.map(t => t.id === task.id ? { ...t, weekdays } : t),
    moves,
    completions: relocateCompletion(data.completions, task.id, previousTarget, toDayKey),
  };
};

export const applyOnceMove = (data, task, toDayKey) => ({
  ...data,
  items: data.items.map(t => t.id === task.id ? { ...t, date: toDayKey } : t),
  completions: relocateCompletion(data.completions, task.id, task.date, toDayKey),
});

export const pruneStaleMoves = (data) => {
  const byId = new Map(data.items.map(t => [String(t.id), t]));
  const moves = Object.fromEntries(Object.entries(data.moves || {}).filter(([key]) => {
    const sep = key.lastIndexOf(":");
    const task = byId.get(key.slice(0, sep));
    return task && isTaskOnDay(task, key.slice(sep + 1));
  }));
  return { ...data, moves };
};
