<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useQuasar } from 'quasar';
import { collection, getDocs, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { useRouter } from 'vue-router';
import { db, auth } from '../firebase/index';
import { signOut } from 'firebase/auth';

// 1. Typen aus index.ts
import type { IngredientFirebase, Markets, WithId, RecipeFirebase } from '../types/index';

// 2. Service Funktionen
import {
  getIngredients,
  updateIngredient,
  getMarkets,
  addMarket,
  updateMarket,
  deleteMarket,
  getRecipes,
  updateRecipe,
  getWGInfo,
  createWG,
  joinWG,
  leaveWG,
  updateUserWGPrefs,
  updateUserProfile,
  updateUserPrefs
} from '../firebase/services';

const $q = useQuasar();
const tab = ref('general');

const keepScreenOn = ref(true);
const timerSound = ref('classic');

const router = useRouter();
const handleLogout = async () => {
  try {
    await signOut(auth);
    $q.notify({ type: 'info', message: 'Erfolgreich abgemeldet.' });
    void router.push('/login');
  } catch (error) {
    console.error("Fehler beim Logout:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Abmelden.' });
  }
};

// --- ALLGEMEINE EINSTELLUNGEN ---
const isDarkMode = ref($q.dark.isActive);
const defaultPortions = ref(2);

watch(isDarkMode, (val) => {
  $q.dark.set(val);
  localStorage.setItem('darkMode', val ? 'true' : 'false');
});

watch(defaultPortions, (val) => {
  localStorage.setItem('defaultPortions', val.toString());
});

// --- GLOBALE DATEN (Für Zutaten-Logik) ---
const allIngredients = ref<IngredientFirebase[]>([]);
const allRecipes = ref<RecipeFirebase[]>([]);

// --- ZUTATEN BILDER LOGIK ---
const ingredientsWithoutImage = ref<IngredientFirebase[]>([]);
const isUploadingMap = ref<Record<string, boolean>>({});

// Cloudinary Config
const CLOUDINARY_CLOUD_NAME = 'ddwxwy7j0';
const CLOUDINARY_UPLOAD_PRESET = 'ml_default';

const loadGlobalData = async () => {
  try {
    const [ings, recs] = await Promise.all([getIngredients(), getRecipes()]);
    allIngredients.value = ings;
    allRecipes.value = recs;
    ingredientsWithoutImage.value = ings.filter(i => !i.image || i.image.trim() === '');
  } catch (error: unknown) {
    console.error("Fehler beim Laden der globalen Daten:", error);
  }
};

const uploadImage = async (file: File | null, ingredientId: string) => {
  if (!file) return;
  isUploadingMap.value[ingredientId] = true;

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST', body: formData,
    });

    if (!response.ok) throw new Error('Upload fehlgeschlagen');
    const data = await response.json();

    await updateIngredient(ingredientId, { image: data.secure_url });
    await loadGlobalData();
    $q.notify({ type: 'positive', message: 'Bild hochgeladen & gespeichert!' });

  } catch (error: unknown) {
    console.error("Fehler beim Upload:", error);
    $q.notify({ type: 'negative', message: 'Upload Fehler' });
  } finally {
    isUploadingMap.value[ingredientId] = false;
  }
};

// --- BILDER-GALERIE (Aus bestehenden wählen) ---
const showImagePicker = ref(false);
const imagePickerTargetId = ref<string | null>(null);

const uniqueExistingImages = computed(() => {
  const images = new Set<string>();
  allIngredients.value.forEach(ing => {
    if (ing.image) images.add(ing.image);
  });
  return Array.from(images);
});

const openImagePicker = (ingredientId: string) => {
  imagePickerTargetId.value = ingredientId;
  showImagePicker.value = true;
};

