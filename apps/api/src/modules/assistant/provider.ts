import { AppError } from '../../utils/app-error.js';

/**
 * The language model behind the assistant, kept behind a small interface so another model (or a
 * scripted fake in tests) can be swapped in. A conversation is a list of turns; a model turn can
 * ask for tools to be called, and the results go back in the next user turn.
 */

export type ChatPart =
  | { text: string }
  | { call: { name: string; args: Record<string, unknown> } }
  | { result: { name: string; response: Record<string, unknown> } };

export interface ChatTurn {
  role: 'user' | 'model';
  parts: ChatPart[];
  /** The provider's own parts for a model turn, sent back unchanged (Gemini needs its signatures). */
  raw?: unknown[];
}

/** A JSON Schema subset that function-calling models understand. */
export interface ToolSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolSchema>;
  required?: string[];
  items?: ToolSchema;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolSchema;
}

export interface ChatRequest {
  system: string;
  turns: ChatTurn[];
  tools: ToolSpec[];
}

export interface ChatProvider {
  readonly model: string;
  generate(request: ChatRequest): Promise<ChatTurn>;
}

type GeminiPart = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

const toGemini = (part: ChatPart): GeminiPart =>
  'text' in part
    ? { text: part.text }
    : 'call' in part
      ? { functionCall: { name: part.call.name, args: part.call.args } }
      : { functionResponse: { name: part.result.name, response: part.result.response } };

/** Google Gemini over its REST API (generateContent with function calling). */
export class GeminiProvider implements ChatProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async generate({ system, turns, tools }: ChatRequest): Promise<ChatTurn> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({ role: t.role, parts: t.raw ?? t.parts.map(toGemini) })),
          tools: [{ functionDeclarations: tools }],
          generationConfig: { temperature: 0.2 },
        }),
      });
    } catch {
      throw new AppError(
        503,
        'The AI assistant could not be reached. Try again.',
        'ASSISTANT_UNAVAILABLE',
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (/API_KEY_INVALID|API key not valid/.test(detail)) {
        throw new AppError(
          503,
          'The GEMINI_API_KEY is not valid. Check it in the API settings.',
          'ASSISTANT_UNAVAILABLE',
        );
      }
      const busy = res.status === 429 || res.status === 503;
      throw new AppError(
        503,
        busy
          ? 'The AI assistant is busy (free-tier limit). Try again in a minute.'
          : `The AI assistant returned an error (${res.status}). Check GEMINI_API_KEY and GEMINI_MODEL.`,
        'ASSISTANT_UNAVAILABLE',
      );
    }
    const body = (await res.json()) as {
      candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
    };
    const raw = body.candidates?.[0]?.content?.parts ?? [];
    const parts: ChatPart[] = raw.flatMap((p): ChatPart[] =>
      p.functionCall
        ? [{ call: { name: p.functionCall.name, args: p.functionCall.args ?? {} } }]
        : p.text && !p.thought
          ? [{ text: p.text }]
          : [],
    );
    return { role: 'model', parts, raw };
  }
}
