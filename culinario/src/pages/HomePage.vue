<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';

// 1. Zentrale Typen importieren (mit ID)
import type { RecipeFirebase } from '../types/index';

// 2. Deine neuen Service-Funktionen importieren
import { getRecipes, getRecipeCategories, getIngredients, deleteRecipe } from '../firebase/services';

const router = useRouter();
const $q = useQuasar();

// Filter States
const searchQuery = ref('');
const selectedCategory = ref<string | null>(null);
const selectedIngredients = ref<string[]>([]);
const showFilterDialog = ref(false);

// Zutaten-Filter States
const ingredientSearchQuery = ref('');
const isIngredientsExpanded = ref(false); // Startet eingeklappt

// Wir benutzen Map für performantere Zuweisungen
const masterCategories = ref<Map<string, string>>(new Map());
const masterIngredients = ref<Map<string, string>>(new Map());

// 3. Typ auf RecipeFirebase ändern (damit die .id Eigenschaft offiziell existiert)
const recipes = ref<RecipeFirebase[]>([]);
const isLoading = ref(true);

// --- LOGIK ---
const activeCategories = computed(() => {
  const usedCategoryIds = new Set<string>();

  recipes.value.forEach(recipe => {
    if (recipe.category) {
      usedCategoryIds.add(recipe.category);
    }
  });

  return Array.from(usedCategoryIds).map(id => ({
    value: id,
    label: masterCategories.value.get(id) || 'Unbekannte Kategorie'
  })).sort((a, b) => a.label.localeCompare(b.label));
});

const pickSurpriseRecipe = () => {
  // Wir nehmen die gefilterten Rezepte, falls Filter aktiv sind, sonst alle.
  const sourceList = filteredRecipes.value.length > 0 ? filteredRecipes.value : recipes.value;

  if (sourceList.length === 0) {
    $q.notify({
      type: 'warning',
      message: 'Keine Rezepte zum Auslosen vorhanden.',
      position: 'top'
    });
    return;
  }

  const randomIndex = Math.floor(Math.random() * sourceList.length);
  const randomRecipe = sourceList[randomIndex];

  // FIX: Wir prüfen erst, ob randomRecipe existiert UND ob es eine ID hat
  if (randomRecipe && randomRecipe.id) {
    $q.notify({
      type: 'positive',
      message: `Heute gibt es: ${randomRecipe.name}! 🎲`,
      icon: 'casino',
      color: 'primary',
      timeout: 2000
    });

    void router.push(`/recipe/${randomRecipe.id}`);
  }
};

const allIngredients = computed(() => {
  const usedIngredientIds = new Set<string>();

  recipes.value.forEach(recipe => {
    if (recipe.ingredients && Array.isArray(recipe.ingredients)) {
      recipe.ingredients.forEach(ing => {
        // Wir erweitern den Typ hier inline, um ESLint glücklich zu machen
        const flexibleIng = ing as typeof ing & { ingredientId?: string };
        const id = flexibleIng.ingredientID || flexibleIng.ingredientId;

        if (id) {
          usedIngredientIds.add(id);
        }
      });
    }
  });

  return Array.from(usedIngredientIds).map(id => ({
    id: id,
    name: masterIngredients.value.get(id) || 'Unbekannte Zutat'
  })).sort((a, b) => a.name.localeCompare(b.name));
});

const filteredIngredients = computed(() => {
  if (!ingredientSearchQuery.value) return allIngredients.value;
  const lowerQuery = ingredientSearchQuery.value.toLowerCase();
  return allIngredients.value.filter(ing => ing.name.toLowerCase().includes(lowerQuery));
});

watch(ingredientSearchQuery, (newVal) => {
  if (newVal.trim().length > 0) {
    isIngredientsExpanded.value = true;
  }
});

const toggleIngredient = (ingredientId: string) => {
  const index = selectedIngredients.value.indexOf(ingredientId);
  if (index > -1) {
    selectedIngredients.value.splice(index, 1);
  } else {
    selectedIngredients.value.push(ingredientId);
  }
};

