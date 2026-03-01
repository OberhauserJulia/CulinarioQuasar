<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase/index';
import { useQuasar } from 'quasar';
import { parseIngredient } from '../parser/ingredientParser';
import { getDoc, doc } from 'firebase/firestore';

import type { ShoppingListFirebase, IngredientFirebase, Markets, WithId } from '../types/index';

import {
  getIngredients,
  getMarkets,
  subscribeToShoppingList,
  updateShoppingListItem,
  deleteShoppingListItem,
  addShoppingListItem,
  getGroupMemberSettings
} from '../firebase/services';

interface DisplayItem extends ShoppingListFirebase {
  name: string;
  image: string;
}

const supermarkets = ref<WithId<Markets>[]>([]);
const selectedSupermarket = ref<WithId<Markets> | null | undefined>(undefined);
const categories = ref<Record<string, string>>({});

const viewMode = ref<'list' | 'grid'>('grid');
const $q = useQuasar();
const isProcessing = ref(false);
const smartInput = ref('');

const shoppingItems = ref<ShoppingListFirebase[]>([]);
const ingredientsMap = ref<Record<string, string>>({});
const allIngredients = ref<IngredientFirebase[]>([]);
const showMenu = ref(false);
const suggestions = ref<IngredientFirebase[]>([]);
const memberSettings = ref<Record<string, { shareShoppingList: boolean }>>({});

let unsubscribeShoppingList: (() => void) | null = null;

onMounted(async () => {
  try {
    const ings = await getIngredients();
    memberSettings.value = await getGroupMemberSettings();
    const tempMap: Record<string, string> = {};

    const userSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
    const autoCleanup = userSnap.data()?.autoCleanupList;

    if (autoCleanup) {
      // Einfache Logik: Lösche alle, die bereits abgehakt sind
      // Komplexere Logik würde einen Zeitstempel 'checkedAt' in Firestore benötigen
      const checkedItems = shoppingItems.value.filter(item => item.checked);
      for (const item of checkedItems) {
        await deleteShoppingListItem(item.id);
      }
    }

    ings.forEach(ing => {
      if (ing.name) {
        tempMap[ing.id] = ing.name;
      }
    });

    ingredientsMap.value = tempMap;
    allIngredients.value = ings;

    const marks = await getMarkets();
    supermarkets.value = marks;
    if (marks.length > 0 && !selectedSupermarket.value) {
      selectedSupermarket.value = marks[0];
    }

    const catSnap = await getDocs(collection(db, 'categories'));
    const cMap: Record<string, string> = {};
    catSnap.forEach(d => {
      cMap[d.id] = d.data().name;
    });
    categories.value = cMap;

    unsubscribeShoppingList = subscribeToShoppingList((items) => {
      shoppingItems.value = items;
    });

  } catch (error: unknown) {
    console.error("Fehler beim Laden der Startdaten:", error);
  }
});

onUnmounted(() => {
  if (unsubscribeShoppingList) {
    unsubscribeShoppingList();
  }
});

// --- EDITIEREN LOGIK ---
const showEditDialog = ref(false);
const editingItem = ref<DisplayItem | null>(null);

// NEU: Nur noch eine einzige Variable für das kombinierte Feld
const editQuantityInput = ref('');

const editCategory = ref<string | null>(null);
const editImage = ref<string | null>(null);

const categoryOptions = computed(() => {
  return Object.entries(categories.value).map(([id, name]) => ({ label: name, value: id }));
});

const availableImages = computed(() => {
  const images = new Set<string>();
  allIngredients.value.forEach(ing => {
    if (ing.image) images.add(ing.image);
  });
  return Array.from(images);
});

// NEU: Wir füllen das einzelne Feld intelligent aus
const openEditDialog = (item: DisplayItem) => {
  editingItem.value = item;

  if (item.amount > 0) {
    editQuantityInput.value = `${item.amount} ${item.unit}`.trim();
  } else if (item.unit) {
    editQuantityInput.value = item.unit;
  } else {
    editQuantityInput.value = '';
  }

  editCategory.value = item.customCategoryId || null;
  editImage.value = item.customImage || item.image || null;
  showEditDialog.value = true;
};

