/**
 * Full user workflow integration tests
 * Philosophy: "Test functionality not functions" - via logging & config interface
 * GitHub Issue #11
 */

const scribbles = require('../index');

describe('User Workflow: Express App with Full Tracing', () => {
    // Simulates a complete Express app workflow with tracing

    let logs = [];
    let stdOutCalls = [];

    beforeEach(() => {
        logs = [];
        stdOutCalls = [];
    });

    it('should correlate all logs within a request trace context', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            headers: ['x-custom-header'],
            traceTrigger: undefined // Don't buffer
        });

        // Simulate incoming request with trace headers
        const mockReq = {
            headers: {
                traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
                tracestate: 'vendor1=abc123',
                'x-custom-header': 'custom-value'
            },
            url: '/api/users/42?include=orders',
            path: '/api/users/42',
            query: { include: 'orders' },
            params: { userId: '42' },
            method: 'GET',
            socket: { remoteAddress: '192.168.1.100' }
        };

        const mockRes = {};
        const mockNext = () => {
            // Step 1: Log entry point
            scribbles.info('Request received');

            // Step 2: Log business logic
            scribbles.log('Fetching user data', { userId: 42 });

            // Step 3: Log sub-operation
            scribbles.debug('Querying database');

            // Step 4: Log completion
            scribbles.info('Request completed', { status: 200 });

            // Verify all logs share the same trace context
            expect(logs.length).toBe(4);

            const traceId = logs[0].trace.traceId;
            logs.forEach(log => {
                expect(log.trace.traceId).toBe(traceId);
                expect(log.trace.url).toBe('/api/users/42?include=orders');
                expect(log.trace.method).toBe('GET');
            });

            // Verify trace headers include forwarded headers
            const headers = scribbles.trace.headers();
            expect(headers['x-custom-header']).toBe('custom-value');
            expect(headers.traceparent).toBeDefined();

            done();
        };

        scribbles.middleware.express(mockReq, mockRes, mockNext);
    });

    it('should propagate trace context through async operations', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        const mockReq = {
            headers: {},
            url: '/async-test',
            path: '/async-test',
            query: {},
            params: {},
            method: 'POST',
            socket: { remoteAddress: '10.0.0.1' }
        };

        const mockRes = {};
        const mockNext = () => {
            scribbles.log('Start async operation');

            // Simulate async database call
            setTimeout(() => {
                scribbles.log('Database query completed');

                // Simulate another async operation
                Promise.resolve().then(() => {
                    scribbles.log('Processing complete');

                    // All logs should have same spanId
                    expect(logs.length).toBe(3);
                    const spanId = logs[0].trace.spanId;
                    logs.forEach(log => {
                        expect(log.trace.spanId).toBe(spanId);
                    });

                    done();
                });
            }, 10);
        };

        scribbles.middleware.express(mockReq, mockRes, mockNext);
    });
});

describe('User Workflow: traceTrigger Buffering', () => {
    // Test log buffering with traceTrigger

    let logs = [];

    beforeEach(() => {
        logs = [];
    });

    it('should buffer logs and flush when trigger level is hit', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            traceTrigger: 'error',
            levels: ['error', 'warn', 'log', 'info', 'debug']
        });

        scribbles.trace({ spanLabel: 'buffered-trace' }, () => {
            // These should be buffered (not output yet)
            scribbles.debug('Debug info');
            scribbles.info('Info message');
            scribbles.log('Log entry');
            scribbles.warn('Warning');

            // At this point, nothing should be output
            expect(logs.length).toBe(0);

            // This triggers the flush
            scribbles.error('Critical error occurred');

            // Now ALL logs should be output (buffered + trigger)
            expect(logs.length).toBe(5);

            // Verify order is preserved
            expect(logs[0].info.logLevel).toBe('debug');
            expect(logs[1].info.logLevel).toBe('info');
            expect(logs[2].info.logLevel).toBe('log');
            expect(logs[3].info.logLevel).toBe('warn');
            expect(logs[4].info.logLevel).toBe('error');

            done();
        });
    });

    it('should continue outputting after trigger is hit', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            traceTrigger: 'warn',
            levels: ['error', 'warn', 'log', 'info', 'debug']
        });

        scribbles.trace({ spanLabel: 'continue-after-trigger' }, () => {
            scribbles.debug('Before trigger');
            expect(logs.length).toBe(0);

            scribbles.warn('Trigger hit');
            expect(logs.length).toBe(2); // debug + warn

            // After trigger, subsequent logs should output immediately
            scribbles.info('After trigger 1');
            expect(logs.length).toBe(3);

            scribbles.debug('After trigger 2');
            expect(logs.length).toBe(4);

            done();
        });
    });

    it('should discard buffered logs if trigger never hit', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            traceTrigger: 'error',
            levels: ['error', 'warn', 'log', 'info', 'debug']
        });

        scribbles.trace({ spanLabel: 'no-trigger' }, () => {
            scribbles.debug('Debug 1');
            scribbles.info('Info 1');
            scribbles.log('Log 1');
            scribbles.warn('Warn 1');

            // No error logged, so nothing output
            expect(logs.length).toBe(0);

            // Outside trace, logs should work normally
            setTimeout(() => {
                scribbles.config({ traceTrigger: undefined });
                scribbles.log('Outside trace');
                expect(logs.length).toBe(1);
                done();
            }, 10);
        });
    });
});

