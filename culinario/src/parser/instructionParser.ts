import type { Units, AlternativeQuantity } from './types';
import { tokenize } from './tokenizer';
import { getUnits, convert, round } from './units';

export interface InstructionTime {
  timeInSeconds: number;
  timeUnitText: string;
  timeText: string;
}

export interface InstructionParseResult {
  totalTimeInSeconds: number;
  timeItems: InstructionTime[];
  temperature: number;
  temperatureUnit: string;
  temperatureText: string;
  temperatureUnitText: string;
  alternativeTemperatures: AlternativeQuantity[];
}

export interface ParseInstructionOptions {
  includeAlternativeTemperatureUnit: boolean;
  fallbackLanguage: string;
}

const defaultParseInstructionOptions: ParseInstructionOptions = {
  includeAlternativeTemperatureUnit: false,
  fallbackLanguage: "",
};

export function parseInstruction(
  text: string,
  language: string,
  options: ParseInstructionOptions = defaultParseInstructionOptions,
): InstructionParseResult | null {
  let units = getUnits(language);

  if (!units && options.fallbackLanguage) {
    units = getUnits(options.fallbackLanguage);
  }

  if (!units) {
    throw new Error(`Language ${language} is not supported and fallback language ${options.fallbackLanguage} is not available.`);
  }

  const tokens = tokenize(text);

  if (tokens.length === 0) return null;

  let number = 0;
  let numberText = "";

  const timeItems: InstructionTime[] = [];
  let totalTimeInSeconds = 0;
  let temperature = 0;
  let temperatureText = "";
  let temperatureUnit = "";
  let temperatureUnitText = "";

  let alternativeTemperatures: AlternativeQuantity[] = [];

  for (const token of tokens) {
    const maybeNumber = Number(token);

    if (!isNaN(maybeNumber)) {
      number = maybeNumber;
      numberText = token;
    } else if (number > 0) {
      const maybeUnit = token.toLowerCase();

      if (units.temperatureMarkers.includes(maybeUnit)) {
        if (units.defaultTemperatureUnit) {
          temperature = number;
          temperatureText = numberText;
          const defTemp = units.temperatureUnits.get(units.defaultTemperatureUnit);
          if (defTemp) temperatureUnit = defTemp.text;
        }
        continue;
      }

      if (units.timeUnits.has(maybeUnit)) {
        const timeUnit = units.timeUnits.get(maybeUnit);
        if (timeUnit) {
          const multiplier = units.timeUnitMultipliers.get(timeUnit) || 1;
          const timeInSeconds = number * multiplier;
          totalTimeInSeconds += timeInSeconds;
          timeItems.push({
            timeInSeconds,
            timeUnitText: token,
            timeText: numberText,
          });
        }
      } else if (units.temperatureUnits.has(maybeUnit)) {
        temperature = number;
        temperatureText = numberText;
        const tempUnit = units.temperatureUnits.get(maybeUnit);
        if (tempUnit) {
          temperatureUnit = tempUnit.text;
          temperatureUnitText = token;
        }
      }

      number = 0;
    }
  }

  if (options.includeAlternativeTemperatureUnit && temperature > 0) {
    alternativeTemperatures = getTemperatureConversions(temperature, temperatureUnit, units);
  }

  return {
    totalTimeInSeconds,
    timeItems,
    temperature,
    temperatureText,
    temperatureUnit,
    temperatureUnitText,
    alternativeTemperatures,
  };
}

function getTemperatureConversions(temperature: number, uom: string, units: Units): AlternativeQuantity[] {
  const unit = units.temperatureUnits.get(uom);
  const conversionGroup = unit?.conversionGroup;

  if (!conversionGroup) return [];

  const defaultConversions = units.unitConversions.defaultConversions.get(conversionGroup);
  if (!defaultConversions) return [];

  return defaultConversions
    .filter((item) => item !== unit?.symbol)
    .map((possibility) => {
      const possibilityUOM = units.temperatureUnits.get(possibility);
      const quantity = convert(temperature, unit?.symbol || '', possibility, units);

      const rounded = round(quantity, 0, 4);
      return {
        quantity: rounded,
        unit: possibility,
        unitText: possibilityUOM?.text ?? possibility,
        minQuantity: rounded,
        maxQuantity: rounded,
      };
    });
}
