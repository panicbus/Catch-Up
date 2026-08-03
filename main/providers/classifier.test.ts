import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classifyOffTopic, isAiConfigured, type ProviderConfig } from './classifier';

const ITEMS = [
  { id: 'a1', title: 'Virginia Tech wins football game', snippet: null },
  { id: 'a2', title: 'Apple unveils new chip', snippet: null },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('isAiConfigured', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is false for null/undefined config', () => {
    expect(isAiConfigured(null)).toBe(false);
    expect(isAiConfigured(undefined)).toBe(false);
  });

  it('gemini/groq need a key (explicit or env)', () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    expect(isAiConfigured({ provider: 'gemini' })).toBe(false);
    expect(isAiConfigured({ provider: 'gemini', apiKey: 'k' })).toBe(true);
    process.env.GEMINI_API_KEY = 'env-key';
    expect(isAiConfigured({ provider: 'gemini' })).toBe(true);

    expect(isAiConfigured({ provider: 'groq' })).toBe(false);
    expect(isAiConfigured({ provider: 'groq', apiKey: 'k' })).toBe(true);
  });

  it('ollama needs a non-blank model name, no key', () => {
    expect(isAiConfigured({ provider: 'ollama' })).toBe(false);
    expect(isAiConfigured({ provider: 'ollama', ollamaModel: '  ' })).toBe(false);
    expect(isAiConfigured({ provider: 'ollama', ollamaModel: 'qwen2.5:7b' })).toBe(true);
  });
});

describe('classifyOffTopic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gemini: parses the candidates[0].content.parts[0].text shape', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{"remove":["a1"]}' }] } }] }));
    const config: ProviderConfig = { provider: 'gemini', apiKey: 'k' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toEqual(new Set(['a1']));
  });

  it('groq: parses the choices[0].message.content shape', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"remove":["a1"]}' } }] }));
    const config: ProviderConfig = { provider: 'groq', apiKey: 'k' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toEqual(new Set(['a1']));
    const [, requestInit] = vi.mocked(fetch).mock.calls[0];
    expect((requestInit as RequestInit).headers).toMatchObject({ authorization: 'Bearer k' });
  });

  it('ollama: parses the message.content shape and disables streaming', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: { content: '{"remove":["a1"]}' } }));
    const config: ProviderConfig = { provider: 'ollama', ollamaModel: 'qwen2.5:7b' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toEqual(new Set(['a1']));
    const [url, requestInit] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse((requestInit as RequestInit).body as string);
    expect(body.stream).toBe(false);
    expect(body.model).toBe('qwen2.5:7b');
  });

  it('only honors ids present in the input (no hallucinated id can affect anything)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{"remove":["a1","made-up-id"]}' }] } }] }));
    const config: ProviderConfig = { provider: 'gemini', apiKey: 'k' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toEqual(new Set(['a1']));
  });

  it('malformed JSON from the model is treated as unavailable (null), not thrown', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }));
    const config: ProviderConfig = { provider: 'gemini', apiKey: 'k' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toBeNull();
  });

  it('a non-2xx response is treated as unavailable (null) for every provider', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false, 429));
    for (const config of [
      { provider: 'gemini', apiKey: 'k' },
      { provider: 'groq', apiKey: 'k' },
      { provider: 'ollama', ollamaModel: 'qwen2.5:7b' },
    ] satisfies ProviderConfig[]) {
      const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
      expect(result).toBeNull();
    }
  });

  it('a network error is treated as unavailable (null), never throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    const config: ProviderConfig = { provider: 'ollama', ollamaModel: 'qwen2.5:7b' };
    const result = await classifyOffTopic({ items: ITEMS, channelName: 'Tech', subchannelName: null, config });
    expect(result).toBeNull();
  });

  it('no key/model configured returns null without ever calling fetch', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await classifyOffTopic({
      items: ITEMS,
      channelName: 'Tech',
      subchannelName: null,
      config: { provider: 'gemini' },
    });
    expect(result).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an empty item list short-circuits to an empty set without calling fetch', async () => {
    const result = await classifyOffTopic({
      items: [],
      channelName: 'Tech',
      subchannelName: null,
      config: { provider: 'gemini', apiKey: 'k' },
    });
    expect(result).toEqual(new Set());
    expect(fetch).not.toHaveBeenCalled();
  });
});
