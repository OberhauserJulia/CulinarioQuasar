<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useQuasar } from 'quasar';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { VueDraggableNext } from 'vue-draggable-next';

// 1. Zentrale Typen importieren
import type { Recipe, IngredientItem, IngredientFirebase } from '../types/index';

// 2. Deine neuen Service-Funktionen importieren
import {
  getRecipeById,
  addRecipe,
  updateRecipe,
  getRecipeCategories,
  getIngredientByName,
  getIngredientById,
  addIngredient,
  updateIngredient,
  getIngredients
} from '../firebase/services';

// 3. Parser & Umrechner importieren
import { parseIngredient } from '../parser/ingredientParser';
import { parseInstruction } from '../parser/instructionParser'; // <-- NEU: Für den Ofen!
import { convert, getUnits } from '../parser/units';

const router = useRouter();
const $q = useQuasar();
const goBack = () => { void router.back(); };
const isSaving = ref(false);
const route = useRoute();
const editId = computed(() => route.query.edit as string | undefined);
const categories = ref<{ label: string, value: string }[]>([]);

const knownIngredients = ref<IngredientFirebase[]>([]);

// IMPORT STATE
const showImportDialog = ref(false);
const importUrl = ref('');
const uiRecipeAmount = ref('');
const importText = ref('');
const isImporting = ref(false);
const importTab = ref('url');
const autoTranslate = ref(true);

const fileInputRef = ref<{ pickFiles: () => void } | null>(null);
const imageFileToUpload = ref<File | null>(null);
const localImagePreview = ref<string>('');

const CLOUDINARY_CLOUD_NAME = 'ddwxwy7j0';
const CLOUDINARY_UPLOAD_PRESET = 'ml_default';

const recipeData = ref<Partial<Recipe>>({
  name: '',
  category: '',
  ovensettings: '',
  source: '',
  ingredients: [],
  preparationSteps: [],
  image: ''
});

interface LocalIngredient {
  ingredientID: string;
  amount: number | null;
  unit: string;
  name: string;
  image?: string;
  note?: string;
  symbol?: string;
}

interface DropdownIngredient extends LocalIngredient {
  availableAmount: number;
}

interface UIIngredient {
  text: string;
  isProcessing: boolean;
  processedData: LocalIngredient | null;
}

interface LocalPreparationStep {
  stepNumber: number;
  description: string;
  ingredients: LocalIngredient[];
  _tempIngredient?: DropdownIngredient | null;
  _tempAmount?: number | null;
  _showIngredientsUI?: boolean;
}

interface AIParsedIngredient {
  originalText: string;
  amount: number;
  unit: string;
  singularName: string;
  pluralName: string;
  displayName: string;
  note?: string;
}

interface AIParsedStep {
  stepNumber: number;
  description: string;
}

