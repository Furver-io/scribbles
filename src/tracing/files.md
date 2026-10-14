# Tracing

Distributed tracing and correlation functionality.

## Directory Structure

```
tracing/
├── hijacker.js
├── middleware.js
├── namespace.js
├── outbound-args.js
└── trace.js
```

## Files

### `hijacker.js`
HTTP/HTTPS request hijacker for automatic trace header injection.

### `middleware.js`
Express middleware for distributed tracing and trace context propagation.

### `namespace.js`
CLS (Continuation-Local Storage) namespace management for trace correlation.

### `outbound-args.js`
Argument handling for the traced `http` / `https` client wrappers: accepts every
call shape (`url`, `url, callback`, `url, options, callback`, `options, callback`),
normalises object / array headers and adds the trace headers to a copy of the options.

### `trace.js`
Distributed tracing functions for creating trace contexts and W3C headers.
