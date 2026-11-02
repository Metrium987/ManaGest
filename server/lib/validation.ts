import { z } from 'zod';
import { ApiError } from './errors';
import { isValidProfitCenter, normaliseProfitCenter } from '../../shared/profit-centers';

/** Validate input and return only stable field/code pairs, never prose. */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      // A custom issue carries a stable code in its message (e.g. 'required'),
      // so field errors stay translated instead of showing 'custom'.
      const code = issue.code === 'custom' ? issue.message : issue.code;
      if (!details[key]) details[key] = code;
    }
    throw new ApiError(422, 'VALIDATION_ERROR', details);
  }
  return result.data;
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date');

export const optionalIsoDate = z
  .union([isoDate, z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

export const email = z.string().trim().toLowerCase().email().max(190);

export const optionalText = (max = 2000) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed === '' ? null : trimmed;
    });

export const requiredText = (min = 1, max = 200) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .transform((value) => value.replace(/\s+/g, ' '));

export const minorAmount = z.coerce.number().int().min(0).max(9_999_999_999);

export const quantity = z.coerce.number().min(0).max(1_000_000);

export const percentRate = z.coerce.number().int().min(0).max(100);

export const lineItemSchema = z.object({
  id: z.string().min(1).max(60),
  product_id: z.string().max(60).nullish(),
  description: z.string().trim().min(1).max(500),
  quantity: quantity,
  unit_price: minorAmount,
  tax_rate: percentRate,
  // Local TVA status (BK-001): exempt lines produce no 0-rate bucket.
  tax_status: z.enum(['taxable', 'exempt']).optional(),
  expertise_level: z.string().trim().max(60).nullish().transform((value) => value ?? null).optional(),
  // Q11: the profit centre is copied onto the line as a snapshot. A code that is no
  // longer in the list is still accepted: an old document keeps what it was issued
  // with, and the format is what protects the report from a stray value.
  profit_center: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((value) => normaliseProfitCenter(value))
    .refine((value) => value === null || isValidProfitCenter(value), { message: 'invalid' })
    .optional(),
});

export const lineItemsSchema = z.array(lineItemSchema).min(1).max(200);

export const discountSchema = {
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: minorAmount.default(0),
};

export const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
};

export function offsetOf(page: number, perPage: number): number {
  return (page - 1) * perPage;
}

export const idParam = z.string().min(8).max(60);