interface AIParsedRecipe {
  name: string;
  recipeamount?: number;
  ovensettings?: string;
  category?: string;
  image?: string;
  ingredients: Omit<AIParsedIngredient, 'originalText'>[];
  preparationSteps: AIParsedStep[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getIngredientId = (ing: any): string => {
  return ing.ingredientID || ing.ingredientId || '';
};

const capitalize = (str: string): string => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const uiIngredients = ref<UIIngredient[]>([{ text: '', isProcessing: false, processedData: null }]);
const preparationSteps = ref<LocalPreparationStep[]>([
  { stepNumber: 1, description: '', ingredients: [], _showIngredientsUI: false }
]);

watch(() => uiIngredients.value, (newVals) => {
  const last = newVals[newVals.length - 1];
  if (last && last.text.trim() !== '') {
    uiIngredients.value.push({ text: '', isProcessing: false, processedData: null });
  }
}, { deep: true });

watch(() => preparationSteps.value, (newVals) => {
  const last = newVals[newVals.length - 1];
  if (last && last.description.trim() !== '') {
    preparationSteps.value.push({
      stepNumber: preparationSteps.value.length + 1,
      description: '',
      ingredients: [],
      _showIngredientsUI: false
    });
  }
}, { deep: true });

watch(() => uiIngredients.value, (newVals) => {
  for (let i = 0; i < newVals.length - 1; i++) {
    if (newVals[i]?.text.trim() === '') {
      newVals.splice(i, 1);
      i--;
    }
  }
  const last = newVals[newVals.length - 1];
  if (last && last.text.trim() !== '') {
    newVals.push({ text: '', isProcessing: false, processedData: null });
  }
}, { deep: true });

const availableIngredientsForDropdown = computed<DropdownIngredient[]>(() => {
  return uiIngredients.value
    .filter(ui => ui.processedData !== null)
    .map(ui => {
      const globalIng = ui.processedData!;
      const totalAmount = Number(globalIng.amount) || 0;
      const globalId = globalIng.ingredientID;

      let usedAmount = 0;
      preparationSteps.value.forEach(step => {
        if (step.ingredients) {
          step.ingredients.forEach(stepIng => {
            if (stepIng.ingredientID === globalId) {
              usedAmount += Number(stepIng.amount) || 0;
            }
          });
        }
      });

      return {
        ...globalIng,
        ingredientID: globalId,
        availableAmount: parseFloat((totalAmount - usedAmount).toFixed(2))
      };
    }).filter(ing => ing.availableAmount > 0);
});

const findIngredientMatch = (searchName: string) => {
  let match = knownIngredients.value.find(ing =>
    ing.name.toLowerCase() === searchName ||
    (ing.plural && ing.plural.toLowerCase() === searchName)
  );

  if (!match) {
    const partials = knownIngredients.value.filter(ing =>
      searchName.includes(ing.name.toLowerCase()) ||
      (ing.plural && searchName.includes(ing.plural.toLowerCase()))
    );
    if (partials.length > 0) {
      partials.sort((a, b) => b.name.length - a.name.length);
      match = partials[0];
    }
  }
  return match;
};

const tryParseLocally = (index: number) => {
  const item = uiIngredients.value[index];
  if (!item || !item.text.trim() || item.processedData || item.isProcessing) return;

  try {
    const parsed = parseIngredient(item.text, 'de');
    if (!parsed || !parsed.ingredient) return;

    const match = findIngredientMatch(parsed.ingredient.toLowerCase());

    if (match) {
      const isPlural = parsed.quantity !== 1 && parsed.quantity !== 0;
      const rawName = (isPlural && match.plural && match.plural.trim() !== '') ? match.plural : match.name;
      const displayName = capitalize(rawName);

      item.processedData = {
        ingredientID: match.id,
        amount: parsed.quantity > 0 ? parsed.quantity : null,
        unit: parsed.unitText || '',
        symbol: parsed.unit || '',
        name: displayName,
        image: match.image || ''
      };

      if (parsed.extra) item.processedData.note = parsed.extra;

      const amtStr = parsed.quantity > 0 ? `${parsed.quantity} ` : '';
      const unitStr = parsed.unitText ? `${parsed.unitText} ` : '';
      const noteSuffix = parsed.extra ? ` (${parsed.extra})` : '';

      item.text = `${amtStr}${unitStr}${displayName}${noteSuffix}`.trim();
    }
  } catch (error) {
    console.warn("Lokales Parsen fehlgeschlagen", error);
  }
};


// --- ZUTATEN ZUSAMMENRECHNEN (Consolidator: Völlig überarbeitet!) ---
const consolidateIngredients = (ingredients: UIIngredient[], lang: string): UIIngredient[] => {
  const merged = new Map<string, UIIngredient>();
  const result: UIIngredient[] = [];
  const unitsObj = getUnits(lang);

  for (const item of ingredients) {
    if (!item.processedData || !item.processedData.name) {
      result.push(item);
      continue;
    }

    // Gruppieren über ID (wenn vorhanden) ODER Name
    const mergeKey = item.processedData.ingredientID || item.processedData.name.toLowerCase();

    if (merged.has(mergeKey)) {
      const existing = merged.get(mergeKey)!;
      const addedAmount = item.processedData.amount || 0;
      const exAmount = existing.processedData!.amount || 0;

      const fromUnit = (item.processedData.symbol || item.processedData.unit || '').toLowerCase();
      const toUnit = (existing.processedData!.symbol || existing.processedData!.unit || '').toLowerCase();

      // Gleiche Einheiten -> Sofort addieren
      if (fromUnit === toUnit) {
        existing.processedData!.amount = Number((exAmount + addedAmount).toFixed(2));
      }
      // Unterschiedliche Einheiten -> Die Magie beginnt (z.B. EL -> g)
      else if (unitsObj && addedAmount > 0) {
        try {
          const convertedAmount = convert(addedAmount, fromUnit, toUnit, unitsObj);
          existing.processedData!.amount = Number((exAmount + convertedAmount).toFixed(2));
        } catch (e) {
          // Falls EL -> g nicht geht, probieren wir rückwärts: g -> EL!
          try {
            const reverseConvert = convert(exAmount, toUnit, fromUnit, unitsObj);
            existing.processedData!.amount = Number((reverseConvert + addedAmount).toFixed(2));

            // Wir müssen die Einheit der Zielzutat tauschen! (Sicherer Fallback für TypeScript)
            existing.processedData!.unit = item.processedData.unit || '';

            if (item.processedData.symbol) {
              existing.processedData!.symbol = item.processedData.symbol;
            } else {
              delete existing.processedData!.symbol;
            }

          } catch (e2) {
            console.warn(`Konnte ${addedAmount} ${fromUnit} nicht zu ${toUnit} konvertieren.`, e, e2);
            result.push(item);
            continue;
          }
        }
      }

      // Text im Eingabefeld nach der Addition wunderschön updaten
      const newAmount = existing.processedData!.amount || 0;
      existing.processedData!.amount = newAmount > 0 ? newAmount : null;

      const amtStr = newAmount > 0 ? `${newAmount} ` : '';
      const unitStr = existing.processedData!.unit ? `${existing.processedData!.unit} ` : '';
      const noteSuffix = existing.processedData!.note ? ` (${existing.processedData!.note})` : '';
      existing.text = `${amtStr}${unitStr}${existing.processedData!.name}${noteSuffix}`.trim();

    } else {
      merged.set(mergeKey, JSON.parse(JSON.stringify(item)));
    }
  }

  for (const val of merged.values()) {
    result.push(val);
  }
  return result;
};


// --- BATCH KI LOGIK ---
const isProcessingAll = ref(false);

const hasUnprocessedIngredients = computed(() => {
  return uiIngredients.value.some(ui => ui.text.trim() !== '' && ui.processedData === null);
});

const handleIngredientEdit = (index: number) => {
  const item = uiIngredients.value[index];
  if (item && item.processedData) {
    const amtStr = item.processedData.amount ? `${item.processedData.amount} ` : '';
    const unitStr = item.processedData.unit ? `${item.processedData.unit} ` : '';
    const noteStr = item.processedData.note ? ` (${item.processedData.note})` : '';
    const confirmedText = `${amtStr}${unitStr}${item.processedData.name}${noteStr}`.trim();

    if (item.text !== confirmedText) item.processedData = null;
  }
};

const processAllIngredients = async () => {
  const itemsToProcess = uiIngredients.value.filter(item => item.text.trim() !== '' && item.processedData === null);
  if (itemsToProcess.length === 0) return;

  isProcessingAll.value = true;
  itemsToProcess.forEach(item => item.isProcessing = true);

  try {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              originalText: { type: SchemaType.STRING },
              amount: { type: SchemaType.NUMBER },
              unit: { type: SchemaType.STRING },
              singularName: { type: SchemaType.STRING },
              pluralName: { type: SchemaType.STRING },
              displayName: { type: SchemaType.STRING },
              note: { type: SchemaType.STRING }
            },
            required: ["originalText", "amount", "unit", "singularName", "pluralName", "displayName"]
          }
        }
      }
    });

    const textsToAnalyze = itemsToProcess.map(item => item.text.trim());
    const prompt = `Analysiere diese Zutatenliste. Ordne jede Zutat exakt ihrem Ursprungstext ("originalText") zu:\n${JSON.stringify(textsToAnalyze)}`;

    const result = await model.generateContent(prompt);
    const aiDataArray = JSON.parse(result.response.text()) as AIParsedIngredient[];

    for (const aiData of aiDataArray) {
      const targetItem = uiIngredients.value.find(ui => ui.text.trim() === aiData.originalText && ui.processedData === null);
      if (!targetItem) continue;

      const capSingular = capitalize(aiData.singularName);
      const existingIng = await getIngredientByName(capSingular);

      let finalIngredientID = '';
      let finalImage = '';

      if (existingIng) {
        finalIngredientID = existingIng.id;
        finalImage = existingIng.image || '';
        if (!existingIng.plural && aiData.pluralName) {
          await updateIngredient(existingIng.id, { plural: capitalize(aiData.pluralName) });
        }
      } else {
        finalIngredientID = await addIngredient({
          name: aiData.singularName,
          plural: capitalize(aiData.pluralName),
          categoryId: '',
          image: ''
        });
      }

      const rawNameToShow = aiData.displayName || aiData.singularName;
      const nameToShow = capitalize(rawNameToShow);
      const noteText = aiData.note || '';

      const processed: LocalIngredient = {
        ingredientID: finalIngredientID,
        amount: aiData.amount > 0 ? aiData.amount : null,
        unit: aiData.unit || '',
        symbol: aiData.unit || '', // Für den Mixer
        name: nameToShow,
      };
      if (finalImage) processed.image = finalImage;
      if (noteText) processed.note = noteText;

      targetItem.processedData = processed;
      const amtStr = aiData.amount > 0 ? `${aiData.amount} ` : '';
      const unitStr = aiData.unit ? `${aiData.unit} ` : '';
      const noteSuffix = noteText ? ` (${noteText})` : '';
      targetItem.text = `${amtStr}${unitStr}${nameToShow}${noteSuffix}`.trim();
    }

    knownIngredients.value = await getIngredients();

    // ZUSAMMENFASSEN direkt nach der KI
    uiIngredients.value = consolidateIngredients(uiIngredients.value, 'de');
    uiIngredients.value.push({ text: '', isProcessing: false, processedData: null });

    $q.notify({ type: 'positive', message: 'Neue Zutaten erfolgreich gelernt & zusammengefasst!', icon: 'auto_awesome' });

  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('429')) {
      $q.notify({ type: 'warning', message: 'KI-Limit erreicht. Bitte warte ca. 1 Minute.', icon: 'timer' });
    } else {
      $q.notify({ type: 'negative', message: 'Fehler beim Verarbeiten der Zutaten.' });
    }
  } finally {
    isProcessingAll.value = false;
    itemsToProcess.forEach(item => item.isProcessing = false);
  }
};