// NEU: Wir zerschneiden den Text beim Speichern wieder
const saveEditItem = async () => {
  if (!editingItem.value) return;
  isProcessing.value = true;

  try {
    let newAmount = 0;
    let newUnit = '';
    const val = editQuantityInput.value.trim();

    if (val) {
      // 1. Zuerst durch deinen starken Parser jagen (wir hängen den Namen an, damit der Kontext stimmt)
      const parsed = parseInputLocally(`${val} ${editingItem.value.name}`);

      newAmount = parsed.amount;
      newUnit = parsed.unit;

      // 2. Fallback: Falls die Einheit komplett "unbekannt" ist (z.B. "2 Kisten")
      // und der Parser sie deshalb ignoriert hat:
      if (!newUnit) {
        // Regex korrigiert: \/ wurde zu /
        const match = val.match(/^([\d.,/]+)\s*(.*)$/);

        // Match-Check erweitert: Wir prüfen, ob match[2] definiert ist
        if (match && match[2] !== undefined) {
          newUnit = match[2].trim();
        } else {
          newUnit = val; // Wenn nur Text getippt wurde (z.B. "Viel")
        }
      }
    }

    const updateData: Partial<ShoppingListFirebase> = {
      amount: newAmount,
      unit: newUnit,
    };

    // Eigene Anpassungen nur speichern, wenn es ein "Custom Item" ist
    if (!editingItem.value.ingredientid) {
      updateData.customCategoryId = editCategory.value || '';
      updateData.customImage = editImage.value || '';
    }

    await updateShoppingListItem(editingItem.value.id, updateData);
    showEditDialog.value = false;
    $q.notify({ type: 'positive', message: 'Artikel aktualisiert' });
  } catch (e) {
    console.error("Fehler beim Speichern:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Speichern' });
  } finally {
    isProcessing.value = false;
  }
};

const displayItems = computed<DisplayItem[]>(() => {
  const myUid = auth.currentUser?.uid;

  return shoppingItems.value
    .filter(item => {
      // PRIVATSPHÄRE-FILTER ohne 'any'
      // Wir casten das Item auf den Typ plus das optionale authorId Feld
      const itemWithAuthor = item as ShoppingListFirebase & { authorId?: string };
      const authorId = itemWithAuthor.authorId;

      const isAllowed = !authorId ||
        authorId === myUid ||
        (memberSettings.value[authorId]?.shareShoppingList !== false);

      return isAllowed;
    })
    .map(item => {
      // ID-CHECK ohne 'any'
      // Wir casten auf die möglichen Schreibweisen aus der Datenbank
      const legacyItem = item as ShoppingListFirebase & { ingredientId?: string; ingredientID?: string };
      const safeId = item.ingredientid || legacyItem.ingredientId || legacyItem.ingredientID;

      const ingredient = safeId ? allIngredients.value.find(i => i.id === safeId) : null;
      const finalImage = item.customImage ? item.customImage : (ingredient?.image || '');
      const finalName = item.customName ? item.customName : (ingredient?.name || 'Unbekannter Artikel');

      return {
        ...item,
        ingredientid: safeId || '',
        name: finalName,
        image: finalImage
      };
    });
});

const groupedItems = computed(() => {
  const items = displayItems.value;
  const order = selectedSupermarket.value?.categoryOrder || [];

  const groups: Record<string, DisplayItem[]> = {};

  items.forEach(item => {
    let catId = 'unknown'; // Standard: Sonstiges

    // Wir nutzen jetzt die saubere ingredientid aus displayItems
    if (item.ingredientid) {
      const ingredient = allIngredients.value.find(ing => ing.id === item.ingredientid);
      if (ingredient?.categoryId) {
        catId = ingredient.categoryId;
      }
    } else if (item.customCategoryId) {
      catId = item.customCategoryId;
    }

    const targetGroup = groups[catId] || [];
    targetGroup.push(item);
    groups[catId] = targetGroup;
  });

  const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
    const indexA = order.indexOf(a);
    const indexB = order.indexOf(b);
    return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
  });

  return sortedGroupKeys.map(key => ({
    categoryId: key,
    categoryName: categories.value[key] || 'Sonstiges',
    items: groups[key] || []
  }));
});

