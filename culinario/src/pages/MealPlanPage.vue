<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { date, useQuasar } from 'quasar';
import { auth } from '../firebase/index';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/index';

// 1. Zentrale Typen
import type { RecipeFirebase, ShoppingList } from '../types/index';

// 2. Service-Funktionen
import {
  getRecipes,
  getMealPlans,
  addRecipeToMealPlan,
  removeRecipeFromMealPlan,
  getShoppingList,
  batchUpdateShoppingList,
  getGroupMembers,
  getGroupMemberSettings
} from '../firebase/services';

type MealPlanEntry = string | { recipeId: string; cookId: string };

const $q = useQuasar();
const router = useRouter();

const groupMembers = ref<{ id: string, name: string }[]>([]);
const selectedCookId = ref(auth.currentUser?.uid || '');
const memberSettings = ref<Record<string, { shareMealPlan: boolean }>>({});

const currentAnchorDate = ref(new Date());
// Streng typisiert
const allRecipes = ref<RecipeFirebase[]>([]);
const mealPlans = ref<Record<string, { recipes: MealPlanEntry[] }>>({});
const isAddingToCart = ref(false);

// Picker State
const showPicker = ref(false);
const activeDateString = ref('');
const pickerSearch = ref('');

const weekStart = ref(1);
const hidePastDays = ref(false);

