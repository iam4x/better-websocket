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
