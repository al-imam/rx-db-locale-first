import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { createRxDatabase } from "rxdb/plugins/core";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Create an in-memory database for the server
const serverDb = await createRxDatabase({
  name: "serverdb",
  storage: getRxStorageMemory(),
});

// Define the todo collection schema
const todoSchema = {
  version: 0,
  primaryKey: "id",
  type: "object",
  properties: {
    id: {
      type: "string",
      maxLength: 20,
    },
    name: {
      type: "string",
    },
    state: {
      type: "string",
      enum: ["open", "done"],
      maxLength: 10,
    },
    lastChange: {
      type: "number",
      minimum: 0,
      maximum: 2701307494132,
      multipleOf: 1,
    },
  },
  required: ["id", "name", "state", "lastChange"],
  indexes: ["state", ["state", "lastChange"]],
};

// Create the todos collection
await serverDb.addCollections({
  todos: {
    schema: todoSchema,
  },
});

// API endpoints
app.get("/todos", async (req, res) => {
  const todos = await serverDb.todos.find().exec();
  res.json(todos);
});

app.post("/todos", async (req, res) => {
  const todo = req.body;
  await serverDb.todos.insert(todo);
  res.json(todo);
});

app.put("/todos/:id", async (req, res) => {
  const { id } = req.params;
  const todo = req.body;
  await serverDb.todos.findOne(id).update(todo);
  res.json(todo);
});

app.delete("/todos/:id", async (req, res) => {
  const { id } = req.params;
  await serverDb.todos.findOne(id).remove();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
