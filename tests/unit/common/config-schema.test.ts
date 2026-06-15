import { describe, expect, test } from 'bun:test';
import { defineConfig, validateConfig } from '../../../src/common/config-schema';
import { InvalidArgumentError } from '../../../src/common/errors';

describe('validateConfig — engine field', () => {
  test('omits engine when absent (default = system behaviour, no key)', () => {
    expect(validateConfig({ name: 'A' })).toEqual({ name: 'A' });
  });

  test('accepts engine.webkit as a full id', () => {
    const id = 'webkitgtk-6.0-2.52.4-bunmaska1-linux-x64';
    expect(validateConfig({ engine: { webkit: id } })).toEqual({ engine: { webkit: id } });
  });

  test("accepts engine.webkit = 'system' and a bare upstream version", () => {
    expect(validateConfig({ engine: { webkit: 'system' } })).toEqual({
      engine: { webkit: 'system' },
    });
    expect(validateConfig({ engine: { webkit: '2.52.4' } })).toEqual({
      engine: { webkit: '2.52.4' },
    });
  });

  test('accepts engine.embed boolean', () => {
    expect(validateConfig({ engine: { embed: true } })).toEqual({ engine: { embed: true } });
  });

  test('drops an empty engine object to an empty object', () => {
    expect(validateConfig({ engine: {} })).toEqual({ engine: {} });
  });

  test('rejects a non-object engine', () => {
    expect(() => validateConfig({ engine: 'system' })).toThrow(InvalidArgumentError);
  });

  test('rejects a non-string engine.webkit', () => {
    expect(() => validateConfig({ engine: { webkit: 6 } })).toThrow(InvalidArgumentError);
  });

  test('rejects a non-boolean engine.embed', () => {
    expect(() => validateConfig({ engine: { embed: 'yes' } })).toThrow(InvalidArgumentError);
  });

  test('defineConfig passes an engine config through untouched', () => {
    const cfg = defineConfig({ engine: { webkit: '2.52.4', embed: false } });
    expect(cfg.engine).toEqual({ webkit: '2.52.4', embed: false });
  });
});
