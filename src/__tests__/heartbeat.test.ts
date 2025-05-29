import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { BetterWebSocket, BetterWebSocketState } from "../index";
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

describe("Heartbeat", () => {
  test("sends heartbeat", (done) => {
    const opts: BetterWebSocketOptions = {
      enableHeartbeat: true,
      heartbeatInterval: 100,
      heartbeatMessage: "ping",
    };
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`, undefined, opts);
    ws.addEventListener("message", (ev) => {
      const msg = ev as MessageEvent;
      if (msg.data === "pong") {
        done();
      }
    });
  });

  test("no heartbeat after close", (done) => {
    const opts: BetterWebSocketOptions = {
      enableHeartbeat: true,
      heartbeatInterval: 50,
      heartbeatMessage: "ping",
    };
    ws = new BetterWebSocket(`ws://localhost:${testServerPort}`, undefined, opts);
    let pingAfterClose = 0;
    let closed = false;
    ws.addEventListener("open", () => {
      const original = ws.send.bind(ws);
      ws.send = ((d: any) => {
        if (d === "ping" && closed) pingAfterClose++;
        return original(d);
      }) as any;
      setTimeout(() => {
        closed = true;
        ws.close();
      }, 75);
    });
    ws.addEventListener("close", () => {
      setTimeout(() => {
        expect(pingAfterClose).toBe(0);
        done();
      }, 150);
    });
  });
});