// --- IMPORT LOGIK ---
interface JsonLdRecipe {
  '@type'?: string | string[];
  name?: string;
  image?: unknown;
  recipeCategory?: string | string[];
  recipeYield?: string | number | (string | number)[];
  recipeIngredient?: string[];
  recipeInstructions?: unknown;
  [key: string]: unknown;
}

const extractJsonLdRecipe = (html: string): JsonLdRecipe | null => {
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    if (!match[1]) continue;
    try {
      const data = JSON.parse(match[1]) as unknown;
      let recipe: JsonLdRecipe | null = null;
      const searchRecipe = (obj: unknown) => {
        if (!obj) return;
        if (Array.isArray(obj)) {
          obj.forEach(searchRecipe);
        } else if (typeof obj === 'object') {
          const rec = obj as Record<string, unknown>;
          const type = rec['@type'];
          if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
            recipe = rec as JsonLdRecipe;
          } else {
            Object.values(rec).forEach(searchRecipe);
          }
        }
      };
      searchRecipe(data);
      if (recipe) return recipe;
    } catch { /* Ignorieren */ }
  }
  return null;
};

const detectLanguage = (html: string): string => {
  const langMatch = html.match(/<html[^>]*lang=["']([^"']+)["']/i);
  if (langMatch && langMatch[1]) {
    return langMatch[1].toLowerCase().startsWith('de') ? 'de' : 'en';
  }
  if (html.includes('Zutaten') || html.includes('Zubereitung')) return 'de';
  return 'en';
};

const extractImageUrl = (imageObj: unknown): string => {
  if (!imageObj) return '';
  if (typeof imageObj === 'string') return imageObj;
  if (Array.isArray(imageObj) && typeof imageObj[0] === 'string') return imageObj[0];
  if (typeof imageObj === 'object' && imageObj !== null) {
    const record = imageObj as Record<string, unknown>;
    if (typeof record.url === 'string') return record.url;
  }
  return '';
};

const extractInstructions = (instructionsObj: unknown): string[] => {
  if (!instructionsObj) return [];
  if (typeof instructionsObj === 'string') return [instructionsObj];
  if (Array.isArray(instructionsObj)) {
    return instructionsObj.map((step: unknown) => {
      if (typeof step === 'string') return step;
      if (typeof step === 'object' && step !== null) {
        const record = step as Record<string, unknown>;
        if (typeof record.text === 'string') return record.text;
      }
      return '';
    }).filter((text: string) => text.trim() !== '');
  }
  return [];
};

const extractVideoDescription = (html: string): string => {
  // 1. YouTube versteckt die volle Beschreibung oft im internen JSON
  const ytMatch = html.match(/"shortDescription":"(.*?)"/);
  if (ytMatch && ytMatch[1]) {
    // YouTube nutzt \n für Zeilenumbrüche, das müssen wir für die KI lesbar machen
    return ytMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  }

  // 2. TikTok, Instagram & Co. nutzen Meta-Tags für die Vorschau (wie bei WhatsApp)
  const metaTags = html.match(/<meta[^>]+>/g) || [];
  for (const tag of metaTags) {
    if (tag.includes('og:description') || tag.includes('name="description"')) {
      const contentMatch = tag.match(/content=["']([^"']+)["']/i);
      if (contentMatch && contentMatch[1]) {
        return contentMatch[1];
      }
    }
  }
  return '';
};


const fetchHtmlFromUrl = async (url: string): Promise<string> => {
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl);
  if (!response.ok) throw new Error(`HTTP Fehler: ${response.status}`);
  return await response.text();
};

