import { parseWeightMeasurement, type ProfileData } from '@levelmaxing/contracts';
import { parseWeightInput } from './sync.ts';

const gramsPerPound = 453.59237;
export type WeightUnit = ProfileData['units'];

export function formatWeight(grams: number, unit: WeightUnit = 'kg'): string {
  const value = grams / (unit === 'lb' ? gramsPerPound : 1000);
  return `${value.toLocaleString(undefined, { maximumFractionDigits: unit === 'lb' ? 2 : 3 })} ${unit}`;
}

export function parseDisplayedWeight(value: string, date: string, unit: WeightUnit) {
  if (unit === 'kg') return parseWeightInput(value, date);
  const normalized = value.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,3})?$/.test(normalized)) return;
  return parseWeightMeasurement({ grams: Math.round(Number(normalized) * gramsPerPound), measuredOn: date.trim() });
}
