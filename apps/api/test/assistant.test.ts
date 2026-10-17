import { addDays, gstinCheckCharacter, istDateKey, istDayRange } from '@ims/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  AuditLogModel,
  CategoryModel,
  ProductModel,
  PurchaseOrderModel,
  RestockPlanModel,
  SaleModel,
  SettingsModel,
  StockMovementModel,
  SupplierModel,
} from '../src/models/index.js';
import type { ChatProvider, ChatRequest, ChatTurn } from '../src/modules/assistant/provider.js';
import { setChatProvider } from '../src/modules/assistant/service.js';
import { signedIn } from './helpers/auth.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase({ cleanEach: true });

/** A model that follows a script: each step sees the request and returns the next turn. */
class ScriptedModel implements ChatProvider {
  readonly model = 'scripted';
  readonly requests: ChatRequest[] = [];
  constructor(private readonly steps: ((req: ChatRequest) => ChatTurn)[]) {}
  async generate(req: ChatRequest): Promise<ChatTurn> {
    this.requests.push(structuredClone(req));
    const step = this.steps.shift();
    if (!step) throw new Error('The script ran out');
    return step(req);
  }
}
const say = (text: string): ChatTurn => ({ role: 'model', parts: [{ text }] });
const call = (name: string, args: Record<string, unknown> = {}): ChatTurn => ({
  role: 'model',
  parts: [{ call: { name, args } }],
});
/** The tool results the model was sent in its latest request. */
const lastResults = (req: ChatRequest) =>
  req.turns.at(-1)!.parts.flatMap((p) => ('result' in p ? [p.result] : []));

let app: ReturnType<typeof createApp>;
let manager: string;
let cashier: string;

beforeEach(async () => {
  app = createApp();
  manager = (await signedIn(app, 'manager')).bearer;
  cashier = (await signedIn(app, 'cashier')).bearer;
});
afterEach(() => setChatProvider(undefined));

const ask = (messages: { role: string; content: string }[], auth = manager) =>
  request(app).post('/api/assistant/chat').set('Authorization', auth).send({ messages });
const question = (content: string) => ask([{ role: 'user', content }]);

const today = istDateKey(new Date());

/** Milk sells 20 a day and has 10 left; oil sells 10 a day and has 500. */
async function setup() {
  await SettingsModel.create({
    shopName: 'Demo Mart',
    gstin: `29AABCS1234K1Z${gstinCheckCharacter('29AABCS1234K1Z')}`,
    stateCode: '29',
  });
  const category = await CategoryModel.create({ name: 'Grocery' });
  const dairy = await SupplierModel.create({
    name: 'Greenfield Dairy',
    stateCode: '29',
    leadTimeDays: 2,
  });
  const base = {
    category: category._id,
    hsnCode: '0401',
    unit: 'pcs',
    gstRate: 5,
    costPrice: 4000,
    sellingPrice: 5600,
    reorderLevel: 0,
    preferredSupplier: dairy._id,
  } as const;
  const milk = await ProductModel.create({
    ...base,
    sku: 'DRY-001',
    name: 'Toned Milk 1 L',
    stock: 10,
    packSize: 12,
  });
  const oil = await ProductModel.create({
    ...base,
    sku: 'STP-006',
    name: 'Sunflower Oil 1 L',
    stock: 500,
  });
  const sales = [];
  const movements = [];
  for (let d = 1; d <= 70; d++) {
    const { start } = istDayRange(addDays(today, -d));
    sales.push({
      invoiceNumber: `INV/T/${String(d).padStart(5, '0')}`,
      soldAt: new Date(start.getTime() + 10 * 3_600_000),
      status: 'completed',
      items: [
        { product: milk._id, quantity: 20 },
        { product: oil._id, quantity: 10 },
      ],
    });
    for (const [product, balanceAfter] of [
      [milk._id, 40],
      [oil._id, 500],
    ] as const) {
      movements.push({
        product,
        type: 'sale',
        quantity: -1,
        balanceAfter,
        occurredAt: new Date(start.getTime() + 20 * 3_600_000),
      });
    }
  }
  await SaleModel.collection.insertMany(sales);
  await StockMovementModel.collection.insertMany(movements);
  return { milk, oil };
}

describe('assistant status', () => {
  it('is off without a model, and says how to turn it on', async () => {
    const status = await request(app).get('/api/assistant/status').set('Authorization', manager);
    expect(status.body).toEqual({ enabled: false });
    const res = await question('How were sales?');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'ASSISTANT_DISABLED' });
  });

  it('is for admins and managers only', async () => {
    setChatProvider(new ScriptedModel([]));
    expect(
      (await request(app).get('/api/assistant/status').set('Authorization', cashier)).status,
    ).toBe(403);
    expect((await ask([{ role: 'user', content: 'Hi' }], cashier)).status).toBe(403);
  });
});

