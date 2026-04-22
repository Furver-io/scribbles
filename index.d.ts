/**
 * Scribbles - A log and tracing lib for Node
 * TypeScript definitions
 */

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Pretty printing options for value serialization
 */
interface PrettyOptions {
    /** Preferred indentation string (default: "  ") */
    indent?: string;
    /** Will inline values up to this length (default: terminal width in dev, Infinity in prod) */
    inlineCharacterLimit?: number;
    /** Set to true to get single-quoted strings (default: false) */
    singleQuotes?: boolean;
    /** How many nested steps in the object/array tree to walk */
    depth?: number;
    /** Filter function to include/exclude properties */
    filter?: (obj: object, key: string) => boolean;
    /** Transform function to modify stringified property values */
    transform?: (obj: object, key: string, value: string) => string;
    /** Use ASCII brackets (⎡⎜⎣) for group indentation (default: false) */
    groupBrackets?: boolean;
    /**
     * When true with `colors`, emit ANSI syntax roles for the `{value}` column
     * (keys, brackets, type names, primitives, etc.). `colorScheme[level]` is
     * applied only to the plain template prefix before `{value}` so inner token
     * colors are not wrapped by a single outer SGR. Default: true (set false for
     * whole-line level color only, no per-token roles).
     */
    syntaxHighlight?: boolean;
    /**
     * Overrides for syntax roles (shallow-merged over defaults; base map switches
     * with `colorblindMode`). Role keys include: bracket, comma, colon, typeName,
     * key, string, number, boolean, nullish, symbol, regex, function, arrayIndex,
     * circular, truncation, identifierLabel, disambiguationPrefix, fallback, transformOutput.
     * Values are color names accepted by `colors.js` / {@link ScribblesConfig.colorScheme} keys.
     */
    syntaxColorScheme?: { [role: string]: string };
}

/**
 * Git environment variable mapping
 */
interface GitEnvConfig {
    /** Environment variable name for git short hash */
    hash?: string;
    /** Environment variable name for git repository name */
    repo?: string;
    /** Environment variable name for git branch */
    branch?: string;
}

/**
 * StdOut configuration - can be a function, object with level methods, or null to disable
 */
type StdOutConfig =
    | ((msg: string) => void)
    | { [level: string]: (msg: string) => void }
    | { log: (msg: string) => void }
    | null;

/**
 * Configuration options for scribbles
 */
interface ScribblesConfig {
    /** Environment mode (default: process.env.NODE_ENV || 'dev') */
    mode?: string;
    /** Log format template string with placeholders */
    format?: string;
    /** Time format using Moment.js format tokens (default: "YYYY-MM-DDTHH:mm:ss.SSS") */
    time?: string;
    /** Array of log levels from highest to lowest priority */
    levels?: string[];
    /** Minimum log level to output (default: "debug") */
    logLevel?: string;
    /** Log level that triggers trace flushing */
    traceTrigger?: string;
    /** Output destination for formatted log strings */
    stdOut?: StdOutConfig;
    /** Callback to receive structured log data objects */
    dataOut?: (data: LogEntry) => void;
    /** Custom stringify function for values */
    stringify?: (value: unknown, pretty: PrettyOptions) => string;
    /** Headers to forward in trace context (string, RegExp, array, or null to disable) */
    headers?: string | RegExp | (string | RegExp)[] | null;
    /** Header name mapping from input to output */
    headersMapping?: { [outputKey: string]: string | string[] };
    /** Environment variable mapping for git info */
    gitEnv?: GitEnvConfig;
    /** Pretty printing options */
    pretty?: PrettyOptions;
    /** Global object to attach log functions to ("console", "global", or custom object) */
    global?: "console" | "global" | { [key: string]: unknown };
    /** Enable colored log output (default: true in dev mode) */
    colors?: boolean;
    /** Use colorblind-friendly color scheme (default: false) */
    colorblindMode?: boolean;
}

// =============================================================================
// Log Entry Types
// =============================================================================

/**
 * Git information in log entry
 */
interface GitInfo {
    repo: string;
    branch: string;
    hash: string;
}

/**
 * Trace context information
 */
interface TraceInfo {
    traceId?: string;
    spanId?: string;
    span64?: string;
    spanLabel?: string;
    tracestate?: Array<{ key: string; value: string }>;
}

/**
 * Log entry metadata
 */
interface LogInfo {
    time: Date;
    mode: string;
    hostname: string;
    instance: string;
    logLevel: string;
}

/**
 * Source context information
 */
interface ContextInfo {
    fileName: string;
    lineNumber: number;
    method?: string;
    /** Current group nesting level (0 when not in a group) */
    groupLevel?: number;
    /** Joined labels of all parent groups */
    groupLabel?: string;
}

/**
 * Log input data
 */
interface InputInfo {
    message?: string;
    originalMessage?: string;
    value?: unknown;
    stackTrace?: string[];
    from?: string[];
}

