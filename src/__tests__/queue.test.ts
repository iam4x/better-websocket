import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { BetterWebSocket } from "../index";
import { createTestServer, TestServer } from "./server";
import type { BetterWebSocketOptions } from "../index";

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

describe("Message queue", () => {
  test("queues messages when offline", () => {
    ws = new BetterWebSocket("ws://localhost:9999");
    ws.send("a");
    ws.send("b");
    expect(ws.getQueuedMessageCount()).toBe(2);
  });

  test("flushes queue on connect", (done) => {
    ws = new BetterWebSocket("ws://localhost:9999");
    ws.send("x");
    ws.send("y");
    expect(ws.getQueuedMessageCount()).toBe(2);
    ws.destroy();
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
    ws.addEventListener("open", () => ws.send("z"));
    ws.addEventListener("message", (ev) => {
      const msg = ev as MessageEvent;
      expect(msg.data).toBe("echo: z");
      done();
    });
  });

  test("respects max queue size", () => {
    const opts: BetterWebSocketOptions = { maxQueueSize: 2 };
    ws = new BetterWebSocket("ws://localhost:9999", undefined, opts);
    ws.send("1");
    ws.send("2");
    ws.send("3");
    expect(ws.getQueuedMessageCount()).toBe(2);
  });
});
