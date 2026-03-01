<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import type { Content } from 'pdfmake/interfaces';
import { auth, db } from '../firebase/index';
import { doc, getDoc } from 'firebase/firestore';


// 1. Zentrale Typen importieren
import type { RecipeFirebase, ShoppingList } from '../types/index';
// 2. Service-Funktionen importieren
import {
  getRecipeById,
  getRecipes,
  getIngredientById,
  deleteRecipe,
  getShoppingList,
  batchUpdateShoppingList
} from '../firebase/services';

// 3. Den neuen Instruction Parser importieren
import { parseInstruction } from '../parser/instructionParser';

// PDF Make Imports
import pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

pdfMake.vfs = pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts.vfs;

// --- HILFS-INTERFACES ---
interface DisplayIngredient {
  id: string;
  amount: number;
  unit: string;
  name: string;
  image: string;
}

interface DisplayStep {
  stepNumber: number;
  description: string;
  ingredients: DisplayIngredient[];
  // NEU: Eindeutige IDs für die Timer hinzugefügt
  extractedTimes: { id: string; seconds: number; text: string }[];
}

interface ActiveTimer {
  id: string;
  remainingSeconds: number;
  originalSeconds: number;
  label: string;
}

interface LocalWakeLockSentinel {
  release: () => Promise<void>;
}
interface NavigatorWithWakeLock {
  wakeLock: {
    request: (type: 'screen') => Promise<LocalWakeLockSentinel>;
  };
}


interface WindowWithAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
  AudioContext?: typeof AudioContext;
}

const route = useRoute();
const router = useRouter();
const $q = useQuasar();

const goBack = () => { void router.back(); };

// --- DATEN MODELLE ---
const isLoading = ref(true);
const recipe = ref<RecipeFirebase | null>(null);
const allRecipes = ref<RecipeFirebase[]>([]);
const timerSound = ref('classic');

const resolvedIngredients = ref<DisplayIngredient[]>([]);
const resolvedSteps = ref<DisplayStep[]>([]);
const selectedIngredientIds = ref<string[]>([]);

const currentServings = ref(1);
const originalServings = ref(1);
const recipeUnit = ref('Portionen');

const factor = computed(() => {
  if (!originalServings.value || originalServings.value <= 0) return 1;
  return currentServings.value / originalServings.value;
});

const formatAmount = (amount: number) => {
  const total = amount * factor.value;
  if (!total) return '';
  return parseFloat(total.toFixed(2)).toString();
};


// --- NEUE MULTI-TIMER LOGIK ---
const activeTimers = ref<ActiveTimer[]>([]);
let masterTimerInterval: ReturnType<typeof setInterval> | null = null;
const showCookingMode = ref(false);
const cookingSlide = ref(1);

// Zieht mit dem Parser alle Zeiten aus einem Fließtext
const extractTimesFromStep = (description: string, stepNum: number) => {
  const result = parseInstruction(description, 'de');
  if (!result || !result.timeItems || result.timeItems.length === 0) return [];

  // FIX: Wir machen jede Timer-ID absolut einzigartig (Schritt + Dauer + Index)
  return result.timeItems.map((item, index) => ({
    id: `step_${stepNum}_${item.timeInSeconds}_${index}`,
    seconds: item.timeInSeconds,
    text: `${item.timeText} ${item.timeUnitText}`
  }));
};

const formatTime = (totalSeconds: number) => {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const toggleTimer = (timerId: string, seconds: number, labelText: string) => {
  const existingIndex = activeTimers.value.findIndex(t => t.id === timerId);

  if (existingIndex > -1) {
    // Wenn er läuft: Sicher stoppen und entfernen
    activeTimers.value.splice(existingIndex, 1);
    checkMasterInterval();
  } else {
    // Wenn er nicht läuft: Hinzufügen
    activeTimers.value.push({
      id: timerId,
      originalSeconds: seconds,
      remainingSeconds: seconds,
      label: labelText
    });

    $q.notify({ type: 'positive', message: `Timer für ${labelText} gestartet!`, icon: 'timer', timeout: 1500 });
    startMasterInterval();
  }
};

const startMasterInterval = () => {
  if (masterTimerInterval) return; // Verhindert doppelte Geschwindigkeiten!

  masterTimerInterval = setInterval(() => {
    // 1. Welche Timer sind jetzt in dieser Sekunde abgelaufen?
    const finishedTimers = activeTimers.value.filter(t => t.remainingSeconds <= 1);

    // 2. Wir löschen die abgelaufenen SOFORT aus der laufenden Liste (verhindert Endlos-Schleifen)
    activeTimers.value = activeTimers.value.filter(t => t.remainingSeconds > 1);

    // 3. Alle noch laufenden Timer um 1 Sekunde reduzieren
    activeTimers.value.forEach(t => t.remainingSeconds--);

    // 4. Den Alarm für die fertigen auslösen
    finishedTimers.forEach(t => {
      timerFinished(t);
    });

    checkMasterInterval();
  }, 1000);
};

const checkMasterInterval = () => {
  if (activeTimers.value.length === 0 && masterTimerInterval) {
    clearInterval(masterTimerInterval);
    masterTimerInterval = null;
  }
};

const playAlarmSound = () => {
  const AudioContextClass = window.AudioContext || (window as unknown as WindowWithAudioContext).webkitAudioContext;
  const ctx = new AudioContextClass();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  // Sound-Profile basierend auf Settings
  if (timerSound.value === 'digital') {
    osc.type = 'square';
    osc.frequency.value = 440;
  } else if (timerSound.value === 'soft') {
    osc.type = 'sine';
    osc.frequency.value = 330;
  } else { // 'classic'
    osc.type = 'sine';
    osc.frequency.value = 880;
  }

  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 1.5);
  osc.stop(ctx.currentTime + 1.5);
};

