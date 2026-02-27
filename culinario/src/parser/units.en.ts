import type { Units } from './types';

export const englishUnits: Units = {
  ingredientUnits: new Map([
    ['g', { symbol: 'g', text: 'gram' }],
    ['gram', { symbol: 'g', text: 'gram' }],
    ['grams', { symbol: 'g', text: 'gram' }],
    ['kg', { symbol: 'kg', text: 'kilogram' }],
    ['oz', { symbol: 'oz', text: 'ounce' }],
    ['ounce', { symbol: 'oz', text: 'ounce' }],
    ['ounces', { symbol: 'oz', text: 'ounce' }],
    ['lb', { symbol: 'lb', text: 'pound' }],
    ['pound', { symbol: 'lb', text: 'pound' }],
    ['pounds', { symbol: 'lb', text: 'pound' }],
    ['ml', { symbol: 'ml', text: 'ml' }],
    ['l', { symbol: 'l', text: 'L' }],
    ['tsp', { symbol: 'tsp', text: 'teaspoon' }],
    ['teaspoon', { symbol: 'tsp', text: 'teaspoon' }],
    ['tbsp', { symbol: 'tbsp', text: 'tablespoon' }],
    ['tablespoon', { symbol: 'tbsp', text: 'tablespoon' }],
    ['cup', { symbol: 'cup', text: 'cup' }],
    ['cups', { symbol: 'cup', text: 'cup' }],
    ['pt', { symbol: 'pt', text: 'pint' }],
    ['qt', { symbol: 'qt', text: 'quart' }],
    ['gal', { symbol: 'gal', text: 'gallon' }],
    ['pinch', { symbol: 'pinch', text: 'pinch' }],
    ['clove', { symbol: 'clove', text: 'clove' }],
    ['cloves', { symbol: 'clove', text: 'clove' }],
    ['slice', { symbol: 'slice', text: 'slice' }],
    ['piece', { symbol: 'piece', text: 'piece' }]
  ]),

  timeUnits: new Map([
    ['sec', 's'], ['second', 's'], ['seconds', 's'],
    ['min', 'm'], ['minute', 'm'], ['minutes', 'm'],
    ['h', 'h'], ['hr', 'h'], ['hour', 'h'], ['hours', 'h'],
    ['d', 'd'], ['day', 'd'], ['days', 'd']
  ]),

  timeUnitMultipliers: new Map([
    ['s', 1], ['m', 60], ['h', 3600], ['d', 86400]
  ]),

  temperatureUnits: new Map([
    ['c', { symbol: 'C', text: 'Celsius' }],
    ['celsius', { symbol: 'C', text: 'Celsius' }],
    ['f', { symbol: 'F', text: 'Fahrenheit' }],
    ['fahrenheit', { symbol: 'F', text: 'Fahrenheit' }]
  ]),

  ingredientPrepositions: ['of', 'for', 'chopped', 'diced', 'minced', 'fresh', 'dried', 'sliced'],
  ingredientSizes: ['small', 'medium', 'large', 'thick', 'thin'],
  temperatureMarkers: ['degrees', 'degree', '°', 'temperature', 'heat'],

  ingredientQuantities: new Map([
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
    ['half', 0.5], ['quarter', 0.25]
  ]),

  ingredientRangeMarker: ['-', 'to', 'or'],
  ingredientQuantityAddMarker: ['and', '&', 'plus'],

  unitConversions: {
    defaultConversions: new Map([
      ['volume', ['ml', 'l', 'tsp', 'tbsp', 'cup']],
      ['weight', ['g', 'kg', 'oz', 'lb']]
    ]),
    converters: new Map([
      ['l->ml', (input) => input * 1000],
      ['ml->l', (input) => input / 1000]
      // Hier könnten später mehr Konvertierungen rein
    ])
  },

  defaultTemperatureUnit: 'c'
};
