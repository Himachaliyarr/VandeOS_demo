import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { confirmJoiningPayment } from '../src/services/razorpay.js';

test('joining payment verification requires a valid Razorpay signature and matching captured payment', async () => {
  const previousKeyId = process.env.RAZORPAY_KEY_ID;
  const previousKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const previousFetch = globalThis.fetch;
  process.env.RAZORPAY_KEY_ID = 'test-key';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';
  const orderId = 'order-test';
  const paymentId = 'payment-test';
  const signature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ id: paymentId, order_id: orderId, amount: 50000, currency: 'INR', status: 'captured' })
  });

  try {
    const payment = await confirmJoiningPayment({ orderId, paymentId, signature, amount: 50000 });
    assert.equal(payment.status, 'captured');
    await assert.rejects(
      confirmJoiningPayment({ orderId, paymentId, signature: '0'.repeat(64), amount: 50000 }),
      error => error.status === 400
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKeyId === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = previousKeyId;
    if (previousKeySecret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
    else process.env.RAZORPAY_KEY_SECRET = previousKeySecret;
  }
});
