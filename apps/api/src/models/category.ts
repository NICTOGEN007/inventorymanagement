import { model, Schema, type InferSchemaType } from 'mongoose';
import { baseOptions } from './common.js';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    isActive: { type: Boolean, default: true },
  },
  baseOptions,
);

// Case-insensitive uniqueness: "Beverages" and "beverages" are the same category.
categorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type Category = InferSchemaType<typeof categorySchema>;
export const CategoryModel = model('Category', categorySchema);