const toggleItem = async (item: ShoppingListFirebase) => {
  try {
    await updateShoppingListItem(item.id, { checked: item.checked });
  } catch {
    $q.notify({ type: 'negative', message: 'Fehler beim Aktualisieren' });
  }
};

const deleteItem = async (id: string) => {
  try {
    await deleteShoppingListItem(id);
  } catch {
    $q.notify({ type: 'negative', message: 'Fehler beim Löschen' });
  }
};

const performClearList = async () => {
  isProcessing.value = true;
  try {
    const deletePromises = shoppingItems.value.map(item => deleteShoppingListItem(item.id));
    await Promise.all(deletePromises);
    $q.notify({ type: 'positive', message: 'Einkaufsliste geleert!' });
  } catch (error: unknown) {
    console.error("Fehler:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Leeren der Liste' });
  } finally {
    isProcessing.value = false;
  }
};

const confirmClearList = () => {
  if (shoppingItems.value.length === 0) return;
  $q.dialog({
    title: 'Liste leeren',
    message: 'Möchtest du wirklich alle Artikel unwiderruflich löschen?',
    cancel: true,
    persistent: true,
    color: 'negative'
  }).onOk(() => {
    void performClearList();
  });
};

const parseInputLocally = (text: string) => {
  try {
    const result = parseIngredient(text, 'de');
    if (result) {
      return {
        amount: result.quantity > 0 ? result.quantity : 0, // 0 bedeutet "keine Menge"
        unit: result.unitText || '',
        name: result.ingredient || text.trim()
      };
    }
  } catch (error) {
    console.warn("Parser error:", error);
  }
  return { amount: 0, unit: '', name: text.trim() };
};

const onInputUpdate = (val: string | number | null) => {
  const text = String(val || '').trim();

  if (text.length < 2) {
    showMenu.value = false;
    suggestions.value = [];
    return;
  }

  const parsed = parseInputLocally(text);
  const searchName = parsed.name.toLowerCase();

  const matches = allIngredients.value.filter(ing =>
    ing.name.toLowerCase().includes(searchName)
  );

  matches.sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();

    if (nameA === searchName && nameB !== searchName) return -1;
    if (nameA !== searchName && nameB === searchName) return 1;

    if (nameA.startsWith(searchName) && !nameB.startsWith(searchName)) return -1;
    if (!nameA.startsWith(searchName) && nameB.startsWith(searchName)) return 1;

    return nameA.localeCompare(nameB);
  });

  suggestions.value = matches.slice(0, 5);
  showMenu.value = true;
};

const isCustomItem = computed(() => {
  if (!smartInput.value.trim()) return false;
  const parsed = parseInputLocally(smartInput.value);
  const exactMatch = allIngredients.value.find(i => i.name.toLowerCase() === parsed.name.toLowerCase());
  return !exactMatch;
});

const addFromSuggestion = async (ing: IngredientFirebase) => {
  const parsed = parseInputLocally(smartInput.value);
  try {
    await addShoppingListItem({
      amount: parsed.amount,
      unit: parsed.unit,
      ingredientid: ing.id,
      checked: false
    });

    smartInput.value = '';
    showMenu.value = false;
    $q.notify({ type: 'positive', message: `${ing.name} hinzugefügt` });
  } catch {
    $q.notify({ type: 'negative', message: 'Fehler beim Hinzufügen' });
  }
};

const addCustomItem = async (parsed: { amount: number, unit: string, name: string }) => {
  isProcessing.value = true;
  try {
    await addShoppingListItem({
      amount: parsed.amount,
      unit: parsed.unit,
      ingredientid: '',
      customName: parsed.name,
      checked: false
    });
    $q.notify({ type: 'positive', message: `${parsed.name} hinzugefügt (Tippen & Halten zum Bearbeiten)` });
    smartInput.value = '';
    showMenu.value = false;
  } catch {
    $q.notify({ type: 'negative', message: 'Fehler beim Hinzufügen' });
  } finally {
    isProcessing.value = false;
  }
};

const handleEnter = async () => {
  if (!smartInput.value.trim()) return;

  const parsed = parseInputLocally(smartInput.value);
  const exactMatch = allIngredients.value.find(i => i.name.toLowerCase() === parsed.name.toLowerCase());

  if (exactMatch) {
    await addFromSuggestion(exactMatch);
  } else {
    await addCustomItem(parsed);
  }
};
</script>

