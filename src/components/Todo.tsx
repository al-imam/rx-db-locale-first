import { useState } from "react";
import { RxTodoDocument } from "../types/todo";

interface TodoProps {
  todo: RxTodoDocument;
}

export const Todo = ({ todo }: TodoProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(todo.name);

  const handleToggle = () => {
    todo.incrementalPatch({
      state: todo.state === "done" ? "open" : "done",
    });
  };

  const handleDelete = () => {
    todo.remove();
  };

  const handleEdit = async () => {
    const newName = editValue.trim();
    if (newName && newName !== todo.name) {
      await todo.incrementalPatch({ name: newName });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleEdit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditValue(todo.name);
    }
  };

  return (
    <li
      className={`group flex items-center gap-2 p-4 border-b border-gray-200 ${
        todo.state === "done" ? "bg-gray-50" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={todo.state === "done"}
        onChange={handleToggle}
        className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />

      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleEdit}
          onKeyDown={handleKeyDown}
          className="flex-1 px-2 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      ) : (
        <span
          className={`flex-1 cursor-pointer ${
            todo.state === "done" ? "line-through text-gray-500" : ""
          }`}
          onDoubleClick={() => setIsEditing(true)}
        >
          {todo.name}
        </span>
      )}

      <button
        onClick={handleDelete}
        className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700"
      >
        ×
      </button>
    </li>
  );
};