describe('answering questions', () => {
  it('looks figures up with tools and answers from them', async () => {
    await setup();
    const model = new ScriptedModel([
      () => call('get_sales_summary', { period: 'last7' }),
      (req) => {
        const [result] = lastResults(req);
        const totals = (result!.response as { totals: { netSales_inr: number; bills: number } })
          .totals;
        return say(`Net sales were ₹${totals.netSales_inr} from ${totals.bills} bills.`);
      },
    ]);
    setChatProvider(model);
    const res = await question('How did we do this week?');
    expect(res.status).toBe(200);
    expect(res.body.toolsUsed).toEqual(['get_sales_summary']);
    // The raw sales rows have no money fields, so the answer reports what the tool found.
    expect(res.body.reply).toMatch(/^Net sales were ₹\d+(\.\d+)? from \d+ bills\.$/);
    expect(res.body.plan).toBeUndefined();

    const first = model.requests[0]!;
    expect(first.system).toContain(`Today is ${today}`);
    expect(first.system).toContain('You cannot confirm a plan or place an order');
    expect(first.tools.map((t) => t.name)).not.toContain('confirm_restock_plan');
    expect(first.turns).toEqual([{ role: 'user', parts: [{ text: 'How did we do this week?' }] }]);
    expect(await AuditLogModel.findOne({ action: 'assistant.chat' }).lean()).toMatchObject({
      details: { tools: ['get_sales_summary'] },
    });
  });

  it('reads the forecasts and passes the conversation so far', async () => {
    await setup();
    const model = new ScriptedModel([
      () => call('get_restock_status'),
      (req) => {
        const products = (
          lastResults(req)[0]!.response as { products: { product: string; status: string }[] }
        ).products;
        return say(products.map((p) => `${p.product}: ${p.status}`).join('\n'));
      },
    ]);
    setChatProvider(model);
    const res = await ask([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi! How can I help?' },
      { role: 'user', content: 'What will run out soon?' },
    ]);
    expect(res.body.reply).toBe('Toned Milk 1 L: reorder');
    expect(model.requests[0]!.turns.map((t) => t.role)).toEqual(['user', 'model', 'user']);
  });

  it('lets the model see a tool error and explain it', async () => {
    await setup();
    const model = new ScriptedModel([
      () => call('get_product_forecast', { product: 'cardamom' }),
      (req) => say(String(lastResults(req)[0]!.response.error)),
    ]);
    setChatProvider(model);
    const res = await question('Forecast for cardamom?');
    expect(res.body.reply).toBe('No product matches "cardamom"');
  });

  it('checks the question', async () => {
    setChatProvider(new ScriptedModel([]));
    const res = await ask([{ role: 'assistant', content: 'Hi' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toBe('The last message must be the question');
  });
});

describe('restock plans from the chat', () => {
  it('prepares a draft but never orders anything', async () => {
    await setup();
    const model = new ScriptedModel([
      () => call('create_restock_plan', { budget_inr: 50000 }),
      (req) => {
        const plan = lastResults(req)[0]!.response as { planNumber: string; note: string };
        return say(`I prepared ${plan.planNumber}. ${plan.note}`);
      },
    ]);
    setChatProvider(model);
    const res = await question('Can you restock based on previous demand? Keep it under ₹50,000');
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({
      status: 'draft',
      source: 'assistant',
      budget: 5_000_000,
      itemCount: 1,
    });
    expect(res.body.plan.total).toBeLessThanOrEqual(5_000_000);
    expect(res.body.reply).toContain(
      'Nothing is ordered until the owner presses "Confirm & place orders"',
    );
    expect(await PurchaseOrderModel.countDocuments()).toBe(0);

    // The next question knows about the draft, and can change it by product name.
    const edit = new ScriptedModel([
      (req) => {
        expect(req.system).toContain(
          `A draft restock plan ${res.body.plan.planNumber} is waiting for review`,
        );
        return call('update_restock_plan', {
          changes: [
            { product: 'toned milk', quantity: 100 },
            { product: 'Sunflower Oil', quantity: 24 },
          ],
        });
      },
      () => say('Done: milk is 100 and oil 24.'),
    ]);
    setChatProvider(edit);
    const changed = await question('Make the milk 100 and add 24 oil');
    const lines = changed.body.plan.groups[0].items.map(
      (i: { product: { name: string }; quantity: number }) => [i.product.name, i.quantity],
    );
    expect(lines).toEqual([
      ['Toned Milk 1 L', 100],
      ['Sunflower Oil 1 L', 24],
    ]);
    expect((await RestockPlanModel.findById(res.body.plan.id).lean())!.status).toBe('draft');
    expect(await PurchaseOrderModel.countDocuments()).toBe(0);
  });
});
