import type { Request } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { AppError } from './app-error.js';

/** Makes user input safe to use inside a regular expression. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" match. */
export function containsPattern(value: string): RegExp {
  return new RegExp(escapeRegex(value.trim()), 'i');
}

/** Converts a route id to an ObjectId, answering 404 for anything malformed. */
export function toObjectId(id: string, notFoundMessage = 'Not found'): Types.ObjectId {
  if (!isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(id)) throw AppError.notFound(notFoundMessage);
  return new Types.ObjectId(id);
}

export const iso = (date: Date) => date.toISOString();

/** The `:id` route parameter as a string. */
export function idParam(req: Request): string {
  return String(req.params.id);
}
