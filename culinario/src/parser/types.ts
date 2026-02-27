export interface UnitDetail {
  symbol: string;
  text: string;
  customFunction?: (tokens: string[], startIndex: number) => { uom: string; uomText: string; newIndex: number };
  conversionGroup?: string;
}

export interface UnitConversion {
  defaultConversions: Map<string, string[]>;
  converters: Map<string, (input: number) => number>;
}

export interface Units {
  ingredientUnits: Map<string, UnitDetail>;
  timeUnits: Map<string, string>;
  timeUnitMultipliers: Map<string, number>;
  temperatureUnits: Map<string, UnitDetail>;
  ingredientPrepositions: string[];
  ingredientSizes: string[];
  temperatureMarkers: string[];
  ingredientQuantities: Map<string, number>;
  ingredientRangeMarker: string[];
  ingredientQuantityAddMarker: string[];
  unitConversions: UnitConversion;
  defaultTemperatureUnit: string | null;
}

export interface AlternativeQuantity {
  quantity: number;
  unit: string;
  unitText: string;
  minQuantity: number;
  maxQuantity: number;
}
