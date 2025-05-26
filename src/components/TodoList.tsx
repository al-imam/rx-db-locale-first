import { useEffect, useState } from "react";
import { randomToken } from "rxdb/plugins/core";
import { databasePromise } from "../lib/database";
import type { RxTodoDocument } from "../types/todo";
import { Todo } from "./Todo";

export const TodoList = () => {
  const [todos, setTodos] = useState<RxTodoDocument[]>([]);
  const [newTodo, setNewTodo] = useState("");

  useEffect(() => {
    const subscription = databasePromise.then((db) =>
      db.todos
        .find({
          sort: [{ state: "desc" }, { lastChange: "desc" }],
        })
        .$.subscribe((todos) => {
          setTodos(todos);
        })
    );

    return () => {
      subscription.then((sub) => sub.unsubscribe());
    };
  }, []);

  const handleAddTodo = async () => {
    if (!newTodo.trim()) return;

    const db = await databasePromise;
    await db.todos.insert({
      id: randomToken(10),
      name: newTodo.trim(),
      state: "open",
      lastChange: Date.now(),
    });
    setNewTodo("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddTodo();
    }
  };

  const handleClearCompleted = async () => {
    const db = await databasePromise;
    await db.todos
      .find({
        selector: { state: "done" },
      })
      .remove();
  };

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            p2p todos
          </h1>
          <p className="text-gray-600 mb-4">
            This is a local-first todo app that replicates
            peer-to-peer with WebRTC. Share this URL to test
            replication:
            <br />
            <code className="bg-gray-100 px-2 py-1 rounded">
              {window.location.href}
            </code>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTodo}
              onChange={(e) => setNewTodo(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="What needs to be done?"
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleAddTodo}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add
            </button>
          </div>
        </div>

        <ul className="divide-y divide-gray-200">
          {todos.map((todo) => (
            <Todo key={todo.id} todo={todo} />
          ))}
        </ul>

        <div className="p-4 border-t flex justify-between items-center">
          <span className="text-gray-600">
            {todos.filter((t) => t.state === "open").length} items
            left
          </span>
          <button
            onClick={handleClearCompleted}
            className="text-gray-600 hover:text-gray-800"
          >
            Clear completed
          </button>
        </div>
      </div>
    </div>
  );
};