<template>
  <q-page class="dynamic-text q-pa-md q-pa-lg-xl">
    <div class="max-width-container">

      <div class="row items-center justify-between q-mb-xl wrap q-gutter-y-md">
        <h1 class="text-h4 text-weight-bold q-my-none dynamic-text gt-sm">Einkaufsliste</h1>
        <h1 class="text-h5 text-weight-bold q-my-none dynamic-text lt-md">Einkaufsliste</h1>

        <div class="row items-center q-gutter-sm supermarket-controls">

          <div class="dynamic-card dynamic-border rounded-borders q-pa-xs row transition-colors">
            <q-btn flat dense icon="format_list_bulleted" :color="viewMode === 'list' ? 'primary' : 'grey-5'"
              @click="viewMode = 'list'" class="q-px-sm rounded-borders transition-colors">
              <q-tooltip class="bg-primary">Listenansicht</q-tooltip>
            </q-btn>
            <q-btn flat dense icon="grid_view" :color="viewMode === 'grid' ? 'primary' : 'grey-5'"
              @click="viewMode = 'grid'" class="q-px-sm rounded-borders transition-colors">
              <q-tooltip class="bg-primary">Kachelansicht</q-tooltip>
            </q-btn>
          </div>

          <div class="supermarket-select">
            <q-select v-model="selectedSupermarket" :options="supermarkets" option-label="name"
              label="Supermarkt-Layout" filled :dark="$q.dark.isActive" color="primary" dense
              class="custom-dynamic-input" hide-bottom-space popup-content-class="dynamic-card dynamic-text">
              <template v-slot:prepend>
                <q-icon name="storefront" color="primary" size="sm" />
              </template>
            </q-select>
          </div>

          <q-btn v-if="shoppingItems.length > 0" unelevated icon="delete_sweep" text-color="negative"
            class="dynamic-card dynamic-border rounded-borders hover-negative transition-colors"
            style="height: 40px; padding: 0 12px;" @click="confirmClearList">
            <span class="q-ml-sm text-weight-bold gt-xs">Leeren</span>
            <q-tooltip class="bg-negative text-white">Gesamte Liste leeren</q-tooltip>
          </q-btn>

        </div>
      </div>

      <q-card class="dynamic-card dynamic-border q-pa-md q-mb-xl shadow-2 transition-colors">
        <div class="text-subtitle2 text-weight-bold q-mb-md text-primary">Artikel hinzufügen</div>

        <q-input v-model="smartInput" filled :dark="$q.dark.isActive" color="primary" dense
          class="custom-dynamic-input full-width text-body1" placeholder="Menge, Einheit & Zutat (z.B. 500g Mehl)"
          :loading="isProcessing" @update:model-value="onInputUpdate" @keyup.enter="handleEnter" hide-bottom-space
          autocomplete="off">

          <template v-slot:append>
            <q-icon :name="isCustomItem ? 'edit_note' : 'check_circle'" :color="isCustomItem ? 'amber' : 'positive'"
              class="q-mr-sm" size="xs">
              <q-tooltip class="bg-dynamic-soft dynamic-text dynamic-border">
                {{ isCustomItem ? 'Freier Text (ohne Datenbank-Eintrag)' : 'Zutat in Datenbank gefunden' }}
              </q-tooltip>
            </q-icon>
            <q-btn flat round icon="add" color="primary" @click="handleEnter" :disable="!smartInput.trim()" />
          </template>

          <q-menu v-model="showMenu" fit no-focus no-parent-event class="dynamic-card dynamic-text dynamic-border"
            auto-close>
            <q-list separator class="dynamic-separator">

              <q-item v-for="ing in suggestions" :key="ing.id" clickable v-ripple @click="addFromSuggestion(ing)"
                class="list-item-hover">
                <q-item-section avatar style="min-width: 40px;">
                  <q-avatar v-if="ing.image" size="32px" rounded class="shadow-1">
                    <img :src="ing.image" style="object-fit: cover;">
                  </q-avatar>
                  <q-avatar v-else size="32px" rounded class="bg-dynamic-soft dynamic-border">
                    <q-icon name="restaurant" class="dynamic-text-muted" size="xs" />
                  </q-avatar>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-bold dynamic-text">{{ ing.name }}</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-icon name="add_circle" color="primary" size="sm" />
                </q-item-section>
              </q-item>

              <q-item v-if="suggestions.length === 0 && smartInput.trim().length > 1" clickable v-ripple
                @click="handleEnter" class="list-item-hover">
                <q-item-section>
                  <q-item-label class="text-italic dynamic-text-muted">
                    "{{ parseInputLocally(smartInput).name }}" als freien Eintrag speichern
                  </q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-icon name="edit_note" color="amber" />
                </q-item-section>
              </q-item>

            </q-list>
          </q-menu>
        </q-input>
      </q-card>

      <div v-if="groupedItems.length > 0" class="shopping-list">
        <div v-for="group in groupedItems" :key="group.categoryId" class="q-mb-xl">

          <div class="row items-center q-mb-sm q-ml-xs">
            <div class="text-subtitle1 text-weight-bold text-primary text-uppercase letter-spacing-1">
              {{ group.categoryName }}
            </div>
            <q-space />
            <div class="text-caption dynamic-text-muted">{{ group.items.length }} Artikel</div>
          </div>

          <transition-group v-if="viewMode === 'list'" name="list" tag="div" class="q-gutter-y-sm">
            <q-item v-for="item in group.items" :key="item.id" tag="label" v-ripple
              class="shopping-item dynamic-card dynamic-border rounded-borders q-px-sm transition-colors"
              :class="{ 'item-checked': item.checked }" v-touch-hold.mouse="() => openEditDialog(item)">

              <q-item-section avatar>
                <q-checkbox v-model="item.checked" color="primary" :dark="$q.dark.isActive" keep-color
                  @update:model-value="toggleItem(item)" />
              </q-item-section>
              <q-item-section avatar v-if="item.image" style="min-width: 40px;">
                <q-avatar size="32px" rounded class="shadow-1"><img :src="item.image"></q-avatar>
              </q-item-section>
              <q-item-section>
                <q-item-label class="text-weight-bold item-name text-body1 dynamic-text">{{ item.name }}</q-item-label>
                <q-item-label caption class="dynamic-text-muted item-amount" v-if="item.amount > 0">{{ item.amount }} {{
                  item.unit }}</q-item-label>
              </q-item-section>
              <q-item-section side>
                <div class="row items-center no-wrap">
                  <q-btn flat round dense icon="edit" class="dynamic-text-muted hover-primary edit-btn"
                    @click.stop="openEditDialog(item)" />
                  <q-btn flat round dense icon="delete_outline" class="dynamic-text-muted hover-negative"
                    @click.stop="deleteItem(item.id)" />
                </div>
              </q-item-section>
            </q-item>
          </transition-group>

          <transition-group v-else name="list" tag="div" class="bring-grid">
            <div v-for="item in group.items" :key="'grid-' + item.id"
              class="bring-tile dynamic-card cursor-pointer relative-position column flex-center text-center q-pa-sm transition-colors"
              :class="{ 'tile-checked': item.checked }" v-ripple @click="item.checked = !item.checked; toggleItem(item)"
              v-touch-hold.mouse="() => openEditDialog(item)">

              <q-btn round flat dense icon="close" size="xs"
                class="absolute-top-right q-mt-xs q-mr-xs action-btn dynamic-text dynamic-border bg-dynamic-page"
                @click.stop="deleteItem(item.id)" />

              <q-btn round flat dense icon="edit" size="xs"
                class="absolute-top-left q-mt-xs q-ml-xs action-btn dynamic-text dynamic-border bg-dynamic-page edit-btn"
                @click.stop="openEditDialog(item)" />

              <div class="tile-content flex flex-center column">
                <q-icon v-if="item.checked" name="check_circle" color="primary" size="sm"
                  class="q-mb-xs absolute-center" style="z-index: 10;" />

                <q-avatar v-if="item.image" size="40px" class="q-mb-sm bg-transparent"
                  :class="{ 'opacity-50': item.checked }">
                  <img :src="item.image" style="object-fit: cover;">
                </q-avatar>

                <div class="text-subtitle2 text-weight-bold tile-name q-mb-xs dynamic-text" lang="de">
                  {{ item.name }}
                </div>
                <div class="text-caption dynamic-text-muted tile-amount" v-if="item.amount > 0">
                  {{ item.amount }} {{ item.unit }}
                </div>
              </div>

            </div>
          </transition-group>

        </div>
      </div>

      <div v-else class="empty-state flex flex-center column text-center q-pa-xl transition-colors">
        <q-icon name="shopping_cart" size="4em" class="dynamic-text-muted q-mb-md opacity-40" />
        <div class="text-h6 dynamic-text-muted text-weight-bold">Deine Liste ist leer</div>
        <div class="text-body2 dynamic-text-muted q-mt-sm">Füge oben Artikel hinzu oder plane deine Woche.</div>
      </div>

    </div>

    <q-dialog v-model="showEditDialog" persistent>
      <q-card class="dynamic-card dynamic-text rounded-xl shadow-10" style="width: 400px; max-width: 95vw;">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6 text-primary">{{ editingItem?.name }} bearbeiten</div>
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup class="dynamic-text-muted" />
        </q-card-section>

        <q-card-section class="q-pt-lg">
          <div class="q-mb-md">
            <q-input v-model="editQuantityInput" label="Menge & Einheit (z.B. 2 Packungen)" filled
              :dark="$q.dark.isActive" color="primary" class="custom-dynamic-input text-body1"
              @keyup.enter="saveEditItem" autocomplete="off" />
          </div>

          <div v-if="editingItem && !editingItem.ingredientid">
            <q-separator :dark="$q.dark.isActive" class="q-my-md opacity-20" />
            <div class="text-subtitle2 text-weight-bold q-mb-sm">Details anpassen (Freier Eintrag)</div>

            <q-select v-model="editCategory" :options="categoryOptions" emit-value map-options label="Kategorie" filled
              :dark="$q.dark.isActive" color="primary" class="custom-dynamic-input q-mb-md"
              popup-content-class="dynamic-card dynamic-text" />

            <div class="text-caption dynamic-text-muted q-mb-xs">Bild wählen:</div>
            <q-scroll-area style="height: 140px;" class="bg-dynamic-soft rounded-borders q-pa-sm dynamic-border">
              <div class="row q-gutter-sm">
                <q-avatar size="40px" class="cursor-pointer flex flex-center dynamic-card dynamic-border"
                  :class="{ 'border-primary': editImage === '' }" @click="editImage = ''">
                  <q-icon name="block" class="dynamic-text-muted" />
                </q-avatar>

                <q-avatar v-for="img in availableImages" :key="img" size="40px"
                  class="cursor-pointer image-selector-item flex flex-center overflow-hidden dynamic-card dynamic-border"
                  :class="{ 'border-primary': editImage === img }" @click="editImage = img">
                  <img :src="img" style="object-fit: cover; width: 100%; height: 100%;">
                </q-avatar>
              </div>
            </q-scroll-area>
          </div>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-md bg-dynamic-soft dynamic-border-top">
          <q-btn flat label="Abbrechen" v-close-popup class="dynamic-text" no-caps />
          <q-btn color="primary" label="Speichern" @click="saveEditItem" :loading="isProcessing" no-caps unelevated
            class="rounded-borders text-weight-bold" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<style scoped>
