import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCrmCsv, serializeCrmCsv } from '../src/services/crmCsv.js';

test('CRM CSV export round-trips quoted values and custom data columns', () => {
  const csv = serializeCrmCsv([{
    kind: 'lead',
    title: 'Lead, "One"',
    description: 'First line\r\nSecond line',
    status: 'NEW',
    dueDate: new Date('2026-11-06T00:00:00.000Z'),
    amount: 125.5,
    currency: 'INR',
    data: { company: 'Acme, Inc.', source: 'Website' }
  }]);

  const [record] = parseCrmCsv(csv);
  assert.equal(record.kind, 'lead');
  assert.equal(record.title, 'Lead, "One"');
  assert.equal(record.description, 'First line\r\nSecond line');
  assert.equal(record.status, 'NEW');
  assert.equal(record.dueDate, '2026-11-06');
  assert.equal(record.amount, 125.5);
  assert.equal(record.currency, 'INR');
  assert.deepEqual(record.data, { company: 'Acme, Inc.', source: 'Website' });
});

test('CRM CSV export neutralizes spreadsheet formulas', () => {
  const csv = serializeCrmCsv([{ kind: 'lead', title: '=IMPORTXML("example")', data: {} }]);
  const [record] = parseCrmCsv(csv);
  assert.equal(record.title, '\'=IMPORTXML("example")');
});

test('CRM CSV import rejects malformed or incomplete files', () => {
  assert.throws(() => parseCrmCsv('kind,title\nlead,"unterminated'), /unterminated/);
  assert.throws(() => parseCrmCsv('kind,title,title\nlead,One,Two'), /duplicate/);
  assert.throws(() => parseCrmCsv('kind,status\nlead,NEW'), /kind and title/);
});