const selectExistingImage = async (imgUrl: string) => {
  if (!imagePickerTargetId.value) return;
  try {
    await updateIngredient(imagePickerTargetId.value, { image: imgUrl });
    $q.notify({ type: 'positive', message: 'Bild erfolgreich zugewiesen!' });
    showImagePicker.value = false;
    await loadGlobalData();
  } catch (e) {
    console.error("Fehler beim Zuweisen des Bildes:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Zuweisen.' });
  }
};

// --- ZUTATEN LÖSCHEN & AUSTAUSCHEN LOGIK ---
const showDeleteDialog = ref(false);
const isDeleting = ref(false);
const ingredientToDelete = ref<IngredientFirebase | null>(null);
const recipesUsingIngredient = ref<RecipeFirebase[]>([]);
const swapIngredientId = ref<string | null>(null);

const allIngredientsOptions = computed(() => {
  return allIngredients.value
    .filter(i => i.id !== ingredientToDelete.value?.id) // Die zu löschende Zutat ausblenden
    .map(i => ({ label: i.name, value: i.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

const getIngredientIdHelper = (ing: { ingredientID?: string; ingredientId?: string }): string => {
  return ing.ingredientID || ing.ingredientId || '';
};

const initiateDelete = (ing: IngredientFirebase) => {
  ingredientToDelete.value = ing;
  swapIngredientId.value = null;

  // 1. Prüfen, in welchen Rezepten diese Zutat vorkommt
  recipesUsingIngredient.value = allRecipes.value.filter(recipe => {
    const inIngredients = recipe.ingredients?.some(i => getIngredientIdHelper(i) === ing.id);
    const inSteps = recipe.preparationSteps?.some(step => step.ingredients?.some(i => getIngredientIdHelper(i) === ing.id));
    return inIngredients || inSteps;
  });

  showDeleteDialog.value = true;
};

const executeDeleteAndSwap = async () => {
  if (!ingredientToDelete.value) return;
  isDeleting.value = true;

  try {
    const oldId = ingredientToDelete.value.id;
    const newId = swapIngredientId.value;

    // 1. Rezepte updaten (falls sie verwendet wird)
    if (recipesUsingIngredient.value.length > 0) {
      if (!newId) {
        $q.notify({ type: 'warning', message: 'Bitte wähle eine Zutat als Ersatz aus.' });
        isDeleting.value = false;
        return;
      }

      for (const recipe of recipesUsingIngredient.value) {
        if (!recipe.id) continue;

        // Deep Copy erstellen
        const updatedRecipe = JSON.parse(JSON.stringify(recipe)) as RecipeFirebase;

        // In Zutatenliste austauschen
        updatedRecipe.ingredients?.forEach((i: { ingredientID?: string; ingredientId?: string }) => {
          if (getIngredientIdHelper(i) === oldId) {
            i.ingredientID = newId;
            if (i.ingredientId) i.ingredientId = newId; // Fallback überschreiben
          }
        });

        // In Schritten austauschen
        updatedRecipe.preparationSteps?.forEach((step: { ingredients?: { ingredientID?: string; ingredientId?: string }[] }) => {
          step.ingredients?.forEach((i: { ingredientID?: string; ingredientId?: string }) => {
            if (getIngredientIdHelper(i) === oldId) {
              i.ingredientID = newId;
              if (i.ingredientId) i.ingredientId = newId;
            }
          });
        });

        await updateRecipe(recipe.id, updatedRecipe);
      }
    }

    // 2. Zutat final aus der Datenbank löschen
    await deleteDoc(doc(db, 'ingredients', oldId));

    $q.notify({ type: 'positive', message: 'Zutat erfolgreich gelöscht (und ggf. in Rezepten ersetzt)!' });
    showDeleteDialog.value = false;
    await loadGlobalData();

  } catch (error) {
    console.error("Fehler beim Löschen:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Löschen.' });
  } finally {
    isDeleting.value = false;
  }
};


// --- SUPERMARKT LOGIK (Unverändert) ---
const supermarkets = ref<WithId<Markets>[]>([]);
const allCategories = ref<{ id: string, name: string }[]>([]);
const showMarketDialog = ref(false);
const isEditMode = ref(false);

const editingMarket = ref<Markets>({ name: '', categoryOrder: [] });
const editingId = ref<string | null>(null);

const loadSupermarketsAndCategories = async () => {
  try {
    const catSnap = await getDocs(collection(db, 'categories'));
    const cats: { id: string, name: string }[] = [];
    catSnap.forEach(d => { if (d.data().name) cats.push({ id: d.id, name: d.data().name }); });
    allCategories.value = cats;
    supermarkets.value = await getMarkets();
  } catch (error: unknown) { console.error(error); }
};

const availableCategoriesForEdit = computed(() => {
  const selectedIds = editingMarket.value.categoryOrder || [];
  return allCategories.value.filter(cat => !selectedIds.includes(cat.id));
});

const selectedCategoriesObjects = computed(() => {
  const order = editingMarket.value.categoryOrder || [];
  return order.map(id => allCategories.value.find(c => c.id === id)).filter(Boolean) as { id: string, name: string }[];
});

const openAddMarket = () => {
  isEditMode.value = false; editingId.value = null; editingMarket.value = { name: '', categoryOrder: [] };
  showMarketDialog.value = true;
};

const openEditMarket = (market: WithId<Markets>) => {
  isEditMode.value = true; editingId.value = market.id; editingMarket.value = { name: market.name, categoryOrder: [...market.categoryOrder] };
  showMarketDialog.value = true;
};

const saveMarket = async () => {
  try {
    if (!editingMarket.value.name.trim()) return;
    if (isEditMode.value && editingId.value) { await updateMarket(editingId.value, editingMarket.value); $q.notify({ type: 'positive', message: 'Aktualisiert' }); }
    else { await addMarket(editingMarket.value); $q.notify({ type: 'positive', message: 'Erstellt' }); }
    await loadSupermarketsAndCategories(); showMarketDialog.value = false;
  } catch (error) { console.error(error); $q.notify({ type: 'negative', message: 'Fehler' }); }
};

const performDeleteMarket = async (market: WithId<Markets>) => {
  try { await deleteMarket(market.id); await loadSupermarketsAndCategories(); $q.notify({ type: 'positive', message: 'Gelöscht' }); }
  catch (error) { console.error(error); $q.notify({ type: 'negative', message: 'Fehler' }); }
};

const confirmDeleteMarket = (market: WithId<Markets>) => {
  $q.dialog({ title: 'Löschen', message: `"${market.name}" wirklich löschen?`, cancel: true, persistent: true, color: 'negative' }).onOk(() => { void performDeleteMarket(market); });
};

const addCategoryToMarket = (catId: string) => { editingMarket.value.categoryOrder.push(catId); };
const removeCategoryFromMarket = (catId: string) => { editingMarket.value.categoryOrder = editingMarket.value.categoryOrder.filter(id => id !== catId); };
const moveCategory = (index: number, direction: -1 | 1) => {
  const arr = editingMarket.value.categoryOrder; const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= arr.length) return;
  const itemA = arr[index]; const itemB = arr[newIndex];
  if (itemA !== undefined && itemB !== undefined) { arr[index] = itemB; arr[newIndex] = itemA; }
};

// --- WG LOGIK ---
const wgInfo = ref<{ id: string, name: string, code: string } | null>(null);
const createWgName = ref('');
const joinWgCode = ref('');
const isWgProcessing = ref(false);
const shareMealPlan = ref(true);
const shareShoppingList = ref(true);
const displayName = ref('');
const unitPreference = ref('metric');

const loadWgData = async () => {
  wgInfo.value = await getWGInfo();

  const userSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
  if (userSnap.exists()) {
    const data = userSnap.data();
    displayName.value = data.name || '';
    unitPreference.value = data.unitPreference || 'metric';

    keepScreenOn.value = data.keepScreenOn ?? true;
    timerSound.value = data.timerSound || 'classic';

    shareMealPlan.value = data.shareMealPlan ?? true;
    shareShoppingList.value = data.shareShoppingList ?? true;
  }
};

const updateProfileName = async () => {
  if (!displayName.value.trim()) return;
  try {
    await updateUserProfile({ name: displayName.value.trim() });
    $q.notify({ type: 'positive', message: 'Profilname aktualisiert!', timeout: 1000 });
  } catch (e) {
    console.error(e);
    $q.notify({ type: 'negative', message: 'Fehler beim Speichern.' });
  }
};

const handleCreateWG = async () => {
  if (!createWgName.value.trim()) return;
  isWgProcessing.value = true;
  try {
    await createWG(createWgName.value);
    await loadWgData();
    createWgName.value = '';
    $q.notify({ type: 'positive', message: 'WG erfolgreich gegründet!' });
  } catch (e) {
    console.error("Fehler beim Gründen der WG:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Gründen der WG.' });
  } finally {
    isWgProcessing.value = false;
  }
};

const handleJoinWG = async () => {
  if (!joinWgCode.value.trim()) return;
  isWgProcessing.value = true;
  try {
    const wgName = await joinWG(joinWgCode.value);
    await loadWgData();
    joinWgCode.value = '';

    // GANZ WICHTIG: Die App neu laden, damit alle Rezepte der neuen WG gezogen werden!
    $q.notify({ type: 'positive', message: `Erfolgreich der WG "${wgName}" beigetreten!` });
    setTimeout(() => { window.location.reload(); }, 1500);

  } catch (e: unknown) { // <-- 'any' durch 'unknown' ersetzt
    // Wir prüfen sauber, ob es ein echtes Error-Objekt ist
    const errorMessage = e instanceof Error ? e.message : 'Fehler beim Beitritt.';
    $q.notify({ type: 'negative', message: errorMessage });
  } finally {
    isWgProcessing.value = false;
  }
};

const handleLeaveWG = () => {
  $q.dialog({
    title: 'WG verlassen',
    message: 'Möchtest du diese WG wirklich verlassen? Du hast danach keinen Zugriff mehr auf diese Rezepte und den Wochenplan.',
    cancel: true, persistent: true, color: 'negative'
  }).onOk(() => {
    void (async () => {
      isWgProcessing.value = true;
      try {
        await leaveWG();
        $q.notify({ type: 'info', message: 'WG verlassen.' });
        setTimeout(() => { window.location.reload(); }, 1000);
      } catch (e) {
        console.error("Fehler beim Verlassen der WG:", e);
        $q.notify({ type: 'negative', message: 'Fehler beim Verlassen.' });
      } finally {
        isWgProcessing.value = false;
      }
    })();
  });
};

watch(keepScreenOn, async (val) => {
  await updateUserPrefs({ keepScreenOn: val });
});

watch(timerSound, async (val) => {
  await updateUserPrefs({ timerSound: val });
});

watch([shareMealPlan, shareShoppingList], async () => {
  await updateUserWGPrefs({
    shareMealPlan: shareMealPlan.value,
    shareShoppingList: shareShoppingList.value
  });
});

watch(unitPreference, async (newVal) => {
  await updateUserPrefs({ unitPreference: newVal });
});

onMounted(async () => {
  const storedTheme = localStorage.getItem('darkMode');
  if (storedTheme !== null) isDarkMode.value = storedTheme === 'true';
  const storedPortions = localStorage.getItem('defaultPortions');
  if (storedPortions) defaultPortions.value = parseInt(storedPortions, 10);

  void loadGlobalData();
  void loadSupermarketsAndCategories();
  await loadWgData();
});
</script>

<template>
  <q-page class="bg-dark-page text-white q-pa-md q-pa-lg-xl">
    <div class="max-width-container">

      <h1 class="text-h3 text-weight-bold q-my-none q-mb-lg">Einstellungen</h1>

      <q-tabs v-model="tab" class="bg-dark border-dark rounded-borders q-mb-xl text-grey-5" active-color="primary"
        indicator-color="primary" align="left" narrow-indicator>
        <q-tab name="general" icon="tune" label="Allgemein" no-caps class="text-weight-bold" />
        <q-tab name="supermarkets" icon="storefront" label="Supermärkte" no-caps class="text-weight-bold" />
        <q-tab name="ingredients" icon="hide_image" label="Zutaten-Bilder" no-caps class="text-weight-bold">
          <q-badge v-if="ingredientsWithoutImage.length > 0" color="negative" floating rounded class="q-ml-sm">
            {{ ingredientsWithoutImage.length }}
          </q-badge>
        </q-tab>
        <q-tab name="about" icon="info_outline" label="Info" no-caps class="text-weight-bold" />
        <q-tab name="wg" icon="groups" label="Meine WG" no-caps class="text-weight-bold" />
      </q-tabs>

      <q-tab-panels v-model="tab" animated class="bg-transparent p-0">

        <q-tab-panel name="general" class="q-pa-none">
          <q-card flat class="settings-card bg-dark border-dark">
            <q-list separator class="separator-dark">
              <q-item tag="label" v-ripple class="q-py-lg">
                <q-item-section avatar>
                  <q-icon name="dark_mode" color="grey-5" size="md" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">Dunkles Design</q-item-label>
                  <q-item-label caption class="text-grey-5">Aktiviert den Dark Mode der App</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle v-model="isDarkMode" color="primary" size="lg" />
                </q-item-section>
              </q-item>

              <q-item class="q-py-lg">
                <q-item-section avatar>
                  <q-icon name="restaurant" color="grey-5" size="md" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">Standard-Portionen</q-item-label>
                  <q-item-label caption class="text-grey-5">Vorauswahl beim Anlegen neuer Rezepte</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row items-center no-wrap bg-dark-soft border-dark rounded-borders q-pa-xs">
                    <q-btn flat dense round icon="remove" color="white"
                      @click="defaultPortions > 1 ? defaultPortions-- : null" />
                    <div class="text-weight-bold q-px-md text-subtitle1">{{ defaultPortions }}</div>
                    <q-btn flat dense round icon="add" color="white" @click="defaultPortions++" />
                  </div>
                </q-item-section>
              </q-item>

              <q-item class="q-py-lg">
                <q-item-section avatar>
                  <q-icon name="person" color="grey-5" size="md" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">Anzeigename</q-item-label>
                  <q-item-label caption class="text-grey-5">Wie du in der WG erscheinst</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-input v-model="displayName" dense filled dark class="custom-dark-input" placeholder="Dein Name"
                    @blur="updateProfileName" @keyup.enter="updateProfileName" style="width: 150px;" />
                </q-item-section>
              </q-item>

              <q-item class="q-py-lg">
                <q-item-section avatar>
                  <q-icon name="straighten" color="grey-5" size="md" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">Maßeinheiten</q-item-label>
                  <q-item-label caption class="text-grey-5">Bevorzugtes System beim KI-Import</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-select v-model="unitPreference" :options="[
                    { label: 'Metrisch (g, ml, °C)', value: 'metric' },
                    { label: 'Original (Cups, °F)', value: 'original' }
                  ]" dense filled dark emit-value map-options class="custom-dark-input" style="width: 180px;" />
                </q-item-section>
              </q-item>

              
            </q-list>

            <q-separator class="separator-dark" />
            <div class="q-pa-md">
              <q-btn color="negative" icon="logout" label="Abmelden" class="full-width text-weight-bold" unelevated
                no-caps style="border-radius: 8px;" @click="handleLogout" />
            </div>
          </q-card>
        </q-tab-panel>

        <q-tab-panel name="supermarkets" class="q-pa-none">
          <div class="row items-center justify-between q-mb-md">
            <div class="text-h6 text-weight-bold">Meine Supermärkte</div>
            <q-btn color="primary" icon="add" label="Neuer Markt" no-caps unelevated
              class="rounded-borders text-weight-bold" @click="openAddMarket" />
          </div>

          <q-card flat class="settings-card bg-dark border-dark">
            <q-list separator class="separator-dark">
              <div v-if="supermarkets.length === 0" class="text-center text-grey-5 q-pa-xl">
                <q-icon name="store_mall_directory" size="3em" class="q-mb-sm" />
                <div>Noch keine Supermärkte angelegt.</div>
              </div>

              <q-item v-for="market in supermarkets" :key="market.id" class="q-py-md">
                <q-item-section avatar>
                  <q-avatar color="primary" text-color="dark" icon="storefront" class="text-weight-bold" />
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">{{ market.name }}</q-item-label>
                  <q-item-label caption class="text-grey-5">{{ market.categoryOrder?.length || 0 }} sortierte
                    Kategorien</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row q-gutter-sm">
                    <q-btn flat round icon="edit" color="grey-4" class="bg-dark-soft" @click="openEditMarket(market)" />
                    <q-btn flat round icon="delete_outline" color="red-4" class="bg-dark-soft"
                      @click="confirmDeleteMarket(market)" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </q-tab-panel>

        <q-tab-panel name="ingredients" class="q-pa-none">
          <div class="row items-center justify-between q-mb-md">
            <div class="text-h6 text-weight-bold">Zutaten ohne Bilder</div>
            <div class="text-caption text-grey-5">{{ ingredientsWithoutImage.length }} Einträge</div>
          </div>

          <q-card flat class="settings-card bg-dark border-dark">
            <div v-if="ingredientsWithoutImage.length === 0" class="text-center q-pa-xl">
              <q-icon name="check_circle_outline" size="4em" color="positive" class="q-mb-md" />
              <div class="text-h5 text-weight-bold text-white">Alles aufgeräumt!</div>
              <div class="text-grey-5 q-mt-sm">Jede Zutat in deiner Datenbank hat ein Bild.</div>
            </div>

            <q-list separator class="separator-dark" v-else>
              <q-item v-for="ing in ingredientsWithoutImage" :key="ing.id" class="q-py-md row items-center">

                <q-item-section avatar>
                  <q-avatar color="grey-9" text-color="grey-5" icon="image_not_supported" />
                </q-item-section>

                <q-item-section>
                  <q-item-label class="text-weight-bold text-body1">{{ ing.name }}</q-item-label>
                  <q-item-label caption class="text-grey-6 text-xs">ID: {{ ing.id }}</q-item-label>
                </q-item-section>

                <q-item-section side class="gt-xs">
                  <div class="row items-center q-gutter-sm">

                    <q-btn outline color="primary" icon="photo_library" label="Aus Datenbank" no-caps
                      @click="openImagePicker(ing.id)">
                      <q-tooltip class="bg-primary">Ein bereits hochgeladenes Bild verwenden</q-tooltip>
                    </q-btn>

                    <q-btn outline color="primary" icon="cloud_upload" label="Upload" no-caps
                      :loading="isUploadingMap[ing.id]">
                      <q-file
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;"
                        accept="image/*" :model-value="null"
                        @update:model-value="(file) => uploadImage(file, ing.id)" />
                    </q-btn>

                    <q-btn flat round icon="delete" color="red-4" class="bg-dark-soft" @click="initiateDelete(ing)">
                      <q-tooltip class="bg-negative">Zutat löschen (und aus Rezepten entfernen)</q-tooltip>
                    </q-btn>

                  </div>
                </q-item-section>

                <q-item-section side class="lt-sm">
                  <div class="row items-center q-gutter-xs">
                    <q-btn flat round dense icon="photo_library" color="primary" class="bg-dark-soft"
                      @click="openImagePicker(ing.id)" />
                    <q-btn flat round dense icon="cloud_upload" color="primary" class="bg-dark-soft relative-position"
                      :loading="isUploadingMap[ing.id]">
                      <q-file
                        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;"
                        accept="image/*" :model-value="null"
                        @update:model-value="(file) => uploadImage(file, ing.id)" />
                    </q-btn>
                    <q-btn flat round dense icon="delete" color="red-4" class="bg-dark-soft"
                      @click="initiateDelete(ing)" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </q-tab-panel>

        <q-tab-panel name="wg" class="q-pa-none">
          <div class="text-h6 q-mb-md text-weight-bold">Familie & WG</div>

          <q-card flat class="settings-card bg-dark border-dark q-pa-lg">

            <div v-if="wgInfo" class="text-center">
              <q-avatar size="80px" color="primary" text-color="white" class="q-mb-md shadow-4">
                <q-icon name="diversity_3" size="xl" />
              </q-avatar>
              <h2 class="text-h4 text-weight-bold q-my-none">{{ wgInfo.name }}</h2>
              <p class="text-grey-5 q-mt-sm">Du teilst Rezepte, Wochenpläne und Einkaufslisten mit dieser Gruppe.</p>

              <div class="bg-dark-soft border-dark rounded-borders q-pa-md q-my-lg inline-block">
                <div class="text-caption text-grey-5 text-uppercase letter-spacing-1 q-mb-xs">Einladungs-Code</div>
                <div class="text-h4 text-weight-bolder text-primary letter-spacing-1">{{ wgInfo.code }}</div>
              </div>

              <div class="row justify-center q-mt-md">
                <q-btn outline color="negative" icon="logout" label="WG verlassen" @click="handleLeaveWG"
                  :loading="isWgProcessing" no-caps class="text-weight-bold" />
              </div>
            </div>

            <div v-else>
              <div class="text-center q-mb-xl">
                <q-icon name="group_add" size="4em" color="grey-6" class="q-mb-md" />
                <div class="text-h6 text-weight-bold">Du bist in keiner WG</div>
                <p class="text-grey-5">Erstelle eine neue Gruppe oder trete einer bestehenden bei, um den Wochenplan und
                  Rezepte zu teilen.</p>
              </div>

              <div class="row q-col-gutter-lg">
                <div class="col-12 col-md-6">
                  <div class="bg-dark-soft border-dark rounded-borders q-pa-md full-height">
                    <div class="text-subtitle1 text-weight-bold q-mb-sm text-primary">WG gründen</div>
                    <q-input v-model="createWgName" label="Name (z.B. Chaos-WG)" filled dark
                      class="custom-dark-input q-mb-md" hide-bottom-space />
                    <q-btn color="primary" label="Neue WG erstellen" @click="handleCreateWG" :loading="isWgProcessing"
                      class="full-width text-weight-bold" unelevated no-caps />
                  </div>
                </div>

                <div class="col-12 col-md-6">
                  <div class="bg-dark-soft border-dark rounded-borders q-pa-md full-height">
                    <div class="text-subtitle1 text-weight-bold q-mb-sm text-primary">WG beitreten</div>
                    <q-input v-model="joinWgCode" label="6-stelliger Code" filled dark class="custom-dark-input q-mb-md"
                      hide-bottom-space />
                    <q-btn outline color="primary" label="Beitreten" @click="handleJoinWG" :loading="isWgProcessing"
                      class="full-width text-weight-bold" no-caps />
                  </div>
                </div>
              </div>
            </div>

          </q-card>

          <q-separator dark class="q-my-lg" />
          <div class="text-subtitle1 text-weight-bold q-mb-md text-primary">WG-Berechtigungen</div>
          <div class="bg-dark-soft border-dark rounded-borders q-pa-sm">
            <q-list dark>
              <q-item tag="label" v-ripple>
                <q-item-section>
                  <q-item-label>Meinen Wochenplan teilen</q-item-label>
                  <q-item-label caption>Andere sehen, was du diese Woche kochst</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle v-model="shareMealPlan" color="primary" />
                </q-item-section>
              </q-item>

              <q-item tag="label" v-ripple>
                <q-item-section>
                  <q-item-label>Meine Einkaufsliste teilen</q-item-label>
                  <q-item-label caption>Deine Artikel erscheinen auf der WG-Liste</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-toggle v-model="shareShoppingList" color="primary" />
                </q-item-section>
              </q-item>
            </q-list>
          </div>
        </q-tab-panel>

        <q-tab-panel name="about" class="q-pa-none">
          <q-card flat class="settings-card bg-dark border-dark q-pa-xl text-center">
            <q-icon name="restaurant_menu" size="5em" color="primary" class="q-mb-md" />
            <div class="text-h4 text-weight-bold q-mb-sm">Culinario</div>
            <div class="text-primary text-weight-bold q-mb-xl">Version 2.5.0 Pro</div>
            <div class="text-body1 text-grey-5 max-width-container" style="max-width: 600px;">
              Entwickelt mit Vue 3, Quasar und Firebase.<br><br>
              Mit KI-gestütztem Rezept-Import, smartem Zutaten-Parser, automatischen Einkaufslisten und responsivem
              Design.
            </div>
          </q-card>
        </q-tab-panel>

      </q-tab-panels>
    </div>

    <q-dialog v-model="showImagePicker">
      <q-card class="bg-dark text-white border-dark dialog-card">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6 text-weight-bold">Bestehendes Bild wählen</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup color="grey-5" />
        </q-card-section>

        <q-card-section class="q-pt-md">
          <q-scroll-area style="height: 50vh;">
            <div class="image-grid">
              <q-img v-for="img in uniqueExistingImages" :key="img" :src="img"
                class="gallery-img cursor-pointer rounded-borders" :ratio="1" @click="selectExistingImage(img)" />
            </div>
          </q-scroll-area>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showDeleteDialog" persistent>
      <q-card class="bg-dark text-white border-dark" style="width: 450px; max-width: 95vw;">
        <q-card-section class="bg-red-9 text-white row items-center">
          <q-icon name="warning" size="md" class="q-mr-sm" />
          <div class="text-h6 text-weight-bold">Zutat löschen</div>
        </q-card-section>

        <q-card-section class="q-pt-md">
          <p class="text-body1">Möchtest du <strong>{{ ingredientToDelete?.name }}</strong> wirklich aus der Datenbank
            löschen?</p>

          <div v-if="recipesUsingIngredient.length > 0"
            class="bg-dark-soft border-dark rounded-borders q-pa-md q-mt-md">
            <div class="text-amber text-weight-bold q-mb-sm row items-center">
              <q-icon name="error_outline" size="sm" class="q-mr-xs" />
              Achtung! Zutat wird verwendet
            </div>
            <p class="text-grey-4 text-caption">
              Diese Zutat kommt aktuell in <strong>{{ recipesUsingIngredient.length }} Rezept(en)</strong> vor.
              Wenn du sie löschst, musst du festlegen, durch welche Zutat sie in diesen Rezepten ersetzt werden soll:
            </p>

            <q-select v-model="swapIngredientId" :options="allIngredientsOptions" emit-value map-options
              label="Ersatz-Zutat wählen" filled dark class="custom-dark-input q-mt-md" />
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md">
          <q-btn flat label="Abbrechen" v-close-popup color="white" no-caps :disable="isDeleting" />
          <q-btn :label="recipesUsingIngredient.length > 0 ? 'Löschen & Ersetzen' : 'Zutat Löschen'" color="negative"
            @click="executeDeleteAndSwap" :loading="isDeleting" no-caps unelevated class="text-weight-bold" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showMarketDialog" persistent transition-show="scale" transition-hide="scale">
      <q-card class="bg-dark text-white border-dark dialog-card">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6 text-weight-bold">{{ isEditMode ? 'Supermarkt bearbeiten' : 'Neuer Supermarkt' }}</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup color="grey-5" />
        </q-card-section>

        <q-card-section class="q-pt-md">
          <q-input v-model="editingMarket.name" label="Name des Supermarkts" filled dark
            class="custom-dark-input q-mb-lg" autofocus />

          <div class="row q-col-gutter-lg">
            <div class="col-12 col-md-6">
              <div class="row items-center q-mb-sm">
                <q-icon name="route" color="primary" size="sm" class="q-mr-sm" />
                <span class="text-subtitle2 text-weight-bold">Dein Laufweg</span>
              </div>

              <div v-if="editingMarket.categoryOrder.length === 0"
                class="text-grey-6 text-caption q-pa-md border-dashed rounded-borders text-center">
                Ziehe Kategorien von rechts hierher, um den Laufweg zu definieren.
              </div>

              <q-list separator class="rounded-borders overflow-hidden border-dark bg-dark-soft" v-else>
                <q-item v-for="(cat, index) in selectedCategoriesObjects" :key="cat.id" class="q-pa-sm">
                  <q-item-section avatar style="min-width: 30px;">
                    <q-avatar size="sm" color="primary" text-color="dark" class="text-weight-bold">{{ index + 1
                    }}</q-avatar>
                  </q-item-section>
                  <q-item-section class="text-weight-medium">{{ cat.name }}</q-item-section>
                  <q-item-section side>
                    <div class="row items-center no-wrap">
                      <div class="column q-mr-sm">
                        <q-btn flat round dense icon="expand_less" size="xs" color="grey-5"
                          @click="moveCategory(index, -1)" :disable="index === 0" />
                        <q-btn flat round dense icon="expand_more" size="xs" color="grey-5"
                          @click="moveCategory(index, 1)" :disable="index === editingMarket.categoryOrder.length - 1" />
                      </div>
                      <q-btn flat round dense icon="remove_circle_outline" color="red-4"
                        @click="removeCategoryFromMarket(cat.id)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>

            <div class="col-12 col-md-6">
              <div class="row items-center q-mb-sm">
                <q-icon name="inventory_2" color="grey-6" size="sm" class="q-mr-sm" />
                <span class="text-subtitle2 text-weight-bold text-grey-5">Verfügbar</span>
              </div>

              <q-list separator class="rounded-borders overflow-hidden border-dark bg-dark-soft">
                <q-item v-for="cat in availableCategoriesForEdit" :key="cat.id" clickable v-ripple
                  @click="addCategoryToMarket(cat.id)" class="hover-primary">
                  <q-item-section avatar style="min-width: 30px;"><q-icon name="add" color="primary"
                      size="sm" /></q-item-section>
                  <q-item-section>{{ cat.name }}</q-item-section>
                </q-item>
                <div v-if="availableCategoriesForEdit.length === 0"
                  class="q-pa-md text-grey-6 text-center text-caption">Alle Kategorien zugeordnet.</div>
              </q-list>
            </div>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md border-top">
          <q-btn flat label="Abbrechen" v-close-popup no-caps color="white" />
          <q-btn color="primary" label="Speichern" @click="saveMarket" no-caps unelevated
            class="q-px-md rounded-borders text-weight-bold" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<style scoped>
/* --- GLOBALES DESIGN --- */
.bg-dark-page {
  background-color: #161616;
  min-height: 100vh;
}

.max-width-container {
  max-width: 1100px;
  margin: 0 auto;
}

.border-dark {
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
}

.bg-dark-soft {
  background-color: rgba(255, 255, 255, 0.03);
}

.separator-dark {
  border-color: rgba(255, 255, 255, 0.05);
}

:deep(.q-tab-panel) {
  padding: 0;
}

/* --- KARTEN --- */
.settings-card {
  border-radius: 16px;
  overflow: hidden;
}

/* --- BILDER GALERIE --- */
.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 12px;
  padding: 8px;
}

.gallery-img {
  border: 2px solid transparent;
  transition: all 0.2s ease;
}

.gallery-img:hover {
  transform: scale(1.05);
  border-color: #66a182;
  box-shadow: 0 4px 12px rgba(102, 161, 130, 0.3);
}

/* --- DIALOG --- */
.dialog-card {
  width: 800px;
  max-width: 95vw;
  border-radius: 16px;
}

.border-dashed {
  border: 1px dashed rgba(255, 255, 255, 0.15);
}

.border-top {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

/* --- INPUTS --- */
:deep(.custom-dark-input .q-field__control) {
  background-color: #222222 !important;
  border-radius: 8px;
}

:deep(.custom-dark-input .q-field__control:before) {
  border-bottom: none !important;
}

/* --- HOVER EFFEKTE --- */
.hover-primary:hover {
  background-color: rgba(102, 161, 130, 0.1) !important;
  color: #66a182;
}
</style>
