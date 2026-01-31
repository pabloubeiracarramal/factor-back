# Backend API Changes - Frontend Update Required

## 1. Company Model

### New Field
- `bankAccountNumber` (string, optional) - IBAN/bank account number

### Affected Endpoints
- `POST /companies` - accepts `bankAccountNumber`
- `PATCH /companies/:id` - accepts `bankAccountNumber`
- `GET /companies/:id` - returns `bankAccountNumber`
- `GET /companies/me` - returns `bankAccountNumber`

### Frontend Tasks
- [ ] Add "Bank Account Number (IBAN)" field to company create form
- [ ] Add "Bank Account Number (IBAN)" field to company edit/settings form
- [ ] Display bank account in company details (if needed)

---

## 2. Invoice Model

### New Fields
- `paymentMethod` (enum, optional) - Payment method for the invoice
- `observations` (string, optional) - Additional notes/observations

### PaymentMethod Enum Values
```typescript
enum PaymentMethod {
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  CREDIT_CARD = 'CREDIT_CARD',
  PAYPAL = 'PAYPAL',
  OTHER = 'OTHER'
}
```

### Affected Endpoints
- `POST /invoices` - accepts `paymentMethod`, `observations`
- `PATCH /invoices/:id` - accepts `paymentMethod`, `observations`
- `GET /invoices/:id` - returns `paymentMethod`, `observations`
- `GET /invoices` - returns `paymentMethod`, `observations`

### Frontend Tasks
- [ ] Add payment method dropdown to invoice create form
- [ ] Add payment method dropdown to invoice edit form
- [ ] Add observations textarea to invoice create form
- [ ] Add observations textarea to invoice edit form
- [ ] Display payment method in invoice details view
- [ ] Display observations in invoice details view

---

## 3. Invoice Item Model

### Field Changes
- `description` → renamed to `name` (string, required) - The name of the item
- `description` (string, optional) - NEW - Additional description for the item

### Updated InvoiceItem Structure
```typescript
interface InvoiceItem {
  name: string;        // Required - item name
  description?: string; // Optional - item description
  quantity: number;    // 0 allowed for note/section rows
  price: number;
  taxRate?: number;    // Defaults to 21
}
```

### Affected Endpoints
- `POST /invoices` - items use `name` + optional `description`
- `PATCH /invoices/:id` - items use `name` + optional `description`

### Frontend Tasks
- [ ] Rename item `description` field to `name` in invoice item forms
- [ ] Add optional `description` field below item name
- [ ] Update any interfaces/types for invoice items
- [ ] Update invoice item display to show name + description

---

## 4. PDF Generation Changes

These are automatic (no frontend action needed), but good to know:

- Payment method is displayed based on invoice's `paymentMethod` field
- Bank account (IBAN) only shown when payment method is `BANK_TRANSFER`
- Observations section appears at the bottom if `observations` is set
- Items with `quantity === 0` only show the item text (name/description), no numbers
- Item description appears below item name with spacing