const timerFinished = (timer: ActiveTimer) => {
  playAlarmSound();
  if (navigator.vibrate) navigator.vibrate([500, 200, 500]);

  $q.dialog({
    title: '⏰ Timer abgelaufen!',
    message: `Der ${timer.label} Timer ist fertig.`,
    persistent: true,
    ok: 'Okay'
  });
};

// Berechnet, wie viel Prozent eines Timers schon vergangen sind (Für die UI: 0.0 bis 1.0)
const getTimerProgress = (timerId: string): number => {
  const t = activeTimers.value.find(x => x.id === timerId);
  if (!t) return 0;
  return (t.originalSeconds - t.remainingSeconds) / t.originalSeconds;
};

// Gibt die verbleibende Zeit als formatierten String zurück
const getActiveTimerDisplay = (timerId: string): string | null => {
  const t = activeTimers.value.find(x => x.id === timerId);
  if (!t) return null;
  return formatTime(t.remainingSeconds);
};

onUnmounted(() => {
  if (masterTimerInterval) {
    clearInterval(masterTimerInterval);
    masterTimerInterval = null;
  }
});


// --- PDF EXPORT LOGIK ---
const isExporting = ref(false);

const getBase64ImageFromURL = (url: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.setAttribute("crossOrigin", "anonymous");
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg"));
      } else {
        reject(new Error("Canvas context is null"));
      }
    };
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
    img.src = url;
  });
};

const exportRecipe = async () => {
  if (!recipe.value) return;
  isExporting.value = true;

  const dismissNotification = $q.notify({
    type: 'ongoing',
    message: 'PDF wird erstellt...'
  });

  try {
    let headerImage: string | null = null;
    if (recipe.value.image) {
      try {
        headerImage = await getBase64ImageFromURL(recipe.value.image);
      } catch {
        console.warn('Bild konnte nicht geladen werden.');
      }
    }

    const half = Math.ceil(resolvedIngredients.value.length / 2);
    const leftIngredients = resolvedIngredients.value.slice(0, half);
    const rightIngredients = resolvedIngredients.value.slice(half);

    const createIngredientLine = (ing: DisplayIngredient) => ({
      text: [
        { text: '• ', color: '#1976D2', bold: true },
        { text: `${formatAmount(ing.amount)} ${ing.unit} `, bold: true },
        { text: ing.name }
      ],
      margin: [0, 2, 0, 2] as [number, number, number, number]
    });

    const stepsList: Content[] = resolvedSteps.value.map((step, index) => {
      const stackElements: Content[] = [
        { text: `Schritt ${index + 1}`, style: 'stepHeader' },
        {
          text: step.description,
          style: 'stepText',
          margin: [0, 0, 0, (step.ingredients && step.ingredients.length > 0) ? 2 : 10]
        }
      ];

      if (step.ingredients && step.ingredients.length > 0) {
        const ingTexts = step.ingredients.map((ing, i) => {
          const isLast = i === step.ingredients.length - 1;
          return {
            text: `${formatAmount(ing.amount)} ${ing.unit} ${ing.name}${isLast ? '' : ', '}`,
            color: '#444'
          };
        });

        stackElements.push({
          text: [
            { text: 'Benötigt: ', color: '#1976D2', bold: true, fontSize: 10 },
            ...ingTexts
          ],
          margin: [0, 5, 0, 0],
          fontSize: 10,
          background: '#f5f5f5'
        });
      }

      stackElements.push({ text: '', margin: [0, 0, 0, 15] });

      return { stack: stackElements };
    });

    const docDefinition: TDocumentDefinitions = {
      info: { title: recipe.value.name, author: 'Culinario App' },
      content: [
        { text: recipe.value.name, style: 'header' },
        {
          columns: [
            { width: 'auto', text: `${currentServings.value} ${recipeUnit.value}`, bold: true, color: '#555' },
            { width: '*', text: recipe.value.category ? ` |  ${recipe.value.category}` : '', color: '#777' }
          ],
          margin: [0, 0, 0, 10]
        },
        headerImage ? { image: headerImage, width: 500, margin: [0, 0, 0, 20] } : { text: '', margin: [0, 0, 0, 10] },
        { text: 'Zutaten', style: 'subheader' },
        {
          columns: [
            { stack: leftIngredients.map(createIngredientLine) },
            { stack: rightIngredients.map(createIngredientLine) }
          ],
          columnGap: 20,
          margin: [0, 0, 0, 30]
        },
        { text: 'Zubereitung', style: 'subheader' },
        { stack: stepsList }
      ],
      styles: {
        header: { fontSize: 24, bold: true, color: '#1976D2', margin: [0, 0, 0, 5] },
        subheader: { fontSize: 18, bold: true, color: '#333', margin: [0, 0, 0, 10], decoration: 'underline', decorationColor: '#1976D2' },
        stepHeader: { fontSize: 13, bold: true, color: '#1976D2', margin: [0, 10, 0, 5] },
        stepText: { fontSize: 12, lineHeight: 1.4, color: '#212121' }
      },
      defaultStyle: { fontSize: 11, color: '#212121' }
    };

    pdfMake.createPdf(docDefinition).open();

    dismissNotification();
    $q.notify({ type: 'positive', message: 'PDF erstellt!' });

  } catch (error) {
    console.error(error);
    dismissNotification();
    $q.notify({ type: 'negative', message: 'Fehler beim PDF Export' });
  } finally {
    isExporting.value = false;
  }
};