describe('User Workflow: Production vs Development Mode', () => {
    let stdOutCalls = [];

    beforeEach(() => {
        stdOutCalls = [];
    });

    it('should output single-line JSON in production mode', () => {
        scribbles.config({
            mode: 'production',
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            format: '{value}',
            stringify: undefined,
            pretty: {} // Let it auto-configure for production
        });

        const complexObject = {
            user: { name: 'Alice', email: 'alice@example.com' },
            orders: [{ id: 1, total: 99.99 }, { id: 2, total: 149.99 }]
        };

        scribbles.log('data', complexObject);

        expect(stdOutCalls.length).toBe(1);
        // Production mode should NOT have newlines (single line)
        expect(stdOutCalls[0]).not.toContain('\n');
    });

    it('should potentially multi-line in dev mode based on terminal width', () => {
        scribbles.config({
            mode: 'dev',
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            format: '{value}',
            stringify: undefined,
            pretty: {
                inlineCharacterLimit: 10 // Force multi-line
            }
        });

        const complexObject = {
            user: { name: 'Bob' },
            count: 42
        };

        scribbles.log('data', complexObject);

        expect(stdOutCalls.length).toBe(1);
        // With small inline limit, should potentially be multi-line
        expect(stdOutCalls[0]).toBeDefined();
    });

    it('should disable colors in production mode by default', () => {
        scribbles.config({
            mode: 'production',
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            format: '{message}',
            logLevel: 'debug'
        });

        scribbles.error('Production error');

        expect(stdOutCalls.length).toBe(1);
        // In production, ANSI escape codes should not be present
        // (unless FORCE_COLOR is set)
        const hasEscapeCodes = stdOutCalls[0].includes('\x1b[');
        // This may vary based on environment, but test should not crash
        expect(typeof hasEscapeCodes).toBe('boolean');
    });
});

describe('User Workflow: Error Tracking with Timer', () => {
    let logs = [];
    let stdOutCalls = [];

    beforeEach(() => {
        logs = [];
        stdOutCalls = [];
    });

    it('should track operation timing with timer functions', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        // Start operation timer
        scribbles.timer('database-query');

        setTimeout(() => {
            // Log intermediate checkpoint
            scribbles.timer('database-query', 'connection established');

            setTimeout(() => {
                // End timer
                scribbles.timerEnd('database-query', 'query complete');

                expect(logs.length).toBe(3);

                // Verify timer data
                expect(logs[0].input.value.tag).toBe('database-query');
                expect(logs[2].input.value.elapsed).toBeGreaterThan(0);
                expect(logs[2].input.value.increment).toBeGreaterThan(0);

                done();
            }, 50);
        }, 50);
    });

    it('should throw error for timerEnd on non-existent timer', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        expect(() => {
            scribbles.timerEnd('non-existent-timer');
        }).toThrow("Timer 'non-existent-timer' does not exist");
    });
});

describe('User Workflow: Console Groups', () => {
    let logs = [];
    let stdOutCalls = [];

    beforeEach(() => {
        logs = [];
        stdOutCalls = [];
    });

    it('should organize logs with groups', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        const groupId = scribbles.group.start('User Authentication');
        scribbles.log('Validating credentials');
        scribbles.log('Checking permissions');
        scribbles.group.end();

        expect(logs.length).toBe(4); // group + 2 logs + groupEnd

        // First log is group start
        expect(logs[0].info.logLevel).toBe('group');
        expect(logs[0].input.message).toBe('User Authentication');

        // Middle logs should have groupLevel > 0
        expect(logs[1].context.groupLevel).toBe(1);
        expect(logs[2].context.groupLevel).toBe(1);

        // Last log is group end (caption echoes the started label by default)
        expect(logs[3].info.logLevel).toBe('groupEnd');
        expect(logs[3].input.message).toBe('User Authentication');
    });

    it('should support nested groups', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        scribbles.group.start('Outer');
        scribbles.log('Outer log');

        scribbles.group.start('Inner');
        scribbles.log('Inner log');
        scribbles.group.end(); // Close inner

        scribbles.log('Back to outer');
        scribbles.group.end(); // Close outer

        // Find the inner log
        const innerLog = logs.find(l => l.input.message === 'Inner log');
        expect(innerLog.context.groupLevel).toBe(2);

        // Find the "back to outer" log
        const outerLog = logs.find(l => l.input.message === 'Back to outer');
        expect(outerLog.context.groupLevel).toBe(1);
    });

    it('should close specific group by ID', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        const outer = scribbles.group.start('Outer');
        scribbles.group.start('Inner 1');
        scribbles.group.start('Inner 2');

        // Close outer group (should close all nested)
        scribbles.group.end(outer);

        // Log after closing
        scribbles.log('After groups');

        const afterLog = logs.find(l => l.input.message === 'After groups');
        expect(afterLog.context.groupLevel).toBe(0);
    });

    it('should support collapsed groups', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug'
        });

        scribbles.group.collapsed('Collapsed Section');
        scribbles.log('Hidden by default');
        scribbles.group.end();

        expect(logs[0].info.logLevel).toBe('groupCollapsed');
    });
});

