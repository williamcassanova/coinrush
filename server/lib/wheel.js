import crypto from 'node:crypto';

export const WHEEL_PRIZES = [
  { label: '10', coin: 10, weight: 30, color: '#2b3550' },
  { label: '25', coin: 25, weight: 24, color: '#38456b' },
  { label: '50', coin: 50, weight: 18, color: '#2b3550' },
  { label: '100', coin: 100, weight: 12, color: '#38456b' },
  { label: '250', coin: 250, weight: 9, color: '#2b3550' },
  { label: '500', coin: 500, weight: 5, color: '#38456b' },
  { label: '1000', coin: 1000, weight: 2, color: '#4a3a1a' },
];

const TOTAL_WEIGHT = WHEEL_PRIZES.reduce((sum, p) => sum + p.weight, 0);

export function pickPrizeIndex() {
  let roll = crypto.randomInt(0, TOTAL_WEIGHT);
  for (let i = 0; i < WHEEL_PRIZES.length; i += 1) {
    roll -= WHEEL_PRIZES[i].weight;
    if (roll < 0) return i;
  }
  return WHEEL_PRIZES.length - 1;
}

export function publicPrizes() {
  return WHEEL_PRIZES.map((p) => ({ label: p.label, coin: p.coin, color: p.color }));
}
