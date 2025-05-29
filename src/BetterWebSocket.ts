import type { BetterWebSocketOptions, QueuedMessage } from "./types";
import { BetterWebSocketState } from "./types";
import {
  connect as internalConnect,
  disconnectSocket as internalDisconnectSocket,
  setupSocketListeners as internalSetupSocketListeners,
  handleOpen as internalHandleOpen,
  handleMessage as internalHandleMessage,
  handleClose as internalHandleClose,
  handleSocketError as internalHandleSocketError,
  handleConnectionError as internalHandleConnectionError,
  attemptReconnect as internalAttemptReconnect,
  startConnectTimeout as internalStartConnectTimeout,
  startHeartbeat as internalStartHeartbeat,
  setHeartbeatTimeout as internalSetHeartbeatTimeout,
  resetHeartbeatTimeout as internalResetHeartbeatTimeout,
  flushMessageQueue as internalFlushMessageQueue,
  clearTimeouts as internalClearTimeouts,
} from "./connection";

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
    internalConnect(this);
  }

  private disconnectSocket(): void {
    internalDisconnectSocket(this);
  }

  private setupSocketListeners(): void {
    internalSetupSocketListeners(this);
  }

  private handleOpen(_event: Event): void {
    internalHandleOpen(this, _event);
  }

  private handleMessage(event: MessageEvent): void {
    internalHandleMessage(this, event);
  }

  private handleClose(event: CloseEvent): void {
    internalHandleClose(this, event);
  }

  private handleSocketError(_event: Event): void {
    internalHandleSocketError(this, _event);
  }

  private handleConnectionError(error: Error): void {
    internalHandleConnectionError(this, error);
  }

  private attemptReconnect(): void {
    internalAttemptReconnect(this);
  }

  private startConnectTimeout(): void {
    internalStartConnectTimeout(this);
  }

  private startHeartbeat(): void {
    internalStartHeartbeat(this);
  }

  private setHeartbeatTimeout(): void {
    internalSetHeartbeatTimeout(this);
  }

  private resetHeartbeatTimeout(): void {
    internalResetHeartbeatTimeout(this);
  }

  private flushMessageQueue(): void {
    internalFlushMessageQueue(this);
  }

  private clearTimeouts(): void {
    internalClearTimeouts(this);
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