const filteredRecipes = computed(() => {
  return recipes.value.filter(recipe => {
    const matchesName = recipe.name?.toLowerCase().includes(searchQuery.value.toLowerCase());
    const matchesCategory = !selectedCategory.value || recipe.category === selectedCategory.value;

    const matchesIngredients = selectedIngredients.value.length === 0 || selectedIngredients.value.every(selectedId => {
      const recipeIngredients = recipe.ingredients || [];
      return recipeIngredients.some(ing => {
        const flexibleIng = ing as typeof ing & { ingredientId?: string };
        return (flexibleIng.ingredientID || flexibleIng.ingredientId) === selectedId;
      });
    });

    return matchesName && matchesCategory && matchesIngredients;
  });
});

const isFiltering = computed(() => {
  return !!(selectedCategory.value || selectedIngredients.value.length > 0);
});

onMounted(async () => {
  try {
    // 4. Datenladen ist jetzt super sauber und übersichtlich!

    // Rezepte laden
    recipes.value = await getRecipes();

    // Kategorien-Stammdaten laden (ID -> Name Mappen)
    const catData = await getRecipeCategories();
    const catMap = new Map<string, string>();
    catData.forEach(c => catMap.set(c.id, c.name));
    masterCategories.value = catMap;

    // Zutaten-Stammdaten laden
    const ingData = await getIngredients();
    const ingMap = new Map<string, string>();
    ingData.forEach(i => ingMap.set(i.id, i.name));
    masterIngredients.value = ingMap;

  } catch (error) {
    console.error("Fehler beim Laden:", error);
  } finally {
    isLoading.value = false;
  }
});

// Navigation
const openRecipe = (id?: string) => {
  if (!id) return;
  void router.push(`/recipe/${id}`);
};

const editRecipe = (id: string) => {
  void router.push(`/add-recipe?edit=${id}`);
};

// 5. Parameter nutzt nun den Firebase-Typ
const confirmDelete = (recipe: RecipeFirebase) => {
  $q.dialog({
    title: 'Löschen',
    message: `Möchtest du "${recipe.name}" wirklich löschen?`,
    cancel: true,
    persistent: true,
    color: 'negative'
  }).onOk(() => {
    void performDelete(recipe);
  });
};

