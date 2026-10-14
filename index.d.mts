/**
 * Scribbles - ESM type definitions (v2.0.0 hard cut)
 *
 * In ESM the default export carries ONLY log-level functions. All
 * infrastructure (`config`, `trace`, `middleware`, `register`, etc.)
 * is available exclusively as named exports. See the corresponding
 * JSDoc in `index.mjs` and the v2 MIGRATION guide for the rationale.
 */

import type {
    LogFunction,
    LogEntry,
    ScribblesConfig,
    TraceFunction,
    TimerLogEntry,
    // Re-exported from index.d.ts below for TS users consuming the
    // namespace. Marker re-export so the CJS file remains the single
    // source of truth for structural interfaces.
} from './index';

export type {
    PrettyOptions,
    GitEnvConfig,
    StdOutConfig,
    SinkName,
    ScribblesConfig,
    GitInfo,
    TraceInfo,
    LogInfo,
    ContextInfo,
    InputInfo,
    CpuStatus,
    SysStatus,
    ProcessStatus,
    NetworkStatus,
    StatusInfo,
    LogEntry,
    TraceOptions,
    TraceHeaders,
    LogFunction,
    TimerLogEntry,
    ExpressRequest,
    ExpressResponse,
    ExpressNextFunction,
    TraceFunction,
    Middleware,
    GroupFunction,
    RegisterStatus,
    Register
} from './index';

import type { Middleware, GroupFunction, Register } from './index';

/**
 * ESM default export — log-levels-only view of the scribbles object.
 *
 * Calling `scribbles.config(...)` / `scribbles.trace(...)` / etc. on
 * this default IS `undefined` at runtime. Infrastructure APIs are
 * reachable only via named imports:
 *
 *     import scribbles, { config, trace, register } from 'scribbles';
 */
interface ScribblesESMDefault {
    error: LogFunction;
    warn: LogFunction;
    log: LogFunction;
    info: LogFunction;
    debug: LogFunction;
    /** Dynamic / custom log levels activated via `config({ levels: [...] })`. */
    [level: string]: LogFunction | unknown;
}

declare const scribbles: ScribblesESMDefault;
export default scribbles;

/** Configure scribbles. See ScribblesConfig for the full option surface. */
export declare const config: (options: ScribblesConfig) => void;

/** Create a trace context / get W3C headers. See TraceFunction. */
export declare const trace: TraceFunction;

/** Framework middleware collection (currently only Express). */
export declare const middleware: Middleware;

/**
 * Runtime-registration API (idempotent installer + introspection).
 * See the `Register` interface for the full shape.
 */
export declare const register: Register;

/** Start / increment a named timer. */
export declare const timer: (tag: string, message?: string) => TimerLogEntry;

/** End a named timer and log the elapsed time. */
export declare const timerEnd: (tag: string, message?: string) => TimerLogEntry;

/** Console-group helpers for nested / collapsed log sections. */
export declare const group: GroupFunction;

/** Status log (system / process health snapshot). */
export declare const status: LogFunction;
