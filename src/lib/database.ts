import {
  addRxPlugin,
  createRxDatabase,
  deepEqual,
  defaultHashSha256,
  randomToken,
  type RxCollection,
  type RxConflictHandler,
  RXDB_VERSION,
  type RxJsonSchema,
  type RxReplicationWriteToMasterRow,
  type RxStorage,
} from "rxdb/plugins/core";
import { replicateRxCollection } from "rxdb/plugins/replication";
import {
  getConnectionHandlerSimplePeer,
  replicateWebRTC,
  type SimplePeer,
} from "rxdb/plugins/replication-webrtc";
import { getRxStorageDexie } from "rxdb/plugins/storage-dexie";
import { type TodoDocType } from "../types/todo";

let storage: RxStorage<unknown, unknown> = getRxStorageDexie();

export const databasePromise = (async () => {
  if (import.meta.env.DEV) {
    await import("rxdb/plugins/dev-mode").then((module) =>
      addRxPlugin(module.RxDBDevModePlugin)
    );

    await import("rxdb/plugins/validate-ajv").then((module) => {
      storage = module.wrappedValidateAjvStorage({ storage });
    });
  }

  const roomId = window.location.hash;

  if (!roomId || roomId.length < 5) {
    window.location.hash = "room-" + randomToken(10);
    window.location.reload();
  }

  const roomHash = await defaultHashSha256(roomId);

  const database = await createRxDatabase<{
    todos: RxCollection<TodoDocType, object>;
  }>({
    name: [
      "tpdp",
      RXDB_VERSION.replace(/\./g, "-"),
      roomHash.substring(0, 10),
    ].join("-"),
    storage,
  });

  const conflictHandler: RxConflictHandler<TodoDocType> = {
    isEqual(a, b) {
      return deepEqual(a, b);
    },

    resolve(input) {
      const ret =
        input.newDocumentState.lastChange >
        input.realMasterState.lastChange
          ? input.newDocumentState
          : input.realMasterState;
      return Promise.resolve(ret);
    },
  };

  await database.addCollections({
    todos: {
      conflictHandler,
      schema: {
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
      } as RxJsonSchema<TodoDocType>,
    },
  });

  database.todos.preSave((doc) => {
    doc.lastChange = Date.now();
    return doc;
  }, true);

  await database.todos.bulkInsert(
    [
      "touch your 👃 with your 👅",
      "solve rubik's cube 🎲 blindfolded",
      "invent new 🍔",
    ].map((name, idx) => ({
      id: "todo-" + idx,
      name,
      lastChange: 0,
      state: "open",
    }))
  );

  // Set up HTTP replication
  const httpReplicationState = await replicateRxCollection({
    collection: database.todos,
    replicationIdentifier: "http-todos",
    pull: {
      handler: async (lastCheckpoint) => {
        const response = await fetch(
          `http://localhost:3000/todos?lastCheckpoint=${lastCheckpoint}`
        );

        const docs = await response.json();

        return {
          documents: docs,
          checkpoint: Date.now(),
        };
      },
    },
    push: {
      handler: async (
        docs: RxReplicationWriteToMasterRow<TodoDocType>[]
      ) => {
        console.log("pushing docs", docs);
        const results = await Promise.all(
          docs.map(async (doc) => {
            const { newDocumentState, assumedMasterState } = doc;

            if (newDocumentState._deleted) {
              await fetch(
                `http://localhost:3000/todos/${newDocumentState.id}`,
                {
                  method: "DELETE",
                }
              );

              return {
                ...newDocumentState,
                _deleted: true,
              };
            }

            const method = assumedMasterState ? "PUT" : "POST";
            const url =
              method === "POST"
                ? "http://localhost:3000/todos"
                : `http://localhost:3000/todos/${newDocumentState.id}`;

            await fetch(url, {
              method,
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(newDocumentState),
            });

            return {
              ...newDocumentState,
              _deleted: false,
            };
          })
        );
        return results;
      },
    },
  });

  const webrtcReplicationState = await replicateWebRTC<
    TodoDocType,
    SimplePeer
  >({
    collection: database.todos,
    connectionHandlerCreator: getConnectionHandlerSimplePeer({}),
    topic: roomHash.substring(0, 10),
    pull: {},
    push: {},
  });

  httpReplicationState.error$.subscribe((err) => {
    console.error("HTTP replication error:", err);
  });

  webrtcReplicationState.error$.subscribe((err) => {
    console.error("WebRTC replication error:", err);
  });

  webrtcReplicationState.peerStates$.subscribe((s) => {
    console.log("new peer states:", s);
  });

  return database;
})();