.border-dark {
  border: 1px solid #333;
}

.supermarket-controls {
  flex-wrap: nowrap;
}

.hover-dark:hover {
  background-color: #2a2a2a !important;
}

@media (max-width: 599px) {
  .supermarket-controls {
    flex-wrap: wrap;
    width: 100%;
  }

  .supermarket-select {
    width: 100%;
    margin-top: 8px;
  }
}

.bring-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(125px, 1fr));
  gap: 12px;
}

.bring-tile {
  background-color: #222222;
  border: 2px solid transparent;
  border-radius: 16px;
  min-height: 110px;
  height: auto;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  user-select: none;
}

.bring-tile:active {
  transform: scale(0.95);
}

@media (hover: hover) {
  .bring-tile:hover {
    border-color: var(--q-primary) !important;
    transform: translateY(-2px);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--q-primary), transparent 85%);
  }

  .shopping-item:hover {
    border-color: var(--q-primary) !important;
  }
}

.tile-content {
  width: 100%;
  min-width: 0;
  padding: 0 2px;
}

.tile-name {
  line-height: 1.2;
  width: 100%;
  overflow-wrap: break-word;
  hyphens: auto;
  -webkit-hyphens: auto;
}

/* Abgehakter Zustand im Grid */
.tile-checked {
  background-color: rgba(34, 34, 34, 0.4);
  border-color: transparent !important;
  opacity: 0.6;
}

