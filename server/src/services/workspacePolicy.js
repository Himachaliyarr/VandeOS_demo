export function invoiceBalance(total, paid) {
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(paid) || paid < 0) {
    throw new TypeError('Invoice totals and paid amounts must be non-negative numbers.');
  }
  if (paid > total) throw new RangeError('Paid amount cannot exceed the invoice total.');
  return Math.max(0, total - paid);
}

export function stockStatus(quantity, minimum) {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimum) || minimum < 0) {
    throw new TypeError('Stock quantities and alert levels must be non-negative numbers.');
  }
  if (quantity === 0) return 'OUT_OF_STOCK';
  return quantity <= minimum ? 'LOW_STOCK' : 'IN_STOCK';
}

export function stockAfterMovement(quantity, direction, amount) {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(amount) || amount <= 0) {
    throw new TypeError('Current stock must be non-negative and movement quantity must be positive.');
  }
  if (!['IN', 'OUT'].includes(direction)) throw new TypeError('Movement direction must be IN or OUT.');
  const next = quantity + (direction === 'IN' ? amount : -amount);
  if (next < 0) throw new RangeError('Stock cannot be reduced below zero.');
  return next;
}
