# InvoiceNinja v5.13.50 — Product & Inventory Management FRD

> **Sources:** `app/Models/Product.php`, `app/Http/Controllers/ProductController.php`, `app/Jobs/Inventory/AdjustProductInventory.php`, `app/Services/Invoice/InvoiceService.php` (`adjustInventory()`)

## 1. System Overview & Boundaries

### Scope (In-scope)
- Product catalog management (SKU, pricing, cost, descriptions)
- Inventory tracking (quantity on hand, costs, reorder thresholds)
- Product-to-invoice linkage (line items)
- Inventory adjustment on invoice create/void/delete/restore
- Product categories (via ExpenseCategory)
- Multi-currency product pricing support

### Scope (Out-of-scope)
- Warehouse management
- Purchase order generation from low stock
- Supplier management (covered in Vendor FRD)

### Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Creates/edits products; sets inventory settings |
| **System (Cron)** | Evaluates low-stock thresholds |
| **Invoice System** | Reads product data when creating invoices |

## 2. Product Entity

### Key Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `assigned_user_id` | int\|null | Assigned user |
| `product_key` | string | SKU / product code |
| `name` | string | Product name |
| `description` | string\|null | Description |
| `unit_price` | float | Default unit price |
| `cost` | float | Cost price |
| `quantity` | float | Quantity on hand |
| `notes` | string\|null | Internal notes |
| `tax_rate1/2/3` | float | Default tax rates |
| `tax_name1/2/3` | string\|null | Default tax names |
| `custom_value1-4` | float | Custom numeric fields |
| `custom_surcharge1-4` | float | Surcharge amounts |
| `custom_surcharge_tax1-4` | int | Surcharge tax flags |
| `is_deleted` | bool | Soft-delete |
| `track_quantity` | bool | Enable stock tracking |
| `is_cost_known` | bool | Cost known flag |
| `in_stock_quantity_threshold` | int | Reorder alert threshold |

## 3. Inventory Management

### 3.1 Inventory Tracking Enablement
- Controlled at company level: `company->track_inventory = true`
- Only tracked when this setting is enabled
- Individual products have `track_quantity` flag for finer control

### 3.2 Inventory Adjustment Triggers
> **Source:** `app/Services/Invoice/InvoiceService.php` (`adjustInventory()`, lines 686-693), `app/Jobs/Inventory/AdjustProductInventory.php`

| Trigger | Action |
|---|---|
| Invoice created/saved | `adjustInventory()` called → `AdjustProductInventory` job decrements stock for each line item with `product_id` |
| Invoice deleted (soft) | `HandleRestore` or deletion → `AdjustProductInventory::handleRestoredInvoice()` increments stock |
| Invoice refunded | Payment reversal → inventory restored |
| Invoice restored from deletion | `HandleRestore::run()` → `AdjustProductInventory::handleRestoredInvoice()` called |

### 3.3 Adjustment Logic
```
AdjustProductInventory(company, invoice, old_invoice):
├─ IF company.track_inventory ≠ true → return (no adjustment)
├─ For each line_item with product_id:
│   ├─ product = Product::find(product_id)
│   ├─ quantity_change = line_item.quantity × -1
│   │   (negative = reduction on invoice creation)
│   │   (positive = restoration on delete/restore)
│   ├─ IF old_invoice provided:
│   │   └─ Calculate delta between old and new quantities
│   └─ product.quantity += quantity_change
├─ Save all affected products
```

### 3.4 Inventory Adjustment Events
| Source | Target | Quantity Change |
|---|---|---|
| Invoice saved (new) | Product | -line_item.quantity |
| Invoice deleted (soft) | Product | +line_item.quantity |
| Invoice restored | Product | +line_item.quantity |
| Invoice refunded | Product | +refunded_quantity |

### 3.5 Low Stock Detection
- `in_stock_quantity_threshold` field on Product
- When `quantity ≤ in_stock_quantity_threshold`, product is flagged as low stock
- No automatic alerts in core; UI shows warning badge

## 4. Product Lifecycle

### 4.1 State Transitions
| From | To | Trigger |
|---|---|---|
| Active | DELETED (soft) | `DELETE /api/v1/products/{id}` |
| DELETED | Active | `PUT /api/v1/products/{id}` (undelete) |
| Active | Updated | `PUT /api/v1/products/{id}` |
| Active | Archived | Auto-archive when inventory = 0 and not tracked |

### 4.2 Product Creation Workflow
1. `POST /api/v1/products` with `product_key`, `name`, `unit_price`, `cost`, `quantity`
2. `StoreProductRequest` validates: product_key unique per company; cost ≥ 0; quantity ≥ 0
3. `ProductRepository::save()` persists with company defaults
4. Product available for invoice line items

### 4.3 Product Lookup in Invoices
When a product is added to an invoice line item:
1. System checks if `product_id` is set
2. Fetches product data: `name` → `notes`, `unit_price` → `cost`, `tax_rate1-3` → line item tax
3. Product `quantity` is decremented on invoice save (if inventory tracked)
4. If `use_product_units_of_measure` is enabled, unit_name is taken from product

## 5. API Endpoints
| Endpoint | Verb | Description |
|---|---|---|
| `products` | GET/POST | List/create products |
| `products/{id}` | GET/PUT/DELETE | Manage product |
| `products/bulk` | POST | Bulk operations |
| `products/{id}/upload` | PUT | Upload product image |
| `products/{id}/inventory` | GET | View inventory history |

## Source Files
| File |
|---|
| `app/Models/Product.php` |
| `app/Http/Controllers/ProductController.php` |
| `app/Repositories/ProductRepository.php` |
| `app/Jobs/Inventory/AdjustProductInventory.php` |
| `app/Services/Invoice/InvoiceService.php` |
| `app/Http/Requests/Product/StoreProductRequest.php` |
| `routes/api.php` |
