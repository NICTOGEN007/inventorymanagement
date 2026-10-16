import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

const FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  barcode: 'Barcode',
  email: 'Email',
  name: 'Name',
  phone: 'Phone number',
  invoiceNumber: 'Invoice number',
};

interface DuplicateKeyError {
  code: 11000;
  keyValue?: Record<string, unknown>;
  keyPattern?: Record<string, unknown>;
}

const isDuplicateKeyError = (err: unknown): err is DuplicateKeyError =>
  typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;

/** Converts any thrown error into a consistent JSON shape: { error: { code, message, details? } }. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
    });
    return;
  }

  // Schema rules enforced by the database layer (e.g. a GSTIN that does not match its state).
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(err.errors).map(([path, e]) => ({
      path: path.split('.'),
      message: e.message,
    }));
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: details[0]?.message ?? 'Invalid data', details },
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res
      .status(400)
      .json({ error: { code: 'BAD_REQUEST', message: `Invalid value for ${err.path}` } });
    return;
  }

  // A unique index caught a duplicate (e.g. two products with the same SKU).
  if (isDuplicateKeyError(err)) {
    const field = Object.keys(err.keyValue ?? err.keyPattern ?? {})[0] ?? 'value';
    const message = `${FIELD_LABELS[field] ?? field} is already in use`;
    res
      .status(409)
      .json({ error: { code: 'CONFLICT', message, details: [{ path: [field], message }] } });
    return;
  }

  // Malformed JSON bodies from express.json()
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Malformed JSON body' } });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProduction ? 'Something went wrong' : String((err as Error)?.message ?? err),
    },
  });
};
