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
  type RxReplicationPullStreamItem,
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
import { Observable, Subject } from "rxjs";
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

  database.todos.preSave(
    (doc) => ({ ...doc, lastChange: Date.now() }),
    true
  );

  replicateWebRTC<TodoDocType, SimplePeer>({
    collection: database.todos,
    connectionHandlerCreator: getConnectionHandlerSimplePeer({}),
    topic: roomHash.substring(0, 10),
    pull: {},
    push: {},
  }).then((replicationState) => {
    replicationState.error$.subscribe((err: unknown) => {
      console.log("replication error:");
      console.dir(err);
    });
    replicationState.peerStates$.subscribe((s) => {
      console.log("new peer states:");
      console.dir(s);
    });
  });

  const PullStream$ = new Subject<
    RxReplicationPullStreamItem<
      TodoDocType,
      { id: string; updatedAt: number }
    >
  >();

  const eventSource = new EventSource("/api/todos/pullStream", {
    withCredentials: true,
  });

  eventSource.onmessage = (event) => {
    const eventData = JSON.parse(event.data);

    PullStream$.next({
      documents: eventData.documents,
      checkpoint: eventData.checkpoint,
    });
  };

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data === "RESYNC") {
      PullStream$.next("RESYNC");
    } else {
      PullStream$.next({
        documents: data.documents,
        checkpoint: data.checkpoint,
      });
    }
  };

  eventSource.onerror = () => {
    PullStream$.next("RESYNC");
  };

  const httpReplicationState = replicateRxCollection({
    collection: database.todos,
    replicationIdentifier: "http-todos",
    live: true,
    pull: {
      handler: async (lastCheckpoint, batchSize) => {
        try {
          const checkpoint = (lastCheckpoint as {
            id: string;
            updatedAt: number;
          }) || { id: "", updatedAt: 0 };
          const response = await fetch(
            `/api/todos/pull?updatedAt=${checkpoint.updatedAt}&id=${checkpoint.id}&batchSize=${batchSize}`
          );

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = await response.json();
          return {
            documents: data.documents,
            checkpoint: data.checkpoint,
          };
        } catch (error) {
          console.error("Pull replication error:", error);
          return {
            documents: [],
            checkpoint: lastCheckpoint,
          };
        }
      },
      stream$: PullStream$.asObservable(),
    },
    push: {
      handler: async (
        docs: RxReplicationWriteToMasterRow<TodoDocType>[]
      ) => {
        try {
          const response = await fetch("/api/todos/push", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(docs),
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const conflicts = await response.json();
          return conflicts;
        } catch (error) {
          console.error("Push replication error:", error);
          throw error;
        }
      },
    },
  });

  httpReplicationState.error$.subscribe((err) => {
    console.error("HTTP replication error:", err);
  });

  httpReplicationState.active$.subscribe((active) => {
    console.log("HTTP replication active:", active);
  });

  return database;
})();