/**
 * CPU status information
 */
interface CpuStatus {
    cores: number;
    model: string;
    speed: number;
    percUsed: number;
    percFree: number;
}

/**
 * System status information
 */
interface SysStatus {
    startedAt: Date;
    arch: string;
    platform: string;
    totalMem: number;
    freeMem: number;
    usedMem: number;
}

/**
 * Process status information
 */
interface ProcessStatus {
    percUsedCpu: number;
    percFreeMem: number;
    usedMem: number;
    startedAt: Date;
    pTitle?: string;
    pid?: number;
    ppid?: number;
    user?: string;
    vNode?: string;
}

/**
 * Network status information
 */
interface NetworkStatus {
    port: number | null;
    connections: number;
}

/**
 * Full status information returned by scribbles.status()
 */
interface StatusInfo {
    state: 'up' | 'blocking';
    cpu: CpuStatus;
    sys: SysStatus;
    process: ProcessStatus;
    network: NetworkStatus;
}

/**
 * Structured log entry object passed to dataOut callback
 */
interface LogEntry {
    /** Scribbles version */
    v: string;
    /** Git repository information */
    git: GitInfo;
    /** Trace context */
    trace: TraceInfo;
    /** Log metadata */
    info: LogInfo;
    /** Source file context */
    context: ContextInfo;
    /** Log input data */
    input: InputInfo;
    /** Status information (only present for status logs) */
    status?: StatusInfo;
    /** Convert log entry to formatted string */
    toString(): string;
}

// =============================================================================
// Trace Types
// =============================================================================

/**
 * Options for trace function
 */
interface TraceOptions {
    /** Custom trace ID or W3C traceparent string */
    traceId?: string;
    /** Tracestate as string or parsed array */
    tracestate?: string | Array<{ key: string; value: string }>;
    /** Label for this span */
    spanLabel?: string;
    /** Headers to include in trace context */
    headers?: { [key: string]: string };
}

/**
 * W3C trace context headers
 */
interface TraceHeaders {
    'x-git-hash'?: string;
    traceparent: string;
    tracestate: string;
    [key: string]: string | undefined;
}

// =============================================================================
// Logging Function Types
// =============================================================================

/**
 * Log function with optional .at() method for source location override
 */
interface LogFunction {
    /**
     * Log a message
     * @param message - Message string
     */
    (message: string): LogEntry;
    /**
     * Log a value
     * @param value - Any value to log
     */
    (value: unknown): LogEntry;
    /**
     * Log an error
     * @param error - Error object
     */
    (error: Error): LogEntry;
    /**
     * Log a message with a value
     * @param message - Message string
     * @param value - Any value to log
     */
    (message: string, value: unknown): LogEntry;
    /**
     * Log a message with an error
     * @param message - Message string
     * @param error - Error object
     */
    (message: string, error: Error): LogEntry;
    /**
     * Log a value with an error
     * @param value - Any value to log
     * @param error - Error object
     */
    (value: unknown, error: Error): LogEntry;
    /**
     * Log an error with a value
     * @param error - Error object
     * @param value - Any value to log
     */
    (error: Error, value: unknown): LogEntry;
    /**
     * Log a message with value and error
     * @param message - Message string
     * @param value - Any value to log
     * @param error - Error object
     */
    (message: string, value: unknown, error: Error): LogEntry;
    /**
     * Log a message with error and value
     * @param message - Message string
     * @param error - Error object
     * @param value - Any value to log
     */
    (message: string, error: Error, value: unknown): LogEntry;
    /**
     * Log with explicit source location
     */
    at: (from: { file: string; line: number; col?: number }, ...args: unknown[]) => LogEntry;
}

/**
 * Timer log entry with timing information
 */
interface TimerLogEntry extends LogEntry {
    input: InputInfo & {
        value: {
            tag: string;
            elapsed: number;
            increment: number;
        };
    };
}

// =============================================================================
// Express Middleware Types
// =============================================================================

/**
 * Express-compatible request object (minimal interface for middleware)
 */
interface ExpressRequest {
    headers: { [key: string]: string | string[] | undefined };
    socket?: { remoteAddress?: string };
    connection?: {
        remoteAddress?: string;
        socket?: { remoteAddress?: string };
    };
    ip?: string;
}

/**
 * Express-compatible response object (minimal interface for middleware)
 */
interface ExpressResponse {
    [key: string]: unknown;
}

/**
 * Express-compatible next function
 */
type ExpressNextFunction = () => void;

// =============================================================================
// Main Scribbles Interface
// =============================================================================

/**
 * Trace function with headers method
 */
