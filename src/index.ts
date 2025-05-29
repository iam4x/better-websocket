export interface BetterWebSocketOptions {
  connectTimeout?: number;
  maxReconnectAttempts?: number;
  reconnectBackoffFactor?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  enableHeartbeat?: boolean;
  heartbeatMessage?: string;
  maxQueueSize?: number;
  protocols?: string | string[];
}

interface ResolvedBetterWebSocketOptions {
  connectTimeout: number;
  maxReconnectAttempts: number;
  reconnectBackoffFactor: number;
  heartbeatInterval: number;
  heartbeatTimeout: number;
  enableHeartbeat: boolean;
  heartbeatMessage: string;
  maxQueueSize: number;
  protocols: string | string[] | undefined;
}

export enum BetterWebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export interface QueuedMessage {
  data: string | ArrayBufferLike | Blob | ArrayBufferView;
  timestamp: number;
  size: number;
}

export class BetterWebSocket extends EventTarget implements WebSocket {
  // WebSocket interface properties
  public binaryType: BinaryType = "blob";
  public bufferedAmount: number = 0;
  public extensions: string = "";
  public protocol: string = "";
  public readyState: number = BetterWebSocketState.CONNECTING;
  public url: string = "";

  // Event handlers
  public onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  public onerror: ((this: WebSocket, ev: Event) => any) | null = null;
  public onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;
  public onopen: ((this: WebSocket, ev: Event) => any) | null = null;

  // Constants
  public readonly CONNECTING = BetterWebSocketState.CONNECTING;
  public readonly OPEN = BetterWebSocketState.OPEN;
  public readonly CLOSING = BetterWebSocketState.CLOSING;
  public readonly CLOSED = BetterWebSocketState.CLOSED;

  // Private properties
  private urls: string[];
  private currentUrlIndex: number = 0;
  private options: ResolvedBetterWebSocketOptions;
  private socket: WebSocket | null = null;
  private messageQueue: QueuedMessage[] = [];
  private reconnectAttempts: number = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed: boolean = false;
  private shouldReconnect: boolean = true;

  // Bound event handlers for proper cleanup
  private boundHandleOpen = this.handleOpen.bind(this);
  private boundHandleMessage = this.handleMessage.bind(this);
  private boundHandleClose = this.handleClose.bind(this);
  private boundHandleSocketError = this.handleSocketError.bind(this);

  constructor(
    urls: string | string[],
    protocols?: string | string[],
    options: BetterWebSocketOptions = {},
  ) {
    super();

    this.urls = Array.isArray(urls) ? urls : [urls];
    if (this.urls.length === 0) {
      throw new Error("At least one URL must be provided");
    }

    this.options = {
      connectTimeout: options.connectTimeout ?? 10000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      reconnectBackoffFactor: options.reconnectBackoffFactor ?? 1.5,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      heartbeatTimeout: options.heartbeatTimeout ?? 5000,
      enableHeartbeat: options.enableHeartbeat ?? false,
      heartbeatMessage: options.heartbeatMessage ?? "ping",
      maxQueueSize: options.maxQueueSize ?? 100,
      protocols: protocols || options.protocols || undefined,
    };

    this.url = this.urls[0];
    this.connect();
  }

  private calculateDataSize(
    data: string | ArrayBufferLike | Blob | ArrayBufferView,
  ): number {
    if (typeof data === "string") {
      return new TextEncoder().encode(data).length;
    } else if (data instanceof Blob) {
      return data.size;
    } else if (data instanceof ArrayBuffer) {
      return data.byteLength;
    } else if (ArrayBuffer.isView(data)) {
      return data.byteLength;
    }
    return 0;
  }

  private updateBufferedAmount(): void {
    this.bufferedAmount = this.messageQueue.reduce(
      (total, msg) => total + msg.size,
      0,
    );
  }