// --- EINKAUFSLISTEN LOGIK ---
const isAddingToCart = ref(false);
const showShoppingListDialog = ref(false);

const openShoppingListDialog = () => {
  selectedIngredientIds.value = resolvedIngredients.value.map(i => i.id);
  showShoppingListDialog.value = true;
};

const selectAllIngredients = () => {
  if (selectedIngredientIds.value.length === resolvedIngredients.value.length) {
    selectedIngredientIds.value = [];
  } else {
    selectedIngredientIds.value = resolvedIngredients.value.map(i => i.id);
  }
};

const executeAddToShoppingList = async () => {
  await addToShoppingList();
  showShoppingListDialog.value = false;
};

const addToShoppingList = async () => {
  if (selectedIngredientIds.value.length === 0) {
    $q.notify({ type: 'warning', message: 'Bitte wähle mindestens eine Zutat aus.' });
    return;
  }
  isAddingToCart.value = true;

  try {
    const currentList = await getShoppingList();
    const itemsToUpdate: { docId: string; amount: number }[] = [];
    const itemsToAdd: ShoppingList[] = [];

    for (const ingId of selectedIngredientIds.value) {
      const ingredientData = resolvedIngredients.value.find(i => i.id === ingId);
      if (!ingredientData) continue;

      const amountToAdd = ingredientData.amount * factor.value;
      const existingItem = currentList.find(
        item => item.ingredientid === ingId && item.unit === ingredientData.unit
      );

      if (existingItem) {
        const newAmount = existingItem.amount + amountToAdd;
        itemsToUpdate.push({ docId: existingItem.id, amount: parseFloat(newAmount.toFixed(2)) });
      } else {
        itemsToAdd.push({
          ingredientid: ingId,
          amount: parseFloat(amountToAdd.toFixed(2)),
          unit: ingredientData.unit,
          checked: false
        });
      }
    }

    if (itemsToUpdate.length > 0 || itemsToAdd.length > 0) {
      await batchUpdateShoppingList(itemsToUpdate, itemsToAdd);
    }

    $q.notify({
      type: 'positive',
      message: `${itemsToAdd.length} neue hinzugefügt, ${itemsToUpdate.length} bestehende erhöht!`,
      icon: 'shopping_cart'
    });
    selectedIngredientIds.value = [];
  } catch (error) {
    console.error(error);
    $q.notify({ type: 'negative', message: 'Fehler beim Hinzufügen.' });
  } finally {
    isAddingToCart.value = false;
  }
};

// --- LÖSCHEN LOGIK ---
const deleteRecipeDialog = () => {
  $q.dialog({
    title: 'Rezept löschen',
    message: `Möchtest du "${recipe.value?.name}" wirklich unwiderruflich löschen?`,
    cancel: true,
    persistent: true
  }).onOk(() => {
    void performDelete();
  });
};

