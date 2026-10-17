import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/modules/assistant/provider.js';

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) =>
  vi.fn(
    async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );

const request = {
  system: 'Be helpful.',
  tools: [
    {
      name: 'get_sales_summary',
      description: 'Sales',
      parameters: { type: 'object' as const, properties: {} },
    },
  ],
  turns: [
    { role: 'user' as const, parts: [{ text: 'How were sales?' }] },
    {
      role: 'model' as const,
      parts: [{ call: { name: 'get_sales_summary', args: {} } }],
      raw: [{ functionCall: { name: 'get_sales_summary', args: {} }, thoughtSignature: 'sig' }],
    },
    {
      role: 'user' as const,
      parts: [{ result: { name: 'get_sales_summary', response: { netSales_inr: 100 } } }],
    },
  ],
};

describe('Gemini provider', () => {
  it('sends the system prompt, the turns and the tools, and reads the answer', async () => {
    const fetch = reply(200, {
      candidates: [
        {
          content: { parts: [{ text: 'Thinking…', thought: true }, { text: 'Sales were ₹100.' }] },
        },
      ],
    });
    vi.stubGlobal('fetch', fetch);
    const turn = await new GeminiProvider('key-1', 'gemini-2.5-flash').generate(request);
    expect(turn.parts).toEqual([{ text: 'Sales were ₹100.' }]);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('key-1');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be helpful.' }] });
    expect(body.tools[0].functionDeclarations[0].name).toBe('get_sales_summary');
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'How were sales?' }] },
      // The model's own parts go back unchanged, signature included.
      {
        role: 'model',
        parts: [{ functionCall: { name: 'get_sales_summary', args: {} }, thoughtSignature: 'sig' }],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_sales_summary', response: { netSales_inr: 100 } } },
        ],
      },
    ]);
  });

  it('turns function calls into tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, {
        candidates: [{ content: { parts: [{ functionCall: { name: 'get_stock_value' } }] } }],
      }),
    );
    const turn = await new GeminiProvider('k', 'm').generate(request);
    expect(turn.parts).toEqual([{ call: { name: 'get_stock_value', args: {} } }]);
  });

  it('explains a busy model and a bad key', async () => {
    vi.stubGlobal('fetch', reply(429, { error: { status: 'RESOURCE_EXHAUSTED' } }));
    await expect(new GeminiProvider('k', 'm').generate(request)).rejects.toMatchObject({
      statusCode: 503,
      message: 'The AI assistant is busy (free-tier limit). Try again in a minute.',
    });
    vi.stubGlobal(
      'fetch',
      reply(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }),
    );
    await expect(new GeminiProvider('k', 'm').generate(request)).rejects.toMatchObject({
      message: 'The GEMINI_API_KEY is not valid. Check it in the API settings.',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('network'))),
    );
    await expect(new GeminiProvider('k', 'm').generate(request)).rejects.toMatchObject({
      message: 'The AI assistant could not be reached. Try again.',
    });
  });
});