interface TraceFunction {
    /**
     * Create a trace context and execute callback
     * @param callback - Function to execute within trace context
     */
    (callback: (spanId: string) => void): void;
    /**
     * Create a labeled trace context
     * @param label - Span label
     * @param callback - Function to execute within trace context
     */
    (label: string, callback: (spanId: string) => void): void;
    /**
     * Create a trace context with options
     * @param options - Trace options
     * @param callback - Function to execute within trace context
     */
    (options: TraceOptions, callback: (spanId: string) => void): void;
    /**
     * Get W3C trace context headers (must be called inside a trace)
     * @param customHeaders - Optional custom headers to merge
     */
    headers: (customHeaders?: { [key: string]: string }) => TraceHeaders;
}

/**
 * Middleware collection
 */
interface Middleware {
    /**
     * Express middleware that creates trace context from incoming request
     */
    express: (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void;
}

/**
 * Return shape for `register.status()` — describes whether the
 * runtime-specific source-transform hook is active.
 */
interface RegisterStatus {
    /** Detected runtime of the current process. */
    runtime: 'node-cjs' | 'node-esm' | 'bun-cjs' | 'bun-esm' | 'unknown';
    /** True iff the CJS `Module._extensions` hook is installed. */
    cjsInstalled: boolean;
    /** True iff the ESM preload (`scribbles/register`) has executed. */
    esmPreloaded: boolean;
    /**
     * Shorthand for "the right mechanism for the current runtime is
     * wired". For CJS-only runtimes the CJS hook is sufficient; for
     * ESM-ish runtimes the preload is the load-bearing piece.
     */
    transformActive: boolean;
    /**
     * Human-readable remediation text. Present iff `transformActive`
     * is false — otherwise omitted.
     */
    instructions?: string;
}

/**
 * Register API — installs the source-transform hook for the current
 * runtime and exposes introspection helpers for CI / health-check use.
 *
 * Exposed as both a callable function (idempotent installer) and an
 * object carrying `.status()` / `.assert()` methods. Also self-
 * references under `.register` so `const { register } = require('scribbles')`
 * and `import { register } from 'scribbles'` both yield the same value.
 */
interface Register {
    /**
     * Install the source-transform hook for the current runtime. Safe
     * to call multiple times — only the first call has any effect.
     */
    (): void;

    /** Inspect whether the transform is active (see RegisterStatus). */
    status: () => RegisterStatus;

    /**
     * Fail-fast CI / boot check. Throws a `SCRIBBLES_NOT_REGISTERED`
     * error with remediation instructions when the transform is not
     * active (e.g. an ESM entrypoint booted without `--import
     * scribbles/register` / `bunfig.toml` preload).
     */
    assert: () => void;

    /** Self-reference so `const { register } = ...` is well-typed. */
    register: Register;
}

/**
 * Group function collection for console.group-style logging
 */
interface GroupFunction {
    /**
     * Start a labeled console group
     * @param label - Optional group label
     * @returns Group ID for targeted closing
     */
    start: (label?: string) => number;

    /**
     * Start a collapsed console group
     * @param label - Optional group label
     * @returns Group ID for targeted closing
     */
    collapsed: (label?: string) => number;

    /**
     * End a console group.
     * - `end()` — LIFO; caption defaults to the same label passed to `start` / `collapsed` (or `"Group"`).
     * - `end("caption")` — LIFO; caption is the string shown on the `groupEnd` line.
     * - `end(id)` — Close from id (and nested groups); caption defaults to that group's stored label.
     * - `end(id, "caption")` — Same close; caption is the string shown (pass `""` for an empty caption).
     */
    end: (groupIdOrEndLabel?: number | string, endLabel?: string) => LogEntry;
}

/**
 * Main scribbles interface
 */
interface Scribbles {
    // Default log levels
    error: LogFunction;
    warn: LogFunction;
    log: LogFunction;
    info: LogFunction;
    debug: LogFunction;

    // Dynamic log levels (added via config.levels)
    [level: string]: LogFunction | unknown;

    /**
     * Configure scribbles options
     */
    config: (options: ScribblesConfig) => void;

    /**
     * Create a trace context
     */
    trace: TraceFunction;

    /**
     * Framework middleware
     */
    middleware: Middleware;

    /**
     * Start or log an intermediate timer value
     * @param tag - Timer identifier
     * @param message - Optional message
     */
    timer: (tag: string, message?: string) => TimerLogEntry;

    /**
     * End a timer and log final value
     * @param tag - Timer identifier
     * @param message - Optional message
     * @throws Error if timer tag does not exist
     */
    timerEnd: (tag: string, message?: string) => TimerLogEntry;

    /**
     * Log system status with performance metrics
     * @param message - Optional message
     */
    status: LogFunction;

    /**
     * Console grouping functions for organizing related log messages
     */
    group: GroupFunction;

    /**
     * Runtime-registration API (v2.0.0+).
     *
     * In CJS the `scribbles.register` property is a back-compat shim
     * over the canonical `const { register } = require('scribbles')`
     * named export. In ESM the hard cut applies: `scribbles.register`
     * is `undefined` and users must do
     * `import { register } from 'scribbles'`.
     */
    register: Register;
}

declare const scribbles: Scribbles;
export = scribbles;
