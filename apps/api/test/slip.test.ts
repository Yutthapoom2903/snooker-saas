import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlipPayload } from '../src/slips/slip-qr';
import { checkSlip, maskedMatches } from '../src/slips/slip-rules';

test('parses transRef and bank from a slip mini-QR (SlipOK guide sample)', () => {
  const p = parseSlipPayload('0041000600000101030040220013071152533APM077365102TH91048134');
  assert.equal(p.bankCode, '004');
  assert.equal(p.transRef, '013071152533APM07736');
});

test('garbage payload has no transRef', () => {
  assert.equal(parseSlipPayload('hello').transRef, null);
});

test('masked bank account matches right-aligned', () => {
  assert.equal(maskedMatches('xxx-x-x3109-x', '123-4-53109-0'), true);
  assert.equal(maskedMatches('xxx-x-x3109-x', '123-4-53108-0'), false);
  assert.equal(maskedMatches('086xxx0000', '0861230000'), true);
  assert.equal(maskedMatches('xxx-xxx-5678', '+66 81 234 5678'), true);
  assert.equal(maskedMatches('xxxxxx', '0812345678'), false); // nothing visible
});

const exp = { depositAmount: 50, bookingCreatedAt: new Date('2026-11-02T10:00:00Z'), shopAccounts: ['0812345678'] };

test('valid slip passes', () => {
  assert.deepEqual(checkSlip({ transRef: 'x', amount: 50, paidAt: new Date('2026-11-02T10:05:00Z'), receiverValues: ['081xxx5678'] }, exp), []);
});

test('short amount, old slip and wrong receiver are all reported', () => {
  const r = checkSlip({ transRef: 'x', amount: 20, paidAt: new Date('2026-11-01T10:00:00Z'), receiverValues: ['089xxx0000'] }, exp);
  assert.equal(r.length, 3);
});
