import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { BetterWebSocket, BetterWebSocketState } from "../index";
import { createTestServer, TestServer } from "./server";

let server: TestServer;
let testServerPort: number;

let ws: BetterWebSocket;

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

describe("Constructor", () => {
  test("creates with single URL", () => {
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    expect(ws.url).toBe(`ws://localhost:${testServerPort}`);
    expect(ws.readyState).toBe(BetterWebSocketState.CONNECTING);
  });

  test("throws with empty URL array", () => {
    expect(() => new BetterWebSocket([])).toThrow("At least one URL must be provided");
  });
});

describe("Connection events", () => {
  test("open and close events", (done) => {
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    ws.addEventListener("open", () => ws.close(1000, "bye"));
    ws.addEventListener("close", (ev) => {
      expect(ev.code).toBe(1000);
      done();
    });
  });

  test("send and receive message", (done) => {
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    ws.addEventListener("open", () => ws.send("hello"));
    ws.addEventListener("message", (ev) => {
      const msg = ev as MessageEvent;
      expect(msg.data).toBe("echo: hello");
      done();
    });
  });
});
