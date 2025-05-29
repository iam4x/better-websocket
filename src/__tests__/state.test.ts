import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { BetterWebSocket, BetterWebSocketState } from "../index";
import { createTestServer, TestServer } from "./server";

let ws: BetterWebSocket;
let server: TestServer;
let testServerPort: number;

beforeAll(async () => {
  server = await createTestServer(0);
  testServerPort = server.port;
});

afterAll(() => {
  server.stop();
});

afterEach(() => {
  if (ws) ws.destroy();
});

describe("State management", () => {
  test("no send after destroy", () => {
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    ws.destroy();
    const before = ws.getQueuedMessageCount();
    ws.send("x");
    expect(ws.getQueuedMessageCount()).toBe(before);
  });

  test("transitions", (done) => {
    const states: number[] = [];
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    states.push(ws.readyState);
    ws.addEventListener("open", () => {
      states.push(ws.readyState);
      ws.close();
    });
    ws.addEventListener("close", () => {
      states.push(ws.readyState);
      expect(states).toEqual([
        BetterWebSocketState.CONNECTING,
        BetterWebSocketState.OPEN,
        BetterWebSocketState.CLOSED,
      ]);
      done();
    });
  });
});
