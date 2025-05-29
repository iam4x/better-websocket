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

describe("URL fallback", () => {
  test("fallback to next URL", (done) => {
    const urls = [
      "ws://localhost:9999",
      `ws://localhost:${testServerPort}`,
    ];
    const opts: BetterWebSocketOptions = { connectTimeout: 500, maxReconnectAttempts: 1 };
    ws = new BetterWebSocket(urls, undefined, opts);
    ws.addEventListener("open", () => {
      expect(ws.getCurrentUrl()).toBe(`ws://localhost:${testServerPort}`);
      done();
    });
  });
});

describe("Reconnection", () => {
  test("stops after max attempts", (done) => {
    const opts: BetterWebSocketOptions = { maxReconnectAttempts: 1, connectTimeout: 200 };
    ws = new BetterWebSocket("ws://localhost:9999", undefined, opts);
    setTimeout(() => {
      expect(ws.getReconnectAttempts()).toBe(1);
      done();
    }, 800);
  });

  test("reset attempts on success", (done) => {
    const opts: BetterWebSocketOptions = { maxReconnectAttempts: 2, connectTimeout: 200 };
    ws = new BetterWebSocket("ws://localhost:65433", undefined, opts);
    setTimeout(() => {
      ws.destroy();
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
      ws.addEventListener("open", () => {
        expect(ws.getReconnectAttempts()).toBe(0);
        done();
      });
    }, 600);
  });
});
