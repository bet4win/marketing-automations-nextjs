import { beforeEach, describe, expect, it } from 'vitest';
import { ASSISTANT_STORAGE_KEY, assistantStore, checkAddress, defaultModel, serverLabel } from './settings';

describe('assistant settings: the server address', () => {
  it.each([
    ['http://localhost:1234/v1', 'http://localhost:1234/v1'],
    ['http://localhost:1234/v1/', 'http://localhost:1234/v1'],
    ['  http://localhost:11434/v1//  ', 'http://localhost:11434/v1'],
    ['http://127.0.0.1:8080/api/v1', 'http://127.0.0.1:8080/api/v1'],
    ['https://localhost:8443/v1', 'https://localhost:8443/v1'],
    ['http://localhost', 'http://localhost'],
    ['http://localhost/', 'http://localhost'],
    ['HTTP://LocalHost:1234/V1', 'http://localhost:1234/V1'],
    ['http://localhost:01234/v1', 'http://localhost:1234/v1'],
  ])('accepts %s as %s', (input, baseUrl) => {
    expect(checkAddress(input)).toEqual({ ok: true, baseUrl });
  });

  it.each([
    [''],
    ['localhost:1234/v1'],
    ['ftp://localhost:1234'],
    ['http://example.com/v1'],
    ['http://localhost.example.com:1234/v1'],
    ['http://127.0.0.2:1234/v1'],
    ['http://[::1]:1234/v1'],
    ['http://0.0.0.0:1234/v1'],
    ['http://192.168.1.10:1234/v1'],
    ['http://user@localhost:1234/v1'],
    ['http://localhost@evil.example:1234/v1'],
    ['http://localhost:1234/v1?x=1'],
    ['http://localhost:1234/v1#top'],
    ['http://localhost:1234/v 1'],
    ['javascript:alert(1)'],
  ])('refuses %j', (input) => {
    expect(checkAddress(input).ok).toBe(false);
  });

  it('explains what it expects', () => {
    expect(checkAddress('')).toEqual({ ok: false, error: 'Enter the address of your model server.' });
    expect(checkAddress('http://example.com')).toEqual({
      ok: false,
      error: expect.stringContaining('http://localhost:1234/v1') as string,
    });
    expect(checkAddress('http://localhost:70000/v1')).toEqual({
      ok: false,
      error: 'The port must be between 1 and 65535.',
    });
    expect(checkAddress('http://localhost:0/v1').ok).toBe(false);
  });

  it('names the server by host and port', () => {
    expect(serverLabel('http://localhost:1234/v1')).toBe('localhost:1234');
    expect(serverLabel('https://127.0.0.1/v1')).toBe('127.0.0.1');
  });
});

describe('assistant settings: the stored value', () => {
  beforeEach(() => {
    const items = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
      clear: () => items.clear(),
      key: (i: number) => [...items.keys()][i] ?? null,
      get length() { return items.size; },
    };
  });

  it('is off until saved, and stores under lanyard.assistant', () => {
    expect(assistantStore.get()).toBeNull();
    assistantStore.set({ baseUrl: 'http://localhost:1234/v1', model: 'qwen/qwen3.8-27b' });
    expect(JSON.parse(localStorage.getItem(ASSISTANT_STORAGE_KEY) ?? 'null')).toEqual({
      baseUrl: 'http://localhost:1234/v1',
      model: 'qwen/qwen3.8-27b',
    });
    assistantStore.reset();
    expect(localStorage.getItem(ASSISTANT_STORAGE_KEY)).toBeNull();
    expect(assistantStore.get()).toBeNull();
  });

  it.each([
    [{ baseUrl: 'http://evil.example/v1', model: 'm' }],
    [{ baseUrl: 'http://localhost:1234/v1/', model: 'm' }],
    [{ baseUrl: 'http://localhost:1234/v1', model: '' }],
    ['not json'],
  ])('treats a hand-edited entry %j as not set up', (value) => {
    localStorage.setItem(ASSISTANT_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
    expect(assistantStore.get()).toBeNull();
  });
});

describe('assistant settings: the default model', () => {
  it('keeps the saved model, else takes the first that can chat', () => {
    const models = ['text-embedding-nomic-embed-text-v1.5', 'qwen/qwen3.8-27b', 'llama3'];
    expect(defaultModel(models, 'llama3')).toBe('llama3');
    expect(defaultModel(models, 'gone')).toBe('qwen/qwen3.8-27b');
    expect(defaultModel(models)).toBe('qwen/qwen3.8-27b');
    expect(defaultModel(['nomic-embed-text'])).toBe('nomic-embed-text');
    expect(defaultModel([])).toBeUndefined();
  });
});
