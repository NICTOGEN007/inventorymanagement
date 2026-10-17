import {
  formatINR,
  istDateKey,
  type AssistantChatInput,
  type AssistantReplyDto,
  type Role,
} from '@ims/shared';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/app-error.js';
import { logger } from '../../utils/logger.js';
import { getShopSettings } from '../settings/service.js';
import { GeminiProvider, type ChatProvider, type ChatTurn } from './provider.js';
import { currentDraft, TOOLS, type ToolContext } from './tools.js';

/** The model may call tools this many times in a row before it must answer. */
const MAX_STEPS = 6;

let provider: ChatProvider | undefined = env.GEMINI_API_KEY
  ? new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL)
  : undefined;

/** Replaces the model (tests use a scripted one); undefined turns the assistant off. */
export function setChatProvider(next: ChatProvider | undefined) {
  provider = next;
}

export function assistantStatus() {
  return provider ? { enabled: true as const, model: provider.model } : { enabled: false as const };
}

async function systemPrompt() {
  const [settings, draft] = await Promise.all([getShopSettings(), currentDraft()]);
  const today = istDateKey(new Date());
  return [
    `You are the assistant inside StockSmart, the inventory and billing system of ${settings.shopName}, a retail shop in India.`,
    `Today is ${today} (Indian Standard Time). The financial year runs from 1 April to 31 March.`,
    'Answer questions about sales, profit, stock, GST and what to reorder, using the tools. Never invent or estimate a figure that a tool did not give you; if no tool covers a question, say so.',
    'Amounts are in Indian rupees: write them like ₹1,23,456.50 (Indian digit grouping). Keep answers short and plain, for a shopkeeper: a sentence or two, or a short list. Use **bold** sparingly.',
    'You can prepare a draft restock plan (create_restock_plan) and change it (update_restock_plan). You cannot confirm a plan or place an order: tell the owner to check the plan and press "Confirm & place orders". Never say that anything has been ordered.',
    draft
      ? `A draft restock plan ${draft.planNumber} is waiting for review: ${draft.itemCount} items, ${formatINR(draft.total)}. "The plan" means this one.`
      : 'No restock plan is waiting for review.',
  ].join('\n');
}

/**
 * Answers one message. The conversation so far comes from the browser (text only); the model
 * calls tools as it needs, and their results go back to it until it answers.
 */
export async function chat(
  input: AssistantChatInput,
  user: { id: string; role: Role },
): Promise<AssistantReplyDto> {
  if (!provider) {
    throw new AppError(
      503,
      'The AI assistant is not set up. Add GEMINI_API_KEY to the API settings.',
      'ASSISTANT_DISABLED',
    );
  }
  const turns: ChatTurn[] = input.messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
  const ctx: ToolContext = { user };
  const used: string[] = [];
  const system = await systemPrompt();
  const tools = TOOLS.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));

  for (let step = 0; step < MAX_STEPS; step++) {
    const answer = await provider.generate({ system, turns, tools });
    turns.push(answer);
    const calls = answer.parts.flatMap((p) => ('call' in p ? [p.call] : []));
    if (calls.length === 0) {
      const reply = answer.parts
        .flatMap((p) => ('text' in p ? [p.text] : []))
        .join('')
        .trim();
      return {
        reply: reply || 'Sorry, I could not find an answer to that. Try asking another way.',
        toolsUsed: used,
        ...(ctx.plan && { plan: ctx.plan }),
      };
    }
    const results = [];
    for (const call of calls) {
      used.push(call.name);
      const tool = TOOLS.find((t) => t.name === call.name);
      let response: Record<string, unknown>;
      try {
        if (!tool) throw AppError.badRequest(`There is no tool called ${call.name}`);
        response = await tool.run(call.args, ctx);
      } catch (err) {
        // The model sees the problem and can explain it or try again.
        response = { error: err instanceof AppError ? err.message : 'That lookup failed' };
        if (!(err instanceof AppError))
          logger.error({ err, tool: call.name }, 'Assistant tool failed');
      }
      results.push({ result: { name: call.name, response } });
    }
    turns.push({ role: 'user', parts: results });
  }
  return {
    reply: 'That needed more steps than I can take at once. Could you ask a narrower question?',
    toolsUsed: used,
    ...(ctx.plan && { plan: ctx.plan }),
  };
}
