# REST API Reference

Base URL: `/api`. All requests and responses are JSON. Except for sign-in and health, every
endpoint needs `Authorization: Bearer <access token>` (see [AUTH.md](AUTH.md)).

**Money** is always an integer number of **paise** (₹617.00 = `61700`). **Dates** are ISO 8601 in UTC.

## Errors

Every error has the same shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": [{ "path": ["sku"], "message": "…" }]
  }
}
```

| Status | Code                                                | When                                                                             |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`                                  | Input failed validation; `details` lists each field                              |
| 400    | `BAD_REQUEST`                                       | Malformed JSON or a business rule (e.g. self-demotion)                           |
| 401    | `UNAUTHORIZED`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, … | Not signed in or session ended                                                   |
| 403    | `FORBIDDEN`                                         | Signed in, but the role lacks the permission                                     |
| 404    | `NOT_FOUND`                                         | Unknown id or route                                                              |
| 409    | `CONFLICT`                                          | Duplicate value (`details` names the field) or a delete that would break history |
| 429    | `RATE_LIMITED`                                      | Too many failed sign-ins                                                         |

Lists that can grow large are paginated: `?page=1&pageSize=20` (max 100), returning
`{ data, page, pageSize, total }`.

## Health

| Method | Path      | Permission | Description                                              |
| ------ | --------- | ---------- | -------------------------------------------------------- |
| GET    | `/health` | —          | `200 { status: "ok" }`, or `503` if the database is down |

## Authentication and users

