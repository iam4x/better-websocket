export type TestServer = {
  port: number;
  stop: () => void;
};

export const createTestServer = (port: number, delay = 0): Promise<TestServer> => {
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
          if (delay > 0) {
            setTimeout(() => {
              _ws.send(`delayed-echo: ${message}`);
            }, delay);
          } else {
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
        close(_ws) {},
      },
    });
    resolve(server);
  });
};
