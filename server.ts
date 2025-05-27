import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import {
  addRxPlugin,
  createRxDatabase,
  lastOfArray,
} from "rxdb/plugins/core";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";
import { RxDBQueryBuilderPlugin } from "rxdb/plugins/query-builder";
import { getRxStorageMemory } from "rxdb/plugins/storage-memory";
import { RxDBUpdatePlugin } from "rxdb/plugins/update";
import { wrappedValidateAjvStorage } from "rxdb/plugins/validate-ajv";
import { Subject } from "rxjs";
import type { TodoDocType } from "./src/types/todo";

addRxPlugin(RxDBQueryBuilderPlugin);
addRxPlugin(RxDBUpdatePlugin);
addRxPlugin(RxDBDevModePlugin);

const app = express();
app.use(cors());
app.use(bodyParser.json());

const serverDb = await createRxDatabase({
  name: "serverdb",
  storage: wrappedValidateAjvStorage({
    storage: getRxStorageMemory(),
  }),
});

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

await serverDb.addCollections({
  todos: {
    schema: todoSchema,
  },
});

interface ReplicationEvent {
  documents: TodoDocType[];
  checkpoint: {
    id: string;
    updatedAt: number;
  } | null;
}

const pullStream$ = new Subject<ReplicationEvent>();

serverDb.todos.$.subscribe((change) => {
  pullStream$.next({
    documents: [change.documentData],
    checkpoint: {
      id: change.documentData.id,
      updatedAt: change.documentData.lastChange,
    },
  });
});

app.get("/todos/pull", async (req, res) => {
  try {
    const updatedAt = parseFloat(req.query.updatedAt as string) || 0;
    const id = (req.query.id as string) || "";
    const batchSize = parseInt(req.query.batchSize as string) || 100;

    const todos = await serverDb.todos
      .find({
        selector: {
          $or: [
            { lastChange: { $gt: updatedAt } },
            { lastChange: { $eq: updatedAt }, id: { $gt: id } },
          ],
        },
        sort: [{ lastChange: "asc" }, { id: "asc" }],
        limit: batchSize,
      })
      .exec();

    const documents = todos.map((todo) => todo.toJSON());
    const checkpoint =
      documents.length === 0
        ? { id, updatedAt }
        : {
            id: lastOfArray(documents).id,
            updatedAt: lastOfArray(documents).lastChange,
          };

    res.json({ documents, checkpoint });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/todos/push", async (req, res) => {
  try {
    const changes = req.body;
    if (!Array.isArray(changes)) {
      return res
        .status(400)
        .json({ error: "Expected array of changes" });
    }

    const conflicts: TodoDocType[] = [];
    const event: ReplicationEvent = {
      documents: [],
      checkpoint: null,
    };

    for (const change of changes) {
      const { newDocumentState, assumedMasterState } = change;
      const existingTodo = await serverDb.todos
        .findOne(newDocumentState.id)
        .exec();

      if (
        existingTodo &&
        (!assumedMasterState ||
          existingTodo.lastChange !== assumedMasterState.lastChange)
      ) {
        conflicts.push(existingTodo.toJSON());
      } else {
        if (existingTodo) {
          await existingTodo.update({
            $set: newDocumentState,
          });
        } else {
          await serverDb.todos.insert(newDocumentState);
        }

        event.documents.push(newDocumentState);
        event.checkpoint = {
          id: newDocumentState.id,
          updatedAt: newDocumentState.lastChange,
        };
      }
    }

    if (event.documents.length > 0) {
      pullStream$.next(event);
    }

    res.json(conflicts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/todos/pullStream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "keep-alive",
    "Cache-Control": "no-cache",
  });

  const subscription = pullStream$.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on("close", () => {
    subscription.unsubscribe();
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