const processImport = async () => {
  isImporting.value = true;
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;

  try {
    let rawHtml = '';
    if (importTab.value === 'url') {
      if (!importUrl.value) return;
      try {
        rawHtml = await fetchHtmlFromUrl(importUrl.value);
      } catch {
        $q.notify({ type: 'warning', message: 'URL Fehler. Bitte Text kopieren.' });
        importTab.value = 'text';
        isImporting.value = false;
        return;
      }
    } else {
      rawHtml = importText.value;
    }

    if (!rawHtml.trim()) return;

    const docLang = detectLanguage(rawHtml);
    const jsonLdRecipe = extractJsonLdRecipe(rawHtml);

    // --- STRUKTURIERTER IMPORT (JSON-LD) ---
    if (jsonLdRecipe && (docLang === 'de' || !autoTranslate.value)) {
      recipeData.value.name = jsonLdRecipe.name || '';
      recipeData.value.source = importTab.value === 'url' ? importUrl.value : 'Importiert';
      recipeData.value.image = extractImageUrl(jsonLdRecipe.image);

      if (jsonLdRecipe.recipeCategory) {
        const catName = Array.isArray(jsonLdRecipe.recipeCategory) ? jsonLdRecipe.recipeCategory[0] : jsonLdRecipe.recipeCategory;
        const foundCat = categories.value.find(c => c.label.toLowerCase() === String(catName).toLowerCase());
        if (foundCat) recipeData.value.category = foundCat.value;
      }

      if (jsonLdRecipe.recipeYield) {
        const yieldText = Array.isArray(jsonLdRecipe.recipeYield) ? jsonLdRecipe.recipeYield[0] : String(jsonLdRecipe.recipeYield);
        uiRecipeAmount.value = String(yieldText);
      }

      const tempIngredients: UIIngredient[] = [];
      const rawIngredients = Array.isArray(jsonLdRecipe.recipeIngredient) ? jsonLdRecipe.recipeIngredient : [];

      for (const item of rawIngredients) {
        const ingStr = String(item);
        const parsed = parseIngredient(ingStr, docLang);
        let processedData: LocalIngredient | null = null;
        let finalDisplayStr = ingStr;

        if (parsed && parsed.ingredient) {
          const match = findIngredientMatch(parsed.ingredient.toLowerCase());
          if (match) {
            const isPlural = parsed.quantity !== 1 && parsed.quantity !== 0;
            const rawName = (isPlural && match.plural) ? match.plural : match.name;
            const displayName = capitalize(rawName);

            processedData = {
              ingredientID: match.id,
              amount: parsed.quantity > 0 ? parsed.quantity : null,
              unit: parsed.unitText || '',
              symbol: parsed.unit || '',
              name: displayName,
              image: match.image || ''
            };
            if (parsed.extra) processedData.note = parsed.extra;

            const amtStr = parsed.quantity > 0 ? `${parsed.quantity} ` : '';
            const unitStr = parsed.unitText ? `${parsed.unitText} ` : '';
            const noteSuffix = parsed.extra ? ` (${parsed.extra})` : '';
            const capIngredient = capitalize(parsed.ingredient);
            finalDisplayStr = `${amtStr}${unitStr}${capIngredient}${noteSuffix}`.trim();
          }
        }
        tempIngredients.push({ text: finalDisplayStr, isProcessing: false, processedData });
      }

      uiIngredients.value = consolidateIngredients(tempIngredients, docLang);
      uiIngredients.value.push({ text: '', isProcessing: false, processedData: null });

      const rawInstructions = extractInstructions(jsonLdRecipe.recipeInstructions);
      let maxOvenTemp = 0;
      let ovenUnit = '°C';

      preparationSteps.value = rawInstructions.map((text, idx) => {
        const parsedInst = parseInstruction(text, docLang);
        if (parsedInst && parsedInst.temperature > maxOvenTemp) {
          maxOvenTemp = parsedInst.temperature;
          ovenUnit = parsedInst.temperatureUnitText || parsedInst.temperatureUnit || '°C';
        }
        return { stepNumber: idx + 1, description: text, ingredients: [], _showIngredientsUI: false };
      });

      if (maxOvenTemp > 0) recipeData.value.ovensettings = `${maxOvenTemp} ${ovenUnit}`;
      preparationSteps.value.push({ stepNumber: preparationSteps.value.length + 1, description: '', ingredients: [], _showIngredientsUI: false });

      $q.notify({ type: 'positive', message: 'Rezept blitzschnell importiert! ⚡' });
      showImportDialog.value = false;
      return;
    }

    // --- KI FALLBACK (Übersetzung & Einheiten-Umrechnung) ---
    if (!apiKey) throw new Error("Kein API Key vorhanden.");

    const videoDesc = extractVideoDescription(rawHtml);
    const cleanHtml = rawHtml.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gm, "").replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gm, "");
    const availableCategoryNames = categories.value.map(c => c.label).join(', ');

    // SPEED-FIX: Datenmenge für die KI drastisch reduzieren!
    let contentToSend = "";
    if (videoDesc && importTab.value === 'url' && (importUrl.value.includes('youtube') || importUrl.value.includes('youtu.be') || importUrl.value.includes('tiktok') || importUrl.value.includes('instagram'))) {
      // Wenn es ein Video ist, reicht meist die Beschreibung. Wir ignorieren den lahmen HTML-Code.
      contentToSend = `Dies ist ein Video. Hier ist die Beschreibung mit dem Rezept:\n"${videoDesc}"`;
    } else {
      // Bei normalen Webseiten nehmen wir nur die ersten 10.000 Zeichen statt 25.000
      contentToSend = `HTML-Inhalt:\n${cleanHtml.substring(0, 10000)}`;
    }

    let prompt = `Extrahiere das Rezept aus folgendem Inhalt.`;

    if (autoTranslate.value) {
      prompt += `
      WICHTIGE ANWEISUNGEN FÜR ÜBERSETZUNG & EINHEITEN:
      1. Antworte AUSSCHLIESSLICH auf DEUTSCH.
      2. RECHNE US-EINHEITEN UM: Cups/Oz/Lbs in Gramm (g) oder Milliliter (ml). Fahrenheit in Celsius (°C). "1 Stick of Butter" = 115g.`;
    }

    prompt += `
    3. KATEGORIE: Wähle aus: [${availableCategoryNames}].
    4. ZUTATEN-NAMEN: "singularName" darf NUR die reine Zutat enthalten (z.B. "Knoblauch" oder "garlic"). KEINE Mengen oder Einheiten im Namen!

    Inhalt: ${contentToSend}`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-flash-latest",
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING },
            recipeamount: { type: SchemaType.NUMBER },
            ovensettings: { type: SchemaType.STRING },
            category: { type: SchemaType.STRING },
            image: { type: SchemaType.STRING },
            ingredients: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  amount: { type: SchemaType.NUMBER },
                  unit: { type: SchemaType.STRING },
                  singularName: { type: SchemaType.STRING },
                  pluralName: { type: SchemaType.STRING },
                  displayName: { type: SchemaType.STRING },
                  note: { type: SchemaType.STRING }
                },
                required: ["amount", "unit", "singularName", "pluralName", "displayName"]
              }
            },
            preparationSteps: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: { stepNumber: { type: SchemaType.NUMBER }, description: { type: SchemaType.STRING } },
                required: ["stepNumber", "description"]
              }
            }
          },
          required: ["name", "ingredients", "preparationSteps"]
        }
      }
    });

    const result = await model.generateContent(prompt);

    // ABSTURZ-FIX: KI-Antwort bereinigen, falls sie Markdown-Tags (` ```json `) enthält
    const rawResponseText = result.response.text();
    const cleanJsonString = rawResponseText.replace(/```json/gi, '').replace(/```/gi, '').trim();
    const aiRecipe = JSON.parse(cleanJsonString) as AIParsedRecipe;

    recipeData.value.name = aiRecipe.name;
    uiRecipeAmount.value = aiRecipe.recipeamount ? `${aiRecipe.recipeamount} Portionen` : '2 Portionen';
    recipeData.value.ovensettings = aiRecipe.ovensettings || '';
    recipeData.value.source = importTab.value === 'url' ? importUrl.value : 'Importiert';
    if (aiRecipe.image) recipeData.value.image = aiRecipe.image;

    if (aiRecipe.category) {
      const foundCat = categories.value.find(c => c.label.toLowerCase() === aiRecipe.category?.toLowerCase());
      if (foundCat) recipeData.value.category = foundCat.value;
    }

    const tempIngredients: UIIngredient[] = [];

    for (const ing of aiRecipe.ingredients) {
      const capSingular = capitalize(ing.singularName);
      const existingIng = await getIngredientByName(capSingular);
      let finalID = '';
      let finalImage = '';

      if (existingIng) {
        finalID = existingIng.id;
        finalImage = existingIng.image || '';
      } else {
        finalID = await addIngredient({
          name: ing.singularName,
          plural: capitalize(ing.pluralName),
          categoryId: '',
          image: ''
        });
      }

      // DOPPEL-WÖRTER-FIX: Wir nutzen streng nur den SingularName
      const nameToShow = capitalize(ing.singularName);
      const noteText = ing.note || '';

      const processed: LocalIngredient = {
        ingredientID: finalID,
        amount: ing.amount > 0 ? ing.amount : null,
        unit: ing.unit,
        name: nameToShow,
        image: finalImage
      };
      if (noteText) processed.note = noteText;

      const amtStr = ing.amount > 0 ? `${ing.amount} ` : '';
      const unitStr = ing.unit ? `${ing.unit} ` : '';
      const noteSuffix = noteText ? ` (${noteText})` : '';

      tempIngredients.push({
        text: `${amtStr}${unitStr}${nameToShow}${noteSuffix}`.trim(),
        isProcessing: false,
        processedData: processed
      });
    }

    uiIngredients.value = consolidateIngredients(tempIngredients, 'de');
    uiIngredients.value.push({ text: '', isProcessing: false, processedData: null });

    preparationSteps.value = aiRecipe.preparationSteps.map(step => ({
      stepNumber: step.stepNumber,
      description: step.description,
      ingredients: [],
      _showIngredientsUI: false
    }));
    preparationSteps.value.push({
      stepNumber: preparationSteps.value.length + 1,
      description: '',
      ingredients: [],
      _showIngredientsUI: false
    });

    knownIngredients.value = await getIngredients();

    $q.notify({ type: 'positive', message: 'Import mit KI erfolgreich!', icon: 'auto_awesome' });
    showImportDialog.value = false;

  } catch (error: unknown) {
    let msg = 'Import fehlgeschlagen.';
    if (error instanceof Error) {
      if (error.message.includes('429')) msg = 'KI-Limit erreicht. Bitte warte ca. 1 Minute.';
      else if (error.message.includes('JSON')) msg = 'KI hat unverständliche Daten gesendet. Bitte erneut versuchen.';
      console.error("Fehlerdetails:", error);
    }
    $q.notify({ type: 'negative', message: msg });
  } finally {
    isImporting.value = false;
  }
};

