import { zodResolver } from '@hookform/resolvers/zod';
import {
  formatINR,
  GST_RATES,
  priceBreakdown,
  productCreateSchema,
  rupeesToPaise,
  UNITS,
  type GstRate,
  type ProductDto,
} from '@ims/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorAlert } from '@/components/ui/Alert';
import { Button, buttonClass } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input, Select } from '@/components/ui/Input';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError, apiFetch, fieldErrors } from '@/lib/api';
import { paiseToInput } from '@/lib/format';
import { useCategories, useSuppliers } from '@/lib/queries';

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const QUANTITY = /^\d+(\.\d{1,3})?$/;

/** What the form holds: text for amounts and quantities, exactly as typed. */
const formSchema = z.object({
  name: z.string(),
  sku: z.string(),
  barcode: z.string(),
  category: z.string().min(1, 'Choose a category'),
  brand: z.string(),
  unit: z.string(),
  description: z.string(),
  hsnCode: z.string(),
  gstRate: z.string().min(1, 'Choose a GST rate'),
  costPrice: z.string().trim().regex(AMOUNT, 'Enter an amount like 120 or 120.50'),
  sellingPrice: z.string().trim().regex(AMOUNT, 'Enter an amount like 120 or 120.50'),
  mrp: z
    .string()
    .trim()
    .refine((v) => v === '' || AMOUNT.test(v), 'Enter an amount like 120 or 120.50'),
  taxInclusive: z.boolean(),
  reorderLevel: z.string().trim().regex(QUANTITY, 'Enter a number'),
  reorderQuantity: z.string().trim().regex(QUANTITY, 'Enter a number'),
  packSize: z.string().trim().regex(/^\d+$/, 'Enter a whole number'),
  openingStock: z.string().trim().regex(QUANTITY, 'Enter a number'),
  preferredSupplier: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

/** Converts form text to the API's shape (paise, numbers). Empty optional fields stay "". */
function toPayload(v: FormValues) {
  return {
    name: v.name,
    sku: v.sku,
    barcode: v.barcode,
    category: v.category,
    brand: v.brand,
    unit: v.unit,
    description: v.description,
    hsnCode: v.hsnCode,
    gstRate: Number(v.gstRate),
    costPrice: rupeesToPaise(Number(v.costPrice)),
    sellingPrice: rupeesToPaise(Number(v.sellingPrice)),
    mrp: v.mrp === '' ? '' : rupeesToPaise(Number(v.mrp)),
    taxInclusive: v.taxInclusive,
    reorderLevel: Number(v.reorderLevel),
    reorderQuantity: Number(v.reorderQuantity),
    packSize: Number(v.packSize),
    openingStock: Number(v.openingStock),
    preferredSupplier: v.preferredSupplier,
  };
}

// Form-level checks first, then exactly the rules the API applies (barcode check digit, MRP, …).
const resolverSchema = formSchema.transform((values, ctx) => {
  const result = productCreateSchema.safeParse(toPayload(values));
  if (result.success) return result.data;
  for (const issue of result.error.issues)
    ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
  return z.NEVER;
});

const EMPTY: FormValues = {
  name: '',
  sku: '',
  barcode: '',
  category: '',
  brand: '',
  unit: 'pcs',
  description: '',
  hsnCode: '',
  gstRate: '',
  costPrice: '',
  sellingPrice: '',
  mrp: '',
  taxInclusive: true,
  reorderLevel: '10',
  reorderQuantity: '24',
  packSize: '1',
  openingStock: '0',
  preferredSupplier: '',
};

function fromProduct(p: ProductDto): FormValues {
  return {
    name: p.name,
    sku: p.sku,
    barcode: p.barcode ?? '',
    category: p.category.id,
    brand: p.brand ?? '',
    unit: p.unit,
    description: p.description ?? '',
    hsnCode: p.hsnCode,
    gstRate: String(p.gstRate),
    costPrice: paiseToInput(p.costPrice),
    sellingPrice: paiseToInput(p.sellingPrice),
    mrp: paiseToInput(p.mrp),
    taxInclusive: p.taxInclusive,
    reorderLevel: String(p.reorderLevel),
    reorderQuantity: String(p.reorderQuantity),
    packSize: String(p.packSize),
    openingStock: '0',
    preferredSupplier: p.preferredSupplier?.id ?? '',
  };
}

export function ProductFormPage() {
  const { id } = useParams();
  const product = useQuery({
    queryKey: ['product', id],
    queryFn: () => apiFetch<{ product: ProductDto }>(`/products/${id}`),
    enabled: !!id,
  });

  if (id && product.isPending) {
    return (
      <div className="flex justify-center p-10">
        <Spinner label="Loading product" />
      </div>
    );
  }
  if (id && product.isError)
    return <ErrorAlert>Could not load the product. {(product.error as Error).message}</ErrorAlert>;
  return <ProductForm key={id ?? 'new'} product={product.data?.product} />;
}

function ProductForm({ product }: { product?: ProductDto }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const categories = useCategories();
  const suppliers = useSuppliers({ enabled: can('purchases:read') });
  const [serverError, setServerError] = useState<string | null>(null);
  const isEdit = !!product;

  const form = useForm<FormValues, unknown, z.output<typeof resolverSchema>>({
    resolver: zodResolver(resolverSchema),
    defaultValues: product ? fromProduct(product) : EMPTY,
  });
  const { errors, isSubmitting } = form.formState;

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      const { openingStock, ...payload } = toPayload(values);
      if (isEdit) {
        // Empty optional fields are sent as null so the API removes them.
        const changes = Object.fromEntries(
          Object.entries(payload).map(([k, v]) => [k, v === '' ? null : v]),
        );
        return apiFetch<{ product: ProductDto }>(`/products/${product.id}`, {
          method: 'PATCH',
          body: changes,
        });
      }
      return apiFetch<{ product: ProductDto }>('/products', {
        method: 'POST',
        body: { ...payload, openingStock },
      });
    },
    onSuccess: ({ product: saved }) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.setQueryData(['product', saved.id], { product: saved });
      toast.success(isEdit ? 'Product updated' : `${saved.name} added`);
      navigate(`/products/${saved.id}`);
    },
    onError: (err) => {
      const fields = fieldErrors(err);
      for (const [field, message] of Object.entries(fields)) {
        if (field in EMPTY)
          form.setError(field as keyof FormValues, { message }, { shouldFocus: true });
      }
      if (Object.keys(fields).length === 0) {
        setServerError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
      }
    },
  });

  const onSubmit = form.handleSubmit(async () => {
    setServerError(null);
    await save.mutateAsync(form.getValues()).catch(() => undefined);
  });

  const backTo = isEdit ? `/products/${product.id}` : '/products';

  return (
    <form noValidate onSubmit={onSubmit} className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {isEdit ? 'Back to product' : 'Products'}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {isEdit ? `Edit ${product.name}` : 'Add product'}
        </h1>
      </div>

      {serverError && <ErrorAlert>{serverError}</ErrorAlert>}

      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Product name" error={errors.name?.message}>
              <Input placeholder="e.g. Basmati Rice 5 kg" {...form.register('name')} />
            </Field>
          </div>
          <Field label="SKU" error={errors.sku?.message} hint="Your own short code, e.g. STP-011.">
            <Input className="uppercase" autoComplete="off" {...form.register('sku')} />
          </Field>
          <Field
            label="Barcode (optional)"
            error={errors.barcode?.message}
            hint="Scan or type the EAN/UPC on the pack."
          >
            <Input inputMode="numeric" autoComplete="off" {...form.register('barcode')} />
          </Field>
          <Field label="Category" error={errors.category?.message}>
            <Select {...form.register('category')}>
              <option value="">Choose…</option>
              {categories.data
                ?.filter((c) => c.isActive || c.id === product?.category.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Brand (optional)" error={errors.brand?.message}>
            <Input {...form.register('brand')} />
          </Field>
          <Field label="Unit" error={errors.unit?.message} hint="How it is counted and sold.">
            <Select {...form.register('unit')}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description (optional)" error={errors.description?.message}>
              <Textarea {...form.register('description')} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Price and GST">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="HSN code"
            error={errors.hsnCode?.message}
            hint="Printed on GST invoices (4, 6 or 8 digits)."
          >
            <Input inputMode="numeric" {...form.register('hsnCode')} />
          </Field>
          <Field label="GST rate" error={errors.gstRate?.message}>
            <Select {...form.register('gstRate')}>
              <option value="">Choose…</option>
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%{r === 0 ? ' (exempt)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Selling price" error={errors.sellingPrice?.message}>
            <MoneyInput {...form.register('sellingPrice')} />
          </Field>
          <Field
            label="MRP (optional)"
            error={errors.mrp?.message}
            hint="Maximum retail price printed on the pack."
          >
            <MoneyInput {...form.register('mrp')} />
          </Field>
          <Field
            label="Cost price (excl. GST)"
            error={errors.costPrice?.message}
            hint="What you pay the supplier per unit, before GST."
          >
            <MoneyInput {...form.register('costPrice')} />
          </Field>
          <label className="flex items-start gap-3 self-center text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600"
              {...form.register('taxInclusive')}
            />
            <span>
              <span className="font-medium">Selling price includes GST</span>
              <span className="block text-slate-500 dark:text-slate-400">
                Usual for retail (MRP-style) pricing.
              </span>
            </span>
          </label>
        </div>
        <PriceSummary control={form.control} />
      </Section>

      <Section title="Stock and reordering">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!isEdit && (
            <Field
              label="Opening stock"
              error={errors.openingStock?.message}
              hint="Already on the shelf today."
            >
              <Input inputMode="decimal" {...form.register('openingStock')} />
            </Field>
          )}
          <Field
            label="Reorder level"
            error={errors.reorderLevel?.message}
            hint="Alert when stock falls to this."
          >
            <Input inputMode="decimal" {...form.register('reorderLevel')} />
          </Field>
          <Field
            label="Reorder quantity"
            error={errors.reorderQuantity?.message}
            hint="Usual quantity to order."
          >
            <Input inputMode="decimal" {...form.register('reorderQuantity')} />
          </Field>
          <Field
            label="Pack size"
            error={errors.packSize?.message}
            hint="Restock orders round up to whole packs."
          >
            <Input inputMode="numeric" {...form.register('packSize')} />
          </Field>
          {can('purchases:read') && (
            <div className="sm:col-span-2 lg:col-span-4">
              <Field
                label="Preferred supplier (optional)"
                error={errors.preferredSupplier?.message}
              >
                <Select {...form.register('preferredSupplier')}>
                  <option value="">None</option>
                  {suppliers.data
                    ?.filter((s) => s.isActive || s.id === product?.preferredSupplier?.id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
          )}
        </div>
        {isEdit && (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Current stock is {product.stock} {product.unit}. Stock changes only through sales,
            purchases and stock adjustments, so every change is recorded.
          </p>
        )}
      </Section>

      <div className="flex justify-end gap-2">
        <Link to={backTo} className={buttonClass({ variant: 'secondary' })}>
          Cancel
        </Link>
        <Button type="submit" loading={isSubmitting}>
          {isEdit ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-6">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

/** Live breakdown of the price as the user types, the way it will appear on an invoice. */
function PriceSummary({
  control,
}: {
  control: Control<FormValues, unknown, z.output<typeof resolverSchema>>;
}) {
  const [sellingPrice, costPrice, gstRate, taxInclusive] = useWatch({
    control,
    name: ['sellingPrice', 'costPrice', 'gstRate', 'taxInclusive'],
  });
  if (!AMOUNT.test(sellingPrice.trim()) || gstRate === '') return null;
  const b = priceBreakdown({
    sellingPrice: rupeesToPaise(Number(sellingPrice)),
    costPrice: AMOUNT.test(costPrice.trim()) ? rupeesToPaise(Number(costPrice)) : 0,
    gstRate: Number(gstRate) as GstRate,
    taxInclusive,
  });
  const hasCost = AMOUNT.test(costPrice.trim());

  return (
    <dl
      className="mt-6 grid grid-cols-2 gap-4 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-4 dark:bg-slate-800/50"
      aria-label="Price breakdown"
    >
      <div>
        <dt className="text-slate-500 dark:text-slate-400">Before GST</dt>
        <dd className="mt-1 font-medium tabular-nums">{formatINR(b.taxable)}</dd>
      </div>
      <div>
        <dt className="text-slate-500 dark:text-slate-400">GST ({gstRate}%)</dt>
        <dd className="mt-1 font-medium tabular-nums">{formatINR(b.gst)}</dd>
      </div>
      <div>
        <dt className="text-slate-500 dark:text-slate-400">Customer pays</dt>
        <dd className="mt-1 font-medium tabular-nums">{formatINR(b.priceWithTax)}</dd>
      </div>
      <div>
        <dt className="text-slate-500 dark:text-slate-400">Your margin</dt>
        <dd
          className={`mt-1 font-medium tabular-nums ${hasCost && b.margin < 0 ? 'text-rose-600' : ''}`}
        >
          {hasCost
            ? `${formatINR(b.margin)}${b.marginPercent !== null ? ` (${b.marginPercent}%)` : ''}`
            : '—'}
        </dd>
      </div>
    </dl>
  );
}
