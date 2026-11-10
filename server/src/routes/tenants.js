import { Router } from 'express';
import { z } from 'zod';
import TenantRegistry from '../models/TenantRegistry.js';
import User from '../models/User.js';
import { connectionForTenant, runWithTenant } from '../services/tenantContext.js';
import { ensureFoundation } from '../services/organization.js';
import { confirmJoiningPayment, createJoiningOrder, joiningFeePaise } from '../services/razorpay.js';
import { ensureTenantIndexes } from '../services/tenantIndexes.js';

const router = Router();

function validate(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const error = new Error(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    error.status = 400;
    throw error;
  }
  return parsed.data;
}

router.post('/signup', async (req, res) => {
  const input = validate(z.object({
    organizationName: z.string().trim().min(2).max(120),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(40),
    ownerName: z.string().trim().min(2).max(120),
    ownerEmail: z.email().transform(email => email.toLowerCase()),
    password: z.string().min(12).max(128)
  }), req.body);

  if (await TenantRegistry.exists({ slug: input.slug })) {
    return res.status(409).json({ success: false, message: 'That organization address is already in use.' });
  }

  const amount = joiningFeePaise();
  const dbName = `vandeos_${input.slug.replaceAll('-', '_')}`;
  if (await TenantRegistry.exists({ dbName })) {
    return res.status(409).json({ success: false, message: 'That organization database is already registered.' });
  }
  const connection = connectionForTenant({ dbName });
  const existingOwner = await runWithTenant(connection, () => User.exists({ email: input.ownerEmail }));
  if (existingOwner) {
    return res.status(409).json({ success: false, message: 'An account with that email already exists in this organization.' });
  }

  const { order, keyId } = await createJoiningOrder({
    amount,
    receipt: `join_${input.slug}_${Date.now()}`.slice(0, 40),
    organizationName: input.organizationName
  });
  const tenant = await TenantRegistry.create({
    name: input.organizationName,
    slug: input.slug,
    dbName,
    status: 'PENDING',
    ownerEmail: input.ownerEmail,
    joiningFeePaise: amount,
    razorpayOrderId: order.id
  });

  await runWithTenant(connection, async () => {
    await ensureFoundation({ name: tenant.name, useEnvironment: false });
    await ensureTenantIndexes();
    await User.create({
      name: input.ownerName,
      email: input.ownerEmail,
      passwordHash: input.password,
      role: 'SUPER_ADMIN',
      active: false,
      mustChangePassword: false
    });
  });

  res.status(201).json({
    success: true,
    data: {
      organization: { name: tenant.name, slug: tenant.slug },
      payment: {
        keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        name: tenant.name,
        description: 'Organization joining fee'
      }
    }
  });
});

router.post('/verify-payment', async (req, res) => {
  const input = validate(z.object({
    slug: z.string().trim().toLowerCase().min(3).max(40),
    orderId: z.string().min(1),
    paymentId: z.string().min(1),
    signature: z.string().regex(/^[a-f0-9]{64}$/i)
  }), req.body);
  const tenant = await TenantRegistry.findOne({ slug: input.slug });
  if (!tenant || tenant.razorpayOrderId !== input.orderId) {
    return res.status(404).json({ success: false, message: 'Organization signup was not found.' });
  }

  if (tenant.status === 'ACTIVE' && tenant.razorpayPaymentId === input.paymentId) {
    return res.json({ success: true, message: 'Organization payment is already verified.' });
  }
  if (tenant.status !== 'PENDING') {
    return res.status(409).json({ success: false, message: 'This organization cannot be activated.' });
  }

  const payment = await confirmJoiningPayment({
    orderId: input.orderId,
    paymentId: input.paymentId,
    signature: input.signature,
    amount: tenant.joiningFeePaise
  });
  const connection = connectionForTenant(tenant);
  const ownerUpdate = await runWithTenant(connection, () => User.updateOne(
    { email: tenant.ownerEmail, role: 'SUPER_ADMIN' },
    { $set: { active: true } }
  ));
  if (ownerUpdate.matchedCount !== 1) {
    const error = new Error('Payment was confirmed, but the organization owner account could not be activated.');
    error.status = 500;
    throw error;
  }

  tenant.status = 'ACTIVE';
  tenant.razorpayPaymentId = payment.id;
  tenant.paidAt = new Date();
  await tenant.save();
  res.json({ success: true, message: 'Payment verified. Your organization is ready.' });
});

export default router;