.tile-checked .tile-name {
  text-decoration: line-through;
  color: #666;
}

.tile-checked .tile-amount {
  text-decoration: line-through;
}

/* Lösch-Button Verhalten im Grid */
.delete-btn {
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 2;
}

/* Desktop: Zeige Löschen-Button nur bei Hover */
@media (hover: hover) {
  .bring-tile:hover .delete-btn {
    opacity: 1;
  }
}

/* Mobile: Immer einen kleinen Löschen-Button anzeigen */
@media (hover: none) {
  .delete-btn {
    opacity: 1;
  }

  .bring-grid {
    grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
    gap: 8px;
  }

  .bring-tile {
    min-height: 100px;
    height: auto;
  }
}

.bg-dark-page {
  background-color: #161616;
  min-height: 100vh;
}

/* Maximale Breite für bessere Lesbarkeit auf Desktop */
.max-width-container {
  max-width: none;
  width: 100%;
}

.supermarket-select {
  min-width: 250px;
}

@media (max-width: 599px) {
  .supermarket-select {
    width: 100%;
  }
}

/* Karte zum Hinzufügen */
.add-card {
  border: 1px solid #333;
  border-radius: 12px;
}

/* Custom Input Styling */
:deep(.custom-dark-input .q-field__control) {
  background-color: #1e1e1e !important;
  border-radius: 8px;
}

