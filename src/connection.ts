import { BetterWebSocketState } from "./types";
import type { BetterWebSocket } from "./BetterWebSocket";

export function connect(instance: BetterWebSocket): void {
  const self = instance as any;
  if (self.isDestroyed) return;

  instance.readyState = BetterWebSocketState.CONNECTING;
  clearTimeouts(instance);

  const currentUrl = self.urls[self.currentUrlIndex];
  instance.url = currentUrl;

  try {
    disconnectSocket(instance);

    self.socket = new WebSocket(currentUrl, self.options.protocols);
    setupSocketListeners(instance);
    startConnectTimeout(instance);
  } catch (error) {
    handleConnectionError(instance, error as Error);
  }
}

export function disconnectSocket(instance: BetterWebSocket): void {
  const self = instance as any;
  if (self.socket) {
    self.socket.removeEventListener("open", self.boundHandleOpen);
    self.socket.removeEventListener("message", self.boundHandleMessage);
    self.socket.removeEventListener("close", self.boundHandleClose);
    self.socket.removeEventListener("error", self.boundHandleSocketError);

    if (
      self.socket.readyState === WebSocket.OPEN ||
      self.socket.readyState === WebSocket.CONNECTING
    ) {
      self.socket.close();
    }

    self.socket = null;
  }
}

export function setupSocketListeners(instance: BetterWebSocket): void {
  const self = instance as any;
  if (!self.socket) return;

  self.socket.addEventListener("open", self.boundHandleOpen);
  self.socket.addEventListener("message", self.boundHandleMessage);
  self.socket.addEventListener("close", self.boundHandleClose);
  self.socket.addEventListener("error", self.boundHandleSocketError);
}

export function handleOpen(instance: BetterWebSocket, _event: Event): void {
  const self = instance as any;
  clearTimeouts(instance);
  instance.readyState = BetterWebSocketState.OPEN;
  self.reconnectAttempts = 0;

  if (self.socket) {
    instance.extensions = self.socket.extensions;
    instance.protocol = self.socket.protocol;
  }

  flushMessageQueue(instance);

  if (self.options.enableHeartbeat) {
    startHeartbeat(instance);
  }

  const openEvent = new Event("open");
  instance.dispatchEvent(openEvent);
  if (instance.onopen) {
    instance.onopen.call(instance, openEvent);
  }
}

export function handleMessage(instance: BetterWebSocket, event: MessageEvent): void {
  const self = instance as any;
  if (self.options.enableHeartbeat) {
    resetHeartbeatTimeout(instance);
  }

  const messageEvent = new MessageEvent("message", {
    data: event.data,
    origin: event.origin,
    lastEventId: event.lastEventId,
    source: event.source,
    ports: event.ports ? [...event.ports] : [],
  });

  instance.dispatchEvent(messageEvent);
  if (instance.onmessage) {
    instance.onmessage.call(instance, messageEvent);
  }
}

export function handleClose(instance: BetterWebSocket, event: CloseEvent): void {
  const self = instance as any;
  clearTimeouts(instance);
  instance.readyState = BetterWebSocketState.CLOSED;

  const closeEvent = new CloseEvent("close", {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
  });

  instance.dispatchEvent(closeEvent);
  if (instance.onclose) {
    instance.onclose.call(instance, closeEvent);
  }

  if (self.shouldReconnect && !self.isDestroyed) {
    attemptReconnect(instance);
  }
}

export function handleSocketError(instance: BetterWebSocket, _event: Event): void {
  const errorEvent = new Event("error");
  instance.dispatchEvent(errorEvent);
  if (instance.onerror) {
    instance.onerror.call(instance, errorEvent);
  }
}

export function handleConnectionError(instance: BetterWebSocket, error: Error): void {
  const self = instance as any;
  instance.readyState = BetterWebSocketState.CLOSED;

  const closeEvent = new CloseEvent("close", {
    code: 1006,
    reason: error.message,
    wasClean: false,
  });

  instance.dispatchEvent(closeEvent);
  if (instance.onclose) {
    instance.onclose.call(instance, closeEvent);
  }

  if (self.shouldReconnect && !self.isDestroyed) {
    attemptReconnect(instance);
  }
}

export function attemptReconnect(instance: BetterWebSocket): void {
  const self = instance as any;
  if (self.isDestroyed || !self.shouldReconnect) return;

  if (self.currentUrlIndex < self.urls.length - 1) {
    self.currentUrlIndex++;
    instance.url = self.urls[self.currentUrlIndex];
    setTimeout(() => connect(instance), 100);
    return;
  }

  self.currentUrlIndex = 0;
  instance.url = self.urls[0];

  if (self.reconnectAttempts >= self.options.maxReconnectAttempts) {
    self.shouldReconnect = false;
    return;
  }

  const delay = Math.pow(self.options.reconnectBackoffFactor, self.reconnectAttempts) * 1000;
  self.reconnectAttempts++;

  self.reconnectTimeoutId = setTimeout(() => {
    connect(instance);
  }, delay);
}

export function startConnectTimeout(instance: BetterWebSocket): void {
  const self = instance as any;
  self.connectTimeoutId = setTimeout(() => {
    if (self.socket && instance.readyState === BetterWebSocketState.CONNECTING) {
      self.socket.close();
      handleConnectionError(instance, new Error("Connection timeout"));
    }
  }, self.options.connectTimeout);
}

export function startHeartbeat(instance: BetterWebSocket): void {
  const self = instance as any;
  self.heartbeatIntervalId = setInterval(() => {
    if (instance.readyState === BetterWebSocketState.OPEN && !self.isDestroyed) {
      instance.send(self.options.heartbeatMessage);
      setHeartbeatTimeout(instance);
    }
  }, self.options.heartbeatInterval);
}

export function setHeartbeatTimeout(instance: BetterWebSocket): void {
  const self = instance as any;
  if (!self.options.enableHeartbeat) {
    return;
  }

  if (self.heartbeatTimeoutId) {
    clearTimeout(self.heartbeatTimeoutId);
  }

  self.heartbeatTimeoutId = setTimeout(() => {
    if (instance.readyState === BetterWebSocketState.OPEN && !self.isDestroyed) {
      instance.close(1000, "Heartbeat response timeout");
    }
  }, self.options.heartbeatTimeout);
}

export function resetHeartbeatTimeout(instance: BetterWebSocket): void {
  const self = instance as any;
  if (self.heartbeatTimeoutId) {
    clearTimeout(self.heartbeatTimeoutId);
  }

  if (self.options.enableHeartbeat) {
    setHeartbeatTimeout(instance);
  }
}

export function flushMessageQueue(instance: BetterWebSocket): void {
  const self = instance as any;
  while (self.messageQueue.length > 0 && instance.readyState === BetterWebSocketState.OPEN) {
    const message = self.messageQueue.shift()!;
    instance["sendDirectly"](message.data);
  }
  instance.updateBufferedAmount();
}

export function clearTimeouts(instance: BetterWebSocket): void {
  const self = instance as any;
  if (self.connectTimeoutId) {
    clearTimeout(self.connectTimeoutId);
    self.connectTimeoutId = null;
  }

  if (self.reconnectTimeoutId) {
    clearTimeout(self.reconnectTimeoutId);
    self.reconnectTimeoutId = null;
  }

  if (self.heartbeatIntervalId) {
    clearInterval(self.heartbeatIntervalId);
    self.heartbeatIntervalId = null;
  }

  if (self.heartbeatTimeoutId) {
    clearTimeout(self.heartbeatTimeoutId);
    self.heartbeatTimeoutId = null;
  }
}
