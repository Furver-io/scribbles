# Tracing

Distributed tracing and correlation functionality.

## Directory Structure

```
tracing/
├── hijacker.js
├── middleware.js
├── namespace.js
├── outbound-args.js
├── outbound-fetch.js
└── trace.js
```

## Files

### `hijacker.js`
HTTP/HTTPS (`request`, `get`) and global `fetch` hijacker for automatic trace header injection.

### `middleware.js`
Express middleware for distributed tracing and trace context propagation.

### `namespace.js`
CLS (Continuation-Local Storage) namespace management for trace correlation.

### `outbound-args.js`
Argument handling for the traced `http` / `https` client wrappers: accepts every
call shape (`url`, `url, callback`, `url, options, callback`, `options, callback`),
normalises object / array headers and adds the trace headers to a copy of the options.

### `outbound-fetch.js`
Argument handling for the traced global `fetch` wrapper: reads object / `Headers` /
array headers and `Request` inputs, adds the trace headers without mutating the
caller's objects, and returns the call untouched outside a trace.

### `trace.js`
Distributed tracing functions for creating trace contexts and W3C headers.