:deep(.custom-dark-input .q-field__control:before) {
  border-bottom: none !important;
}

/* Listen Items */
.letter-spacing-1 {
  letter-spacing: 1px;
}

.shopping-item {
  min-height: 60px;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

@media (hover: hover) {
  .bring-tile:hover .action-btn {
    opacity: 1;
  }

  .edit-btn {
    opacity: 0;
  }

  .shopping-item:hover .edit-btn {
    opacity: 1;
  }
}

/* Abgehakt Zustand */
.item-checked {
  background-color: rgba(34, 34, 34, 0.5);
  border-color: #222;
}

.item-checked .item-name {
  text-decoration: line-through;
  color: #666 !important;
}

.item-checked .item-amount {
  text-decoration: line-through;
  opacity: 0.5;
}

.hover-negative:hover {
  color: var(--q-grey-6) !important;
}

/* Empty State */
.empty-state {
  border: 2px dashed #333;
  border-radius: 16px;
  min-height: 300px;
}

/* Animation für das Hinzufügen/Löschen/Abhaken */
.list-enter-active,
.list-leave-active,
.list-move {
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.list-leave-active {
  position: absolute;
}

/* Buttons Verhalten im Grid (Löschen & Bearbeiten) */
.action-btn {
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 2;
}

/* Desktop: Zeige Buttons nur bei Hover */
@media (hover: hover) {
  .bring-tile:hover .action-btn {
    opacity: 1;
  }

  .edit-btn {
    opacity: 0;
  }

  .shopping-item:hover .edit-btn {
    opacity: 1;
  }

  .hover-primary:hover {
    color: var(--q-primary) !important;
  }
}

/* Mobile: Buttons immer leicht sichtbar oder versteckt lassen */
@media (hover: none) {
  .action-btn {
    opacity: 1;
  }

  /* Auf Handy verstecken wir den Edit-Button, da man lange drücken kann */
  .edit-btn {
    display: none;
  }

  .bring-grid {
    grid-template-columns: repeat(auto-fill, minmax(95px, 1fr));
    gap: 8px;
  }

  .bring-tile {
    min-height: 100px;
    height: auto;
  }
}

.opacity-50 {
  opacity: 0.5;
}

.border-primary {
  border: 2px solid var(--q-primary);
  transform: scale(1.1);
  box-shadow: 0 0 10px rgba(102, 161, 130, 0.5);
}

.image-selector-item {
  transition: all 0.2s ease;
}

.image-selector-item:hover {
  transform: scale(1.1);
}
</style>
