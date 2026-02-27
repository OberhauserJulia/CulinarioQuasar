import type { Units } from './types';
import { germanUnits } from './units.de';
import { englishUnits } from './units.en';

// Wörterbuch-Zentrale
const unitsRegistry = new Map<string, Units>();
unitsRegistry.set('de', germanUnits);
unitsRegistry.set('en', englishUnits);

export function getUnits(language: string): Units | null {
  if (!language) return null;
  return unitsRegistry.get(language.toLowerCase()) ?? null;
}

export function convert(input: number, from: string, to: string, units: Units): number {
  const converter = units.unitConversions.converters.get(`${from}->${to}`);
  if (!converter) {
    // Fallback: Wenn keine Umrechnung da ist, einfach Wert zurückgeben (verhindert Abstürze)
    return input;
  }
  return converter(input);
}

export function round(value: number, minimumFractionDigits: number, maximumFractionDigits: number): number {
  const formattedValue = value.toLocaleString("en", {
    useGrouping: false,
    minimumFractionDigits,
    maximumFractionDigits,
  });
  return Number(formattedValue);
}
