<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { date, useQuasar } from 'quasar';
import { auth } from '../firebase/index';
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

// --- DATEN LADEN ---
onMounted(async () => {
  try {
    // 3. Sauber über den Service laden
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
  const todayStart = date.startOfDate(currentAnchorDate.value, 'day');

  const dayOfWeek = date.getDayOfWeek(todayStart);
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const start = date.subtractFromDate(todayStart, { days: daysSinceMonday });

  for (let i = 0; i < 7; i++) {
    const d = date.addToDate(start, { days: i });
    const dStr = date.formatDate(d, 'YYYY-MM-DD');
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
          // Typsicheres Auslesen der ID (Unterstützt alte und neue Daten)
          const flexibleIng = ing as typeof ing & { ingredientId?: string };
          const ingId = flexibleIng.ingredientID || flexibleIng.ingredientId;

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
  <q-page class="bg-dark-page text-white q-pa-md q-pa-lg-xl">
    <div class="max-width-container">

      <div class="row items-center justify-between q-mb-xl wrap q-gutter-y-md header-responsive">

        <h1 class="text-h4 text-weight-bold q-my-none text-white gt-sm">Wochenplan</h1>
        <h1 class="text-h5 text-weight-bold q-my-none text-white lt-md">Wochenplan</h1>

        <div class="row items-center q-gutter-sm controls-wrapper">

          <q-btn unelevated class="bg-dark border-dark hover-primary" text-color="primary" icon="add_shopping_cart"
            @click="addWeekToCart" :loading="isAddingToCart" style="height: 40px; padding: 0 12px;">
            <span class="q-ml-sm text-weight-bold gt-xs">Einkaufen</span>
            <q-tooltip class="bg-primary text-white">Alle Zutaten dieser Woche zur Einkaufsliste hinzufügen</q-tooltip>
          </q-btn>

          <div class="date-navigator row items-center bg-dark q-px-xs rounded-borders border-dark"
            style="height: 40px;">
            <q-btn flat round dense icon="chevron_left" color="white" @click="changeWeek(-1)" size="sm" />
            <div class="text-subtitle2 text-weight-bold text-center q-mx-sm" style="min-width: 120px;">
              {{ weekRangeLabel }}
            </div>
            <q-btn flat round dense icon="chevron_right" color="white" @click="changeWeek(1)" size="sm" />
          </div>

          <q-btn unelevated class="bg-dark border-dark text-weight-bold" text-color="white" label="Heute"
            @click="goToToday" no-caps style="height: 40px; padding: 0 16px;" />

        </div>
      </div>

      <div class="row q-col-gutter-lg">
        <div v-for="day in weekDays" :key="day.dateString" class="col-12 col-sm-6 col-md-4 col-lg-3">
          <q-card class="day-card column full-height bg-dark text-white" :class="{ 'today-card': day.isToday }">

            <q-card-section class="q-pa-md row justify-between items-center day-header">
              <div>
                <div class="text-subtitle1 text-weight-bold" :class="day.isToday ? 'text-primary' : 'text-white'">
                  {{ day.weekday }}
                </div>
                <div class="text-caption text-grey-5">{{ day.displayDate }}</div>
              </div>
              <q-btn flat round dense icon="add" color="primary" class="hover-primary-bg"
                @click="openRecipePicker(day.dateString)" />
            </q-card-section>

            <q-separator dark inset class="separator-color" />

            <q-card-section class="q-pa-md col relative-position column q-gutter-y-sm">

              <div v-if="day.plannedRecipes.length === 0"
                class="empty-plan-box flex flex-center text-center text-grey-6 cursor-pointer q-pa-lg"
                @click="openRecipePicker(day.dateString)">
                <div>
                  <q-icon name="add_circle_outline" size="md" class="q-mb-sm text-primary" />
                  <div class="text-caption">Rezept planen</div>
                </div>
              </div>

              <transition-group name="list" tag="div" class="q-gutter-y-sm">
                <div v-for="recipe in day.plannedRecipes" :key="recipe.id"
                  class="recipe-item row no-wrap items-center rounded-borders cursor-pointer"
                  @click="goToRecipe(recipe.id)">

                  <q-img :src="recipe.image || 'placeholder.jpg'" class="recipe-image rounded-borders">
                    <template v-slot:error>
                      <div class="absolute-full flex flex-center bg-grey-9">
                        <q-icon name="restaurant" color="grey-6" />
                      </div>
                    </template>
                  </q-img>

                  <div class="col q-px-md overflow-hidden">
                    <div class="text-body2 text-weight-bold ellipsis-2-lines">{{ recipe.name }}</div>
                    <div class="text-caption text-primary row items-center" v-if="recipe.cookId">
                      <q-icon name="person" size="xs" class="q-mr-xs" />
                      {{ getCookName(recipe.cookId) }}
                    </div>
                  </div>

                  <q-btn flat dense round icon="close" size="sm" color="grey-5" class="q-mr-sm hover-negative"
                    @click.stop="removeRecipeFromDay(day.dateString, recipe.id!)" />
                </div>
              </transition-group>

            </q-card-section>
          </q-card>
        </div>
      </div>

      <q-dialog v-model="showPicker" position="standard">
        <q-card class="bg-dark text-white dialog-card column border-dark">

          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6 text-primary text-weight-bold">Was gibt es zu essen?</div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup color="grey-5" />
          </q-card-section>

          <q-card-section class="q-pt-md">
            <div class="text-caption text-grey-5 q-mb-xs">Wer kocht?</div>
            <q-select v-model="selectedCookId" :options="groupMembers" option-value="id" option-label="name" emit-value
              map-options filled dark dense class="custom-dark-input q-mb-md" />

            <q-input v-model="pickerSearch" dense filled dark placeholder="Rezept suchen..." autofocus
              class="custom-dark-input">
              <template v-slot:append><q-icon name="search" color="grey-5" /></template>
            </q-input>
          </q-card-section>

          <q-card-section class="scroll col q-pt-none">
            <q-list class="q-gutter-y-xs">
              <q-item v-for="r in filteredRecipesForPicker" :key="r.id" clickable v-ripple @click="addRecipeToPlan(r)"
                class="recipe-picker-item rounded-borders q-pa-sm">

                <q-item-section avatar>
                  <q-avatar rounded size="48px">
                    <img :src="r.image" v-if="r.image" style="object-fit: cover;">
                    <q-icon name="restaurant" v-else color="grey" class="bg-grey-9 full-width full-height" />
                  </q-avatar>
                </q-item-section>

                <q-item-section>
                  <q-item-label class="text-weight-bold text-white">{{ r.name }}</q-item-label>
                  <q-item-label caption class="text-grey-5" v-if="r.category">{{ r.category }}</q-item-label>
                </q-item-section>

                <q-item-section side>
                  <q-icon name="add_circle" color="primary" size="sm" />
                </q-item-section>
              </q-item>

              <div v-if="filteredRecipesForPicker.length === 0" class="text-center q-pa-xl text-grey-6">
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
.bg-dark-page {
  background-color: #161616;
  min-height: 100vh;
}

.max-width-container {
  max-width: 1400px;
  /* Zentriert auf PC, wie bei HomePage */
  margin: 0 auto;
  width: 100%;
}

.border-dark {
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.separator-color {
  background-color: rgba(255, 255, 255, 0.05);
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
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  background-color: #222222 !important;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

@media (hover: hover) {
  .day-card:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }
}

.day-header {
  min-height: 72px;
}

.today-card {
  border: 2px solid #66a182 !important;
  /* Striktes Primary Grün */
  box-shadow: 0 0 15px rgba(102, 161, 130, 0.15);
}

/* Empty State / Add Box */
.empty-plan-box {
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  height: 100px;
  transition: all 0.2s ease;
}

.empty-plan-box:hover {
  border-color: #66a182;
  background-color: rgba(102, 161, 130, 0.05);
}

/* Recipe Items in Day Card */
.recipe-item {
  background-color: #161616;
  border: 1px solid rgba(255, 255, 255, 0.05);
  padding: 6px;
  transition: background-color 0.2s ease;
}

.recipe-item:hover {
  background-color: #2a2a2a;
}

.recipe-image {
  width: 56px;
  height: 56px;
  min-width: 56px;
}

/* --- UTILITIES & HOVERS --- */
.hover-primary:hover {
  color: #66a182 !important;
  border-color: #66a182 !important;
}

.hover-primary-bg:hover {
  background-color: rgba(102, 161, 130, 0.15);
}

.hover-negative:hover {
  color: #f7204c !important;
  background-color: rgba(247, 32, 76, 0.1);
}

/* --- DIALOG & PICKER --- */
.dialog-card {
  width: 500px;
  max-width: 95vw;
  border-radius: 16px;
  max-height: 80vh;
}

.recipe-picker-item {
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.recipe-picker-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

/* Custom Input inside Dialog */
:deep(.custom-dark-input .q-field__control) {
  background-color: #161616 !important;
  border-radius: 8px;
}

:deep(.custom-dark-input .q-field__control:before) {
  border-bottom: none !important;
}

/* Animations */
.list-enter-active,
.list-leave-active {
  transition: all 0.3s ease;
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(10px);
}
</style>
