import { z } from 'zod';

/** The conversation so far, as the browser keeps it; the newest message is the user's. */
export const assistantChatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z
          .string()
          .trim()
          .min(1, 'Type a question')
          .max(2000, 'Keep it under 2,000 characters'),
      }),
    )
    .min(1)
    .max(20, 'Start a new chat: at most 20 messages')
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be the question'),
});
export type AssistantChatInput = z.output<typeof assistantChatSchema>;
