import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billedMinutes, computeBill, campaignApplies, CampaignLike } from '../src/pricing/pricing';

const rules = { roundingMin: 15, minimumMin: 30 };
const min = (m: number) => m * 60000;

test('minimum applies to short games', () => {
  assert.equal(billedMinutes(min(5), rules), 30);
});

test('rounds up to the next 15 minutes', () => {
  assert.equal(billedMinutes(min(31), rules), 45);
  assert.equal(billedMinutes(min(45), rules), 45);
  assert.equal(billedMinutes(min(45) + 1000, rules), 60);
});

test('bill picks the best single discount and applies deposit', () => {
  const bill = computeBill({
    playedMs: min(60),
    pricePerHour: 120,
    rules,
    deposit: 50,
    candidates: [
      { kind: 'MEMBER', label: 'สมาชิก 10%', type: 'PERCENT', value: 10 },
      { kind: 'CAMPAIGN', label: 'ลด 20 บาท', type: 'FIXED', value: 20 },
    ],
  });
  assert.equal(bill.gross, 120);
  assert.equal(bill.discount, 20);
  assert.equal(bill.discountLabel, 'ลด 20 บาท');
  assert.equal(bill.depositApplied, 50);
  assert.equal(bill.net, 50);
});

test('deposit never makes the bill negative', () => {
  const bill = computeBill({ playedMs: min(10), pricePerHour: 60, rules, deposit: 50, candidates: [] });
  assert.equal(bill.gross, 30);
  assert.equal(bill.depositApplied, 30);
  assert.equal(bill.depositChange, 20);
  assert.equal(bill.net, 0);
});

const base: CampaignLike = {
  name: 'Happy hour',
  type: 'PERCENT',
  value: 20,
  startDate: new Date('2026-01-01T00:00:00Z'),
  endDate: new Date('2026-12-31T23:59:59Z'),
  daysOfWeek: '1,2,3,4,5',
  timeFrom: '22:00',
  timeTo: '02:00',
  tableIds: null,
  membersOnly: false,
  active: true,
};
const at = new Date('2026-06-01T12:00:00Z');

test('campaign window wraps midnight', () => {
  assert.equal(campaignApplies(base, at, 1, 23 * 60, 't1', false), true);
  assert.equal(campaignApplies(base, at, 1, 60, 't1', false), true);
  assert.equal(campaignApplies(base, at, 1, 12 * 60, 't1', false), false);
});

test('campaign respects weekday, members-only and table filter', () => {
  assert.equal(campaignApplies(base, at, 0, 23 * 60, 't1', false), false);
  assert.equal(campaignApplies({ ...base, membersOnly: true }, at, 1, 23 * 60, 't1', false), false);
  assert.equal(campaignApplies({ ...base, tableIds: 't2,t3' }, at, 1, 23 * 60, 't1', false), false);
});
