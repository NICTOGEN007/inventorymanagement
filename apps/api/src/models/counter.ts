import { model, Schema, type ClientSession } from 'mongoose';

/** Atomic sequence numbers for invoices, purchase orders and returns (one counter per key). */
const counterSchema = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const CounterModel = model('Counter', counterSchema);

/** Returns the next number for `key`, starting at 1. Safe under concurrent requests. */
export async function nextSequence(key: string, session?: ClientSession): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  ).lean();
  return counter!.seq;
}
