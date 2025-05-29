# BetterWebSocket

A robust WebSocket wrapper with auto-reconnection, URL fallback, message queuing, and heartbeat functionality.

## Features

- ✅ **Full WebSocket API compatibility** - Drop-in replacement for the native WebSocket class
- 🔄 **Auto-reconnection** with exponential backoff strategy
- 📦 **Message queuing** - Messages are queued when disconnected and sent when reconnected
- 🌐 **Multiple URL fallback** - Automatically tries the next URL if current one fails
- ⏱️ **Connection timeout** handling with automatic URL switching
- 💓 **Heartbeat/keepalive** functionality (opt-in)
- 🛡️ **Robust error handling** and state management
- 📊 **Comprehensive test coverage** with integration tests

## Installation

```bash
npm i -S @iam4x/better-websocket
```

## Quick Start

```typescript
import { BetterWebSocket } from '@iam4x/better-websocket';

// Simple usage - drop-in replacement for WebSocket
const ws = new BetterWebSocket('ws://localhost:8080');

ws.onopen = () => console.log('Connected!');
ws.onmessage = (event) => console.log('Message:', event.data);
ws.onclose = () => console.log('Disconnected');
ws.onerror = (error) => console.log('Error:', error);

ws.send('Hello, WebSocket!');
```

## Advanced Usage

### Multiple URLs with Fallback

```typescript
const ws = new BetterWebSocket([
  'ws://primary-server.com',
  'ws://backup-server.com',
  'ws://fallback-server.com'
], undefined, {
  connectTimeout: 5000,
  maxReconnectAttempts: 10,
  reconnectBackoffFactor: 1.5
});
```

### Heartbeat/Keepalive

```typescript
const ws = new BetterWebSocket('ws://localhost:8080', undefined, {
  enableHeartbeat: true,
  heartbeatInterval: 30000,    // Send ping every 30 seconds
  heartbeatTimeout: 5000,      // Expect pong within 5 seconds
  heartbeatMessage: 'ping'     // Custom heartbeat message
});
```

### Message Queuing

```typescript
const ws = new BetterWebSocket('ws://localhost:8080', undefined, {
  maxQueueSize: 100
});

// Messages sent while disconnected are queued
ws.send('This will be queued if not connected');
ws.send('This too');

// Check queue status
console.log('Queued messages:', ws.getQueuedMessageCount());

// Clear queue if needed
ws.clearMessageQueue();
```

## Configuration Options

```typescript
interface BetterWebSocketOptions {
  connectTimeout?: number;          // Connection timeout in ms (default: 10000)
  maxReconnectAttempts?: number;    // Max reconnection attempts (default: 5)
  reconnectBackoffFactor?: number;  // Backoff multiplier (default: 1.5)
  heartbeatInterval?: number;       // Heartbeat interval in ms (default: 30000)
  heartbeatTimeout?: number;        // Heartbeat response timeout in ms (default: 5000)
  enableHeartbeat?: boolean;        // Enable heartbeat functionality (default: false)
  heartbeatMessage?: string;        // Heartbeat message (default: 'ping')
  maxQueueSize?: number;           // Max queued messages (default: 100)
  protocols?: string | string[];   // WebSocket protocols
}
```

## API Reference

### Constructor

```typescript
new BetterWebSocket(
  urls: string | string[],
  protocols?: string | string[],
  options?: BetterWebSocketOptions
)
```

### WebSocket Interface Methods

All standard WebSocket methods are supported:

- `send(data)` - Send data (queued if not connected)
- `close(code?, reason?)` - Close connection
- Standard properties: `readyState`, `url`, `protocol`, `extensions`, etc.
- Event handlers: `onopen`, `onmessage`, `onclose`, `onerror`

### Additional Methods

- `destroy()` - Permanently destroy the connection (prevents reconnection)
- `forceReconnect()` - Force an immediate reconnection
- `getQueuedMessageCount()` - Get number of queued messages
- `clearMessageQueue()` - Clear the message queue
- `getCurrentUrl()` - Get the currently active URL
- `getReconnectAttempts()` - Get current reconnection attempt count

### Events

BetterWebSocket supports both event handlers and addEventListener:

```typescript
// Event handlers
ws.onopen = (event) => { /* ... */ };
ws.onmessage = (event) => { /* ... */ };
ws.onclose = (event) => { /* ... */ };
ws.onerror = (event) => { /* ... */ };

// Event listeners
ws.addEventListener('open', (event) => { /* ... */ });
ws.addEventListener('message', (event) => { /* ... */ });
ws.addEventListener('close', (event) => { /* ... */ });
ws.addEventListener('error', (event) => { /* ... */ });
```

## Connection States

```typescript
enum BetterWebSocketState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3
}
```

## Reconnection Behavior

1. **URL Fallback**: Tries each URL in order before considering it a failed attempt
2. **Exponential Backoff**: Delay between attempts increases exponentially
3. **Max Attempts**: Stops trying after reaching `maxReconnectAttempts`
4. **Reset on Success**: Reconnection counter resets on successful connection

## Message Queuing

- Messages sent while disconnected are automatically queued
- Queue has a maximum size (configurable via `maxQueueSize`)
- Oldest messages are dropped when queue is full
- All queued messages are sent immediately upon reconnection

## Heartbeat/Keepalive

When enabled, BetterWebSocket will:

1. Send heartbeat messages at regular intervals
2. Monitor for heartbeat responses
3. Automatically reconnect if heartbeat fails
4. Track time since last received message

## Error Handling

BetterWebSocket gracefully handles:

- Connection failures and timeouts
- Network interruptions
- Invalid URLs or protocols
- Server disconnections
- Heartbeat timeouts

## Testing

Run the comprehensive test suite:

```bash
bun test
```

The tests include integration tests with real WebSocket servers to ensure reliability.

## Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Build
bun run build

# Lint
bun run lint
```

## License

MIT
