import { HTTPException } from "hono/http-exception";
import { db } from "../../db.ts";
import type { Person } from "../../people.ts";
import type { TodoRow } from "../../../web/src/contract/operator.ts";
import { now, toTodoRow, type TodoDb } from "./tables.ts";

/**
 * "Create task: Add to your task list." A small list of the studio's own:
 * a title, a note, who wrote it, done or not. Nothing reads it but the
 * screen, and the model is never given it.
 */

const fail = (status: 400 | 404, message: string): never => {
  throw new HTTPException(status, { message });
};

/** Open ones first, oldest first; then the last few done. */
export function todos(): TodoRow[] {
  const open = db.prepare("SELECT * FROM cc_todos WHERE done = 0 ORDER BY id").all() as unknown as TodoDb[];
  const done = db.prepare("SELECT * FROM cc_todos WHERE done = 1 ORDER BY done_at DESC LIMIT 5").all() as unknown as TodoDb[];
  return [...open, ...done].map(toTodoRow);
}

export function addTodo(title: string, noteText: string | null, by: Person): TodoRow {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.length < 2) fail(400, "Give the task a title.");
  if (t.length > 160) fail(400, "Keep the title under 160 characters; the rest can go in the note.");
  const n = (noteText ?? "").trim().slice(0, 1000) || null;
  const r = db.prepare("INSERT INTO cc_todos (title, note, who, created_at) VALUES (?, ?, ?, ?)").run(t, n, by.name, now());
  return toTodoRow(db.prepare("SELECT * FROM cc_todos WHERE id = ?").get(Number(r.lastInsertRowid)) as unknown as TodoDb);
}

export function markTodo(id: number, done: boolean, by: Person): TodoRow {
  const had = db.prepare("SELECT * FROM cc_todos WHERE id = ?").get(id) as unknown as TodoDb | undefined;
  if (!had) fail(404, `There is no task #${id} on the list.`);
  db.prepare("UPDATE cc_todos SET done = ?, done_at = ?, done_by = ? WHERE id = ?").run(done ? 1 : 0, done ? now() : null, done ? by.name : null, id);
  return toTodoRow(db.prepare("SELECT * FROM cc_todos WHERE id = ?").get(id) as unknown as TodoDb);
}

export function removeTodo(id: number): void {
  const r = db.prepare("DELETE FROM cc_todos WHERE id = ?").run(id);
  if (!r.changes) fail(404, `There is no task #${id} on the list.`);
}
