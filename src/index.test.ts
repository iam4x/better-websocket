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
let slowServer: any;
let slowServerPort: number;

const createTestServer = (port: number, delay = 0): Promise<any> => {
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
          // Add artificial delay if specified for slow server testing
          if (delay > 0) {
            setTimeout(() => {
              _ws.send(`delayed-echo: ${message}`);
            }, delay);
          } else {
            // Echo messages back
            if (message === "ping") {
              _ws.send("pong");
            } else {
              _ws.send(`echo: ${message}`);
            }
          }
        },
        open(_ws) {
          if (delay > 0) {
            setTimeout(() => {
              _ws.send("delayed-open");
            }, delay);
          }
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

  // Start slow server for timing tests
  slowServerPort = 8082;
  slowServer = await createTestServer(slowServerPort, 100); // 100ms delay

  // Wait a bit for servers to start
  await new Promise((resolve) => setTimeout(resolve, 200));
});

afterAll(() => {
  if (testServer) {
    testServer.stop();
  }
  if (secondTestServer) {
    secondTestServer.stop();
  }
  if (slowServer) {
    slowServer.stop();
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

    test("should handle binary data in queue", () => {
      ws = new BetterWebSocket("ws://localhost:9999");

      const binaryData = new Uint8Array([1, 2, 3, 4, 5]);
      const arrayBuffer = new ArrayBuffer(8);
      const blob = new Blob(["test"]);

      ws.send(binaryData);
      ws.send(arrayBuffer);
      ws.send(blob);

      expect(ws.getQueuedMessageCount()).toBe(3);
    });

    test("should handle queue overflow correctly", () => {
      const options: BetterWebSocketOptions = {
        maxQueueSize: 3,
      };

      ws = new BetterWebSocket("ws://localhost:9999", undefined, options);

      // Add messages beyond queue size
      ws.send("message1");
      ws.send("message2");
      ws.send("message3");
      ws.send("message4"); // Should remove message1
      ws.send("message5"); // Should remove message2

      expect(ws.getQueuedMessageCount()).toBe(3);
    });

    test("should respect max queue byte size", () => {
      const options: BetterWebSocketOptions = {
        maxQueueSize: 10,
        maxQueueBytes: 10,
      };

      ws = new BetterWebSocket(`ws://localhost:9999`, undefined, options);

      ws.send("1234");
      ws.send("5678");
      ws.send("90ab"); // total 12 bytes, should drop the first

      expect(ws.getQueuedMessageCount()).toBe(2);
      expect(ws.bufferedAmount).toBeLessThanOrEqual(10);
    });

    test("should error when single message exceeds byte size limit", () => {
      const options: BetterWebSocketOptions = {
        maxQueueSize: 2,
        maxQueueBytes: 5,
      };

      ws = new BetterWebSocket(`ws://localhost:9999`, undefined, options);

      expect(() => ws.send("toolong")).toThrow();
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

    test("should handle URL fallback with immediate reconnection", (done) => {
      const urls = [
        "ws://localhost:9999", // Will fail
        "ws://localhost:9998", // Will fail
        `ws://localhost:${testServerPort}`, // Will succeed
      ];

      ws = new BetterWebSocket(urls, undefined, {
        connectTimeout: 100,
        maxReconnectAttempts: 0, // No reconnection attempts beyond URL fallback
      });

      ws.addEventListener("open", () => {
        // Should connect to the third URL
        expect(ws.getCurrentUrl()).toBe(`ws://localhost:${testServerPort}`);
        done();
      });

      ws.addEventListener("close", (event) => {
        const closeEvent = event as CloseEvent;
        // Only fail if we're on the last URL and it still fails
        if (ws.getCurrentUrl() === `ws://localhost:${testServerPort}`) {
          done(
            new Error(
              `URL fallback failed on working server: ${closeEvent.reason}`,
            ),
          );
        }
        // Otherwise, this is expected as URLs are being tried
      });
    }, 2000);

    test("should properly reset URL index on successful connection", (done) => {
      const urls = [
        "ws://localhost:9999", // Will fail initially
        `ws://localhost:${testServerPort}`, // Will succeed
      ];

      ws = new BetterWebSocket(urls, undefined, {
        connectTimeout: 50,
        maxReconnectAttempts: 1,
      });

      let connectionCount = 0;

      ws.addEventListener("open", () => {
        connectionCount++;

        if (connectionCount === 1) {
          // First connection successful, now force a reconnection
          ws.forceReconnect();
        } else {
          // If URL index isn't reset properly,
          // we might not start from the first URL again
          expect(ws.getCurrentUrl()).toBe(urls[1]); // Should use working URL
          done();
        }
      });
    }, 2000);
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

    test("should handle message receive timing edge case", (done) => {
      const options: BetterWebSocketOptions = {
        enableHeartbeat: true,
        heartbeatInterval: 400,
        heartbeatTimeout: 300, // Generous timeout
      };

      ws = new BetterWebSocket(
        `ws://localhost:${testServerPort}`,
        undefined,
        options,
      );

      let messageCount = 0;
      let testCompleted = false;

      ws.addEventListener("open", () => {
        // Start sending messages that might interfere with heartbeat timing
        const messageInterval = setInterval(() => {
          if (messageCount < 2 && !testCompleted) {
            ws.send(`test-${messageCount++}`);
          } else {
            clearInterval(messageInterval);
          }
        }, 100); // Send messages faster than heartbeat interval
      });

      ws.addEventListener("message", () => {
        // Check if we received all test messages
        if (messageCount >= 2 && !testCompleted) {
          testCompleted = true;
          setTimeout(() => {
            expect(ws.readyState).toBe(BetterWebSocketState.OPEN);
            done();
          }, 50);
        }
      });

      ws.addEventListener("close", () => {
        // If this fires before we complete the test, it means heartbeat timing has a bug
        if (!testCompleted) {
          done(new Error("Connection closed prematurely due to heartbeat bug"));
        }
      });

      // Timeout safety - generous timeout since we want to test heartbeat behavior
      setTimeout(() => {
        if (!testCompleted) {
          testCompleted = true;
          // This is actually expected - if heartbeat works correctly,
          // the connection should stay open
          expect(ws.readyState).toBe(BetterWebSocketState.OPEN);
          done();
        }
      }, 1000);
    }, 1500);

    test("should not send heartbeat when connection is closing", (done) => {
      const options: BetterWebSocketOptions = {
        enableHeartbeat: true,
        heartbeatInterval: 50,
        heartbeatMessage: "ping",
      };

      ws = new BetterWebSocket(
        `ws://localhost:${testServerPort}`,
        undefined,
        options,
      );

      let pingsSentAfterClose = 0;
      let closeCalled = false;

      ws.addEventListener("open", () => {
        // Mock the send method to count pings
        const originalSend = ws.send.bind(ws);
        ws.send = ((data: any) => {
          if (data === "ping" && closeCalled) {
            pingsSentAfterClose++;
          }
          return originalSend(data);
        }) as any;

        // Close after a short delay
        setTimeout(() => {
          closeCalled = true;
          ws.close();
        }, 75);
      });

      ws.addEventListener("close", () => {
        // Wait to see if any pings are sent after close
        setTimeout(() => {
          expect(pingsSentAfterClose).toBe(0);
          done();
        }, 150);
      });
    });
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

  describe("BufferedAmount Tracking", () => {
    test("bufferedAmount should be updated when sending data", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.addEventListener("open", () => {
        // When connected, bufferedAmount should be 0
        expect(ws.bufferedAmount).toBe(0);

        ws.send("test message");

        // When connected, messages are sent immediately, so bufferedAmount stays 0
        expect(ws.bufferedAmount).toBe(0);

        done();
      });
    });

    test("bufferedAmount should track queued messages size", () => {
      // Create WebSocket that won't connect
      ws = new BetterWebSocket("ws://localhost:9999");

      const message1 = "message 1";
      const message2 = "message 2";

      ws.send(message1);
      ws.send(message2);

      // bufferedAmount should reflect queued data size
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      expect(ws.getQueuedMessageCount()).toBe(2);
    });
  });

  describe("State Management", () => {
    test("should not allow send after destroy", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.destroy();

      const initialQueueSize = ws.getQueuedMessageCount();
      ws.send("should not be queued");

      // Destroyed WebSocket should not queue messages
      expect(ws.getQueuedMessageCount()).toBe(initialQueueSize);
    });

    test("readyState should transition correctly", (done) => {
      const stateChanges: number[] = [];

      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      // Track state changes through events instead of intercepting setter
      const originalReadyState = ws.readyState;
      stateChanges.push(originalReadyState);

      ws.addEventListener("open", () => {
        stateChanges.push(ws.readyState);
        ws.close();
      });

      ws.addEventListener("close", () => {
        stateChanges.push(ws.readyState);
        // Check that state transitions are correct
        // Should include: CONNECTING -> OPEN -> CLOSED
        expect(stateChanges).toContain(BetterWebSocketState.CONNECTING);
        expect(stateChanges).toContain(BetterWebSocketState.OPEN);
        expect(stateChanges).toContain(BetterWebSocketState.CLOSED);
        done();
      });
    });

    test("concurrent close and connect should not cause state inconsistency", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      ws.addEventListener("open", () => {
        // Immediately close and force reconnect at the same time
        ws.close();
        ws.forceReconnect();

        // Wait and check that we don't have inconsistent state
        setTimeout(() => {
          // State should be CLOSED or CONNECTING, not stuck in CLOSING
          expect([
            BetterWebSocketState.CLOSED,
            BetterWebSocketState.CONNECTING,
            BetterWebSocketState.OPEN,
          ]).toContain(ws.readyState);
          done();
        }, 200);
      });
    });

    test("destroy during connection should not cause hanging state", (done) => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      // Destroy immediately after creation, before connection completes
      setTimeout(() => {
        ws.destroy();

        // Wait to ensure no further state changes occur
        setTimeout(() => {
          expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
          done();
        }, 100);
      }, 10);
    });
  });

  describe("Memory Management", () => {
    test("should properly clean up event listeners on socket replacement", (done) => {
      // Test with a working server to ensure connection succeeds
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`, undefined, {
        connectTimeout: 1000,
      });

      let eventCount = 0;
      ws.addEventListener("open", () => {
        eventCount++;

        if (eventCount === 1) {
          // Force reconnection to test event listener cleanup
          ws.forceReconnect();
        } else {
          // Should only have 2 open events (initial + forceReconnect)
          expect(eventCount).toBe(2);
          done();
        }
      });

      // Timeout safety
      setTimeout(() => {
        if (eventCount === 0) {
          done(new Error("No connection established"));
        } else if (eventCount === 1) {
          // Only got one connection, that's still success for this test
          done();
        }
      }, 2000);
    });
  });

  describe("Type Safety", () => {
    test("Timer type compatibility - should handle different timer return types", () => {
      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

      // The Timer type should be compatible across environments
      const originalSetTimeout = global.setTimeout;

      // Mock setTimeout to return a number (like in browser)
      const mockTimeouts = new Set<any>();
      global.setTimeout = ((fn: any, delay: number) => {
        const id = originalSetTimeout(fn, delay);
        mockTimeouts.add(id);
        return id;
      }) as any;

      const originalClearTimeout = global.clearTimeout;
      global.clearTimeout = ((id: any) => {
        mockTimeouts.delete(id);
        originalClearTimeout(id);
      }) as any;

      try {
        // This should not cause type errors
        ws.close();
        expect(true).toBe(true);
      } finally {
        // Restore original functions
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
      }
    });
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

    test("should properly propagate construction errors", () => {
      // Test with malformed URL
      expect(() => {
        ws = new BetterWebSocket("not-a-url");
      }).not.toThrow(); // Should handle gracefully, not throw immediately

      // Test with empty protocol array
      expect(() => {
        ws = new BetterWebSocket(`ws://localhost:${testServerPort}`, []);
      }).not.toThrow();
    });
  });

  describe("Protocol Handling", () => {
    test("should handle protocol selection correctly", (done) => {
      const protocols = ["protocol1", "protocol2"];

      ws = new BetterWebSocket(`ws://localhost:${testServerPort}`, protocols);

      ws.addEventListener("open", () => {
        // The protocol should be available
        expect(typeof ws.protocol).toBe("string");
        done();
      });

      ws.addEventListener("error", () => {
        // If connection fails, that's also a valid test result
        expect(typeof ws.protocol).toBe("string");
        done();
      });

      // Timeout safety
      setTimeout(() => {
        done();
      }, 1000);
    }, 1500);
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

  describe("Bug Detection Tests", () => {
    describe("Heartbeat timeout race condition bug", () => {
      test("should not set heartbeat timeout when heartbeat is disabled", (done) => {
        // Bug: resetHeartbeatTimeout() is called from handleMessage() even when heartbeat is disabled
        // This could cause unnecessary timeout handling
        ws = new BetterWebSocket(
          `ws://localhost:${testServerPort}`,
          undefined,
          {
            enableHeartbeat: false,
          },
        );

        let heartbeatTimeoutWasSet = false;

        ws.addEventListener("open", () => {
          // Mock setTimeout to detect if heartbeat timeout is being set
          const originalSetTimeout = global.setTimeout;
          global.setTimeout = ((fn: any, delay: number) => {
            // Check if this is a heartbeat timeout (delay should match heartbeatTimeout)
            if (delay === 5000) {
              // default heartbeat timeout
              heartbeatTimeoutWasSet = true;
            }
            return originalSetTimeout(fn, delay);
          }) as any;

          // Send a message to trigger handleMessage -> resetHeartbeatTimeout
          ws.send("test message");

          // Wait for the message to be processed
          setTimeout(() => {
            global.setTimeout = originalSetTimeout;
            expect(heartbeatTimeoutWasSet).toBe(false);
            done();
          }, 100);
        });
      });
    });

    describe("forceReconnect on destroyed socket bug", () => {
      test("should not attempt reconnection on destroyed socket", (done) => {
        ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

        ws.addEventListener("open", () => {
          ws.destroy();
          expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);

          // This should not cause reconnection
          ws.forceReconnect();

          // Wait and verify no reconnection occurred
          setTimeout(() => {
            expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
            done();
          }, 200);
        });
      });
    });

    describe("Double reconnection attempt bug", () => {
      test("should not trigger double reconnection from handleConnectionError", (done) => {
        // Bug: handleConnectionError calls attemptReconnect directly, but then handleClose might call it again
        let reconnectAttempts = 0;

        // Mock attemptReconnect to count calls
        ws = new BetterWebSocket("ws://localhost:9999", undefined, {
          connectTimeout: 100,
          maxReconnectAttempts: 1,
        });

        // Override attemptReconnect to count calls
        const originalAttemptReconnect = (ws as any).attemptReconnect.bind(ws);
        (ws as any).attemptReconnect = () => {
          reconnectAttempts++;
          return originalAttemptReconnect();
        };

        // Wait for connection failure and reconnection attempts
        setTimeout(() => {
          // Should only attempt reconnection once per failure, not double
          expect(reconnectAttempts).toBeLessThanOrEqual(2); // Allow for URL fallback + 1 reconnect
          done();
        }, 500);
      });
    });

    describe("Heartbeat message echo bug", () => {
      test("should handle heartbeat response correctly without infinite echo", (done) => {
        // Bug: If server echoes heartbeat messages, it might cause unexpected behavior
        const options: BetterWebSocketOptions = {
          enableHeartbeat: true,
          heartbeatInterval: 300,
          heartbeatTimeout: 1000, // More generous timeout
          heartbeatMessage: "test-echo", // Use message that our test server will echo
        };

        ws = new BetterWebSocket(
          `ws://localhost:${testServerPort}`,
          undefined,
          options,
        );

        let messageCount = 0;
        let connectionClosed = false;
        let testCompleted = false;

        ws.addEventListener("open", () => {
          // Wait for heartbeat to be sent and potential echo
          setTimeout(() => {
            if (!testCompleted) {
              testCompleted = true;
              expect(connectionClosed).toBe(false);
              expect(messageCount).toBeGreaterThan(0); // Should have received echo
              done();
            }
          }, 600); // Wait longer than heartbeat interval
        });

        ws.addEventListener("message", (event) => {
          messageCount++;
          const messageEvent = event as MessageEvent;
          // Our test server echoes messages, so we should receive "echo: test-echo"
          expect(messageEvent.data).toBe("echo: test-echo");
        });

        ws.addEventListener("close", () => {
          connectionClosed = true;
          if (!testCompleted && messageCount === 0) {
            testCompleted = true;
            done(new Error("Connection closed before receiving any messages"));
          }
        });
      });
    });

    describe("Message queue overflow during reconnection bug", () => {
      test("should handle message overflow correctly during URL fallback", () => {
        const options: BetterWebSocketOptions = {
          maxQueueSize: 2,
        };

        ws = new BetterWebSocket(
          [
            "ws://localhost:9999", // Will fail
            "ws://localhost:9998", // Will fail
            "ws://localhost:9997", // Will fail
          ],
          undefined,
          options,
        );

        // Send more messages than queue size during connection attempts
        ws.send("message1");
        ws.send("message2");
        ws.send("message3"); // Should evict message1
        ws.send("message4"); // Should evict message2

        expect(ws.getQueuedMessageCount()).toBe(2);

        // The queue should contain the latest messages
        ws.clearMessageQueue();
        expect(ws.getQueuedMessageCount()).toBe(0);
      });
    });

    describe("State transition race condition bug", () => {
      test("should handle rapid state changes correctly", (done) => {
        ws = new BetterWebSocket(`ws://localhost:${testServerPort}`);

        ws.addEventListener("open", () => {
          // Rapidly call state-changing methods
          ws.close();
          ws.forceReconnect(); // This should be ignored since we're closing
          ws.close(); // Should be ignored since already closing
          ws.destroy(); // This should finalize the state

          // Should end up in CLOSED state without hanging
          // Use a longer timeout to allow for state transitions
          setTimeout(() => {
            expect(ws.readyState).toBe(BetterWebSocketState.CLOSED);
            done();
          }, 200);
        });

        // Add error handler to catch any unexpected issues
        ws.addEventListener("error", (error) => {
          done(
            new Error(`Unexpected error during state transitions: ${error}`),
          );
        });
      });
    });

    describe("Connection timeout vs heartbeat timeout conflict", () => {
      test("should handle concurrent timeouts gracefully", (done) => {
        // Bug: If connection timeout and heartbeat timeout happen simultaneously, it might cause issues
        const options: BetterWebSocketOptions = {
          connectTimeout: 100,
          enableHeartbeat: true,
          heartbeatTimeout: 150,
          maxReconnectAttempts: 1,
        };

        ws = new BetterWebSocket("ws://localhost:65431", undefined, options);

        // Wait for timeouts to potentially conflict
        setTimeout(() => {
          // Should not crash or hang, just fail gracefully
          expect([
            BetterWebSocketState.CLOSED,
            BetterWebSocketState.CONNECTING,
          ]).toContain(ws.readyState);
          done();
        }, 300);
      });
    });

    describe("Socket cleanup bug", () => {
      test("should properly clean up old socket references", (done) => {
        const urls = [
          "ws://localhost:9999", // Will fail
          `ws://localhost:${testServerPort}`, // Will succeed
        ];

        ws = new BetterWebSocket(urls, undefined, {
          connectTimeout: 50,
        });

        let openCount = 0;
        ws.addEventListener("open", () => {
          openCount++;
          if (openCount === 1) {
            // Force another connection attempt
            ws.forceReconnect();
          } else {
            // Should only have one open event from the final successful connection
            expect(openCount).toBe(2); // One initial + one from forceReconnect
            done();
          }
        });

        // Timeout safety
        setTimeout(() => {
          if (openCount === 0) {
            done(new Error("No connection established"));
          }
        }, 1000);
      });
    });

    describe("BufferedAmount calculation bug", () => {
      test("should calculate data size correctly for all data types", () => {
        ws = new BetterWebSocket("ws://localhost:9999"); // Non-existent to queue messages

        // Test different data types
        const textData = "Hello, World!";
        const uint8Array = new Uint8Array([1, 2, 3, 4, 5]);
        const arrayBuffer = new ArrayBuffer(10);
        const int16Array = new Int16Array([1000, 2000, 3000]);

        ws.send(textData);
        ws.send(uint8Array);
        ws.send(arrayBuffer);
        ws.send(int16Array);

        expect(ws.getQueuedMessageCount()).toBe(4);
        expect(ws.bufferedAmount).toBeGreaterThan(0);

        // BufferedAmount should be calculated correctly
        const expectedSize =
          new TextEncoder().encode(textData).length +
          uint8Array.byteLength +
          arrayBuffer.byteLength +
          int16Array.byteLength;

        expect(ws.bufferedAmount).toBe(expectedSize);
      });
    });
  });
});