  private connect(): void {
    if (this.isDestroyed) return;

    this.readyState = BetterWebSocketState.CONNECTING;
    this.clearTimeouts();

    const currentUrl = this.urls[this.currentUrlIndex];
    this.url = currentUrl;

    try {
      this.disconnectSocket();

      this.socket = new WebSocket(currentUrl, this.options.protocols);
      this.setupSocketListeners();
      this.startConnectTimeout();
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  private disconnectSocket(): void {
    if (this.socket) {
      // Remove event listeners to prevent memory leaks
      this.socket.removeEventListener("open", this.boundHandleOpen);
      this.socket.removeEventListener("message", this.boundHandleMessage);
      this.socket.removeEventListener("close", this.boundHandleClose);
      this.socket.removeEventListener("error", this.boundHandleSocketError);

      // Close the socket if still open
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }

      this.socket = null;
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.addEventListener("open", this.boundHandleOpen);
    this.socket.addEventListener("message", this.boundHandleMessage);
    this.socket.addEventListener("close", this.boundHandleClose);
    this.socket.addEventListener("error", this.boundHandleSocketError);
  }

  private handleOpen(_event: Event): void {
    this.clearTimeouts();
    this.readyState = BetterWebSocketState.OPEN;
    this.reconnectAttempts = 0;

    // Copy socket properties
    if (this.socket) {
      this.extensions = this.socket.extensions;
      this.protocol = this.socket.protocol;
    }

    // Process queued messages
    this.flushMessageQueue();

    // Start heartbeat if enabled
    if (this.options.enableHeartbeat) {
      this.startHeartbeat();
    }

    // Dispatch open event
    const openEvent = new Event("open");
    this.dispatchEvent(openEvent);
    if (this.onopen) {
      this.onopen.call(this, openEvent);
    }
  }

  private handleMessage(event: MessageEvent): void {
    // Reset heartbeat timeout
    if (this.options.enableHeartbeat) {
      this.resetHeartbeatTimeout();
    }

    // Dispatch message event
    const messageEvent = new MessageEvent("message", {
      data: event.data,
      origin: event.origin,
      lastEventId: event.lastEventId,
      source: event.source,
      ports: event.ports ? [...event.ports] : [],
    });

    this.dispatchEvent(messageEvent);
    if (this.onmessage) {
      this.onmessage.call(this, messageEvent);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.clearTimeouts();
    this.readyState = BetterWebSocketState.CLOSED;

    const closeEvent = new CloseEvent("close", {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });

    this.dispatchEvent(closeEvent);
    if (this.onclose) {
      this.onclose.call(this, closeEvent);
    }

    // Attempt reconnection if needed
    if (this.shouldReconnect && !this.isDestroyed) {
      this.attemptReconnect();
    }
  }

  private handleSocketError(_event: Event): void {
    // Dispatch error event but don't trigger additional reconnection
    // as the close event will handle reconnection
    const errorEvent = new Event("error");
    this.dispatchEvent(errorEvent);
    if (this.onerror) {
      this.onerror.call(this, errorEvent);
    }
  }

  private handleConnectionError(error: Error): void {
    // Failed to connect - create synthetic close event
    this.readyState = BetterWebSocketState.CLOSED;

    // Create a synthetic close event to trigger standard reconnection logic
    const closeEvent = new CloseEvent("close", {
      code: 1006, // Abnormal closure
      reason: error.message,
      wasClean: false,
    });

    this.dispatchEvent(closeEvent);
    if (this.onclose) {
      this.onclose.call(this, closeEvent);
    }

    // Trigger reconnection immediately for URL fallback
    if (this.shouldReconnect && !this.isDestroyed) {
      this.attemptReconnect();
    }
  }

  private attemptReconnect(): void {
    if (this.isDestroyed || !this.shouldReconnect) return;

    // Try next URL if available (URL fallback doesn't count as reconnection attempt)
    if (this.currentUrlIndex < this.urls.length - 1) {
      this.currentUrlIndex++;
      // Update the current URL
      this.url = this.urls[this.currentUrlIndex];
      setTimeout(() => this.connect(), 100);
      return;
    }

    // All URLs tried, now we start counting reconnection attempts
    this.currentUrlIndex = 0;
    this.url = this.urls[0];

    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      // Max reconnection attempts reached
      this.shouldReconnect = false;
      return;
    }

    const delay =
      Math.pow(this.options.reconnectBackoffFactor, this.reconnectAttempts) *
      1000;
    this.reconnectAttempts++;

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startConnectTimeout(): void {
    this.connectTimeoutId = setTimeout(() => {
      if (this.socket && this.readyState === BetterWebSocketState.CONNECTING) {
        this.socket.close();
        this.handleConnectionError(new Error("Connection timeout"));
      }
    }, this.options.connectTimeout);
  }

  private startHeartbeat(): void {
    this.heartbeatIntervalId = setInterval(() => {
      if (this.readyState === BetterWebSocketState.OPEN && !this.isDestroyed) {
        // Send heartbeat
        this.send(this.options.heartbeatMessage);

        // Set a timeout to close connection if no response received
        // Only set the timeout if heartbeat is enabled (prevent redundant timeout)
        this.setHeartbeatTimeout();
      }
    }, this.options.heartbeatInterval);
  }

  private setHeartbeatTimeout(): void {
    if (!this.options.enableHeartbeat) {
      return;
    }

    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
    }

    this.heartbeatTimeoutId = setTimeout(() => {
      if (this.readyState === BetterWebSocketState.OPEN && !this.isDestroyed) {
        // Heartbeat response timeout, reconnecting
        this.close(1000, "Heartbeat response timeout");
      }
    }, this.options.heartbeatTimeout);
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
    }

    // Only set heartbeat timeout if heartbeat is enabled
    if (this.options.enableHeartbeat) {
      this.setHeartbeatTimeout();
    }
  }

  private flushMessageQueue(): void {
    while (
      this.messageQueue.length > 0 &&
      this.readyState === BetterWebSocketState.OPEN
    ) {
      const message = this.messageQueue.shift()!;
      this.sendDirectly(message.data);
    }
    this.updateBufferedAmount();
  }

  private clearTimeouts(): void {
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }

    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }

    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = null;
    }
  }

  private sendDirectly(
    data: string | ArrayBufferLike | Blob | ArrayBufferView,
  ): void {
    if (this.socket && this.readyState === BetterWebSocketState.OPEN) {
      this.socket.send(data);
    }
  }

  // Public WebSocket interface methods
  public send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.isDestroyed) {
      // Don't queue or send messages after destroy
      return;
    }

    if (this.readyState === BetterWebSocketState.OPEN) {
      this.sendDirectly(data);
    } else {
      // Queue message for later sending
      const size = this.calculateDataSize(data);

      if (this.messageQueue.length >= this.options.maxQueueSize) {
        this.messageQueue.shift(); // Remove oldest message
      }

      this.messageQueue.push({
        data,
        timestamp: Date.now(),
        size,
      });

      this.updateBufferedAmount();
    }
  }

  private closeInternal(code?: number, reason?: string): void {
    if (this.readyState === BetterWebSocketState.CLOSED) {
      return; // Already closed
    }

    this.readyState = BetterWebSocketState.CLOSING;
    this.clearTimeouts();

    if (this.socket) {
      this.socket.close(code, reason);
    } else {
      // If no socket exists, immediately transition to closed
      this.readyState = BetterWebSocketState.CLOSED;
      const closeEvent = new CloseEvent("close", {
        code: code || 1000,
        reason: reason || "",
        wasClean: true,
      });

      setTimeout(() => {
        this.dispatchEvent(closeEvent);
        if (this.onclose) {
          this.onclose.call(this, closeEvent);
        }
      }, 0);
    }
  }

  public close(code?: number, reason?: string): void {
    if (
      this.readyState === BetterWebSocketState.CLOSED ||
      this.readyState === BetterWebSocketState.CLOSING
    ) {
      return; // Already closing or closed
    }
    this.shouldReconnect = false;
    this.closeInternal(code, reason);
  }

  public destroy(): void {
    if (this.isDestroyed) {
      return; // Already destroyed
    }

    this.isDestroyed = true;
    this.shouldReconnect = false;
    this.clearTimeouts();
    this.messageQueue = [];
    this.bufferedAmount = 0;

    this.disconnectSocket();

    if (this.readyState !== BetterWebSocketState.CLOSED) {
      this.readyState = BetterWebSocketState.CLOSED;
    }
  }

  // Additional utility methods
  public getQueuedMessageCount(): number {
    return this.messageQueue.length;
  }

  public clearMessageQueue(): void {
    this.messageQueue = [];
    this.updateBufferedAmount();
  }

  public getCurrentUrl(): string {
    return this.urls[this.currentUrlIndex];
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public forceReconnect(): void {
    if (this.isDestroyed) {
      return; // Don't reconnect if destroyed
    }

    this.shouldReconnect = true;
    if (this.socket && this.readyState === BetterWebSocketState.OPEN) {
      this.closeInternal(1000, "Force reconnect");
    } else if (this.readyState === BetterWebSocketState.CLOSED) {
      this.connect();
    }
  }
}
