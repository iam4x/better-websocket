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
  private reconnectTimeoutId: Timer | null = null;
  private connectTimeoutId: Timer | null = null;
  private heartbeatIntervalId: Timer | null = null;
  private heartbeatTimeoutId: Timer | null = null;
  private lastMessageReceived: number = Date.now();
  private isDestroyed: boolean = false;
  private shouldReconnect: boolean = true;

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

  private connect(): void {
    if (this.isDestroyed) return;

    this.readyState = BetterWebSocketState.CONNECTING;
    this.clearTimeouts();

    const currentUrl = this.urls[this.currentUrlIndex];
    this.url = currentUrl;

    try {
      this.socket = new WebSocket(currentUrl, this.options.protocols);
      this.setupSocketListeners();
      this.startConnectTimeout();
    } catch (error) {
      this.handleConnectionError(error as Error);
    }
  }

  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.addEventListener("open", this.handleOpen.bind(this));
    this.socket.addEventListener("message", this.handleMessage.bind(this));
    this.socket.addEventListener("close", this.handleClose.bind(this));
    this.socket.addEventListener("error", this.handleSocketError.bind(this));
  }

  private handleOpen(_event: Event): void {
    this.clearTimeouts();
    this.readyState = BetterWebSocketState.OPEN;
    this.reconnectAttempts = 0;
    this.lastMessageReceived = Date.now();

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
    this.lastMessageReceived = Date.now();

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
  }

  private attemptReconnect(): void {
    if (this.isDestroyed || !this.shouldReconnect) return;

    // Try next URL if available
    if (this.currentUrlIndex < this.urls.length - 1) {
      this.currentUrlIndex++;
      // Update the current URL
      this.url = this.urls[this.currentUrlIndex];
      setTimeout(() => this.connect(), 100);
      return;
    }

    // Reset to first URL and check reconnect attempts
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
      if (this.readyState === BetterWebSocketState.OPEN) {
        // Check if we haven't received a message in too long
        const timeSinceLastMessage = Date.now() - this.lastMessageReceived;
        if (
          timeSinceLastMessage >
          this.options.heartbeatInterval + this.options.heartbeatTimeout
        ) {
          // Heartbeat timeout, reconnecting
          this.close(1000, "Heartbeat timeout");
          return;
        }

        // Send heartbeat
        this.send(this.options.heartbeatMessage);
        this.resetHeartbeatTimeout();
      }
    }, this.options.heartbeatInterval);
  }

  private resetHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
    }

    this.heartbeatTimeoutId = setTimeout(() => {
      if (this.readyState === BetterWebSocketState.OPEN) {
        // Heartbeat response timeout, reconnecting
        this.close(1000, "Heartbeat response timeout");
      }
    }, this.options.heartbeatTimeout);
  }

  private flushMessageQueue(): void {
    while (
      this.messageQueue.length > 0 &&
      this.readyState === BetterWebSocketState.OPEN
    ) {
      const message = this.messageQueue.shift()!;
      this.sendDirectly(message.data);
    }
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
    if (this.readyState === BetterWebSocketState.OPEN) {
      this.sendDirectly(data);
    } else {
      // Queue message for later sending
      if (this.messageQueue.length >= this.options.maxQueueSize) {
        this.messageQueue.shift(); // Remove oldest message
      }

      this.messageQueue.push({
        data,
        timestamp: Date.now(),
      });
    }
  }

  private closeInternal(code?: number, reason?: string): void {
    this.readyState = BetterWebSocketState.CLOSING;
    this.clearTimeouts();

    if (this.socket) {
      this.socket.close(code, reason);
    } else {
      // If no socket exists, immediately transition to closed
      setTimeout(() => {
        this.readyState = BetterWebSocketState.CLOSED;
        const closeEvent = new CloseEvent("close", {
          code: code || 1000,
          reason: reason || "",
          wasClean: true,
        });
        this.dispatchEvent(closeEvent);
        if (this.onclose) {
          this.onclose.call(this, closeEvent);
        }
      }, 0);
    }
  }

  public close(code?: number, reason?: string): void {
    this.shouldReconnect = false;
    this.closeInternal(code, reason);
  }

  public destroy(): void {
    this.isDestroyed = true;
    this.shouldReconnect = false;
    this.close();
    this.clearTimeouts();
    this.messageQueue = [];
  }

  // Additional utility methods
  public getQueuedMessageCount(): number {
    return this.messageQueue.length;
  }

  public clearMessageQueue(): void {
    this.messageQueue = [];
  }

  public getCurrentUrl(): string {
    return this.urls[this.currentUrlIndex];
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public forceReconnect(): void {
    this.shouldReconnect = true;
    if (this.socket && this.readyState === BetterWebSocketState.OPEN) {
      this.closeInternal(1000, "Force reconnect");
    } else {
      this.connect();
    }
  }
}