const triggerFileInput = () => { fileInputRef.value?.pickFiles(); };

const onFileSelected = (file: File | null) => {
  if (!file) { imageFileToUpload.value = null; localImagePreview.value = ''; return; }
  imageFileToUpload.value = file;
  localImagePreview.value = URL.createObjectURL(file);

  // Wenn ein lokales Bild gewählt wird, leeren wir zur Sicherheit das URL-Feld
  recipeData.value.image = '';
};

const removeImage = () => {
  imageFileToUpload.value = null;
  localImagePreview.value = '';
  recipeData.value.image = '';
};

// --- NEU: Wenn eine Bild-URL eingefügt wird ---
const onImageUrlInput = (val: string | number | null) => {
  if (val && String(val).trim() !== '') {
    // Wenn ein Link da ist, verwerfen wir einen evtl. lokalen Datei-Upload
    imageFileToUpload.value = null;
    localImagePreview.value = '';
  }
};

const uploadImageToCloudinary = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Bild-Upload fehlgeschlagen');
  const data = await response.json();
  return data.secure_url;
};

const loadCategories = async () => {
  try {
    const catsData = await getRecipeCategories();
    categories.value = catsData.map(c => ({ label: c.name, value: c.id }));
  } catch (e) { console.error(e); }
};

const removeIngredientFromStep = (stepIndex: number, ingIndex: number) => {
  const step = preparationSteps.value[stepIndex];
  if (step) step.ingredients.splice(ingIndex, 1);
};

const addIngredientToStep = (stepIndex: number) => {
  const step = preparationSteps.value[stepIndex];
  if (!step) return;
  const selectedIng = step._tempIngredient;

  if (selectedIng && step._tempAmount) {
    const newIng: LocalIngredient = {
      ingredientID: selectedIng.ingredientID,
      name: selectedIng.name,
      amount: step._tempAmount,
      unit: selectedIng.unit,
    };
    if (selectedIng.image) newIng.image = selectedIng.image;
    if (selectedIng.note) newIng.note = selectedIng.note;

    step.ingredients.push(newIng);
    step._tempIngredient = null;
    step._tempAmount = null;
  }
};

