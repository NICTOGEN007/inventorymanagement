import {
  formatINR,
  type AssistantReplyDto,
  type AssistantStatusDto,
  type RestockPlanDto,
} from '@ims/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, CheckCircle2, KeyRound, RotateCcw, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { ChatMarkdown } from '@/components/ChatMarkdown';
import { PlanStatusBadge } from '@/components/RestockBadges';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch } from '@/lib/api';
import { formatQuantity } from '@/lib/format';
import { useRestockRefresh } from '@/lib/restock';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  plan?: RestockPlanDto;
}

const SUGGESTIONS = [
  'How were sales this week compared with last week?',
  'Which products will run out soon?',
  'What sold most last month, and what made the most profit?',
  'Can you restock based on previous demand? Keep it under ₹50,000',
];

/** The chat survives moving to another page and back (not a reload of a closed tab). */
const STORAGE_KEY = 'assistant-chat';
/** The API takes at most 20 messages; older ones are dropped from what is sent. */
const HISTORY = 19;

function loadChat(): Message[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as Message[]) : [];
  } catch {
    return [];
  }
}

export function AssistantPage() {
  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => apiFetch<AssistantStatusDto>('/assistant/status'),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="AI Assistant"
        description="Ask about sales, profit, stock and GST in plain words, or ask it to prepare a restock plan."
      />
      {status.isPending ? (
        <div className="flex justify-center p-16">
          <Spinner label="Checking the assistant" />
        </div>
      ) : status.isError ? (
        <ErrorAlert>Could not reach the assistant. {(status.error as Error).message}</ErrorAlert>
      ) : status.data.enabled ? (
        <Chat model={status.data.model} />
      ) : (
        <NotSetUp />
      )}
    </div>
  );
}

function NotSetUp() {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-slate-500" aria-hidden />
        <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            The assistant is not set up yet
          </h2>
          <p>
            It runs on Google Gemini. To turn it on, create a free API key in Google AI Studio, add
            it to the API&apos;s{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.env</code> file as{' '}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">GEMINI_API_KEY</code>, and
            restart the API.
          </p>
          <p>
            Everything else, including the forecasts and restock plans on{' '}
            <Link
              to="/restock"
              className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Smart Restock
            </Link>
            , works without it.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Chat({ model }: { model: string }) {
  const [messages, setMessages] = useState<Message[]>(loadChat);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const refresh = useRestockRefresh();

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage may be unavailable (private window); the chat still works.
    }
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages]);

  const send = useMutation({
    mutationFn: (history: Message[]) =>
      apiFetch<AssistantReplyDto>('/assistant/chat', {
        method: 'POST',
        body: {
          messages: history.slice(-HISTORY).map(({ role, content }) => ({ role, content })),
        },
      }),
    onSuccess: (answer) => {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: answer.reply, ...(answer.plan && { plan: answer.plan }) },
      ]);
      if (answer.plan) refresh();
    },
  });

  const ask = (text: string) => {
    const content = text.trim();
    if (!content || send.isPending) return;
    const history: Message[] = [...messages, { role: 'user', content }];
    setMessages(history);
    setDraft('');
    send.mutate(history);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(draft);
    }
  };
  const latestPlan = [...messages].reverse().find((m) => m.plan)?.plan?.id;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800">
        <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Bot className="size-4" aria-hidden />
          Google Gemini ({model})
        </p>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={send.isPending}
            onClick={() => {
              setMessages([]);
              send.reset();
            }}
          >
            <RotateCcw className="size-4" aria-hidden />
            New chat
          </Button>
        )}
      </div>

      <div
        className="space-y-4 px-4 py-5 sm:px-6"
        role="log"
        aria-label="Conversation"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ask anything about the shop. The assistant looks the figures up in StockSmart and
              never makes them up. For example:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm whitespace-pre-wrap text-white">
                <span className="sr-only">You: </span>
                {m.content}
              </p>
            </div>
          ) : (
            <div key={i} className="max-w-[92%] space-y-3">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                <span className="sr-only">Assistant: </span>
                <ChatMarkdown text={m.content} />
              </div>
              {m.plan && <PlanCard plan={m.plan} current={m.plan.id === latestPlan} />}
            </div>
          ),
        )}
        {send.isPending && (
          <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Spinner label="" /> Looking that up…
          </p>
        )}
        {send.isError && (
          <ErrorAlert>
            {send.error instanceof ApiError ? send.error.message : 'The assistant did not answer.'}{' '}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => send.mutate(messages)}
            >
              Try again
            </button>
          </ErrorAlert>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 border-t border-slate-200 px-4 py-3 sm:px-6 dark:border-slate-800"
      >
        <div className="flex-1">
          <label htmlFor="assistant-question" className="sr-only">
            Your question
          </label>
          <Textarea
            id="assistant-question"
            rows={2}
            maxLength={2000}
            placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <Button type="submit" disabled={!draft.trim() || send.isPending} aria-label="Send">
          <SendHorizontal className="size-4" aria-hidden />
        </Button>
      </form>
      <p className="px-4 pb-3 text-xs text-slate-500 sm:px-6 dark:text-slate-400">
        Your questions and the figures the assistant looks up are sent to Google Gemini. It can
        prepare restock plans but never orders anything: only you can confirm a plan.
      </p>
    </Card>
  );
}