const performDelete = async (recipe: RecipeFirebase) => {
  if (!recipe.id) return;
  try {
    // Neue Service-Funktion zum Löschen aufrufen
    await deleteRecipe(recipe.id);
    recipes.value = recipes.value.filter(r => r.id !== recipe.id);
    $q.notify({ type: 'positive', message: 'Gelöscht.' });
  } catch (error) {
    // Fehler in der Konsole ausgeben, damit ESLint zufrieden ist
    console.error("Fehler beim Löschen des Rezepts:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Löschen.' });
  }
};
</script>

<template>
  <q-page class="bg-dynamic-page q-pa-md transition-ease">

    <div class="max-width-container full-height column">

      <div class="row items-center justify-between q-mb-lg q-pt-sm header-responsive">

        <h1 class="text-h4 text-weight-bold q-my-none dynamic-text gt-sm">Meine Rezepte</h1>

        <div class="row no-wrap items-center q-gutter-sm search-wrapper">

          <q-btn unelevated class="dynamic-card hover-primary transition-ease" @click="pickSurpriseRecipe"
            style="height: 49px; width: 49px; border-radius: 14px;">
            <q-icon name="casino" class="dynamic-text" />
            <q-tooltip class="bg-primary text-white text-weight-bold">Überrasch mich!</q-tooltip>
          </q-btn>

          <q-input v-model="searchQuery" borderless dense placeholder="Rezept suchen..."
            class="col search-input dynamic-card transition-ease" :dark="$q.dark.isActive" input-class="dynamic-text">
            <template v-slot:prepend>
              <q-icon name="search" class="dynamic-text-muted q-pl-sm" size="sm" />
            </template>
          </q-input>

          <q-btn unelevated class="filter-btn text-weight-bold" color="primary" icon="tune"
            @click="showFilterDialog = true">
            <q-badge v-if="isFiltering" color="negative" floating rounded />
          </q-btn>
        </div>
      </div>

      <q-dialog v-model="showFilterDialog" :position="$q.screen.lt.sm ? 'bottom' : 'right'"
        :full-width="$q.screen.lt.sm" :full-height="!$q.screen.lt.sm" class="filter-dialog">
        <q-card class="dynamic-card dynamic-text q-pa-sm"
          :class="$q.screen.lt.sm ? 'filter-card-mobile' : 'filter-card-desktop'">

          <q-card-section class="row items-center justify-between q-pb-none">
            <div class="text-h6 text-weight-bold">Rezepte filtern</div>
            <q-btn icon="close" flat round dense v-close-popup class="dynamic-text-muted bg-dynamic-soft" size="sm" />
          </q-card-section>

          <q-card-section v-if="activeCategories.length > 0">
            <div class="row items-center justify-between q-mb-md">
              <div class="text-subtitle1 text-weight-bold">Rezeptkategorie</div>
              <q-btn icon="refresh" flat round dense size="sm" class="dynamic-text-muted"
                @click="selectedCategory = null" />
            </div>
            <div class="row q-gutter-sm">
              <q-chip v-for="cat in activeCategories" :key="cat.value" clickable
                :color="selectedCategory === cat.value ? 'primary' : undefined"
                :class="['custom-chip', selectedCategory !== cat.value ? 'chip-inactive' : 'text-white']"
                @click="selectedCategory = selectedCategory === cat.value ? null : cat.value">
                {{ cat.label }}
              </q-chip>
            </div>
          </q-card-section>

          <q-card-section v-if="allIngredients.length > 0">
            <div class="row items-center justify-between q-mb-sm">
              <div class="row items-center cursor-pointer" @click="isIngredientsExpanded = !isIngredientsExpanded">
                <div class="text-subtitle1 text-weight-bold">Zutaten</div>
                <q-icon :name="isIngredientsExpanded ? 'expand_less' : 'expand_more'" size="sm"
                  class="q-ml-xs dynamic-text-muted" />
              </div>
              <q-btn icon="refresh" flat round dense size="sm" class="dynamic-text-muted"
                @click="selectedIngredients = []; ingredientSearchQuery = ''" />
            </div>

            <q-input v-model="ingredientSearchQuery" borderless dense placeholder="Nach Zutat filtern..."
              class="ingredient-search bg-dynamic-soft q-mb-md rounded-borders" :dark="$q.dark.isActive"
              input-class="dynamic-text">
              <template v-slot:prepend>
                <q-icon name="search" class="dynamic-text-muted q-pl-sm" size="sm" />
              </template>
              <template v-slot:append v-if="ingredientSearchQuery">
                <q-icon name="close" class="dynamic-text-muted cursor-pointer q-pr-sm" size="xs"
                  @click="ingredientSearchQuery = ''" />
              </template>
            </q-input>

            <q-slide-transition>
              <div v-show="isIngredientsExpanded">
                <div class="row q-gutter-sm">
                  <q-chip v-for="ing in filteredIngredients" :key="ing.id" clickable
                    :color="selectedIngredients.includes(ing.id) ? 'primary' : undefined"
                    :class="['custom-chip', !selectedIngredients.includes(ing.id) ? 'chip-inactive' : 'text-white']"
                    @click="toggleIngredient(ing.id)">
                    {{ ing.name }}
                  </q-chip>
                </div>
                <div v-if="filteredIngredients.length === 0" class="dynamic-text-muted q-mt-sm text-caption">
                  Keine Zutat mit diesem Namen gefunden.
                </div>
              </div>
            </q-slide-transition>
          </q-card-section>

          <div class="q-pb-lg"></div>
        </q-card>
      </q-dialog>

      <div v-if="isLoading" class="flex flex-center q-pa-xl col-grow">
        <q-spinner-dots color="primary" size="3em" />
      </div>

      <div v-else-if="filteredRecipes.length === 0"
        class="text-center dynamic-text-muted q-pa-xl col-grow flex flex-center column">
        <q-icon name="search_off" size="4em" class="q-mb-md" />
        <div class="text-h6">Keine Rezepte gefunden</div>
        <p>Versuche es mit anderen Suchbegriffen oder Filtern.</p>
      </div>

      <div v-else class="row q-col-gutter-lg">
        <div class="col-12 col-sm-6 col-md-4 col-lg-3 col-xl-3" v-for="recipe in filteredRecipes" :key="recipe.id">

          <q-card class="recipe-card dynamic-card cursor-pointer" flat @click="openRecipe(recipe.id)">
            <q-img :src="recipe.image || 'placeholder.jpg'" :ratio="16 / 9" class="recipe-image">
              <div class="absolute-top-right q-pa-none bg-transparent">
                <q-btn round flat dense icon="more_vert" color="white" class="shadow-1"
                  style="background: rgba(0,0,0,0.3);" @click.stop>
                  <q-menu auto-close class="dynamic-card dynamic-text">
                    <q-list>
                      <q-item clickable @click="recipe.id && editRecipe(recipe.id)" class="list-item-hover">
                        <q-item-section avatar><q-icon name="edit" color="primary" /></q-item-section>
                        <q-item-section>Bearbeiten</q-item-section>
                      </q-item>
                      <q-item clickable @click="confirmDelete(recipe)" class="list-item-hover">
                        <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
                        <q-item-section class="text-negative">Löschen</q-item-section>
                      </q-item>
                    </q-list>
                  </q-menu>
                </q-btn>
              </div>
            </q-img>

            <q-card-section class="q-py-md text-center bg-transparent">
              <div class="text-subtitle1 text-weight-bolder ellipsis dynamic-text">{{ recipe.name }}</div>
            </q-card-section>
          </q-card>

        </div>
      </div>

    </div>
  </q-page>
</template>

<style scoped>
/* --- RESPONSIVE LAYOUT KLASSEN --- */
.max-width-container {
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.search-wrapper {
  width: 100%;
}

/* Ab Tablet-Größe: Suchleiste fixiert */
@media (min-width: 1024px) {
  .search-wrapper {
    width: 400px;
  }
}

/* --- FORMEN & INPUTS --- */
.search-input {
  border-radius: 12px;
  height: 49px;
  overflow: hidden;
}

:deep(.search-input .q-field__control) {
  height: 49px;
  flex: 1;
  flex-direction: row;
  gap: 6px;
  align-items: center;
  padding: 0 12px;
}

.ingredient-search {
  border-radius: 12px;
  height: 49px;
  overflow: hidden;
}

:deep(.ingredient-search .q-field__control) {
  height: 49px;
  padding: 0 12px;
}

/* --- BUTTONS & CHIPS --- */
.filter-btn {
  border-radius: 14px;
  height: 49px;
  width: 49px;
  /* color="primary" wird im Template gesetzt */
}

.custom-chip {
  border-radius: 8px;
  font-weight: 600;
  padding: 8px 16px;
  margin-right: 8px;
  margin-bottom: 8px;
  transition: background-color 0.2s, color 0.2s;
}

/* Dynamischer Inactive-Status für Chips */
:global(.body--dark) .chip-inactive {
  background-color: rgba(255, 255, 255, 0.05) !important;
  color: #fff;
}

:global(.body--light) .chip-inactive {
  background-color: rgba(0, 0, 0, 0.05) !important;
  color: #000;
}

.hover-primary:hover {
  color: var(--q-primary) !important;
  border-color: var(--q-primary) !important;
}

:global(.body--dark) .list-item-hover:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

:global(.body--light) .list-item-hover:hover {
  background-color: rgba(0, 0, 0, 0.03);
}

/* --- KARTEN & DIALOGE --- */
.recipe-card {
  border-radius: 16px;
  overflow: hidden;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.recipe-card:hover {
  border-color: var(--q-primary) !important;
  transform: translateY(-4px);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--q-primary), transparent 85%);
}

.recipe-image {
  border-radius: 16px 16px 0 0;
}

.filter-card-mobile {
  width: 100vw !important;
  max-width: 100vw !important;
  margin: 0 !important;
  border-radius: 24px 24px 0 0;
}

.filter-card-desktop {
  height: 100vh !important;
  width: 400px;
  max-width: 100vw;
  border-radius: 24px 0 0 24px;
}
</style>

<style>
/* Überschreibt das interne Padding des Quasar Dialogs für Randlosigkeit */
.filter-dialog .q-dialog__inner {
  padding: 0 !important;
}
</style>