See [AUTH.md](AUTH.md#api) for `/auth/*` and `/users/*`.

## Categories

| Method | Path              | Permission       | Description                              |
| ------ | ----------------- | ---------------- | ---------------------------------------- |
| GET    | `/categories`     | `products:read`  | All categories with `productCount`       |
| POST   | `/categories`     | `products:write` | `{ name, description? }`                 |
| PATCH  | `/categories/:id` | `products:write` | Any of `name`, `description`, `isActive` |
| DELETE | `/categories/:id` | `products:write` | Only if it has no products (else `409`)  |

## Suppliers

| Method | Path             | Permission         | Description                                             |
| ------ | ---------------- | ------------------ | ------------------------------------------------------- |
| GET    | `/suppliers`     | `purchases:read`   | All suppliers with `productCount`; `?search=`           |
| GET    | `/suppliers/:id` | `purchases:read`   | One supplier                                            |
| POST   | `/suppliers`     | `purchases:manage` | Create (see fields below)                               |
| PUT    | `/suppliers/:id` | `purchases:manage` | Replace all fields; omitted optional fields are cleared |
| DELETE | `/suppliers/:id` | `purchases:manage` | Only with no products and no purchase orders            |

Fields: `name`, `contactPerson?`, `phone?` (10-digit mobile), `email?`, `gstin?` (checked, and
must match `stateCode`), `stateCode` (GST state code, e.g. `"29"`), `address? { line1, line2,
city, pincode }`, `leadTimeDays` (0–90), `isActive?`.

## Products

| Method | Path                     | Permission       | Description                                                    |
| ------ | ------------------------ | ---------------- | -------------------------------------------------------------- |
| GET    | `/products`              | `products:read`  | Paginated list (filters below)                                 |
| GET    | `/products/lookup?code=` | `products:read`  | Active product by exact barcode or SKU (POS scan)              |
| GET    | `/products/:id`          | `products:read`  | One product                                                    |
| POST   | `/products`              | `products:write` | Create; optional `openingStock` goes to the ledger             |
| PATCH  | `/products/:id`          | `products:write` | Update any field except stock; `null` clears an optional field |

List filters: `search` (name, SKU, barcode, brand), `category`, `supplier`, `stock` (`ok`, `low`,
`out`), `status` (`active` default, `inactive`, `all`), `sort` (`name`, `-name`, `sku`, `stock`,
`-stock`, `sellingPrice`, `-sellingPrice`, `-updatedAt`).

Product fields: `sku` (3–32 letters, digits, dashes; stored upper-case), `barcode?` (EAN-8/UPC-A/
EAN-13/GTIN-14 with a valid check digit), `name`, `description?`, `category`, `brand?`, `unit`,
`hsnCode` (4/6/8 digits), `gstRate` (0, 0.25, 3, 5, 18, 40), `costPrice` (excl. GST),
`sellingPrice`, `mrp?`, `taxInclusive`, `reorderLevel`, `reorderQuantity`, `preferredSupplier?`,
`imageUrl?`, `isActive?`.

Responses also include `stock`, `stockStatus` (`ok` / `low` / `out`), `onOrder` (still to arrive
on open purchase orders) and `category`/`preferredSupplier` as `{ id, name }`.

**Stock is never edited directly.** Sending `stock` to `PATCH` is rejected; stock changes only
through the stock ledger (opening stock, purchases, sales, returns, adjustments).

## Inventory

| Method | Path                     | Permission         | Description                                                                        |
| ------ | ------------------------ | ------------------ | ---------------------------------------------------------------------------------- |
| GET    | `/inventory/movements`   | `inventory:read`   | The stock ledger, newest first (filters below)                                     |
| GET    | `/inventory/summary`     | `reports:read`     | Stock value at cost and selling price, by category; write-offs in the last 30 days |
| POST   | `/inventory/adjustments` | `inventory:adjust` | Stock count or write-off for one or more products                                  |

Movement filters: `product`, `type` (`opening`, `purchase`, `sale`, `sale_return`,
`purchase_return`, `adjustment`), `from` and `to` (IST calendar dates, `YYYY-MM-DD`, inclusive),
`page`, `pageSize` (default 25). Each movement has a signed `quantity`, `balanceAfter`, the
document that caused it as `reference: { kind, number }` (e.g. `INV/26-27/00042`), and who made
it. `unitCost` and `value` are only included for roles with `reports:read`.

Adjustment body:

```json
{
  "reason": "count",
  "note": "Monthly shelf count",
  "items": [
    { "product": "<id>", "mode": "set", "quantity": 20 },
    { "product": "<id>", "mode": "change", "quantity": -1.5 }
  ]
}
```

- `reason`: `count` (stock count correction), `damaged`, `expired`, `lost`, or `other` (needs a
  `note`). Damaged, expired and lost can only remove stock.
- `mode`: `set` records the counted quantity (the API works out the difference); `change` adds
  (+) or removes (−) the given amount.
- Quantities may have decimals only for loose units (kg, g, litre, ml, metre).
- All lines succeed or none do. Lines whose count already matches are reported as `unchanged`
  and nothing is recorded for them. Removing more than is in stock is refused.

**Cost prices** (`costPrice` on products, `unitCost`/`value` on movements, and the summary) are
only returned to roles with `reports:read`, so cashiers never see margins.

## Settings

| Method | Path        | Permission | Description                                                       |
| ------ | ----------- | ---------- | ----------------------------------------------------------------- |
| GET    | `/settings` | signed in  | Shop name, GSTIN, state and document prefixes (read-only for now) |

## Purchase orders

| Method | Path                           | Permission         | Description                                                                     |
| ------ | ------------------------------ | ------------------ | ------------------------------------------------------------------------------- |
| GET    | `/purchase-orders`             | `purchases:read`   | Newest first; `status` (incl. `open`), `supplier`, `search` (PO number), paging |
| GET    | `/purchase-orders/:id`         | `purchases:read`   | Full order with lines, deliveries and supplier                                  |
| POST   | `/purchase-orders`             | `purchases:manage` | Create a draft, or place it straight away (`place: true`)                       |
| PUT    | `/purchase-orders/:id`         | `purchases:manage` | Replace a **draft** (placed orders cannot be edited)                            |
| POST   | `/purchase-orders/:id/place`   | `purchases:manage` | Draft → ordered                                                                 |
| POST   | `/purchase-orders/:id/receive` | `purchases:manage` | Record a delivery (full or partial)                                             |
| POST   | `/purchase-orders/:id/cancel`  | `purchases:manage` | `{ reason }`: cancels, or closes a partly received order                        |

Create / update body:

```json
{
  "supplier": "<id>",
  "items": [{ "product": "<id>", "quantity": 144, "unitCost": 14000 }],
  "expectedAt": "2026-10-20",
  "notes": "Deliver before 10 am",
  "place": true
}
```

- `unitCost` is per unit **excluding GST**, in paise. Each line's GST rate comes from the product.
- GST is **CGST + SGST** when the supplier is in the shop's state, otherwise **IGST**.
- `expectedAt` (IST date) defaults to today plus the supplier's delivery time when the order is placed.
- Numbers follow the financial year: `PO/26-27/00001`.

Receive body: `{ "items": [{ "product": "<id>", "quantity": 100 }], "supplierInvoiceNumber": "KAD/7781", "note": "…" }`.
Receiving adds stock through the ledger (`purchase` movements), refuses more than is still to
arrive, and moves the order to `partially_received` or `received`. Each product's cost price
becomes the **weighted average** of the stock on the shelf and the new goods:

```
new cost = (stock before × old cost + received × order cost) / (stock before + received)
```

| Status               | Meaning                                 | Next                |
| -------------------- | --------------------------------------- | ------------------- |
| `draft`              | Being prepared, not sent                | edit, place, cancel |
| `ordered`            | Sent to the supplier                    | receive, cancel     |
| `partially_received` | Some goods arrived                      | receive, close      |
| `received`           | Everything arrived                      | —                   |
| `closed`             | Partly received; the rest will not come | —                   |
| `cancelled`          | Nothing will arrive                     | —                   |

Quantities still to arrive on `ordered` and `partially_received` orders show as `onOrder` on
products, so the same goods are never ordered twice.

## Sales (point of sale)

| Method | Path                     | Permission     | Description                                                                  |
| ------ | ------------------------ | -------------- | ---------------------------------------------------------------------------- |
| POST   | `/sales`                 | `sales:create` | Bill a customer: prices, GST, invoice number and stock in one transaction    |
| GET    | `/sales`                 | `sales:read`   | Newest first; `from`/`to` (IST dates), `search`, `method`, `cashier`, paging |
| GET    | `/sales/:id`             | `sales:read`   | Full invoice with lines, tax and payments                                    |
| GET    | `/sales/:id/invoice.pdf` | `sales:read`   | GST tax invoice as a PDF (A4)                                                |

Body:

```json
{
  "items": [{ "product": "<id>", "quantity": 2, "discount": 1000 }],
  "customer": "<id>",
  "payments": [
    { "method": "cash", "amount": 50000 },
    { "method": "upi", "amount": 73400, "reference": "UPI123456" }
  ],
  "clientRef": "f3c1b2a4-0d5e-4f6a-8b7c-9d0e1f2a3b4c"
}
```

- Prices come from the product (`sellingPrice`, tax-inclusive or not); `discount` is per line in paise.
- No `customer` means a walk-in customer in the shop's state. A customer registered in another
  state makes the sale inter-state: **IGST** instead of CGST + SGST, place of supply = their state.
- The total is rounded to the nearest rupee (`roundOff`). Payments must add up to exactly the total,
  otherwise 400 with the difference. Change for cash is worked out by the till, not stored.
- Asking for more than is in stock answers **409 `INSUFFICIENT_STOCK`** with the line at fault
  (`details[0].path = ["items", 1, "quantity"]`). Nothing is saved and no invoice number is used.
- Invoice numbers are gap-free per financial year: `INV/26-27/00042` (at most 16 characters).
- `clientRef` (optional) is chosen by the till for each bill. Sending the same bill again returns
  the invoice already issued (200) instead of billing twice.
- Each line creates a `sale` stock movement with the cost at the time, for profit reports later.

The list also returns `summary: { count, total }` for everything that matches the filters.

## Customers

| Method | Path         | Permission       | Description                                                 |
| ------ | ------------ | ---------------- | ----------------------------------------------------------- |
| GET    | `/customers` | `customers:read` | Active customers by `search` (name, phone or GSTIN), paging |

Adding and editing customers comes with returns in step 8.
