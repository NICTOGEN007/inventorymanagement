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