const submitRecipe = async () => {
  if (hasUnprocessedIngredients.value) {
    await processAllIngredients();
    if (hasUnprocessedIngredients.value) {
      $q.notify({ type: 'warning', message: 'Einige Zutaten konnten nicht analysiert werden. Bitte prüfen.' });
      return;
    }
  }

  isSaving.value = true;
  try {
    let finalAmount = 1;
    let finalUnit = 'Portionen';
    const amountStr = uiRecipeAmount.value.trim();

    if (imageFileToUpload.value) {
      try {
        const uploadedUrl = await uploadImageToCloudinary(imageFileToUpload.value);
        recipeData.value.image = uploadedUrl;
      } catch (uploadError) {
        console.error("Bild-Upload Fehler:", uploadError);
        $q.notify({ type: 'negative', message: 'Das Bild konnte nicht hochgeladen werden.' });
        isSaving.value = false; return;
      }
    }

    if (amountStr) {
      const match = amountStr.match(/^([\d.,]+)\s*(.*)$/);
      if (match && match[1]) {
        finalAmount = parseFloat(match[1].replace(',', '.'));
        finalUnit = match[2]?.trim() || 'Portionen';
      } else {
        finalUnit = amountStr;
      }
    }

    const validIngredients: IngredientItem[] = uiIngredients.value
      .filter(ui => ui.processedData !== null && ui.text.trim() !== '')
      .map(ui => {
        const item: IngredientItem = {
          ingredientID: ui.processedData!.ingredientID,
          amount: ui.processedData!.amount || 0, // In Firestore als 0 speichern, wenn null
          unit: ui.processedData!.unit,
        };
        if (ui.processedData!.note) item.note = ui.processedData!.note;
        return item;
      });

    let currentStepNum = 1;
    const validSteps = preparationSteps.value
      .filter(step => step.description.trim() !== '')
      .map(step => ({
        stepNumber: currentStepNum++,
        description: step.description,
        ingredients: step.ingredients.map(ing => {
          const item: IngredientItem = {
            ingredientID: ing.ingredientID,
            amount: ing.amount || 0,
            unit: ing.unit,
          };
          if (ing.note) item.note = ing.note;
          return item;
        })
      }));

    const finalData = {
      ...recipeData.value,
      recipeamount: { amount: finalAmount, unit: finalUnit },
      ingredients: validIngredients,
      preparationSteps: validSteps
    } as Recipe;

    if (editId.value) {
      await updateRecipe(editId.value, finalData);
      $q.notify({ type: 'positive', message: 'Rezept aktualisiert!' });
    } else {
      await addRecipe(finalData);
      $q.notify({ type: 'positive', message: 'Rezept gespeichert!' });
    }
    void router.push('/');
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Fehler beim Speichern' });
  } finally {
    isSaving.value = false;
  }
};

onMounted(async () => {
  await loadCategories();
  knownIngredients.value = await getIngredients();

  if (editId.value) {
    try {
      const data = await getRecipeById(editId.value);
      if (data) {
        recipeData.value = { ...data };
        uiRecipeAmount.value = data.recipeamount ? `${data.recipeamount.amount} ${data.recipeamount.unit}`.trim() : '';

        const rawIngs = data.ingredients || [];
        uiIngredients.value = [];

        for (const ing of rawIngs) {
          const flexibleIng = ing as typeof ing & { name?: string };
          let ingName = capitalize(flexibleIng.name || '');
          let ingImage = '';
          const id = getIngredientId(ing);
          const noteText = ing.note;
          const noteSuffix = noteText ? ` (${noteText})` : '';

          if (id) {
            const iData = await getIngredientById(id);
            if (iData) {
              const isPlural = ing.amount !== 1 && ing.amount !== 0;
              const rawDataName = (isPlural && iData.plural && iData.plural.trim() !== '') ? iData.plural : iData.name;
              ingName = capitalize(rawDataName);
              ingImage = iData.image || '';
            }
          }

          const processed: LocalIngredient = {
            ingredientID: id,
            amount: ing.amount > 0 ? ing.amount : null,
            unit: ing.unit,
            name: ingName
          };
          if (ingImage) processed.image = ingImage;
          if (noteText) processed.note = noteText;

          const amtStr = processed.amount ? `${processed.amount} ` : '';
          const unitStr = processed.unit ? `${processed.unit} ` : '';

          uiIngredients.value.push({
            text: `${amtStr}${unitStr}${ingName}${noteSuffix}`.trim(),
            isProcessing: false,
            processedData: processed
          });
        }
        uiIngredients.value.push({ text: '', isProcessing: false, processedData: null });

        preparationSteps.value = (data.preparationSteps || []).map(step => ({
          stepNumber: step.stepNumber,
          description: step.description,
          ingredients: (step.ingredients || []).map(ing => {
            const flexibleIng = ing as typeof ing & { name?: string; ingredientId?: string };
            const baseIng: LocalIngredient = {
              amount: ing.amount > 0 ? ing.amount : null,
              unit: ing.unit,
              name: capitalize(flexibleIng.name || ''),
              ingredientID: getIngredientId(flexibleIng)
            };
            if (ing.note) baseIng.note = ing.note;
            return baseIng;
          }),
          _showIngredientsUI: false
        }));

        preparationSteps.value.push({ stepNumber: preparationSteps.value.length + 1, description: '', ingredients: [], _showIngredientsUI: false });
        await resolveIngredientDetailsForSteps();
      }
    } catch (e) {
      console.error("Fehler beim Laden des Rezepts:", e);
    }
  }
});

const resolveIngredientDetailsForSteps = async () => {
  for (const step of preparationSteps.value) {
    if (step.ingredients) {
      for (const stepIng of step.ingredients) {
        const id = stepIng.ingredientID;
        if (id) {
          const iData = await getIngredientById(id);
          if (iData) {
            if (!stepIng.name) stepIng.name = capitalize(iData.name);
            stepIng.image = iData.image || '';
          }
        }
      }
    }
  }
};
</script>

