/**
 * Integration tests for edge cases and error handling
 * Tests boundary conditions, error scenarios, and unusual inputs
 * 
 * Note: Tests run in separate describe blocks to avoid state pollution
 * from the CLS namespace cleanup
 */

const scribbles = require('../index');

describe('Reserved Log Levels', () => {
    beforeEach(() => {
        scribbles.config({
            stdOut: null,
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should throw when using "config" as level', () => {
        expect(() => {
            scribbles.config({
                levels: ['config', 'error', 'warn']
            });
        }).toThrow(/config/);
    });

    it('should throw when using "trace" as level', () => {
        expect(() => {
            scribbles.config({
                levels: ['trace', 'error', 'warn']
            });
        }).toThrow(/trace/);
    });

    it('should throw when using "middleware" as level', () => {
        expect(() => {
            scribbles.config({
                levels: ['middleware', 'error']
            });
        }).toThrow(/middleware/);
    });

    // Note: timer, timerEnd, status, and group are reserved (issue #24, #13)
    it('should reject timer as a log level (reserved)', () => {
        expect(() => {
            scribbles.config({
                levels: ['timer', 'error', 'warn', 'log'],
                logLevel: 'log'
            });
        }).toThrow(/timer/);
    });

    it('should reject status as a log level (reserved)', () => {
        expect(() => {
            scribbles.config({
                levels: ['status', 'error', 'warn', 'log'],
                logLevel: 'log'
            });
        }).toThrow(/status/);
    });

    it('should reject group as a log level (reserved)', () => {
        expect(() => {
            scribbles.config({
                levels: ['group', 'error', 'warn', 'log'],
                logLevel: 'log'
            });
        }).toThrow(/group/);
    });
});

describe('Timer Error Handling', () => {
    beforeEach(() => {
        scribbles.config({
            stdOut: null,
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should throw when timerEnd called on non-existent timer', () => {
        expect(() => {
            scribbles.timerEnd('never-started');
        }).toThrow(/never-started/);
    });
});

describe('Empty Arguments', () => {
    let logs = [];

    beforeEach(() => {
        logs = [];
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should handle log with no arguments', () => {
        const result = scribbles.log();
        expect(result).toBeDefined();
    });

    it('should handle log with undefined', () => {
        const result = scribbles.log(undefined);
        expect(result.input.value).toBe(undefined);
    });

    it('should handle log with null', () => {
        const result = scribbles.log(null);
        expect(result.input.value).toBe(null);
    });

    it('should handle log with empty string', () => {
        const result = scribbles.log('');
        expect(result.input.message).toBe('');
    });

    it('should handle log with empty object', () => {
        const result = scribbles.log({});
        expect(result.input.value).toEqual({});
    });

    it('should handle log with empty array', () => {
        const result = scribbles.log([]);
        expect(result.input.value).toEqual([]);
    });
});

describe('JSON-like Strings', () => {
    let stdOutCalls = [];

    beforeEach(() => {
        stdOutCalls = [];
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should prefix string starting with {', () => {
        scribbles.log('{looks like json}');
        expect(stdOutCalls[0]).toContain('String"');
    });

    it('should prefix string starting with [', () => {
        scribbles.log('[looks like array]');
        expect(stdOutCalls[0]).toContain('String"');
    });

    it('should prefix value string starting with {', () => {
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message} {value}'
        });
        scribbles.log('message', '{json-like value}');
        expect(stdOutCalls[0]).toContain('String"');
    });

    it('should prefix value string starting with [', () => {
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message} {value}'
        });
        scribbles.log('message', '[array-like value]');
        expect(stdOutCalls[0]).toContain('String"');
    });
});

describe('Symbol Handling', () => {
    let logs = [];
    let stdOutCalls = [];

    beforeEach(() => {
        logs = [];
        stdOutCalls = [];
        scribbles.config({
            stdOut: (msg) => stdOutCalls.push(msg),
            dataOut: (data) => logs.push(data),
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message} {value}'
        });
    });

    it('should handle Symbol as message', () => {
        const sym = Symbol('test-symbol');
        const result = scribbles.log(sym);
        // Symbol gets converted via toString for output
        expect(stdOutCalls[0]).toContain('Symbol(test-symbol)');
    });

    it('should handle Symbol as value', () => {
        const sym = Symbol('value-symbol');
        scribbles.log('message', sym);
        expect(stdOutCalls[0]).toContain('Symbol(value-symbol)');
    });
});

describe('Large Values', () => {
    let logs = [];

    beforeEach(() => {
        logs = [];
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should handle very large objects', () => {
        const largeObj = {};
        for (let i = 0; i < 1000; i++) {
            largeObj[`key${i}`] = `value${i}`;
        }

        const result = scribbles.log('large', largeObj);
        expect(result.input.value).toEqual(largeObj);
    });

    it('should handle deeply nested objects', () => {
        let obj = { value: 'leaf' };
        for (let i = 0; i < 50; i++) {
            obj = { nested: obj };
        }

        const result = scribbles.log('deep', obj);
        expect(result.input.value).toBeDefined();
    });

    it('should handle very long strings', () => {
        const longString = 'a'.repeat(10000);
        const result = scribbles.log('long', longString);
        expect(result.input.value).toBe(longString);
    });

    it('should handle large arrays', () => {
        const largeArray = Array.from({ length: 1000 }, (_, i) => i);
        const result = scribbles.log('array', largeArray);
        expect(result.input.value).toEqual(largeArray);
    });
});

describe('Special Numbers', () => {
    let logs = [];

    beforeEach(() => {
        logs = [];
        scribbles.config({
            stdOut: null,
            dataOut: (data) => logs.push(data),
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should handle Infinity', () => {
        const result = scribbles.log('inf', Infinity);
        expect(result.input.value).toBe(Infinity);
    });

    it('should handle -Infinity', () => {
        const result = scribbles.log('neginf', -Infinity);
        expect(result.input.value).toBe(-Infinity);
    });

    it('should handle very large numbers', () => {
        const result = scribbles.log('big', Number.MAX_SAFE_INTEGER);
        expect(result.input.value).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle very small numbers', () => {
        const result = scribbles.log('small', Number.MIN_VALUE);
        expect(result.input.value).toBe(Number.MIN_VALUE);
    });
});

describe('StdOut Errors', () => {
    beforeEach(() => {
        scribbles.config({
            stdOut: null,
            dataOut: null,
            levels: ['error', 'warn', 'log', 'info', 'debug'],
            logLevel: 'debug',
            format: '{message}'
        });
    });

    it('should reject at config time a stdOut object with no function for an enabled level', () => {
        // Was: threw from scribbles.log() later. A missing level is a setup mistake, so it is
        // now rejected when applying the options (see 57-sink-errors-never-reach-the-caller).
        expect(() => {
            scribbles.config({
                stdOut: {
                    error: () => { },
                    // Missing other levels
                },
                dataOut: null,
                levels: ['error', 'warn', 'log'],
                logLevel: 'log',
                format: '{message}'
            });
        }).toThrow(/warn.*not found/);
    });
});

describe('Empty Config', () => {
    it('should handle empty config object', () => {
        expect(() => {
            scribbles.config({});
        }).not.toThrow();
    });
});