const performDelete = async () => {
  try {
    const recipeId = route.params.id as string;
    await deleteRecipe(recipeId);
    $q.notify({ type: 'positive', message: 'Rezept gelöscht.' });
    void router.push('/');
  } catch (error) {
    console.error("Löschen fehlgeschlagen:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Löschen.' });
  }
};

// --- WAKE LOCK ---
let wakeLock: LocalWakeLockSentinel | null = null;
const requestWakeLock = async () => {
  if ('wakeLock' in navigator) {
    try {
      const nav = navigator as unknown as NavigatorWithWakeLock;
      wakeLock = await nav.wakeLock.request('screen');
    } catch (err: unknown) { console.error(err); }
  }
};

const releaseWakeLock = async () => {
  if (wakeLock !== null) {
    await wakeLock.release();
    wakeLock = null;
  }
};

// --- KOCHMODUS START ---
const currentStepData = computed(() => {
  if (!resolvedSteps.value || resolvedSteps.value.length === 0) return null;
  return resolvedSteps.value[cookingSlide.value - 1];
});

const nextCookingStep = () => {
  if (cookingSlide.value < resolvedSteps.value.length) {
    cookingSlide.value++;
  }
};

const prevCookingStep = () => {
  if (cookingSlide.value > 1) {
    cookingSlide.value--;
  }
};

const startCooking = () => {
  cookingSlide.value = 1;
  showCookingMode.value = true;
  void requestWakeLock();
};

const closeCooking = () => {
  showCookingMode.value = false;
  void releaseWakeLock();

  // FIX: Alle Timer wirklich abschießen, wenn man den Modus verlässt
  if (masterTimerInterval) {
    clearInterval(masterTimerInterval);
    masterTimerInterval = null;
  }
  activeTimers.value = [];
};

// --- INIT ---
onMounted(async () => {
  const userSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
  if (userSnap.exists()) {
    timerSound.value = userSnap.data().timerSound || 'classic';
  }

  try {
    allRecipes.value = await getRecipes();
  } catch (e) { console.error("Fehler beim Laden der Sidebar-Rezepte", e); }

  let recipeId = route.params.id;
  if (Array.isArray(recipeId)) recipeId = recipeId[0];
  if (!recipeId) return;

  try {
    const data = await getRecipeById(recipeId);

    if (!data) {
      void router.push('/');
      return;
    }

    recipe.value = data;

    const rawAmount = data.recipeamount;
    let servings = 1;
    let unitText = 'Portionen';

    if (typeof rawAmount === 'object' && rawAmount !== null) {
      servings = Number(rawAmount.amount) || 1;
      if ('unit' in rawAmount && rawAmount.unit) {
        unitText = String(rawAmount.unit);
      }
    } else {
      servings = Number(rawAmount) || 1;
    }

    originalServings.value = servings;
    currentServings.value = servings;
    recipeUnit.value = unitText;

    const rawIngredients = data.ingredients || [];
    const rawSteps = data.preparationSteps || [];

    const uniqueIDs = new Set<string>();

    rawIngredients.forEach((ing) => {
      const id = ing.ingredientID || (ing as typeof ing & { ingredientId?: string }).ingredientId;
      if (id) uniqueIDs.add(id);
    });

    rawSteps.forEach((step) => {
      if (step.ingredients) {
        step.ingredients.forEach((stepIng) => {
          const id = stepIng.ingredientID || (stepIng as typeof stepIng & { ingredientId?: string }).ingredientId;
          if (id) uniqueIDs.add(id);
        });
      }
    });

    const ingredientDataDict: Record<string, { name: string, image: string }> = {};

    await Promise.all(Array.from(uniqueIDs).map(async (id) => {
      const ingData = await getIngredientById(id);
      if (ingData) {
        ingredientDataDict[id] = { name: ingData.name, image: ingData.image || '' };
      } else {
        ingredientDataDict[id] = { name: 'Unbekannt', image: '' };
      }
    }));

    resolvedIngredients.value = rawIngredients.map((ing) => {
      const id = ing.ingredientID || (ing as typeof ing & { ingredientId?: string }).ingredientId || 'unknown';
      return {
        id: id,
        amount: Number(ing.amount) || 0,
        unit: ing.unit,
        name: ingredientDataDict[id]?.name || 'Unbekannte Zutat',
        image: ingredientDataDict[id]?.image || ''
      };
    });

    // HIER WIRD DER NEUE PARSER MIT SCHRITT-NUMMERN EINGESETZT
    resolvedSteps.value = rawSteps.map((step) => ({
      stepNumber: step.stepNumber,
      description: step.description,
      extractedTimes: extractTimesFromStep(step.description, step.stepNumber),
      ingredients: (step.ingredients || []).map((stepIng) => {
        const id = stepIng.ingredientID || (stepIng as typeof stepIng & { ingredientId?: string }).ingredientId || 'unknown';
        return {
          id: id,
          amount: Number(stepIng.amount) || 0,
          unit: stepIng.unit,
          name: ingredientDataDict[id]?.name || 'Unbekannte Zutat',
          image: ingredientDataDict[id]?.image || ''
        };
      })
    }));

  } catch (error) {
    console.error('Fehler beim Laden:', error);
  } finally {
    isLoading.value = false;
  }
});
</script>

<template>
  <q-page class="bg-dynamic-page dynamic-text full-height row no-wrap items-start transition-ease">

    <div class="recipe-sidebar gt-sm bg-dynamic-sidebar dynamic-sidebar-border scroll">
      <div class="q-pa-md sticky-sidebar-header z-top dynamic-border-bottom">
        <div class="text-subtitle1 text-weight-bold text-primary text-uppercase" style="letter-spacing: 1px;">
          Weitere Rezepte
        </div>
      </div>

      <div class="q-pa-md q-gutter-y-md">
        <q-card v-for="r in allRecipes" :key="r.id"
          class="sidebar-recipe-card dynamic-card cursor-pointer relative-position transition-ease"
          :class="{ 'active-recipe-card': r.id === route.params.id }" flat @click="router.push(`/recipe/${r.id}`)">

          <q-img :src="r.image || 'placeholder.jpg'" :ratio="16 / 9" class="sidebar-recipe-image" />

          <q-card-section class="q-py-sm text-center ">
            <div class="text-subtitle2 text-weight-bolder ellipsis transition-ease"
              :class="r.id === route.params.id ? 'text-primary' : 'dynamic-text'">
              {{ r.name }}
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>

    <div class="col scroll relative-position full-height content-scroll-area">

      <div v-if="isLoading" class="flex flex-center full-height" style="min-height: 50vh;">
        <q-spinner-dots color="primary" size="3em" />
      </div>

      <div v-else-if="!recipe" class="text-center q-pa-xl dynamic-text-muted">
        <q-icon name="error_outline" size="4em" color="negative" />
        <div class="text-h6 q-mt-md">Rezept nicht gefunden</div>
      </div>

      <div v-else class="content-wrapper q-pb-xl">

        <div class="header-image-container relative-position lt-md">
          <q-img :src="recipe.image || 'placeholder.jpg'" class="recipe-main-image" />
          <div class="absolute-top row justify-between q-pa-md" style="width: 100%;">
            <q-btn round flat icon="arrow_back" color="white" class="glass-btn" @click="goBack" />
            <div class="row q-gutter-sm">
              <q-btn round flat icon="more_vert" color="white" class="glass-btn">
                <q-menu :dark="$q.dark.isActive" class="bg-dynamic-soft dynamic-text">
                  <q-list>
                    <q-item clickable :to="`/add-recipe?edit=${route.params.id}`">
                      <q-item-section avatar><q-icon name="edit" class="dynamic-text" /></q-item-section>
                    </q-item>
                    <q-item clickable @click="exportRecipe">
                      <q-item-section avatar><q-icon name="picture_as_pdf" class="dynamic-text" /></q-item-section>
                    </q-item>
                    <q-item clickable @click="deleteRecipeDialog">
                      <q-item-section avatar><q-icon name="delete" color="red-4" /></q-item-section>
                    </q-item>
                  </q-list>
                </q-menu>
              </q-btn>
              <q-btn round flat icon="shopping_cart" color="white" class="glass-btn" @click="openShoppingListDialog" />
            </div>
          </div>
        </div>

        <div class="main-content-card q-pa-md q-pa-md-xl bg-dynamic-page">

          <div
            class="row items-center justify-between q-mb-xl gt-sm sticky-desktop-header rounded-borders dynamic-card dynamic-border">
            <h1 class="text-h4 text-weight-bold q-my-none q-pl-md dynamic-text">{{ recipe.name }}</h1>
            <div class="row q-gutter-sm q-pr-md">
              <q-btn flat icon="edit" no-caps class="dynamic-text-muted hover-primary transition-ease"
                :to="`/add-recipe?edit=${route.params.id}`" />
              <q-btn flat icon="picture_as_pdf" no-caps class="dynamic-text-muted hover-primary transition-ease"
                @click="exportRecipe" />
              <q-btn flat icon="shopping_cart" no-caps
                class="dynamic-text-muted hover-primary transition-ease text-weight-bold"
                @click="openShoppingListDialog" />
            </div>
          </div>

          <h1 class="text-h4 text-weight-bold q-my-none q-mb-md lt-md dynamic-text">{{ recipe.name }}</h1>

          <div class="row q-col-gutter-xl">
            <div class="col-12 col-md-5 col-lg-4">
              <q-img :src="recipe.image || 'placeholder.jpg'" class="recipe-desktop-image gt-sm q-mb-lg shadow-10" />

              <div v-if="recipe.source || recipe.ovensettings"
                class="row items-center recipe-details-box dynamic-card dynamic-border q-mb-lg">
                <div class="col flex flex-center" v-if="recipe.source">
                  <a v-if="recipe.source.startsWith('http')" :href="recipe.source" target="_blank"
                    class="dynamic-text text-weight-bold link-no-decoration q-py-sm hover-primary transition-ease">
                    {{ recipe.source.toLowerCase().includes('youtube') ? 'YouTube' : 'Webseite' }}
                  </a>
                  <span v-else class="dynamic-text text-weight-bold q-py-sm">Webseite</span>
                </div>
                <div v-if="recipe.ovensettings" class="vertical-divider"></div>
                <div class="col flex flex-center" v-if="recipe.ovensettings">
                  <span class="dynamic-text text-weight-bold q-py-sm">{{ recipe.ovensettings }}</span>
                </div>
              </div>

              <div class="row items-center justify-between q-mb-md">
                <div class="text-h6 text-primary text-weight-bold">Zutaten</div>
                <div class="servings-adjuster dynamic-card dynamic-border row items-center no-wrap">
                  <q-btn flat dense size="sm" class="hover-primary transition-ease dynamic-text" icon="remove"
                    @click="currentServings > 1 ? currentServings-- : null" />
                  <div class="text-weight-bold q-px-md text-subtitle1 dynamic-text">{{ currentServings }} {{ recipeUnit
                  }}</div>
                  <q-btn flat dense size="sm" icon="add" class="hover-primary transition-ease dynamic-text"
                    @click="currentServings++" />
                </div>
              </div>

              <div class="ingredients-list">
                <div v-for="ing in resolvedIngredients" :key="ing.id" class="row items-center q-py-sm ingredient-row">
                  <q-avatar size="32px" class="q-mr-md rounded-borders bg-dynamic-soft shadow-1 dynamic-border">
                    <img v-if="ing.image" :src="ing.image" style="object-fit: cover;" />
                    <q-icon v-else name="restaurant" size="16px" class="dynamic-text-muted" />
                  </q-avatar>
                  <div class="text-body1 dynamic-text">
                    <span class="text-weight-bold text-primary">{{ formatAmount(ing.amount) }}</span> {{ ing.unit }} {{
                      ing.name }}
                  </div>
                </div>
              </div>
            </div>

            <div class="col-12 col-md-7 col-lg-8">
              <div class="text-h6 text-primary text-weight-bold q-mb-md">Zubereitung</div>

              <div v-for="step in resolvedSteps" :key="step.stepNumber" class="q-mb-xl preparation-step-block">
                <div class="row items-center q-mb-sm">
                  <q-badge color="primary" class="q-px-sm q-py-xs text-weight-bold text-subtitle2"
                    style="border-radius: 6px;">
                    {{ step.stepNumber }}. Schritt
                  </q-badge>

                  <div v-if="step.extractedTimes.length > 0" class="row q-ml-md q-gutter-sm">
                    <q-chip v-for="timeObj in step.extractedTimes" :key="timeObj.id" icon="timer"
                      class="cursor-pointer shadow-1 text-weight-bold bg-dynamic-soft dynamic-border dynamic-text transition-ease hover-primary-bg"
                      @click="toggleTimer(timeObj.id, timeObj.seconds, timeObj.text)">
                      {{ timeObj.text }}
                    </q-chip>
                  </div>
                </div>

                <p class="text-body1 dynamic-text-muted step-description" v-html="step.description"></p>

                <div class="row q-gutter-xs q-mt-sm" v-if="step.ingredients && step.ingredients.length > 0">
                  <div v-for="(stepIng, ingIndex) in step.ingredients" :key="ingIndex"
                    class="step-ingredient-chip dynamic-card dynamic-border row items-center q-px-sm q-py-xs">
                    <q-avatar v-if="stepIng.image" size="20px" class="q-mr-sm bg-transparent">
                      <img :src="stepIng.image" style="object-fit: cover;" />
                    </q-avatar>
                    <span class="text-weight-medium dynamic-text" style="font-size: 13px;">
                      {{ formatAmount(stepIng.amount) }} {{ stepIng.unit }} {{ stepIng.name }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <q-page-sticky position="bottom-right" :offset="[18, 18]" style="z-index: 99;">
        <q-btn color="primary" icon="restaurant" label="Kochmodus"
          class="kochmodus-btn text-weight-bold shadow-4 transition-ease" no-caps unelevated @click="startCooking" />
      </q-page-sticky>

    </div>

    <q-dialog v-model="showCookingMode" maximized transition-show="slide-up" transition-hide="slide-down">
      <q-card class="bg-dynamic-page dynamic-text full-height flex flex-center" v-if="currentStepData"
        v-touch-swipe.mouse.left="nextCookingStep" v-touch-swipe.mouse.right="prevCookingStep">

        <div class="column no-wrap q-pa-lg full-height" style="width: 100%; max-width: 900px;">

          <div class="row items-start justify-between q-mb-lg q-mt-sm" style="min-height: 50px;">
            <q-btn icon="arrow_back_ios_new" flat round class="dynamic-text glass-btn" @click="closeCooking" />

            <div class="row q-gutter-sm justify-end" style="max-width: 70%;">
              <div v-for="timer in activeTimers" :key="timer.id" class="relative-position">
                <q-btn icon="timer" flat rounded
                  class="text-weight-bold active-timer-badge shadow-5 bg-dynamic-soft dynamic-text dynamic-border"
                  @click="toggleTimer(timer.id, timer.originalSeconds, timer.label)">
                  <span class="q-ml-sm">{{ formatTime(timer.remainingSeconds) }}</span>
                </q-btn>
                <q-linear-progress :value="getTimerProgress(timer.id)" color="positive" class="absolute-bottom"
                  style="border-radius: 0 0 16px 16px; height: 3px;" />
              </div>
            </div>
          </div>

          <div class="col column justify-center">
            <div class="q-mb-lg row items-center">
              <q-badge color="primary" class="q-px-md q-py-sm text-weight-bold"
                style="border-radius: 6px; font-size: 20px;">
                {{ currentStepData.stepNumber }}. Schritt
              </q-badge>
            </div>

            <p class="dynamic-text q-mb-xl"
              style="line-height: 1.6; font-weight: 400; font-size: clamp(1.2rem, 3vw, 1.8rem);">
              {{ currentStepData.description }}
            </p>

            <div class="row q-gutter-md q-mb-xl" v-if="currentStepData.extractedTimes.length > 0">
              <q-btn v-for="timeObj in currentStepData.extractedTimes" :key="timeObj.id" outline rounded
                :color="getActiveTimerDisplay(timeObj.id) ? 'positive' : 'grey-5'"
                class="text-weight-bold shadow-2 timer-start-btn dynamic-text"
                :class="!getActiveTimerDisplay(timeObj.id) ? 'dynamic-border bg-dynamic-soft' : ''"
                @click="toggleTimer(timeObj.id, timeObj.seconds, timeObj.text)">
                <q-icon :name="getActiveTimerDisplay(timeObj.id) ? 'stop_circle' : 'play_circle'" size="sm"
                  class="q-mr-sm" />
                {{ getActiveTimerDisplay(timeObj.id) || `${timeObj.text} Starten` }}
              </q-btn>
            </div>

            <div class="row q-gutter-sm" v-if="currentStepData.ingredients?.length">
              <div v-for="(stepIng, ingIndex) in currentStepData.ingredients" :key="ingIndex"
                class="step-ingredient-chip row items-center q-px-md q-py-sm bg-dynamic-soft dynamic-border">
                <q-avatar v-if="stepIng.image" size="28px" class="q-mr-sm bg-transparent">
                  <img :src="stepIng.image" />
                </q-avatar>
                <span class="text-weight-bold dynamic-text" style="font-size: clamp(0.9rem, 2vw, 1.2rem);">
                  {{ formatAmount(stepIng.amount) }} {{ stepIng.unit }} {{ stepIng.name }}
                </span>
              </div>
            </div>
          </div>

          <div class="row q-gutter-md q-mt-auto q-pb-md">
            <q-btn color="primary" icon="arrow_back" class="col q-py-md cooking-nav-btn shadow-4" no-caps unelevated
              :disable="cookingSlide === 1" @click="prevCookingStep" />
            <q-btn color="primary" icon="arrow_forward" class="col q-py-md cooking-nav-btn shadow-4" no-caps unelevated
              v-if="cookingSlide < resolvedSteps.length" @click="nextCookingStep" />
            <q-btn color="positive" icon="check" class="col q-py-md cooking-nav-btn shadow-4" no-caps unelevated v-else
              @click="closeCooking" />
          </div>

        </div>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showShoppingListDialog" :position="$q.screen.lt.sm ? 'bottom' : 'right'"
      :full-width="$q.screen.lt.sm" :full-height="!$q.screen.lt.sm">
      <q-card class="column no-wrap dynamic-text bg-dynamic-page shopping-list-drawer">
        <q-card-section class="row items-center q-pb-none q-pt-md">
          <div class="text-h6 text-weight-bold">Auf die Einkaufsliste</div>
          <q-space />
          <q-btn icon="close" flat round dense class="dynamic-text-muted" v-close-popup />
        </q-card-section>

        <q-card-section class="q-py-sm row items-center justify-between">
          <span class="dynamic-text-muted text-subtitle2">Zutaten auswählen:</span>
          <q-btn flat dense color="primary"
            :label="selectedIngredientIds.length === resolvedIngredients.length ? 'Auswahl aufheben' : 'Alle auswählen'"
            @click="selectAllIngredients" no-caps class="text-weight-bold" />
        </q-card-section>

        <q-card-section class="col scroll q-pt-none">
          <q-list separator class="bg-dynamic-soft dynamic-border" style="border-radius: 12px;">
            <q-item v-for="ing in resolvedIngredients" :key="ing.id" tag="label" v-ripple class="q-py-md">
              <q-item-section avatar>
                <q-checkbox v-model="selectedIngredientIds" :val="ing.id" color="primary" keep-color />
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-medium text-body1 dynamic-text">{{ ing.name }}</q-item-label>
                <q-item-label caption class="dynamic-text-muted">{{ formatAmount(ing.amount) }} {{ ing.unit
                }}</q-item-label>
              </q-item-section>
            </q-item>
          </q-list>
        </q-card-section>

        <q-card-actions class="q-px-md q-pb-lg q-pt-md bg-dynamic-page">
          <q-btn color="primary" class="full-width q-py-sm shadow-4"
            style="border-radius: 12px; font-size: 16px; font-weight: bold;"
            :label="`Hinzufügen (${selectedIngredientIds.length})`" :loading="isAddingToCart" unelevated
            @click="executeAddToShoppingList" :disable="selectedIngredientIds.length === 0" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<style scoped>
:global(.body--dark) .bg-dynamic-page {
  background-color: #121212;
}

:global(.body--light) .bg-dynamic-page {
  background-color: #f4f6f8;
}

/* --- GLOBALES DESIGN & LAYOUT --- */
.transition-ease {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.hover-primary:hover {
  color: var(--q-primary) !important;
}

.hover-primary-bg:hover {
  background-color: color-mix(in srgb, var(--q-primary), transparent 85%) !important;
  border-color: var(--q-primary) !important;
  color: var(--q-primary) !important;
}

.recipe-sidebar {
  flex: 0 0 240px;
  min-width: 240px;
  max-width: 240px;
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  overflow: hidden !important;
}

.dynamic-sidebar-border {
  border-right: 1px solid rgba(0, 0, 0, 0.12);
}

:global(.body--dark) .dynamic-sidebar-border {
  border-right: 1px solid rgba(255, 255, 255, 0.12);
}

.recipe-sidebar::-webkit-scrollbar {
  display: none !important;
}

.sticky-sidebar-header {
  position: sticky;
  top: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

:global(.body--dark) .sticky-sidebar-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

/* Sidebar Recipe Cards */
.sidebar-recipe-card {
  border-radius: 12px;
}

.sidebar-recipe-card:hover {
  transform: translateY(-2px);
}

.active-recipe-card {
  border-color: var(--q-primary) !important;
  box-shadow: 0 0 0 1px var(--q-primary) !important;
}

.sidebar-recipe-image {
  border-radius: 12px 12px 0 0;
}

.content-scroll-area {
  height: calc(100vh - 50px);
  overflow-y: auto;
}

/* --- REZEPT INHALT STYLES --- */
.content-wrapper {
  max-width: 1200px;
  margin: 0 auto;
}

@media (min-width: 1024px) {
  .main-content-card {
    background-color: transparent !important;
    margin-top: 0 !important;
    padding-top: 20px !important;
  }

  .sticky-desktop-header {
    position: sticky;
    top: 0;
    z-index: 100;
    background-color: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding-top: 16px;
    padding-bottom: 16px;
  }

  :global(.body--dark) .sticky-desktop-header {
    background-color: rgba(22, 22, 22, 0.95);
  }

  .kochmodus-btn {
    border-radius: 12px;
    padding: 12px 24px;
    font-size: 16px;
  }
}

/* MOBILE OPTIMIERUNGEN */
@media (max-width: 1023px) {
  .shopping-list-drawer {
    width: 100vw !important;
    max-width: 100vw !important;
    border-radius: 24px 24px 0 0;
  }

  .kochmodus-btn {
    width: 100%;
    border-radius: 16px;
    padding: 16px 40px;
    font-size: 18px;
  }

  .main-content-card {
    border-radius: 32px 32px 0 0;
    margin-top: -40px;
  }
}

.header-image-container {
  width: 100%;
  height: 45vh;
}

.recipe-main-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.recipe-desktop-image {
  width: 100%;
  border-radius: 24px;
  aspect-ratio: 1 / 1;
  object-fit: cover;
}

/* INHALTS-STYLING */
.step-description {
  line-height: 1.7;
  white-space: pre-wrap;
  font-size: 1.1rem;
}

.ingredient-row {
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

:global(.body--dark) .ingredient-row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.recipe-details-box {
  border-radius: 16px;
  min-height: 54px;
}

.step-ingredient-chip {
  border-radius: 8px;
  transition: transform 0.2s;
}

.step-ingredient-chip:hover {
  transform: translateY(-2px);
}

.vertical-divider {
  width: 1px;
  height: 24px;
  background-color: rgba(0, 0, 0, 0.15);
}

:global(.body--dark) .vertical-divider {
  background-color: rgba(255, 255, 255, 0.15);
}

/* Der Glass-Button bleibt dunkel-transparent, da er meist über Bildern liegt */
.glass-btn {
  background: rgba(30, 30, 30, 0.5);
  backdrop-filter: blur(8px);
  color: white !important;
}

.servings-adjuster {
  border-radius: 12px;
  padding: 4px;
}

/* NEUE TIMER STYLES */
.active-timer-badge {
  border: 1px solid var(--q-primary);
  border-radius: 16px;
  transition: all 0.3s ease;
}

.active-timer-badge:hover {
  background-color: color-mix(in srgb, var(--q-primary), transparent 80%) !important;
}

.timer-start-btn {
  border-width: 2px;
  font-size: 16px;
  padding: 8px 24px;
}

.link-no-decoration {
  text-decoration: none;
}

.shopping-list-drawer {
  display: flex;
  flex-direction: column;
  margin: 0 !important;
}

.scroll {
  flex-grow: 1;
}
</style>

<style>
.shopping-list-drawer .shopping-list-drawer__inner {
  padding: 0 !important;
}
</style>