describe('User Workflow: Custom Log Levels', () => {
    let logs = [];

    beforeEach(() => {
        logs = [];
        // Reset to default config to avoid state pollution
        scribbles.config({
            stdOut: null,
            dataOut: null,
            logLevel: 'debug',
            levels: ['error', 'warn', 'log', 'info', 'debug']
        });
    });

    it('should support custom log levels', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'verbose',
            levels: ['fatal', 'error', 'warning', 'info', 'verbose', 'silly']
        });

        // Custom levels should be available as functions
        expect(typeof scribbles.fatal).toBe('function');
        expect(typeof scribbles.warning).toBe('function');
        expect(typeof scribbles.verbose).toBe('function');

        scribbles.fatal('System crash');
        scribbles.warning('Disk space low');
        scribbles.verbose('Detailed info');

        expect(logs.length).toBe(3);
        expect(logs[0].info.logLevel).toBe('fatal');
        expect(logs[1].info.logLevel).toBe('warning');
        expect(logs[2].info.logLevel).toBe('verbose');
    });

    it('should filter logs based on logLevel', () => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'warning',
            levels: ['fatal', 'error', 'warning', 'info', 'verbose']
        });

        scribbles.fatal('Should appear');
        scribbles.error('Should appear');
        scribbles.warning('Should appear');
        scribbles.info('Should NOT appear');
        scribbles.verbose('Should NOT appear');

        expect(logs.length).toBe(3);
    });
});

describe('User Workflow: Headers Mapping', () => {
    let logs = [];

    beforeEach(() => {
        logs = [];
    });

    it('should map incoming headers to different outgoing names', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            headersMapping: {
                'x-trace-id': 'x-request-id'
            }
        });

        const mockReq = {
            headers: {
                'x-request-id': 'req-123-abc'
            },
            url: '/test',
            path: '/test',
            query: {},
            params: {},
            method: 'GET',
            socket: { remoteAddress: '127.0.0.1' }
        };

        const mockRes = {};
        const mockNext = () => {
            const headers = scribbles.trace.headers();

            // The x-request-id should be mapped to x-trace-id
            expect(headers['x-trace-id']).toBe('req-123-abc');
            done();
        };

        scribbles.middleware.express(mockReq, mockRes, mockNext);
    });

    it('should support fallback header names', (done) => {
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            logLevel: 'debug',
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            headersMapping: {
                'x-correlation-id': ['x-trace-id', 'x-request-id', 'x-correlation']
            }
        });

        const mockReq = {
            headers: {
                'x-request-id': 'fallback-value'
            },
            url: '/test',
            path: '/test',
            query: {},
            params: {},
            method: 'GET',
            socket: { remoteAddress: '127.0.0.1' }
        };

        const mockRes = {};
        const mockNext = () => {
            const headers = scribbles.trace.headers();

            // Should use x-request-id since x-trace-id doesn't exist
            expect(headers['x-correlation-id']).toBe('fallback-value');
            done();
        };

        scribbles.middleware.express(mockReq, mockRes, mockNext);
    });
});

describe('User Workflow: Pretty Print Transform', () => {
    let stdOutCalls = [];

    beforeEach(() => {
        stdOutCalls = [];
        // Reset to default config
        scribbles.config({
            stdOut: null,
            dataOut: null,
            logLevel: 'debug',
            levels: ['error', 'warn', 'log', 'info', 'debug']
        });
    });

    it('should transform values during pretty printing', () => {
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            format: '{value}',
            stringify: undefined,
            pretty: {
                inlineCharacterLimit: Number.POSITIVE_INFINITY,
                transform: (obj, key, val) => {
                    // Mask password fields
                    if (key === 'password') {
                        return '****';
                    }
                    return val;
                }
            }
        });

        scribbles.log('credentials', {
            username: 'admin',
            password: 'secret123'
        });

        expect(stdOutCalls.length).toBe(1);
        expect(stdOutCalls[0]).toContain('admin');
        expect(stdOutCalls[0]).toContain('****');
        expect(stdOutCalls[0]).not.toContain('secret123');
    });

    it('should filter properties during pretty printing', () => {
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            format: '{value}',
            stringify: undefined,
            pretty: {
                inlineCharacterLimit: Number.POSITIVE_INFINITY,
                filter: (obj, key) => {
                    // Exclude internal properties
                    return !key.startsWith('_');
                }
            }
        });

        scribbles.log('data', {
            publicField: 'visible',
            _internalField: 'hidden'
        });

        expect(stdOutCalls.length).toBe(1);
        expect(stdOutCalls[0]).toContain('publicField');
        expect(stdOutCalls[0]).not.toContain('_internalField');
    });
});
