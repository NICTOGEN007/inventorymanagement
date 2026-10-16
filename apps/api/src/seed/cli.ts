import { parseArgs } from 'node:util';
import { formatINR } from '@ims/shared';
import { isProduction } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../db/connect.js';
import { UserModel } from '../models/index.js';
import { DEMO_USERS } from './catalog.js';
import { generateDataset } from './generate.js';
import { resetDatabase, writeDataset } from './write.js';

const USAGE = `Usage: npm run seed -- [--reset] [--days 365] [--seed 2026] [--force]

  --reset   Required when the database already has data: wipes it first.
  --days    Days of sales history to generate, ending today (default 365).
  --seed    Random seed; the same seed gives the same data (default 2026).
  --force   Allow running with NODE_ENV=production.`;

async function main() {
  const { values } = parseArgs({
    options: {
      reset: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      days: { type: 'string', default: '365' },
      seed: { type: 'string', default: '2026' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const days = Number(values.days);
  const seed = Number(values.seed);
  if (!Number.isInteger(days) || !Number.isInteger(seed)) {
    throw new Error(`--days and --seed must be integers\n\n${USAGE}`);
  }
  if (isProduction && !values.force) {
    throw new Error('Refusing to seed with NODE_ENV=production. Pass --force if you are sure.');
  }

  await connectDatabase();
  try {
    if ((await UserModel.estimatedDocumentCount()) > 0 && !values.reset) {
      throw new Error(
        'The database already has data. Run again with --reset to wipe it and reseed.',
      );
    }

    const started = Date.now();
    console.log(`Generating ${days} days of demo data (seed ${seed})…`);
    const data = generateDataset({ days, seed, now: new Date() });
    await resetDatabase();
    await writeDataset(data);

    const revenue = data.sales.reduce((sum, s) => sum + s.grandTotal, 0);
    const lowStock = data.products.filter((p) => p.stock <= p.reorderLevel);
    const onOrder = new Set(
      data.purchaseOrders
        .filter((po) => po.status === 'ordered')
        .flatMap((po) => po.items.map((i) => String(i.product))),
    );
    console.table({
      Products: data.products.length,
      Customers: data.customers.length,
      Suppliers: data.suppliers.length,
      'Sales (invoices)': data.sales.length,
      'Purchase orders': data.purchaseOrders.length,
      Returns: data.saleReturns.length,
      'Stock movements': data.stockMovements.length,
      'At or below reorder level': lowStock.length,
      '…of which not yet ordered': lowStock.filter((p) => !onOrder.has(String(p._id))).length,
    });
    console.log(`Total sales: ${formatINR(revenue)}`);
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)} s.\n\nDemo logins:`);
    console.table(DEMO_USERS.map(({ email, password, role }) => ({ role, email, password })));
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
