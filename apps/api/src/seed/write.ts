import mongoose from 'mongoose';
import {
  CategoryModel,
  CounterModel,
  CustomerModel,
  ProductModel,
  PurchaseOrderModel,
  SaleModel,
  SaleReturnModel,
  SettingsModel,
  StockMovementModel,
  SupplierModel,
  UserModel,
} from '../models/index.js';
import { hashPassword } from '../utils/password.js';
import type { Dataset } from './generate.js';

const ALL_MODELS = [
  SettingsModel,
  UserModel,
  CategoryModel,
  SupplierModel,
  ProductModel,
  CustomerModel,
  PurchaseOrderModel,
  SaleModel,
  SaleReturnModel,
  StockMovementModel,
  CounterModel,
] as const;

/** Drops every collection the app owns and recreates them with their indexes. */
export async function resetDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  for (const model of ALL_MODELS) {
    await model.createCollection();
    await model.syncIndexes();
  }
}

async function insertInBatches<T>(
  model: { insertMany(docs: T[], options: { ordered: boolean }): Promise<unknown> },
  docs: T[],
  batchSize = 2000,
) {
  for (let i = 0; i < docs.length; i += batchSize) {
    await model.insertMany(docs.slice(i, i + batchSize), { ordered: true });
  }
}

/**
 * Inserts a generated dataset. Documents go through Mongoose validation, so the
 * seed data is held to the same rules as data entered through the app.
 */
export async function writeDataset(data: Dataset): Promise<void> {
  const users = await Promise.all(
    data.users.map(async ({ password, ...user }) => ({
      ...user,
      passwordHash: await hashPassword(password),
    })),
  );

  await SettingsModel.create(data.settings);
  await UserModel.insertMany(users);
  await CategoryModel.insertMany(data.categories);
  await SupplierModel.insertMany(data.suppliers);
  await ProductModel.insertMany(data.products);
  await CustomerModel.insertMany(data.customers);
  await insertInBatches(PurchaseOrderModel, data.purchaseOrders);
  await insertInBatches(SaleModel, data.sales);
  await insertInBatches(SaleReturnModel, data.saleReturns);
  await insertInBatches(StockMovementModel, data.stockMovements);
  await CounterModel.insertMany(data.counters);
}
