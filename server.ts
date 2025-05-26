import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { addRxPlugin, createRxDatabase } from "rxdb/plugins/core";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";

// Add the query builder plugin
addRxPlugin(RxDBQueryBuilderPlugin);

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

serverDb.todos.$.subscribe((change) => {
  console.log(change);
});

// Pull endpoint - get all documents since last checkpoint
app.get("/todos/pull", async (req, res) => {
  try {
    const lastCheckpoint =
      parseInt(req.query.lastCheckpoint as string) || 0;
    const todos = await serverDb.todos
      .find()
      .where("lastChange")
      .gt(lastCheckpoint)
      .exec();
    res.json(todos);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Push endpoint - handle all document changes
app.post("/todos/push", async (req, res) => {
  try {
    const changes = req.body;
    if (!Array.isArray(changes)) {
      return res
        .status(400)
        .json({ error: "Expected array of changes" });
    }

    const results = await Promise.all(
      changes.map(async (change) => {
        const { newDocumentState } = change;

        // Handle deleted documents
        if (newDocumentState._deleted) {
          const existingTodo = await serverDb.todos
            .findOne(newDocumentState.id)
            .exec();
          if (existingTodo) {
            await existingTodo.remove();
          }
          return { ...newDocumentState, _deleted: true };
        }

        // Handle document updates/inserts
        const existingTodo = await serverDb.todos
          .findOne(newDocumentState.id)
          .exec();

        if (existingTodo) {
          // If document exists, update if the new version is newer
          if (newDocumentState.lastChange > existingTodo.lastChange) {
            await existingTodo.update(newDocumentState);
          }
        } else {
          // If document doesn't exist, insert it
          await serverDb.todos.insert(newDocumentState);
        }

        return { ...newDocumentState, _deleted: false };
      })
    );

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