<template>
  <q-page class="bg-dark-page text-white q-pa-md q-pa-lg-xl">
    <div class="max-width-container">

      <q-form @submit.prevent="submitRecipe">

        <div class="row items-center justify-between q-mb-xl sticky-action-bar z-top">
          <h1 class="text-h4 text-weight-bold q-my-none gt-xs">
            {{ editId ? 'Rezept bearbeiten' : 'Neues Rezept' }}
          </h1>
          <h1 class="text-h5 text-weight-bold q-my-none lt-sm">
            {{ editId ? 'Bearbeiten' : 'Neues Rezept' }}
          </h1>

          <div class="row items-center q-gutter-sm">
            <q-btn outline color="primary" icon="cloud_download" label="Import" @click="showImportDialog = true"
              v-if="!editId" no-caps class="gt-xs" />
            <q-btn outline color="primary" icon="cloud_download" @click="showImportDialog = true" v-if="!editId" no-caps
              class="lt-sm q-px-sm" />

            <q-btn flat color="white" label="Abbrechen" @click="goBack" no-caps class="gt-xs" />
            <q-btn color="primary" icon="save" label="Speichern" type="submit" :loading="isSaving" padding="8px 24px"
              no-caps class="text-weight-bold shadow-4" style="border-radius: 8px;" />
          </div>
        </div>

        <div class="row q-col-gutter-xl">

          <div class="col-12 col-md-5 col-lg-4">
            <div class="sticky-left-column">
              <div class="q-mb-lg relative-position">
                <q-file ref="fileInputRef" v-model="imageFileToUpload" style="display: none" accept="image/*"
                  @update:model-value="onFileSelected" />

                <div class="image-upload-box flex flex-center cursor-pointer q-pa-sm" @click="triggerFileInput">
                  <template v-if="!localImagePreview && !recipeData.image">
                    <div class="text-center text-primary">
                      <q-icon name="add_photo_alternate" size="2.5rem" class="q-mb-sm" />
                      <div class="text-subtitle1 text-weight-medium">Foto hinzufügen</div>
                    </div>
                  </template>
                  <q-img v-else :src="localImagePreview || recipeData.image"
                    class="full-height full-width rounded-borders" style="object-fit: scale-down" />
                </div>

                <q-btn v-if="localImagePreview || recipeData.image" icon="close" color="negative" round dense
                  class="absolute-top-right q-ma-sm shadow-3" style="z-index: 10;" @click.stop="removeImage" />
              </div>

              <q-input v-model="recipeData.image" placeholder="Oder Bild-URL einfügen (z.B. https://...)" filled dark
                dense class="custom-dark-input q-mb-lg" @update:model-value="onImageUrlInput">
                <template v-slot:prepend>
                  <q-icon name="link" size="xs" color="grey-6" />
                </template>
              </q-input>

              <div class="q-mb-md">
                <div class="text-primary text-weight-bold text-subtitle-responsive q-mb-sm">Rezeptname</div>
                <q-input v-model="recipeData.name" placeholder="Name eingeben" filled dark class="custom-dark-input"
                  hide-bottom-space clearable />
              </div>

              <div class="q-mb-md">
                <div class="text-primary text-weight-bold text-subtitle-responsive q-mb-sm">Sonstiges</div>
                <div class="q-gutter-y-sm">
                  <q-select v-model="recipeData.category" :options="categories" label="Rezeptkategorie" filled dark
                    emit-value map-options clearable behavior="menu" class="custom-dark-input" hide-bottom-space />
                  <q-input v-model="uiRecipeAmount" label="Rezeptmenge" filled dark class="custom-dark-input"
                    hide-bottom-space clearable />
                  <q-input v-model="recipeData.ovensettings" label="Ofeneinstellung" filled dark
                    class="custom-dark-input" hide-bottom-space clearable />
                  <q-input v-model="recipeData.source" label="Quelle" filled dark class="custom-dark-input"
                    hide-bottom-space clearable />
                </div>
              </div>
            </div>
          </div>

          <div class="col-12 col-md-7 col-lg-8">

            <div class="q-mb-xl">
              <div class="text-primary text-weight-bold text-subtitle-responsive q-mb-sm">Zutaten</div>

              <VueDraggableNext v-model="uiIngredients" handle=".drag-handle" animation="200"
                ghost-class="drop-ghost-line">
                <div v-for="(ing, index) in uiIngredients" :key="index" class="row items-center no-wrap q-mb-sm">
                  <q-icon v-if="ing.processedData" name="drag_indicator" color="grey-6" size="sm"
                    class="q-mr-sm cursor-pointer drag-handle hover-primary" />

                  <q-input v-model="ing.text" label="Menge und Zutat" filled dark class="custom-dark-input full-width"
                    @update:model-value="handleIngredientEdit(index)" @blur="tryParseLocally(index)" hide-bottom-space>
                    <template v-slot:prepend v-if="ing.processedData?.image">
                      <q-avatar size="24px" rounded><img :src="ing.processedData.image"></q-avatar>
                    </template>
                    <template v-slot:append>
                      <q-spinner v-if="ing.isProcessing" color="primary" size="1em" />
                      <q-icon v-else-if="ing.processedData" name="check_circle" color="primary" />
                    </template>
                  </q-input>
                </div>
              </VueDraggableNext>

              <q-btn v-if="hasUnprocessedIngredients" label="✨ Zutaten mit KI anlegen" color="amber" text-color="dark"
                class="full-width q-mt-sm text-weight-bold" unelevated :loading="isProcessingAll"
                @click="processAllIngredients" style="border-radius: 8px;" />
            </div>

            <div class="text-primary text-weight-bold text-subtitle-responsive q-mb-md">Zubereitungsschritte</div>
            <div v-for="(step, index) in preparationSteps" :key="index" class="q-mb-lg">
              <q-chip square color="primary" text-color="white" class="text-weight-bold q-mb-sm step-chip"
                style="border-radius: 6px;">
                {{ index + 1 }}. Schritt
              </q-chip>
              <div class="step-container shadow-2">
                <q-input v-model="step.description" type="textarea" placeholder="Beschreibung..." filled dark autogrow
                  class="custom-dark-input step-textarea" hide-bottom-space />

                <div class="step-action-bar q-pa-sm">
                  <div class="row items-center q-gutter-sm">
                    <q-chip v-for="(stepIng, ingIndex) in step.ingredients" :key="ingIndex" removable
                      @remove="removeIngredientFromStep(index, ingIndex)" color="primary" text-color="white"
                      class="q-ma-none custom-chip">
                      <q-avatar v-if="stepIng.image"><img :src="stepIng.image"></q-avatar>
                      <q-avatar v-else icon="restaurant" />

                      <span class="text-weight-bold q-mr-xs">{{ stepIng.amount }}{{ stepIng.unit }}</span>
                      <span>{{ stepIng.name }}</span>

                      <span v-if="stepIng.note" class="q-ml-xs text-grey-4" style="font-size: 0.85em;">
                        ({{ stepIng.note }})
                      </span>
                    </q-chip>

                    <q-btn flat rounded no-caps :icon="step._showIngredientsUI ? 'close' : 'add'"
                      :label="(!step._showIngredientsUI && step.ingredients.length === 0) ? 'Zutat hinzufügen' : ''"
                      @click="step._showIngredientsUI = !step._showIngredientsUI" color="white" />
                  </div>

                  <q-slide-transition>
                    <div v-if="step._showIngredientsUI" class="q-mt-sm q-pa-sm bg-dark-soft rounded-borders">
                      <div class="row q-col-gutter-sm items-stretch">
                        <div class="col-12 col-sm-6">
                          <q-select v-model="step._tempIngredient" :options="availableIngredientsForDropdown"
                            option-label="name" label="Zutat" filled dark dense class="custom-dark-input"
                            @update:model-value="(val) => step._tempAmount = val ? val.availableAmount : null">

                            <template v-slot:option="scope">
                              <q-item v-bind="scope.itemProps">
                                <q-item-section avatar v-if="scope.opt.image">
                                  <q-avatar size="sm" rounded><img :src="scope.opt.image"></q-avatar>
                                </q-item-section>
                                <q-item-section>
                                  <q-item-label>
                                    {{ scope.opt.name }}
                                    <span v-if="scope.opt.note" class="text-grey-5 q-ml-xs" style="font-size: 0.85em;">
                                      ({{ scope.opt.note }})
                                    </span>
                                  </q-item-label>
                                  <q-item-label caption class="text-grey-6">
                                    Verfügbar: {{ scope.opt.availableAmount }} {{ scope.opt.unit }}
                                  </q-item-label>
                                </q-item-section>
                              </q-item>
                            </template>

                            <template v-slot:selected-item="scope">
                              <div v-if="scope.opt" class="ellipsis">
                                {{ scope.opt.name }}
                                <span v-if="scope.opt.note" class="text-grey-5 q-ml-xs" style="font-size: 0.85em;">
                                  ({{ scope.opt.note }})
                                </span>
                              </div>
                            </template>

                          </q-select>
                        </div>

                        <div class="col-8 col-sm-4">
                          <q-input v-model.number="step._tempAmount" type="number" label="Menge" filled dark dense
                            class="custom-dark-input" :suffix="step._tempIngredient?.unit"
                            :error="!!step._tempIngredient && (step._tempAmount ?? 0) > step._tempIngredient.availableAmount"
                            :error-message="step._tempIngredient ? `Maximal ${step._tempIngredient.availableAmount} ${step._tempIngredient.unit} verfügbar` : ''" />
                        </div>

                        <div class="col-4 col-sm-2">
                          <q-btn color="primary" icon="check" class="full-height full-width" style="border-radius: 8px;"
                            @click="addIngredientToStep(index)"
                            :disable="!step._tempIngredient || !step._tempAmount || step._tempAmount <= 0 || step._tempAmount > step._tempIngredient.availableAmount" />
                        </div>
                      </div>
                    </div>
                  </q-slide-transition>
                </div>
              </div>
            </div>

            <div class="row justify-end q-mt-xl lt-md">
              <q-btn color="primary" icon="save" label="Rezept speichern" type="submit" :loading="isSaving"
                class="full-width text-weight-bold" padding="12px" style="border-radius: 12px; font-size: 16px;"
                no-caps />
            </div>

          </div>
        </div>
      </q-form>
    </div>

    <q-dialog v-model="showImportDialog" persistent>
      <q-card class="bg-dark text-white" style="width: 500px; max-width: 95vw;">
        <q-card-section class="row items-center">
          <div class="text-h6 text-primary">Rezept importieren</div><q-space /><q-btn icon="close" flat round
            v-close-popup />
        </q-card-section>
        <q-tabs v-model="importTab" class="text-primary" align="justify"><q-tab name="url" label="URL" /><q-tab
            name="text" label="Text" /></q-tabs>
        <q-card-section class="q-pa-md">
          <div class="row items-center q-mb-md bg-dark-soft q-pa-sm rounded-borders">
            <q-icon name="translate" color="primary" size="sm" class="q-mr-sm" />
            <q-item-label class="text-weight-bold flex-grow">Englische Rezepte übersetzen & umrechnen</q-item-label>
            <q-toggle v-model="autoTranslate" color="primary" />
          </div>

          <q-input v-if="importTab === 'url'" v-model="importUrl" label="URL" filled dark class="q-mb-md" />
          <q-input v-else v-model="importText" type="textarea" label="Text" filled dark autogrow class="q-mb-md" />
        </q-card-section>
        <q-card-actions align="right" class="q-pa-md"><q-btn flat label="Abbrechen" v-close-popup /><q-btn
            label="Importieren" color="primary" @click="processImport" :loading="isImporting" /></q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<style scoped>
