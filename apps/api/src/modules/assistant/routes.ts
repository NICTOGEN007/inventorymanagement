import { assistantChatSchema } from '@ims/shared';
import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { audit } from '../../utils/audit.js';
import * as assistant from './service.js';

export const assistantRouter = Router();
assistantRouter.use(authenticate, requirePermission('assistant:use'));

assistantRouter.get('/status', (_req, res) => {
  res.json(assistant.assistantStatus());
});

// Free-tier models allow only a few requests a minute; this keeps one person from using them up.
const WINDOW_MS = 60_000;
const PER_WINDOW = 15;
const recent = new Map<string, number[]>();

assistantRouter.post('/chat', async (req, res) => {
  const input = assistantChatSchema.parse(req.body);
  const now = Date.now();
  const times = (recent.get(req.user!.id) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= PER_WINDOW) {
    res.status(429).json({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'That is a lot of questions at once. Wait a minute and try again.',
      },
    });
    return;
  }
  recent.set(req.user!.id, [...times, now]);

  const answer = await assistant.chat(input, { id: req.user!.id, role: req.user!.role });
  // Which tools were used, not what was asked: the questions can contain anything.
  await audit(req, 'assistant.chat', 'Assistant', undefined, {
    tools: answer.toolsUsed,
    ...(answer.plan && { plan: answer.plan.planNumber }),
  });
  res.json(answer);
});
