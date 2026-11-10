import { createHmac, timingSafeEqual } from 'node:crypto';

const razorpayBaseUrl = 'https://api.razorpay.com/v1';

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    const error = new Error('Online organization signup is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
    error.status = 503;
    throw error;
  }
  return { keyId, keySecret };
}

async function razorpayRequest(path, options = {}) {
  const { keyId, keySecret } = credentials();
  let response;
  try {
    response = await fetch(`${razorpayBaseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  } catch (cause) {
    const error = new Error('Could not connect to Razorpay. Please try again.', { cause });
    error.status = 502;
    throw error;
  }
  let result;
  try {
    result = await response.json();
  } catch (cause) {
    const error = new Error('Razorpay returned an unreadable response.', { cause });
    error.status = 502;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(result.error?.description || 'Razorpay could not process the payment request.');
    error.status = 502;
    throw error;
  }
  return result;
}

export function joiningFeePaise() {
  return 50000;
}

export async function createJoiningOrder({ amount, receipt, organizationName }) {
  const order = await razorpayRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount,
      currency: 'INR',
      receipt,
      notes: { organizationName }
    })
  });
  if (!order.id || order.amount !== amount || order.currency !== 'INR') {
    const error = new Error('Razorpay returned an invalid organization signup order.');
    error.status = 502;
    throw error;
  }
  const { keyId } = credentials();
  return { order, keyId };
}

export async function confirmJoiningPayment({ orderId, paymentId, signature, amount }) {
  const { keySecret } = credentials();
  const expected = createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest();
  const supplied = Buffer.from(signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    const error = new Error('Payment signature is invalid.');
    error.status = 400;
    throw error;
  }

  let payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== orderId || payment.amount !== amount || payment.currency !== 'INR') {
    const error = new Error('The payment does not match this organization signup.');
    error.status = 400;
    throw error;
  }

  if (payment.status === 'authorized') {
    payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      body: JSON.stringify({ amount, currency: 'INR' })
    });
  }

  if (payment.status !== 'captured') {
    const error = new Error('The joining fee has not been captured. Complete the payment and try again.');
    error.status = 409;
    throw error;
  }
  return payment;
}