.bg-dark-page {
  background-color: #161616;
  min-height: 100vh;
}

.max-width-container {
  max-width: 1200px;
  /* Leicht erhöht für besseres Desktop-Feeling */
  margin: 0 auto;
}

/* --- NEU: STICKY BEREICHE FÜR DESKTOP --- */
.sticky-action-bar {
  position: sticky;
  top: 0;
  background-color: rgba(22, 22, 22, 0.95);
  backdrop-filter: blur(10px);
  padding: 16px 0;
  margin-top: -16px;
  /* Gleicht das Seiten-Padding aus */
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

@media (min-width: 1024px) {
  .sticky-left-column {
    position: sticky;
    top: 100px;
    /* Hängt unterhalb der Action-Bar */
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    /* Falls man auf sehr kleinen Laptops ist */
    padding-right: 12px;
    /* Platz für den Scrollbar */
  }

  /* Scrollbar für die linke Spalte unsichtbar machen (Clean Look) */
  .sticky-left-column::-webkit-scrollbar {
    width: 4px;
  }

  .sticky-left-column::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
}

.text-subtitle-responsive {
  font-size: clamp(1rem, 2vw, 1.15rem);
}

.image-upload-box {
  background-color: transparent;
  border: 1px dashed #66a182;
  border-radius: 12px;
  height: clamp(200px, 35vh, 320px);
}

:deep(.custom-dark-input .q-field__control) {
  background-color: #222222 !important;
  border-radius: 8px;
}

:deep(.custom-dark-input .q-field__control:before) {
  border-bottom: none !important;
}

/* KATEGORIE SELECT FIX */
:deep(.category-select.q-field--dense .q-field__control) {
  min-height: 40px !important;
  height: 40px !important;
  padding-top: 0 !important;
  display: flex;
  align-items: center;
}

:deep(.category-select .q-field__native) {
  min-height: 40px !important;
  display: flex;
  align-items: center;
}

:deep(.category-select .q-field__label) {
  top: 10px !important;
  transform: none !important;
  font-size: 14px !important;
}

:deep(.category-select.q-field--float .q-field__label) {
  display: none !important;
}

.step-container {
  background-color: #222222;
  border-radius: 8px;
  overflow: hidden;
}

:deep(.step-textarea .q-field__control) {
  background-color: transparent !important;
  border-radius: 0 !important;
}

.step-action-bar {
  border-top: 1px solid #333;
  background-color: #1e1e1e;
}

.bg-dark-soft {
  background-color: rgba(255, 255, 255, 0.05);
}

.drag-handle {
  touch-action: none;
}

.hover-primary:hover {
  color: #66a182 !important;
}

.drop-ghost-line {
  position: relative;
  background: transparent !important;
}

.drop-ghost-line::after {
  content: "";
  position: absolute;
  top: -4px;
  left: 0;
  right: 0;
  height: 3px;
  background-color: #66a182;
  border-radius: 2px;
}
</style>
