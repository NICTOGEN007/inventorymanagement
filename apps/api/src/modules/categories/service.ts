import type { CategoryDto, CategoryInput } from '@ims/shared';
import type { Types } from 'mongoose';
import { CategoryModel, ProductModel, type Category } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { iso, toObjectId } from '../../utils/query.js';

type CategoryDoc = Category & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

function toDto(category: CategoryDoc, productCount: number): CategoryDto {
  return {
    id: String(category._id),
    name: category.name,
    ...(category.description && { description: category.description }),
    isActive: category.isActive ?? true,
    productCount,
    createdAt: iso(category.createdAt),
    updatedAt: iso(category.updatedAt),
  };
}

async function countProducts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await ProductModel.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { category: { $in: ids } } },
    { $group: { _id: '$category', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

export async function listCategories(): Promise<CategoryDto[]> {
  const categories = await CategoryModel.find()
    .collation({ locale: 'en' })
    .sort({ name: 1 })
    .lean<CategoryDoc[]>();
  const counts = await countProducts(categories.map((c) => c._id));
  return categories.map((c) => toDto(c, counts.get(String(c._id)) ?? 0));
}

async function findOr404(id: string) {
  const category = await CategoryModel.findById(toObjectId(id, 'Category not found'));
  if (!category) throw AppError.notFound('Category not found');
  return category;
}

async function dtoFor(category: CategoryDoc) {
  return toDto(category, (await countProducts([category._id])).get(String(category._id)) ?? 0);
}

export async function createCategory(input: CategoryInput): Promise<CategoryDto> {
  const category = await CategoryModel.create(input);
  return dtoFor(category.toObject());
}

export async function updateCategory(
  id: string,
  input: Partial<CategoryInput>,
): Promise<CategoryDto> {
  const category = await findOr404(id);
  category.set(input);
  await category.save();
  return dtoFor(category.toObject());
}

/** Only an unused category can be deleted; otherwise deactivate it so product history stays intact. */
export async function deleteCategory(id: string): Promise<void> {
  const category = await findOr404(id);
  if (await ProductModel.exists({ category: category._id })) {
    throw AppError.conflict(
      'This category has products. Move them or deactivate the category instead.',
    );
  }
  await category.deleteOne();
}
