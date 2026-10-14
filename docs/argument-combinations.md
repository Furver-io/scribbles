# Scribbles Argument Combinations

A detailed breakdown of all argument combinations that scribbles accepts.

---

## Log Level Functions (`error`, `warn`, `log`, `info`, `debug`)

All log functions share the same flexible argument parsing from `src/parsing/args2keys.js`. They accept **message** (string), **value** (any non-string/non-Error), and **error** (Error instance) in various combinations:

| Args | Example | Parsed As |
|------|---------|-----------|
| None | `scribbles.log()` | all undefined |
| String | `scribbles.log('hello')` | message |
| Error | `scribbles.error(new Error('x'))` | error (message extracted from it) |
| Other value | `scribbles.log({foo: 1})` | value |
| String + value | `scribbles.log('msg', {foo: 1})` | message + value |
| String + Error | `scribbles.error('msg', new Error())` | message + error |
| Error + value | `scribbles.error(new Error(), {ctx: 1})` | error + value |
| Value + Error | `scribbles.error({ctx: 1}, new Error())` | value + error |
| String + value + Error | `scribbles.error('msg', {}, new Error())` | all three |
| String + Error + value | `scribbles.error('msg', new Error(), {})` | all three (reordered) |

Each log function also has an **`.at()` method** for overriding source location:
```js
scribbles.log.at({ file: 'my.js', line: 42, col: 0, args: [] }, 'message', optionalValue)
```

---

## `trace()`

Three overloads:

| Form | Example |
|------|---------|
| Callback only | `scribbles.trace((spanId) => { ... })` |
| Label + callback | `scribbles.trace('my-span', (spanId) => { ... })` |
| Options + callback | `scribbles.trace({ spanLabel, traceId, tracestate, headers, url, path, query, params, method }, cb)` |

The callback is called as `cb(spanId, { traceId, spanId })` and `trace()` returns whatever the callback
returns (a returned promise is returned as-is, so async results and rejections reach the caller).

**TraceOptions Properties** (all optional):
- `spanLabel`: String to label this span
- `traceId`: Custom trace ID or W3C traceparent format string (`00-<traceId>-<spanId>-<flag>`)
- `tracestate`: Trace state as string or parsed array
- `headers`: Custom headers to include
- `url`, `path`, `query`, `params`, `method`: Request metadata

**`trace.headers()`** — call inside a trace context to get W3C trace headers:
```js
scribbles.trace.headers()              // returns { traceparent, tracestate, x-git-hash }
scribbles.trace.headers({custom: 'h'}) // merges custom headers in
```

---

## `timer()` / `timerEnd()`

| Form | Example |
|------|---------|
| Tag only | `scribbles.timer('db-query')` |
| Tag + message | `scribbles.timer('db-query', 'starting lookup')` |
| End tag | `scribbles.timerEnd('db-query')` |
| End tag + message | `scribbles.timerEnd('db-query', 'done')` |

Tag can be string or number.

---

## `status()`

Same argument combinations as log functions. Returns a LogEntry enriched with system metrics (CPU, memory, network, process info).

---

## `group`

| Method | Args | Returns |
|--------|------|---------|
| `group.start()` | optional label string | groupId (number) |
| `group.collapsed()` | optional label string | groupId (number) |
| `group.end()` | `()` LIFO (caption = start label), `(caption)` LIFO, `(groupId)`, or `(groupId, caption)` | LogEntry |

---

## `config()`

Single options object with all properties optional:

| Property | Type | Purpose |
|----------|------|---------|
| `stdOut` | console / Function / {level: fn} / null | Output target |
| `dataOut` | `(logEntry) => void` | Structured data output |
| `format` | string with `{placeholders}` | Log format template |
| `time` | string (moment format) | Timestamp format |
| `levels` | string[] | Custom log levels |
| `logLevel` | string | Filter threshold |
| `traceTrigger` | string | Level that triggers trace buffering |
| `stringify` | `(value, pretty) => string` | Custom serializer |
| `pretty` | object | Pretty-print options (indent, depth, etc.) |
| `headers` | string / RegExp / array | Header capture patterns |
| `headersMapping` | object | Remap header keys |
| `gitEnv` | `{hash, repo, branch}` | Env var names for git info |
| `global` | `'console'` / `'global'` / object | Attach scribbles globally |
| `mode` | `'dev'` / `'prod'` / custom | Environment mode |
| `colors` | boolean | Enable/disable color output |
| `colorblindMode` | boolean | Colorblind-friendly palette |
| `colorScheme` | object | Custom colors per level |
| `hijack` | boolean | Auto-inject trace headers |
| `edgeLookupHash` | boolean | Edge optimization flag |

---

## `middleware.express`

Used as standard Express middleware — no arguments from user code:
```js
app.use(scribbles.middleware.express)
```

---

## Key Design Pattern

The polymorphic argument parser in `src/parsing/args2keys.js` uses type detection (string vs Error vs other) to determine which slot each argument fills, regardless of order. This gives all log-level functions and `status()` their flexible calling conventions.