/** A plan the assistant prepared, with the one action it cannot take itself: confirming. */
function PlanCard({ plan, current }: { plan: RestockPlanDto; current: boolean }) {
  const { can } = useAuth();
  const refresh = useRestockRefresh();
  const [state, setState] = useState(plan);
  const [confirming, setConfirming] = useState(false);
  const confirm = useMutation({
    mutationFn: () =>
      apiFetch<{ plan: RestockPlanDto }>(`/restock/plans/${plan.id}/confirm`, { method: 'POST' }),
    onSuccess: ({ plan: confirmed }) => {
      setState(confirmed);
      setConfirming(false);
      refresh();
      toast.success(
        `${confirmed.supplierCount} purchase ${confirmed.supplierCount === 1 ? 'order' : 'orders'} placed`,
      );
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(err instanceof ApiError ? err.message : 'Could not confirm the plan');
    },
  });
  const lines = state.groups.flatMap((g) => g.items);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          Restock plan <span className="whitespace-nowrap">{state.planNumber}</span>
        </p>
        <PlanStatusBadge status={state.status} />
      </div>
      <p className="mt-1 text-slate-500 dark:text-slate-400">
        {state.itemCount} {state.itemCount === 1 ? 'item' : 'items'} from {state.supplierCount}{' '}
        {state.supplierCount === 1 ? 'supplier' : 'suppliers'}, {formatINR(state.total)} incl. GST
        {state.budget !== undefined && ` (budget ${formatINR(state.budget)})`}
      </p>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {lines.slice(0, 8).map((l) => (
          <li key={l.product.id} className="flex justify-between gap-4 py-1.5">
            <span>{l.product.name}</span>
            <span className="whitespace-nowrap tabular-nums">
              {formatQuantity(l.quantity, l.product.unit)} · {formatINR(l.total)}
            </span>
          </li>
        ))}
        {lines.length > 8 && (
          <li className="py-1.5 text-slate-500 dark:text-slate-400">and {lines.length - 8} more</li>
        )}
      </ul>
      {!current && state.status === 'draft' && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          An earlier version: the latest is further down.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={`/restock/plans/${state.id}`}
          className={buttonClass({ variant: 'secondary', size: 'sm' })}
        >
          {state.status === 'draft' ? 'Review and edit' : 'Open plan'}{' '}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        {current && state.status === 'draft' && can('purchases:manage') && (
          <Button size="sm" onClick={() => setConfirming(true)}>
            <CheckCircle2 className="size-4" aria-hidden />
            Confirm &amp; place orders
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Confirm and place the orders?"
        confirmLabel={`Place ${state.supplierCount} ${state.supplierCount === 1 ? 'order' : 'orders'}`}
        confirmVariant="primary"
        loading={confirm.isPending}
        onConfirm={() => confirm.mutate()}
        onClose={() => setConfirming(false)}
      >
        This places {state.supplierCount} purchase {state.supplierCount === 1 ? 'order' : 'orders'},{' '}
        {formatINR(state.total)} in all incl. GST, with{' '}
        {state.groups.map((g) => g.supplier.name).join(', ')}.
      </ConfirmDialog>
    </div>
  );
}