// --- DATEN LADEN ---
onMounted(async () => {
  try {
    const userSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
    if (userSnap.exists()) {
      const data = userSnap.data();
      weekStart.value = data.weekStart ?? 1;
      hidePastDays.value = data.hidePastDays ?? false;
    }

    allRecipes.value = await getRecipes();
    mealPlans.value = await getMealPlans();
    memberSettings.value = await getGroupMemberSettings();
  } catch (error: unknown) {
    console.error("Fehler beim Laden des Wochenplans:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Laden der Daten.' });
  }
});

// --- WOCHEN-LOGIK ---
const weekDays = computed(() => {
  const days = [];
  const todayStart = date.startOfDate(new Date(), 'day');
  const anchorStart = date.startOfDate(currentAnchorDate.value, 'day');

  const dayOfWeek = date.getDayOfWeek(anchorStart);
  let daysToSubtract = 0;
  if (weekStart.value === 1) { // Woche startet Montag
    daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  } else {
    daysToSubtract = dayOfWeek;
  }

  const start = date.subtractFromDate(anchorStart, { days: daysToSubtract });

  for (let i = 0; i < 7; i++) {
    const d = date.addToDate(start, { days: i });
    const dStr = date.formatDate(d, 'YYYY-MM-DD');

    if (hidePastDays.value && d < todayStart) continue;

    const rawEntries = mealPlans.value[dStr]?.recipes || [];

    days.push({
      dateString: dStr,
      displayDate: date.formatDate(d, 'DD.MM.'),
      weekday: date.formatDate(d, 'dddd', {
        days: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
      }),
      isToday: dStr === date.formatDate(new Date(), 'YYYY-MM-DD'),

      // HIER FINDET DIE FILTERUNG STATT:
      plannedRecipes: rawEntries.map((entry: MealPlanEntry) => {
        const rId = typeof entry === 'string' ? entry : entry.recipeId;
        const cId = typeof entry === 'string' ? '' : entry.cookId;

        // 1. Eigene Einträge (cId === meinUid) immer anzeigen
        // 2. Einträge von anderen nur anzeigen, wenn shareMealPlan true ist
        const myUid = auth.currentUser?.uid;
        const isMe = cId === myUid;
        const isShared = memberSettings.value[cId]?.shareMealPlan !== false;

        if (!isMe && !isShared) return null;

        const rData = allRecipes.value.find(r => r.id === rId);
        return rData ? { ...rData, cookId: cId } : null;
      }).filter((r): r is (RecipeFirebase & { cookId: string }) => r !== null)
    });
  }
  return days;
});

const weekRangeLabel = computed(() => {
  const currentDays = weekDays.value;
  if (currentDays.length === 0) return 'Lädt...';
  return `${currentDays[0]?.displayDate} - ${currentDays[currentDays.length - 1]?.displayDate}`;
});

const changeWeek = (offset: number) => {
  currentAnchorDate.value = date.addToDate(currentAnchorDate.value, { days: offset * 7 });
};

const goToRecipe = (recipeId?: string) => {
  if (!recipeId) return;
  void router.push(`/recipe/${recipeId}`);
};

const goToToday = () => { currentAnchorDate.value = new Date(); };

// --- PLANER FUNKTIONEN ---
const openRecipePicker = (dateStr: string) => {
  activeDateString.value = dateStr;
  pickerSearch.value = ''; // Reset Search
  showPicker.value = true;
};

const filteredRecipesForPicker = computed(() => {
  if (!pickerSearch.value) return allRecipes.value;
  const search = pickerSearch.value.toLowerCase();
  return allRecipes.value.filter(r => r.name?.toLowerCase().includes(search));
});

onMounted(async () => {
  try {
    allRecipes.value = await getRecipes();
    const rawPlans = await getMealPlans();

    mealPlans.value = rawPlans;
    groupMembers.value = await getGroupMembers();
  } catch (error: unknown) {
    console.error("Fehler beim Laden:", error);
  }
});

// Update die addRecipeToPlan Funktion:
const addRecipeToPlan = async (recipe: RecipeFirebase) => {
  if (!recipe.id) return;
  const dStr = activeDateString.value;
  const cookId = selectedCookId.value;

  try {
    await addRecipeToMealPlan(dStr, recipe.id, cookId);

    if (!mealPlans.value[dStr]) mealPlans.value[dStr] = { recipes: [] };

    // Ohne 'any', da mealPlans jetzt MealPlanEntry[] erwartet
    mealPlans.value[dStr].recipes.push({ recipeId: recipe.id, cookId: cookId });

    showPicker.value = false;
    $q.notify({ type: 'positive', message: 'Geplant!', timeout: 1000 });
  } catch (e) { console.error(e); }
};

// Hilfsfunktion, um den Namen des Koches zu finden
const getCookName = (userId: string) => {
  if (userId === auth.currentUser?.uid) return 'Ich';
  const user = groupMembers.value.find(m => m.id === userId);
  return user ? user.name : 'Jemand';
};

const removeRecipeFromDay = async (dateStr: string, recipeId: string) => {
  try {
    // 1. Löschen über den Service in der Datenbank
    await removeRecipeFromMealPlan(dateStr, recipeId);

    // 2. Lokal aus dem State entfernen
    if (mealPlans.value[dateStr]) {
      // Wir müssen prüfen, welcher Teil des Eintrags die ID enthält
      mealPlans.value[dateStr].recipes = mealPlans.value[dateStr].recipes.filter((entry: MealPlanEntry) => {
        const currentId = typeof entry === 'string' ? entry : entry.recipeId;
        return currentId !== recipeId;
      });
    }

    $q.notify({ type: 'info', message: 'Rezept entfernt.', timeout: 1000 });
  } catch (e: unknown) {
    console.error("Fehler beim Entfernen:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Entfernen.' });
  }
};

// --- EINKAUFSLISTEN LOGIK ---
const addWeekToCart = async () => {
  const hasRecipes = weekDays.value.some(d => d.plannedRecipes.length > 0);
  if (!hasRecipes) {
    $q.notify({ type: 'warning', message: 'Keine Rezepte in dieser Woche geplant.' });
    return;
  }

  isAddingToCart.value = true;
  try {
    // 1. Zutaten aggregieren (zusammenrechnen)
    const ingredientsToMerge: Record<string, { amount: number, unit: string, id: string }> = {};

    weekDays.value.forEach(day => {
      day.plannedRecipes.forEach(recipe => {
        if (!recipe.ingredients) return;

        recipe.ingredients.forEach(ing => {
          const ingId = ing.ingredientID;

          if (!ingId) return;

          const key = `${ingId}_${ing.unit}`;

          if (!ingredientsToMerge[key]) {
            ingredientsToMerge[key] = { amount: 0, unit: ing.unit, id: ingId };
          }
          ingredientsToMerge[key].amount += Number(ing.amount);
        });
      });
    });

    if (Object.keys(ingredientsToMerge).length === 0) {
      $q.notify({ type: 'warning', message: 'Rezepte haben keine Zutaten hinterlegt.' });
      return;
    }

    // 2. Aktuelle Einkaufsliste über Service laden
    const currentCart = await getShoppingList();

    // 3. Arrays für unser Service-Batch vorbereiten
    const itemsToUpdate: { docId: string; amount: number }[] = [];
    const itemsToAdd: ShoppingList[] = [];

    Object.values(ingredientsToMerge).forEach(item => {
      // Prüfen ob Artikel mit gleicher ID und Einheit schon existiert
      const existingItem = currentCart.find(c => c.ingredientid === item.id && c.unit === item.unit);

      if (existingItem) {
        // Update
        const newAmount = Number(existingItem.amount) + item.amount;
        itemsToUpdate.push({ docId: existingItem.id, amount: parseFloat(newAmount.toFixed(2)) });
      } else {
        // Neu erstellen (strikt nach ShoppingList Typ)
        itemsToAdd.push({
          ingredientid: item.id,
          amount: parseFloat(item.amount.toFixed(2)),
          unit: item.unit,
          checked: false
        });
      }
    });

    // 4. Einen einzigen Datenbank-Batch via Service absenden
    if (itemsToUpdate.length > 0 || itemsToAdd.length > 0) {
      await batchUpdateShoppingList(itemsToUpdate, itemsToAdd);
    }

    $q.notify({
      type: 'positive',
      message: `${itemsToAdd.length} neu, ${itemsToUpdate.length} erhöht auf der Liste!`,
      icon: 'shopping_cart'
    });

  } catch (e: unknown) {
    console.error("Fehler beim Übertragen zur Einkaufsliste:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Übertragen zur Liste.' });
  } finally {
    isAddingToCart.value = false;
  }
};
</script>

<template>
  <q-page class="bg-dynamic-page dynamic-text q-pa-md q-pa-lg-xl transition-ease">
    <div class="max-width-container">

      <div class="row items-center justify-between q-mb-xl wrap q-gutter-y-md header-responsive">

        <h1 class="text-h4 text-weight-bold q-my-none dynamic-text gt-sm">Wochenplan</h1>
        <h1 class="text-h5 text-weight-bold q-my-none dynamic-text lt-md">Wochenplan</h1>

        <div class="row items-center q-gutter-sm controls-wrapper">

          <q-btn unelevated class="dynamic-card dynamic-border hover-primary transition-ease" text-color="primary"
            icon="add_shopping_cart" @click="addWeekToCart" :loading="isAddingToCart"
            style="height: 40px; padding: 0 12px;">
            <span class="q-ml-sm text-weight-bold gt-xs">Einkaufen</span>
            <q-tooltip class="bg-primary text-white">Alle Zutaten dieser Woche zur Einkaufsliste hinzufügen</q-tooltip>
          </q-btn>

          <div
            class="date-navigator row items-center dynamic-card dynamic-border q-px-xs rounded-borders transition-ease"
            style="height: 40px;">
            <q-btn flat round dense icon="chevron_left" class="dynamic-text" @click="changeWeek(-1)" size="sm" />
            <div class="text-subtitle2 text-weight-bold text-center q-mx-sm dynamic-text" style="min-width: 120px;">
              {{ weekRangeLabel }}
            </div>
            <q-btn flat round dense icon="chevron_right" class="dynamic-text" @click="changeWeek(1)" size="sm" />
          </div>

          <q-btn unelevated class="dynamic-card dynamic-border text-weight-bold dynamic-text transition-ease"
            label="Heute" @click="goToToday" no-caps style="height: 40px; padding: 0 16px;" />

        </div>
      </div>

      <div class="row q-col-gutter-lg">
        <div v-for="day in weekDays" :key="day.dateString" class="col-12 col-sm-6 col-md-4 col-lg-3">

          <q-card class="day-card dynamic-card column full-height transition-ease"
            :class="{ 'today-card': day.isToday }">

            <q-card-section class="q-pa-md row justify-between items-center day-header">
              <div>
                <div class="text-subtitle1 text-weight-bold" :class="day.isToday ? 'text-primary' : 'dynamic-text'">
                  {{ day.weekday }}
                </div>
                <div class="text-caption dynamic-text-muted">{{ day.displayDate }}</div>
              </div>
              <q-btn flat round dense icon="add" color="primary" class="hover-primary-bg"
                @click="openRecipePicker(day.dateString)" />
            </q-card-section>

            <q-separator :dark="$q.dark.isActive" inset class="opacity-20" />

            <q-card-section class="q-pa-md col relative-position column q-gutter-y-sm">

              <div v-if="day.plannedRecipes.length === 0"
                class="empty-plan-box flex flex-center text-center dynamic-text-muted cursor-pointer q-pa-lg transition-ease"
                @click="openRecipePicker(day.dateString)">
                <div>
                  <q-icon name="add_circle_outline" size="md" class="q-mb-sm text-primary opacity-60" />
                  <div class="text-caption">Rezept planen</div>
                </div>
              </div>

              <transition-group name="list" tag="div" class="q-gutter-y-sm">
                <div v-for="recipe in day.plannedRecipes" :key="recipe.id"
                  class="recipe-item bg-dynamic-page dynamic-border row no-wrap items-center rounded-borders cursor-pointer transition-ease"
                  @click="goToRecipe(recipe.id)">

                  <q-img :src="recipe.image || 'placeholder.jpg'" class="recipe-image rounded-borders">
                    <template v-slot:error>
                      <div class="absolute-full flex flex-center bg-dynamic-soft">
                        <q-icon name="restaurant" class="dynamic-text-muted" />
                      </div>
                    </template>
                  </q-img>

                  <div class="col q-px-md overflow-hidden">
                    <div class="text-body2 text-weight-bold ellipsis-2-lines dynamic-text">{{ recipe.name }}</div>
                    <div class="text-caption text-primary row items-center" v-if="recipe.cookId">
                      <q-icon name="person" size="xs" class="q-mr-xs" />
                      {{ getCookName(recipe.cookId) }}
                    </div>
                  </div>

                  <q-btn flat dense round icon="close" size="sm" class="q-mr-sm dynamic-text-muted hover-negative"
                    @click.stop="removeRecipeFromDay(day.dateString, recipe.id!)" />
                </div>
              </transition-group>

            </q-card-section>
          </q-card>
        </div>
      </div>

      <q-dialog v-model="showPicker" position="standard" backdrop-filter="blur(5px)">
        <q-card class="dynamic-card dynamic-text dialog-card column rounded-xl overflow-hidden">

          <q-card-section class="row items-center q-pb-none bg-dynamic-soft">
            <div class="text-h6 text-primary text-weight-bold">Was gibt es zu essen?</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup class="dynamic-text-muted" />
          </q-card-section>

          <q-card-section class="q-pt-md bg-dynamic-soft dynamic-border-bottom">
            <div class="text-caption dynamic-text-muted q-mb-xs">Wer kocht?</div>
            <q-select v-model="selectedCookId" :options="groupMembers" option-value="id" option-label="name" emit-value
              map-options filled :dark="$q.dark.isActive" color="primary" dense class="custom-dynamic-input q-mb-md" />

            <q-input v-model="pickerSearch" dense filled :dark="$q.dark.isActive" color="primary"
              placeholder="Rezept suchen..." autofocus class="custom-dynamic-input">
              <template v-slot:append><q-icon name="search" class="dynamic-text-muted" /></template>
            </q-input>
          </q-card-section>

          <q-card-section class="scroll col q-pt-none q-mt-sm">
            <q-list class="q-gutter-y-xs">
              <q-item v-for="r in filteredRecipesForPicker" :key="r.id" clickable v-ripple @click="addRecipeToPlan(r)"
                class="recipe-picker-item rounded-borders q-pa-sm list-item-hover">

                <q-item-section avatar>
                  <q-avatar rounded size="48px" class="shadow-1">
                    <img :src="r.image" v-if="r.image" style="object-fit: cover;">
                    <q-icon name="restaurant" v-else
                      class="bg-dynamic-soft dynamic-text-muted full-width full-height" />
                  </q-avatar>
                </q-item-section>

                <q-item-section>
                  <q-item-label class="text-weight-bold dynamic-text">{{ r.name }}</q-item-label>
                  <q-item-label caption class="dynamic-text-muted" v-if="r.category">{{ r.category }}</q-item-label>
                </q-item-section>

                <q-item-section side>
                  <q-icon name="add_circle" color="primary" size="sm" />
                </q-item-section>
              </q-item>

              <div v-if="filteredRecipesForPicker.length === 0" class="text-center q-pa-xl dynamic-text-muted">
                <q-icon name="search_off" size="xl" class="q-mb-sm" />
                <div>Kein Rezept gefunden.</div>
              </div>
            </q-list>
          </q-card-section>
        </q-card>
      </q-dialog>

    </div>
  </q-page>
</template>

<style scoped>
/* --- GLOBALES DESIGN --- */
.max-width-container {
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.transition-ease {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* --- HEADER --- */
@media (max-width: 599px) {
  .controls-wrapper {
    width: 100%;
    justify-content: space-between;
  }
}

/* --- DAY CARDS --- */
.day-card {
  border-radius: 16px;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

@media (hover: hover) {
  .day-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
  }

  :global(.body--dark) .day-card:hover {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }
}

.day-header {
  min-height: 72px;
}

/* Heute-Karte leuchtet in der Primary Color */
.today-card {
  border: 2px solid var(--q-primary) !important;
  box-shadow: 0 0 15px color-mix(in srgb, var(--q-primary), transparent 85%);
}

/* Empty State / Add Box */
.empty-plan-box {
  border: 1px dashed;
  border-radius: 12px;
  height: 100px;
}

:global(.body--dark) .empty-plan-box {
  border-color: rgba(255, 255, 255, 0.15);
}

:global(.body--light) .empty-plan-box {
  border-color: rgba(0, 0, 0, 0.15);
}

.empty-plan-box:hover {
  border-color: var(--q-primary);
  background-color: color-mix(in srgb, var(--q-primary), transparent 95%);
}

.opacity-60 {
  opacity: 0.6;
}

.opacity-20 {
  opacity: 0.2;
}

/* Recipe Items in Day Card */
.recipe-item {
  padding: 6px;
}

.recipe-item:hover {
  background-color: color-mix(in srgb, var(--q-primary), transparent 96%);
  border-color: color-mix(in srgb, var(--q-primary), transparent 80%);
}

.recipe-image {
  width: 56px;
  height: 56px;
  min-width: 56px;
}

/* --- UTILITIES & HOVERS --- */
.hover-primary:hover {
  color: var(--q-primary) !important;
  border-color: var(--q-primary) !important;
}

.hover-primary-bg:hover {
  background-color: color-mix(in srgb, var(--q-primary), transparent 85%);
}

.hover-negative:hover {
  color: var(--q-negative) !important;
  background-color: color-mix(in srgb, var(--q-negative), transparent 90%);
}

/* --- DIALOG & PICKER --- */
.dialog-card {
  width: 500px;
  max-width: 95vw;
  max-height: 80vh;
}

.recipe-picker-item {
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

:global(.body--dark) .list-item-hover:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

:global(.body--light) .list-item-hover:hover {
  background-color: rgba(0, 0, 0, 0.03);
}

/* Custom Input inside Dialog */
:deep(.custom-dynamic-input .q-field__control) {
  border-radius: 10px;
  padding: 0 16px;
}

:global(.body--dark) :deep(.custom-dynamic-input .q-field__control) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

:global(.body--light) :deep(.custom-dynamic-input .q-field__control) {
  background-color: rgba(0, 0, 0, 0.04) !important;
}

:deep(.custom-dynamic-input .q-field__control:before) {
  border-bottom: none !important;
}

/* Animations */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
