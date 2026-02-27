import type { Units } from './types';

export const germanUnits: Units = {
  ingredientUnits: new Map([
    // Gewichte
    ['g', { symbol: 'g', text: 'g' }],
    ['gramm', { symbol: 'g', text: 'g' }],
    ['kg', { symbol: 'kg', text: 'kg' }],
    ['kilogramm', { symbol: 'kg', text: 'kg' }],
    ['kilo', { symbol: 'kg', text: 'kg' }],
    ['mg', { symbol: 'mg', text: 'mg' }],

    // Volumen
    ['ml', { symbol: 'ml', text: 'ml' }],
    ['milliliter', { symbol: 'ml', text: 'ml' }],
    ['l', { symbol: 'l', text: 'L' }],
    ['liter', { symbol: 'l', text: 'L' }],
    ['cl', { symbol: 'cl', text: 'cl' }],

    // Löffel & Tassen
    ['el', { symbol: 'el', text: 'EL' }],
    ['esslöffel', { symbol: 'el', text: 'EL' }],
    ['tl', { symbol: 'tl', text: 'TL' }],
    ['teelöffel', { symbol: 'tl', text: 'TL' }],
    ['tasse', { symbol: 'tasse', text: 'Tasse' }],
    ['tassen', { symbol: 'tasse', text: 'Tasse' }],

    // Stückzahlen & Gebinde
    ['stk', { symbol: 'stk', text: 'Stück' }],
    ['stk.', { symbol: 'stk', text: 'Stück' }],
    ['stück', { symbol: 'stk', text: 'Stück' }],
    ['stücke', { symbol: 'stk', text: 'Stück' }],
    ['packung', { symbol: 'pck', text: 'Packung' }],
    ['packungen', { symbol: 'pck', text: 'Packung' }],
    ['pck', { symbol: 'pck', text: 'Packung' }],
    ['päckchen', { symbol: 'pck', text: 'Packung' }],
    ['dose', { symbol: 'dose', text: 'Dose' }],
    ['dosen', { symbol: 'dose', text: 'Dose' }],
    ['glas', { symbol: 'glas', text: 'Glas' }],
    ['gläser', { symbol: 'glas', text: 'Glas' }],
    ['flasche', { symbol: 'flasche', text: 'Flasche' }],
    ['flaschen', { symbol: 'flasche', text: 'Flasche' }],

    // Rezept-Spezifisch
    ['prise', { symbol: 'prise', text: 'Prise' }],
    ['prisen', { symbol: 'prise', text: 'Prise' }],
    ['zehe', { symbol: 'zehe', text: 'Zehe' }],
    ['zehen', { symbol: 'zehe', text: 'Zehe' }],
    ['knoblauchzehe', { symbol: 'zehe', text: 'Zehe' }],
    ['knoblauchzehen', { symbol: 'zehe', text: 'Zehe' }],
    ['bund', { symbol: 'bund', text: 'Bund' }],
    ['bündel', { symbol: 'bund', text: 'Bund' }],
    ['blatt', { symbol: 'blatt', text: 'Blatt' }],
    ['blätter', { symbol: 'blatt', text: 'Blatt' }],
    ['zweig', { symbol: 'zweig', text: 'Zweig' }],
    ['zweige', { symbol: 'zweig', text: 'Zweig' }],
    ['stange', { symbol: 'stange', text: 'Stange' }],
    ['stangen', { symbol: 'stange', text: 'Stange' }],
    ['schuss', { symbol: 'schuss', text: 'Schuss' }],
    ['spritzer', { symbol: 'spritzer', text: 'Spritzer' }],
    ['tropfen', { symbol: 'tropfen', text: 'Tropfen' }],
    ['scheibe', { symbol: 'scheibe', text: 'Scheibe' }],
    ['scheiben', { symbol: 'scheibe', text: 'Scheibe' }],
    ['würfel', { symbol: 'würfel', text: 'Würfel' }],
    ['handvoll', { symbol: 'handvoll', text: 'Handvoll' }]
  ]),

  timeUnits: new Map([
    ['sek', 's'], ['sekunde', 's'], ['sekunden', 's'],
    ['min', 'm'], ['minute', 'm'], ['minuten', 'm'],
    ['std', 'h'], ['stunde', 'h'], ['stunden', 'h'],
    ['tag', 'd'], ['tage', 'd']
  ]),

  timeUnitMultipliers: new Map([
    ['s', 1],
    ['m', 60],
    ['h', 3600],
    ['d', 86400]
  ]),

  temperatureUnits: new Map([
    ['c', { symbol: 'C', text: 'Celsius' }],
    ['celsius', { symbol: 'C', text: 'Celsius' }],
    ['f', { symbol: 'F', text: 'Fahrenheit' }],
    ['fahrenheit', { symbol: 'F', text: 'Fahrenheit' }],
  ]),

  // Wörter, die der Parser überspringen/wegwerfen soll, damit als Name "Petersilie" statt "gehackte Petersilie" bleibt
  ingredientPrepositions: [
    'von', 'aus', 'mit', 'in', 'für', 'nach', 'belieben', 'etwas', 'ca.', 'ca',
    'zirka', 'etwa', 'reichlich', 'wenig', 'frische', 'frischer', 'frisches',
    'gehackt', 'gehackte', 'gehackter', 'gemahlen', 'gemahlene', 'gemahlener',
    'gewürfelt', 'gewürfelte', 'getrocknet', 'getrocknete', 'tk', 'tiefgekühlt', 'passierte'
  ],

  // Größenangaben, die übersprungen werden
  ingredientSizes: [
    'groß', 'große', 'großer', 'großen', 'großes',
    'klein', 'kleine', 'kleiner', 'kleinen', 'kleines',
    'mittel', 'mittlere', 'mittlerer', 'mittleren', 'mittleres',
    'mittelgroß', 'mittelgroße', 'mittelgroßer', 'mittelgroßen',
    'dick', 'dicke', 'dicker', 'dicken',
    'dünn', 'dünne', 'dünner', 'dünnen',
    'gehäuft', 'gehäufte', 'gehäufter', 'gehäuften',
    'gestrichen', 'gestrichene', 'gestrichener', 'gestrichenen'
  ],

  temperatureMarkers: ['grad', 'hitze', 'temperatur', '°'],

  // Wandelt ausgeschriebene Zahlen in Ziffern um
  ingredientQuantities: new Map([
    ['ein', 1], ['eine', 1], ['einen', 1], ['einem', 1], ['einer', 1], ['eins', 1],
    ['zwei', 2], ['drei', 3], ['vier', 4], ['fünf', 5],
    ['sechs', 6], ['sieben', 7], ['acht', 8], ['neun', 9],
    ['zehn', 10], ['elf', 11], ['zwölf', 12],
    ['halbe', 0.5], ['halbes', 0.5], ['halber', 0.5], ['halb', 0.5],
    ['viertel', 0.25], ['dreiviertel', 0.75]
  ]),

  ingredientRangeMarker: ['-', 'bis', 'oder'],
  ingredientQuantityAddMarker: ['und', '&', '+'],

  unitConversions: {
    defaultConversions: new Map([
      ['volume', ['ml', 'l', 'tl', 'el', 'tasse']],
      ['weight', ['g', 'kg']]
    ]),
    converters: new Map([
      ['l->ml', (input) => input * 1000],
      ['ml->l', (input) => input / 1000],
      ['kg->g', (input) => input * 1000],
      ['g->kg', (input) => input / 1000],
      ['el->ml', (input) => input * 15],
      ['ml->el', (input) => input / 15],
      ['tl->ml', (input) => input * 5],
      ['ml->tl', (input) => input / 5],
      ['el->g', (input) => input * 15],
      ['g->el', (input) => input / 15],
      ['tl->g', (input) => input * 5],
      ['g->tl', (input) => input / 5],
      ['el->tl', (input) => input * 3],
      ['tl->el', (input) => input / 3],
      ['ml->g', (input) => input],
      ['g->ml', (input) => input]
    ])
  },

  defaultTemperatureUnit: 'c'
};
