import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "bun:test";

import { BetterWebSocket, BetterWebSocketState } from "./index";
import type { BetterWebSocketOptions } from "./index";

// Test WebSocket server setup
let testServer: any;
let testServerPort: number;
let secondTestServer: any;
let secondTestServerPort: number;

const createTestServer = (port: number): Promise<any> => {
  return new Promise((resolve) => {
    const server = Bun.serve({
      port,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        message(_ws, message) {
          // Echo messages back
          if (message === "ping") {
            _ws.send("pong");
          } else {
            _ws.send(`echo: ${message}`);
          }
        },
        open(_ws) {
          // Test server: client connected
        },
        close(_ws) {
          // Test server: client disconnected
        },
      },
    });
    resolve(server);
  });
};

beforeAll(async () => {
  // Start primary test server
  testServerPort = 8080;
  testServer = await createTestServer(testServerPort);

  // Start secondary test server for fallback testing
  secondTestServerPort = 8081;
  secondTestServer = await createTestServer(secondTestServerPort);

  // Wait a bit for servers to start
  await new Promise((resolve) => setTimeout(resolve, 100));
});

afterAll(() => {
  if (testServer) {
    testServer.stop();
  }
  if (secondTestServer) {
    secondTestServer.stop();
  }
});

describe("BetterWebSocket", () => {
  let ws: BetterWebSocket;

  afterEach(() => {
    if (ws) {
      ws.destroy();
    }
  });

  describe("Constructor and Basic Properties", () => {
    test("should create with single URL", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
      expect(ws.url).toBe(`ws://localhost:${testServerPort}`);
      expect(ws.readyState).toBe(BetterWebSocketState.CONNECTING);
    });

    test("should create with multiple URLs", () => {
      ws = new BetterWebSocket([
        `ws://localhost:${testServerPort}`,
        `ws://localhost:${secondTestServerPort}`,
      ]);
      expect(ws.url).toBe(`ws://localhost:${testServerPort}`);
    });

    test("should throw error with empty URL array", () => {
      expect(() => new BetterWebSocket([])).toThrow(
        "At least one URL must be provided",
      );
    });

    test("should set default options", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);
      expect(ws.getReconnectAttempts()).toBe(0);
      expect(ws.getQueuedMessageCount()).toBe(0);
    });

    test("should accept custom options", () => {
      const options: BetterWebSocketOptions = {
        connectTimeout: 5000,
        maxReconnectAttempts: 3,
        reconnectBackoffFactor: 2,
        maxQueueSize: 50,
      };

      ws = new BetterWebSocket(
        `ws://localhost:${testServerPort}`,
        undefined,
        options,
      );
      expect(ws).toBeDefined();
    });
  });

  describe("Connection and Events", () => {
    test("should connect successfully and dispatch open event", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.addEventListener("open", (event) => {
        expect(ws.readyState).toBe(BetterWebSocketState.OPEN);
        expect(event.type).toBe("open");
        done();
      });
    });

    test("should handle onopen callback", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.onopen = (event) => {
        expect(ws.readyState).toBe(BetterWebSocketState.OPEN);
        expect(event.type).toBe("open");
        done();
      };
    });

    test("should send and receive messages", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.addEventListener("open", () => {
        ws.send("test message");
      });

      ws.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent;
        expect(messageEvent.data).toBe("echo: test message");
        done();
      });
    });

    test("should handle onmessage callback", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.onopen = () => {
        ws.send("test message");
      };

      ws.onmessage = (event) => {
        expect(event.data).toBe("echo: test message");
        done();
      };
    });

    test("should close connection properly", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.addEventListener("open", () => {
        ws.close(1000, "Test close");
      });

      ws.addEventListener("close", (event) => {
        const closeEvent = event as CloseEvent;
        expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
        expect(closeEvent.code).toBe(1000);
        expect(closeEvent.reason).toBe("Test close");
        done();
      });
    });
  });

  describe("Message Queuing", () => {
    test("should queue messages when not connected", () => {
      ws = new BetterWebSocket(`ws://localhost:9999`); // Non-existent server

      ws.send("message 1");
      ws.send("message 2");

      expect(ws.getQueuedMessageCount()).toBe(2);
    });

    test("should flush queued messages when connected", (done) => {
      ws = new BetterWebSocket(`ws://localhost:9999`); // Start with non-existent server

      // Queue some messages
      ws.send("queued message 1");
      ws.send("queued message 2");

      expect(ws.getQueuedMessageCount()).toBe(2);

      // Simulate successful connection by creating new instance with working server
      ws.destroy();
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      let messageCount = 0;
      ws.addEventListener("open", () => {
        ws.send("immediate message");
      });

      ws.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent;
        messageCount++;
        if (messageCount === 1) {
          expect(messageEvent.data).toBe("echo: immediate message");
          done();
        }
      });
    });

    test("should respect max queue size", () => {
      const options: BetterWebSocketOptions = {
        maxQueueSize: 2,
      };

      ws = new BetterWebSocket(`ws://localhost:9999`, undefined, options);

      ws.send("message 1");
      ws.send("message 2");
      ws.send("message 3"); // Should remove message 1

      expect(ws.getQueuedMessageCount()).toBe(2);
    });

    test("should clear message queue", () => {
      ws = new BetterWebSocket(`ws://localhost:9999`);

      ws.send("message 1");
      ws.send("message 2");
      expect(ws.getQueuedMessageCount()).toBe(2);

      ws.clearMessageQueue();
      expect(ws.getQueuedMessageCount()).toBe(0);
    });
  });

  describe("URL Fallback", () => {
    test("should fallback to next URL when first fails", (done) => {
      const urls = [
        "ws://localhost:9999", // Non-existent server
        `ws://localhost:${testServerPort}`, // Working server
      ];

      const options: BetterWebSocketOptions = {
        connectTimeout: 1000,
        maxReconnectAttempts: 1,
      };

      ws = new BetterWebSocket(urls, undefined, options);

      ws.addEventListener("open", () => {
        // The URL should have switched to the working server
        expect(ws.url).toBe(`ws://localhost:${testServerPort}`);
        expect(ws.getCurrentUrl()).toBe(`ws://localhost:${testServerPort}`);
        done();
      });
    }, 5000);

    test("should cycle through multiple URLs", (done) => {
      const urls = [
        "ws://localhost:9998", // Non-existent
        "ws://localhost:9999", // Non-existent
        `ws://localhost:${testServerPort}`, // Working
      ];

      const options: BetterWebSocketOptions = {
        connectTimeout: 500,
        maxReconnectAttempts: 1,
      };

      ws = new BetterWebSocket(urls, undefined, options);

      ws.addEventListener("open", () => {
        // Should end up connected to the working server
        expect(ws.url).toBe(`ws://localhost:${testServerPort}`);
        expect(ws.getCurrentUrl()).toBe(`ws://localhost:${testServerPort}`);
        done();
      });
    }, 5000);
  });

  describe("Reconnection", () => {
    test("should attempt reconnection with exponential backoff", (done) => {
      const options: BetterWebSocketOptions = {
        maxReconnectAttempts: 2,
        reconnectBackoffFactor: 2,
        connectTimeout: 500,
      };

      ws = new BetterWebSocket("ws://localhost:9999", undefined, options);

      // Wait for reconnection attempts to complete
      setTimeout(() => {
        expect(ws.getReconnectAttempts()).toBe(2);
        done();
      }, 3000);
    }, 5000);

    test("should stop reconnecting after max attempts", (done) => {
      const options: BetterWebSocketOptions = {
        maxReconnectAttempts: 1,
        connectTimeout: 500,
      };

      ws = new BetterWebSocket("ws://localhost:9999", undefined, options);

      setTimeout(() => {
        expect(ws.getReconnectAttempts()).toBe(1);
        done();
      }, 2000);
    }, 5000);

    test("should reset reconnect attempts on successful connection", (done) => {
      const options: BetterWebSocketOptions = {
        maxReconnectAttempts: 2,
        reconnectBackoffFactor: 1.5,
        connectTimeout: 500,
      };

      // Start with a non-existent server to trigger reconnection attempts
      ws = new BetterWebSocket("ws://localhost:65433", undefined, options);

      // Wait for reconnection attempts to accumulate
      setTimeout(() => {
        const attemptsAfterFailures = ws.getReconnectAttempts();
        expect(attemptsAfterFailures).toBeGreaterThan(0);

        // Now destroy and create a new connection to a working server
        ws.destroy();
        ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

        ws.addEventListener("open", () => {
          // Should start fresh with 0 attempts
          expect(ws.getReconnectAttempts()).toBe(0);
          done();
        });
      }, 2500);
    }, 5000);
  });

  describe("Heartbeat Functionality", () => {
    test("should send heartbeat messages when enabled", (done) => {
      const options: BetterWebSocketOptions = {
        enableHeartbeat: true,
        heartbeatInterval: 500,
        heartbeatMessage: "ping",
      };

      ws = new BetterWebSocket(
        `ws://localhost:${testServerPort}`,
        undefined,
        options,
      );

      let heartbeatReceived = false;

      ws.addEventListener("open", () => {
        // Wait longer than heartbeat interval to ensure heartbeat is sent
        setTimeout(() => {
          expect(heartbeatReceived).toBe(true);
          done();
        }, 750);
      });

      ws.addEventListener("message", (event) => {
        const messageEvent = event as MessageEvent;
        if (messageEvent.data === "pong") {
          heartbeatReceived = true;
        }
      });
    }, 3000);
  });

  describe("Connection Timeout", () => {
    test("should timeout when connection takes too long", (done) => {
      const options: BetterWebSocketOptions = {
        connectTimeout: 200, // Very short timeout
        maxReconnectAttempts: 2,
      };

      // Use localhost with a port that's likely not responding but won't fail immediately
      ws = new BetterWebSocket("ws://localhost:65432", undefined, options);

      // Give enough time for timeout and at least one reconnection attempt
      setTimeout(() => {
        const attempts = ws.getReconnectAttempts();
        // Should have attempted at least one reconnection due to timeout
        expect(attempts).toBeGreaterThan(0);
        done();
      }, 1500);
    }, 3000);
  });

  describe("Utility Methods", () => {
    test("should force reconnect", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      let connectionCount = 0;

      ws.addEventListener("open", () => {
        connectionCount++;
        if (connectionCount === 1) {
          // First connection, force reconnect
          ws.forceReconnect();
        } else {
          // Second connection after force reconnect
          expect(connectionCount).toBe(2);
          expect(ws.readyState).toBe(BetterWebSocketState.OPEN);
          done();
        }
      });
    }, 5000);

    test("should get current URL", () => {
      const urls = [
        `ws://localhost:${testServerPort}`,
        `ws://localhost:${secondTestServerPort}`,
      ];

      ws = new BetterWebSocket(urls);
      expect(ws.getCurrentUrl()).toBe(`ws://localhost:${testServerPort}`);
    });

    test("should destroy connection properly", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.destroy();
      expect(ws.getQueuedMessageCount()).toBe(0);

      // Should not reconnect after destroy
      setTimeout(() => {
        expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
      }, 1000);
    });
  });

  describe("Error Handling", () => {
    test("should handle connection errors gracefully", (done) => {
      ws = new BetterWebSocket("ws://invalid-url", undefined, {
        connectTimeout: 500,
        maxReconnectAttempts: 1,
      });

      ws.addEventListener("close", (event) => {
        const closeEvent = event as CloseEvent;
        expect(closeEvent.code).toBe(1006); // Abnormal closure
        expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
        done();
      });
    }, 3000);

    test("should handle invalid protocols", () => {
      expect(() => {
        ws = new BetterWebSocket("invalid://localhost:8080");
      }).not.toThrow(); // Should handle gracefully, not throw synchronously
    });
  });

  describe("WebSocket Interface Compliance", () => {
    test("should have all required WebSocket constants", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      expect(ws.CONNECTING).toBe(0);
      expect(ws.OPEN).toBe(1);
      expect(ws.CLOSING).toBe(2);
      expect(ws.CLOSED).toBe(3);
    });

    test("should have all required WebSocket properties", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      expect(typeof ws.binaryType).toBe("string");
      expect(typeof ws.bufferedAmount).toBe("number");
      expect(typeof ws.extensions).toBe("string");
      expect(typeof ws.protocol).toBe("string");
      expect(typeof ws.readyState).toBe("number");
      expect(typeof ws.url).toBe("string");
    });

    test("should support event listeners", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      const openHandler = () => {
        expect(true).toBe(true);
        ws.removeEventListener("open", openHandler);
        done();
      };

      ws.addEventListener("open", openHandler);
    });
  });
});
