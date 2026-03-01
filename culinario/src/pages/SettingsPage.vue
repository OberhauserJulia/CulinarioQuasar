<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useQuasar, copyToClipboard, setCssVar } from 'quasar';
import { collection, getDocs, doc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore';
import { useRouter } from 'vue-router';
import { db, auth } from '../firebase/index';
import { signOut, updateEmail, updatePassword } from 'firebase/auth';

// 1. Typen importieren
import type { IngredientFirebase, Markets, WithId, RecipeFirebase } from '../types/index';

// 2. Service Funktionen importieren
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
  updateUserPrefs,
  exportRecipeData,
  deleteUserAccount,
  getGroupMembers,
  addIngredient
} from '../firebase/services';

const $q = useQuasar();
const router = useRouter();
const tab = ref('general');

// ==========================================
// --- EINMALIGER JSON-UPLOAD (SEED) ---
// ==========================================
const seedDatabaseWithJson = (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      $q.loading.show({ message: 'Datenbank wird befüllt... Bitte warten, das kann ein paar Sekunden dauern.' });

      const rawData = JSON.parse(e.target?.result as string);

      // Filtern, falls leere Objekte drin sind
      const validData = rawData.filter((ing: any) => ing.name && ing.name.trim() !== '');

      // In 400er Blöcke aufteilen (Firebase Limit ist 500 pro Batch)
      const chunks = [];
      for (let i = 0; i < validData.length; i += 400) {
        chunks.push(validData.slice(i, i + 400));
      }

      // Blöcke hochladen
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((ing: any) => {
          // Generiert eine neue automatische ID für jede Zutat
          const newDocRef = doc(collection(db, 'ingredients'));
          batch.set(newDocRef, ing);
        });
        await batch.commit(); // Schreibt die 400 Zutaten auf einmal
      }

      $q.notify({ type: 'positive', message: `${validData.length} Zutaten erfolgreich hochgeladen!`, icon: 'check_circle' });

      // Liste in der UI neu laden
      await loadGlobalData();

    } catch (err) {
      console.error("Upload Fehler:", err);
      $q.notify({ type: 'negative', message: 'Fehler beim Parsen oder Hochladen der JSON.' });
    } finally {
      $q.loading.hide();
      // Input-Feld zurücksetzen, damit man dieselbe Datei nochmal wählen könnte
      (event.target as HTMLInputElement).value = '';
    }
  };

  reader.readAsText(file);
};

// ==========================================
// --- ALLGEMEINE SETTINGS & DESIGN ---
// ==========================================
const isDarkMode = ref($q.dark.isActive);
const defaultPortions = ref(2);
const primaryColor = ref('#66a182');

const presetColors = ['#66a182', '#4a90e2', '#e67e22', '#9b59b6', '#f1c40f'];
const isCustomColor = computed(() => !presetColors.includes(primaryColor.value.toLowerCase()));

watch(isDarkMode, (val) => {
  $q.dark.set(val);
});

watch(defaultPortions, (val) => {
  localStorage.setItem('defaultPortions', val.toString());
});

const applyPrimaryColor = (color: string) => {
  setCssVar('primary', color);
  setCssVar('accent', color);
};

watch(primaryColor, (val) => {
  applyPrimaryColor(val);
});

// ==========================================
// --- ACCOUNT SICHERHEIT ---
// ==========================================
const newEmail = ref(auth.currentUser?.email || '');
const newPassword = ref('');
const confirmPassword = ref('');

const handleUpdateEmail = async () => {
  if (!newEmail.value || newEmail.value === auth.currentUser?.email) return;
  try {
    await updateEmail(auth.currentUser!, newEmail.value);
    $q.notify({ type: 'positive', message: 'E-Mail Adresse aktualisiert!' });
  } catch (error: unknown) {
    console.error("Email update error:", error);
    $q.notify({
      type: 'negative',
      message: 'Fehler: Bitte logge dich erneut ein, um diese Änderung zu bestätigen.'
    });
  }
};

const handleUpdatePassword = async () => {
  if (!newPassword.value || newPassword.value !== confirmPassword.value) {
    $q.notify({ type: 'warning', message: 'Passwörter stimmen nicht überein.' });
    return;
  }
  try {
    await updatePassword(auth.currentUser!, newPassword.value);
    $q.notify({ type: 'positive', message: 'Passwort erfolgreich geändert!' });
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (error: unknown) {
    console.error("Password update error:", error);
    $q.notify({ type: 'negative', message: 'Fehler beim Ändern des Passworts.' });
  }
};

// ==========================================
// --- NUTZER-PROFIL & PRÄFERENZEN ---
// ==========================================
const displayName = ref('');
const unitPreference = ref('metric');
const keepScreenOn = ref(true);
const timerSound = ref('classic');
const weekStart = ref(1);
const hidePastDays = ref(true);
const autoCleanupList = ref(false); // NEU: Auto-Aufräumen

const updateProfileName = () => {
  if (!displayName.value.trim()) return;
  void updateUserProfile({ name: displayName.value.trim() });
  $q.notify({ type: 'positive', message: 'Name aktualisiert', timeout: 800 });
};

watch([unitPreference, keepScreenOn, timerSound, weekStart, hidePastDays, autoCleanupList, isDarkMode, defaultPortions, primaryColor], (newVals) => {
  void updateUserPrefs({
    unitPreference: newVals[0],
    keepScreenOn: newVals[1],
    timerSound: newVals[2],
    weekStart: newVals[3],
    hidePastDays: newVals[4],
    autoCleanupList: newVals[5],
    isDarkMode: newVals[6],
    defaultPortions: newVals[7],
    primaryColor: newVals[8]
  });
});

// ==========================================
// --- WG-VERWALTUNG ---
// ==========================================
const wgInfo = ref<{ id: string, name: string, code: string } | null>(null);
const wgMembers = ref<{ id: string, name: string, email: string }[]>([]);
const createWgName = ref('');
const joinWgCode = ref('');
const isWgProcessing = ref(false);
const shareMealPlan = ref(true);
const shareShoppingList = ref(true);

const copyCode = (code: string) => {
  copyToClipboard(code).then(() => {
    $q.notify({ type: 'positive', message: 'Code kopiert!', icon: 'content_copy' });
  }).catch(() => { });
};

const loadWgData = async () => {
  wgInfo.value = await getWGInfo();
  if (wgInfo.value) {
    wgMembers.value = await getGroupMembers();
  }
  const userSnap = await getDoc(doc(db, 'users', auth.currentUser!.uid));
  if (userSnap.exists()) {
    const data = userSnap.data();
    displayName.value = data.name || '';
    unitPreference.value = data.unitPreference || 'metric';
    keepScreenOn.value = data.keepScreenOn ?? true;
    timerSound.value = data.timerSound || 'classic';
    weekStart.value = data.weekStart ?? 1;
    hidePastDays.value = data.hidePastDays ?? true;
    autoCleanupList.value = data.autoCleanupList ?? false;
    shareMealPlan.value = data.shareMealPlan ?? true;
    shareShoppingList.value = data.shareShoppingList ?? true;

    if (data.isDarkMode !== undefined) {
      isDarkMode.value = data.isDarkMode;
      $q.dark.set(data.isDarkMode);
    }
    if (data.defaultPortions !== undefined) {
      defaultPortions.value = data.defaultPortions;
    }
    if (data.primaryColor) {
      primaryColor.value = data.primaryColor;
      applyPrimaryColor(data.primaryColor);
    }
  }
};

const handleCreateWG = async () => {
  if (!createWgName.value.trim()) return;
  isWgProcessing.value = true;
  try {
    await createWG(createWgName.value);
    await loadWgData();
    createWgName.value = '';
  } finally { isWgProcessing.value = false; }
};

const handleJoinWG = async () => {
  if (!joinWgCode.value.trim()) return;
  isWgProcessing.value = true;
  try {
    const wgName = await joinWG(joinWgCode.value);
    await loadWgData();
    joinWgCode.value = '';
    $q.notify({ type: 'positive', message: `Beigetreten: ${wgName}` });
    setTimeout(() => { window.location.reload(); }, 1000);
  } catch (e: unknown) {
    $q.notify({ type: 'negative', message: e instanceof Error ? e.message : 'Fehler' });
  } finally { isWgProcessing.value = false; }
};

const handleLeaveWG = () => {
  $q.dialog({ title: 'WG verlassen', cancel: true, color: 'negative' })
    .onOk(() => {
      void (async () => {
        isWgProcessing.value = true;
        await leaveWG();
        window.location.reload();
      })();
    });
};

watch([shareMealPlan, shareShoppingList], () => {
  void updateUserWGPrefs({ shareMealPlan: shareMealPlan.value, shareShoppingList: shareShoppingList.value });
});

// ==========================================
// --- DATEN-MANAGEMENT & AUTH ---
// ==========================================
const handleExport = () => {
  $q.loading.show({ message: 'Backup wird erstellt...' });
  void (async () => {
    try { await exportRecipeData(); } finally { $q.loading.hide(); }
  })();
};

const confirmAccountDeletion = () => {
  $q.dialog({ title: '⚠️ Account löschen', message: 'Alle Daten werden gelöscht!', cancel: true, color: 'negative' })
    .onOk(() => {
      void (async () => {
        await deleteUserAccount();
        await signOut(auth);
        void router.push('/login');
      })();
    });
};

const handleLogout = async () => {
  await signOut(auth);
  void router.push('/login');
};

// ==========================================
// --- ZUTATEN-BILDER LOGIK ---
// ==========================================
const allIngredients = ref<IngredientFirebase[]>([]);
const ingredientEdits = ref<Record<string, { plural: string; categoryId: string }>>({});
const allRecipes = ref<RecipeFirebase[]>([]);
const ingredientsWithoutImage = ref<IngredientFirebase[]>([]);
const isUploadingMap = ref<Record<string, boolean>>({});
const showAddIngredientDialog = ref(false);
const newIngredientImageFile = ref<File | null>(null);

// Prüft, ob der eingeloggte Nutzer der Admin ist
const isSpecialAdmin = computed(() => auth.currentUser?.uid === 'D6IlIc3FXgbBtDTij1VZgvgliTG3');

// Funktion zum Löschen des Bildes
const removeImage = (ingredientId: string) => { // async hier nicht zwingend nötig
  $q.dialog({
    title: 'Bild entfernen',
    message: 'Möchtest du das Bild dieser Zutat wirklich löschen?',
    cancel: true,
    persistent: true
  }).onOk(() => {
    // Wir nutzen 'void', um ESLint zu beruhigen
    void (async () => {
      try {
        $q.loading.show({ message: 'Bild wird entfernt...' });

        // In Firebase das Bild-Feld auf einen leeren String setzen
        await updateIngredient(ingredientId, { image: '' });

        // Lokale Daten neu laden
        await loadGlobalData();

        $q.notify({ type: 'positive', message: 'Bild erfolgreich entfernt.' });
      } catch (error) {
        console.error("Fehler beim Löschen des Bildes:", error);
        $q.notify({ type: 'negative', message: 'Bild konnte nicht gelöscht werden.' });
      } finally {
        $q.loading.hide();
      }
    })();
  });
};

const newIngredient = ref({
  name: '',
  plural: '',
  categoryId: '',
  image: '',
  isSystem: true // Standardmäßig true für den Admin
});

const openAddIngredientDialog = () => {
  newIngredient.value = { name: '', plural: '', categoryId: '', image: '', isSystem: true };
  newIngredientImageFile.value = null;
  showAddIngredientDialog.value = true;
};

const loadGlobalData = async () => {
  const [ings, recs] = await Promise.all([getIngredients(), getRecipes()]);
  allIngredients.value = ings;
  allRecipes.value = recs;
  ingredientsWithoutImage.value = ings.filter(i => !i.image || i.image.trim() === '');
};

const handleSaveNewIngredient = async () => {
  if (!newIngredient.value.name || !newIngredient.value.categoryId) {
    $q.notify({ type: 'warning', message: 'Name und Kategorie sind Pflichtfelder!' });
    return;
  }

  const uid = auth.currentUser?.uid;
  const isAdmin = isSpecialAdmin.value;

  // Wenn der Nutzer der Admin ist und der Toggle aktiv ist -> System-Zutat
  const isSystemIngredient = isAdmin && newIngredient.value.isSystem;

  try {
    $q.loading.show({ message: 'Zutat wird angelegt...' });

    // 1. Zutatendaten vorbereiten
    // 'unknown' Fix für TypeScript, analog zu deiner verifyIngredient Logik
    const ingData = {
      name: newIngredient.value.name,
      plural: newIngredient.value.plural,
      categoryId: newIngredient.value.categoryId,
      isVerified: isSystemIngredient, // System-Zutaten sind sofort verifiziert
      createdBy: isSystemIngredient ? 'system' : uid,
      image: newIngredient.value.image // Falls aus Galerie gewählt
    } as unknown as IngredientFirebase;

    // 2. In Firebase speichern
    const newId = await addIngredient(ingData);

    // 3. Falls ein GANZ NEUES Bild per File-Upload gewählt wurde
    if (newIngredientImageFile.value && !newIngredient.value.image) {
      const formData = new FormData();
      formData.append('file', newIngredientImageFile.value);
      formData.append('upload_preset', 'ml_default');

      // NEU: Ordnernamen bereinigen
      const category = allCategories.value.find(c => c.id === newIngredient.value.categoryId);
      const rawFolderName = category ? category.name : 'Unsortiert';
      const folderName = rawFolderName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_').replace(/_+/g, '_');

      const subFolder = isSystemIngredient ? 'System' : 'User';
      formData.append('folder', `Zutaten/${folderName}/${subFolder}`);

      const cleanName = newIngredient.value.name.trim().replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_').replace(/_+/g, '_');
      formData.append('public_id', cleanName);

      const resp = await fetch(`https://api.cloudinary.com/v1_1/ddwxwy7j0/image/upload`, {
        method: 'POST', body: formData
      });

      // NEU: Upload-Status prüfen
      if (!resp.ok) {
        const errorData = await resp.json();
        console.error("Cloudinary Error:", errorData);
        throw new Error("Bild-Upload auf den Server fehlgeschlagen.");
      }

      const data = await resp.json();

      // Zutat mit der echten Cloudinary URL aktualisieren
      if (data.secure_url) {
        await updateIngredient(newId, { image: data.secure_url });
      }
    }

    $q.notify({ type: 'positive', message: 'Zutat erfolgreich erstellt!' });
    showAddIngredientDialog.value = false;
    await loadGlobalData();

  } catch (e) {
    console.error("Fehler beim Erstellen der Zutat:", e);
    $q.notify({ type: 'negative', message: 'Fehler beim Erstellen der Zutat.' });
  } finally {
    $q.loading.hide();
  }
};

const uploadImage = async (file: File | null, ingredientId: string) => {
  if (!file) return;
  isUploadingMap.value[ingredientId] = true;

  try {
    // 1. Kategorie-Namen und Herkunft ermitteln
    const ingredient = allIngredients.value.find(i => i.id === ingredientId);
    const category = allCategories.value.find(c => c.id === ingredient?.categoryId);

    // NEU: Ordnernamen bereinigen (entfernt & und Leerzeichen)
    const rawFolderName = category ? category.name : 'Unsortiert';
    const folderName = rawFolderName.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_').replace(/_+/g, '_');

    const isSystemIngredient = ingredient?.createdBy === 'system';
    const subFolder = isSystemIngredient ? 'System' : 'User';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', 'ml_default');
    formData.append('folder', `Zutaten/${folderName}/${subFolder}`);

    // Dateinamen anhand des Zutatennamens setzen
    if (ingredient?.name) {
      const cleanName = ingredient.name.trim().replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_').replace(/_+/g, '_');
      formData.append('public_id', cleanName);
    }

    const resp = await fetch(`https://api.cloudinary.com/v1_1/ddwxwy7j0/image/upload`, {
      method: 'POST',
      body: formData
    });

    // NEU: Prüfen ob Cloudinary den Upload akzeptiert hat!
    if (!resp.ok) {
      const errorData = await resp.json();
      throw new Error(`Cloudinary Fehler: ${errorData.error?.message || 'Unbekannt'}`);
    }

    const data = await resp.json();

    // 3. In Firebase speichern (nur wenn wir eine gültige URL haben)
    if (data.secure_url) {
      await updateIngredient(ingredientId, { image: data.secure_url });
      await loadGlobalData();
      $q.notify({ type: 'positive', message: 'Bild erfolgreich hochgeladen!' });
    }

  } catch (error: any) {
    console.error("Upload fehlgeschlagen:", error);
    $q.notify({ type: 'negative', message: error.message || 'Upload fehlgeschlagen.' });
  } finally {
    isUploadingMap.value[ingredientId] = false;
  }
};

const showImagePicker = ref(false);
const imagePickerTargetId = ref<string | null>(null);
const uniqueExistingImages = computed(() => {
  const imgs = new Set<string>();
  allIngredients.value.forEach(i => { if (i.image) imgs.add(i.image); });
  return Array.from(imgs);
});

// --- ANPASSUNG FÜR BILDER-GALERIE ---
const openImagePicker = (id: string) => {
  imagePickerTargetId.value = id;
  showImagePicker.value = true;
};

const selectExistingImage = async (url: string) => {
  if (imagePickerTargetId.value === 'NEW') {
    // Bild wird für die neue (noch nicht gespeicherte) Zutat ausgewählt
    newIngredient.value.image = url;
    newIngredientImageFile.value = null; // Setzt evtl. hochgeladene Datei zurück
    showImagePicker.value = false;
  } else if (imagePickerTargetId.value) {
    // Normales Speichern für existierende Zutaten
    await updateIngredient(imagePickerTargetId.value, { image: url });
    showImagePicker.value = false;
    await loadGlobalData();
  }
};

// --- ZUTATEN LÖSCHEN ---
const showDeleteDialog = ref(false);
const isDeleting = ref(false);
const ingredientToDelete = ref<IngredientFirebase | null>(null);
const recipesUsingIngredient = ref<RecipeFirebase[]>([]);
const swapIngredientId = ref<string | null>(null);

const allIngredientsOptions = computed(() =>
  allIngredients.value.filter(i => i.id !== ingredientToDelete.value?.id)
    .map(i => ({ label: i.name, value: i.id }))
);

const getIngredientIdHelper = (ing: { ingredientID?: string; ingredientId?: string }): string =>
  ing.ingredientID || ing.ingredientId || '';

const initiateDelete = (ing: IngredientFirebase) => {
  ingredientToDelete.value = ing;
  recipesUsingIngredient.value = allRecipes.value.filter(r =>
    r.ingredients?.some(i => getIngredientIdHelper(i) === ing.id)
  );
  showDeleteDialog.value = true;
};

const executeDeleteAndSwap = async () => {
  if (!ingredientToDelete.value) return;
  isDeleting.value = true;
  const oldId = ingredientToDelete.value.id;

  try {
    for (const recipe of recipesUsingIngredient.value) {
      if (recipe.id) {
        const updated = JSON.parse(JSON.stringify(recipe)) as RecipeFirebase;
        updated.ingredients?.forEach((i: { ingredientID?: string; ingredientId?: string }) => {
          if (getIngredientIdHelper(i) === oldId) {
            i.ingredientID = swapIngredientId.value!;
          }
        });
        await updateRecipe(recipe.id, updated);
      }
    }
    await deleteDoc(doc(db, 'ingredients', oldId));
    showDeleteDialog.value = false;
    await loadGlobalData();
  } catch (error: unknown) {
    console.error("Delete error:", error);
  } finally {
    isDeleting.value = false;
  }
};

// ==========================================
// --- SUPERMÄRKTE ---
// ==========================================
const supermarkets = ref<WithId<Markets>[]>([]);
const allCategories = ref<{ id: string, name: string }[]>([]);
const showMarketDialog = ref(false);
const isEditMode = ref(false);
const editingMarket = ref<Markets>({ name: '', categoryOrder: [] });
const editingId = ref<string | null>(null);

const loadSupermarketsAndCategories = async () => {
  const catSnap = await getDocs(collection(db, 'categories'));
  allCategories.value = catSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
  supermarkets.value = await getMarkets();
};

const availableCategoriesForEdit = computed(() =>
  allCategories.value.filter(c => !editingMarket.value.categoryOrder.includes(c.id))
);

const selectedCategoriesObjects = computed(() =>
  editingMarket.value.categoryOrder
    .map(id => allCategories.value.find(c => c.id === id))
    .filter((c): c is { id: string, name: string } => !!c)
);

const openAddMarket = () => {
  isEditMode.value = false; editingMarket.value = { name: '', categoryOrder: [] }; showMarketDialog.value = true;
};
const openEditMarket = (m: WithId<Markets>) => {
  isEditMode.value = true; editingId.value = m.id; editingMarket.value = { ...m }; showMarketDialog.value = true;
};
const saveMarket = async () => {
  if (isEditMode.value && editingId.value) await updateMarket(editingId.value, editingMarket.value);
  else await addMarket(editingMarket.value);
  await loadSupermarketsAndCategories(); showMarketDialog.value = false;
};
const confirmDeleteMarket = (m: WithId<Markets>) => {
  $q.dialog({ title: 'Markt löschen?', cancel: true }).onOk(() => {
    void (async () => { await deleteMarket(m.id); await loadSupermarketsAndCategories(); })();
  });
};

// Filter für nicht verifizierte Zutaten (Ohne 'any'!)
const unverifiedIngredients = computed<IngredientFirebase[]>(() => {
  return (allIngredients.value as IngredientFirebase[]).filter(i =>
    i.isVerified === false || (!i.image && i.createdBy === auth.currentUser?.uid)
  );
});

const ingredientFilterCategory = ref<string | null>(null);
const ingredientFilterSource = ref<'all' | 'user' | 'system'>('all');
const ingredientSearchQuery = ref('');
const ingredientImageFilter = ref<'maintenance' | 'all' | 'withImage' | 'withoutImage'>('maintenance');

// Zählt die Zutaten für das Badge im Tab anhand der Berechtigungen
const pendingIngredientsCount = computed(() => {
  const uid = auth.currentUser?.uid;

  return allIngredients.value.filter(i => {
    // 1. Braucht die Zutat überhaupt Wartung?
    const needsMaintenance = i.isVerified === false || !i.image || i.image.trim() === '';
    if (!needsMaintenance) return false;

    // 2. Berechtigungs-Check
    if (isSpecialAdmin.value) {
      // Der Admin sieht seine eigenen UND die System-Zutaten
      return i.createdBy === 'system' || i.createdBy === uid;
    } else {
      // Normale User sehen NUR ihre selbst erstellten Zutaten
      return i.createdBy === uid;
    }
  }).length;
});

const maintenanceIngredients = computed<IngredientFirebase[]>(() => {
  let filtered = allIngredients.value as IngredientFirebase[];

  // 1. Textsuche (Nur Admin - überschreibt alles)
  const query = ingredientSearchQuery.value?.toLowerCase().trim();
  if (isSpecialAdmin.value && query) {
    filtered = filtered.filter(i =>
      i.name.toLowerCase().includes(query) ||
      (i.plural && i.plural.toLowerCase().includes(query))
    );
  } else {
    // 2. Filter nach Status / Bild
    if (ingredientImageFilter.value === 'maintenance') {
      // Zeigt nur Zutaten, die noch unbestätigt sind oder kein Bild haben
      filtered = filtered.filter(i => i.isVerified === false || !i.image || i.image.trim() === '');
    } else if (ingredientImageFilter.value === 'withImage') {
      // Zeigt ALLE Zutaten mit Bild (ignoriert isVerified)
      filtered = filtered.filter(i => i.image && i.image.trim() !== '');
    } else if (ingredientImageFilter.value === 'withoutImage') {
      // Zeigt ALLE Zutaten ohne Bild
      filtered = filtered.filter(i => !i.image || i.image.trim() === '');
    }
    // Wenn 'all' gewählt ist, wird hier gar nicht gefiltert -> alle Zutaten werden angezeigt
  }

  // 3. Filter nach Kategorie
  if (ingredientFilterCategory.value) {
    filtered = filtered.filter(i => i.categoryId === ingredientFilterCategory.value);
  }

  // 4. Filter nach Quelle (Admin / User)
  if (isSpecialAdmin.value) {
    if (ingredientFilterSource.value === 'user') {
      filtered = filtered.filter(i => i.createdBy !== 'system');
    } else if (ingredientFilterSource.value === 'system') {
      filtered = filtered.filter(i => i.createdBy === 'system');
    }
  } else {
    // Normale User sehen in der Wartung nur ihre eigenen
    filtered = filtered.filter(i => i.createdBy !== 'system');
  }

  return filtered;
});

// Initialisiere die Edit-Werte, wenn die Liste geladen wird
watch(maintenanceIngredients, (newIngs) => {
  newIngs.forEach(ing => {
    if (!ingredientEdits.value[ing.id]) {
      ingredientEdits.value[ing.id] = {
        plural: ing.plural || '',
        categoryId: ing.categoryId || ''
      };
    }
  });
}, { immediate: true });

// Funktion zum Verifizieren & Speichern der Korrekturen (Ohne 'any'!)
const verifyIngredient = async (id: string) => {
  const edits = ingredientEdits.value[id];

  // Wir nutzen 'unknown' als Zwischenschritt, was ESLint im Gegensatz zu 'any' erlaubt
  const updatePayload = {
    isVerified: true,
    plural: edits?.plural || '',
    categoryId: edits?.categoryId || ''
  } as unknown as Partial<IngredientFirebase>;

  await updateIngredient(id, updatePayload);

  await loadGlobalData();
  $q.notify({ type: 'positive', message: 'Zutat mit Details bestätigt!', icon: 'verified' });
};

const addCategoryToMarket = (id: string) => editingMarket.value.categoryOrder.push(id);
const removeCategoryFromMarket = (id: string) => editingMarket.value.categoryOrder = editingMarket.value.categoryOrder.filter(x => x !== id);

const moveCategory = (idx: number, dir: number) => {
  const arr = [...editingMarket.value.categoryOrder];
  const target = idx + dir;

  if (target >= 0 && target < arr.length && idx >= 0 && idx < arr.length) {
    const itemA = arr[idx];
    const itemB = arr[target];

    if (itemA !== undefined && itemB !== undefined) {
      arr[idx] = itemB;
      arr[target] = itemA;
      editingMarket.value.categoryOrder = arr;
    }
  }
};

// --- INITIALISIERUNG ---
onMounted(async () => {
  void loadGlobalData();
  void loadSupermarketsAndCategories();
  await loadWgData();
});
</script>

<template>
  <q-page class="bg-dynamic-page dynamic-text q-pa-md q-pa-lg-xl transition-ease">
    <div class="max-width-container">

      <div class="row items-center q-mb-xl dynamic-card dynamic-border q-pa-lg rounded-xl shadow-2">
        <q-avatar size="90px" color="primary" text-color="white" class="shadow-10 profile-avatar">
          {{ (displayName || 'D').charAt(0).toUpperCase() }}
        </q-avatar>
        <div class="q-ml-lg">
          <div class="text-h4 text-weight-bold dynamic-text tracking-tight">{{ displayName || 'Dein Profil' }}</div>
          <div class="dynamic-text-muted text-subtitle1">{{ auth.currentUser?.email }}</div>
        </div>
        <q-space />
        <q-btn flat round icon="logout" color="grey-6" @click="handleLogout" class="hover-negative-btn">
          <q-tooltip class="bg-negative">Abmelden</q-tooltip>
        </q-btn>
      </div>

      <div class="tabs-container q-mb-xl">
        <q-tabs v-model="tab" class="settings-tabs shadow-2 dynamic-card dynamic-border rounded-xl"
          active-color="primary" indicator-color="primary" expand no-caps narrow-indicator inline-label outside-arrows
          mobile-arrows>
          <q-tab name="general" label="Präferenzen" icon="tune" />
          <q-tab name="account" label="Sicherheit" icon="lock" />
          <q-tab name="wg" label="Meine WG" icon="groups" />
          <q-tab name="supermarkets" label="Märkte" icon="storefront" />
          <q-tab name="ingredients" label="Zutaten" icon="storage">
            <q-badge v-if="pendingIngredientsCount > 0" color="negative" floating rounded>
              {{ pendingIngredientsCount }}
            </q-badge>
          </q-tab>
        </q-tabs>
      </div>

      <q-tab-panels v-model="tab" animated class="bg-transparent overflow-visible full-width">

        <q-tab-panel name="general" class="q-pa-none">
          <div class="row q-col-gutter-lg">
            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md row items-center text-primary">
                  <q-icon name="person_outline" class="q-mr-sm" size="sm" /> Profil & Identität
                </div>
                <q-input v-model="displayName" label="Anzeigename" filled :dark="isDarkMode" color="primary"
                  @blur="updateProfileName" class="custom-dynamic-input full-width" />
                <p class="text-caption dynamic-text-muted q-mt-sm">Wird in der WG für den Wochenplan genutzt.</p>
              </q-card>
            </div>

            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md row items-center text-primary">
                  <q-icon name="palette" class="q-mr-sm" size="sm" /> App-Design & Farben
                </div>
                <q-item tag="label" dense class="q-px-none q-mb-md">
                  <q-item-section class="dynamic-text">Dunkles Design</q-item-section>
                  <q-item-section side><q-toggle v-model="isDarkMode" color="primary" /></q-item-section>
                </q-item>
                <div class="text-caption dynamic-text-muted q-mb-sm">Akzentfarbe wählen:</div>
                <div class="row q-gutter-md items-center">
                  <q-btn v-for="color in presetColors" :key="color" round size="14px"
                    :style="{ backgroundColor: color }" @click="primaryColor = color" class="color-picker-btn shadow-2">
                    <q-icon v-if="primaryColor.toLowerCase() === color.toLowerCase()" name="check" size="xs"
                      color="white" />
                  </q-btn>
                  <q-btn round size="14px" class="color-picker-btn shadow-2 relative-position"
                    style="background: conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);">
                    <q-icon v-if="isCustomColor" name="check" size="xs" color="white"
                      style="z-index: 1; text-shadow: 0 0 3px rgba(0,0,0,0.8);" />
                    <q-popup-proxy transition-show="scale" transition-hide="scale">
                      <q-card class="dynamic-card q-pa-sm border-dark">
                        <q-color v-model="primaryColor" no-header no-footer format-model="hex" class="bg-transparent" />
                      </q-card>
                    </q-popup-proxy>
                  </q-btn>
                </div>
              </q-card>
            </div>

            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md row items-center text-primary">
                  <q-icon name="restaurant" class="q-mr-sm" size="sm" /> Kochen & Rezepte
                </div>
                <q-input v-model.number="defaultPortions" type="number" label="Standard-Portionen" filled
                  :dark="isDarkMode" color="primary" class="custom-dynamic-input q-mb-md" min="1"
                  hint="Vorauswahl für neue Rezepte" />
                <q-select v-model="timerSound" label="Timer-Ton" filled :dark="isDarkMode" color="primary"
                  :options="[{ label: 'Klassisch (Glocke)', value: 'classic' }, { label: 'Digital', value: 'digital' }, { label: 'Sanft', value: 'soft' }]"
                  emit-value map-options class="custom-dynamic-input q-mb-md" />
                <q-item tag="label" class="bg-dynamic-soft rounded-borders q-pa-sm transition-ease dynamic-border">
                  <q-item-section>
                    <q-item-label class="text-weight-bold dynamic-text">Display immer an</q-item-label>
                  </q-item-section>
                  <q-item-section side><q-toggle v-model="keepScreenOn" color="primary" /></q-item-section>
                </q-item>
              </q-card>
            </div>

            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md row items-center text-primary">
                  <q-icon name="calendar_month" class="q-mr-sm" size="sm" /> Wochenplan & Einkaufen
                </div>
                <q-select v-model="weekStart" label="Wochenstart" filled :dark="isDarkMode" color="primary"
                  :options="[{ label: 'Montag', value: 1 }, { label: 'Sonntag', value: 0 }]" emit-value map-options
                  class="custom-dynamic-input q-mb-lg" />
                <q-item tag="label" class="q-px-none q-mb-sm">
                  <q-item-section>
                    <q-item-label class="dynamic-text text-weight-bold">Vergangene Tage ausblenden</q-item-label>
                  </q-item-section>
                  <q-item-section side><q-toggle v-model="hidePastDays" color="primary" /></q-item-section>
                </q-item>
                <q-separator :dark="isDarkMode" inset class="opacity-20 q-my-sm" />
                <q-item tag="label" class="q-px-none">
                  <q-item-section>
                    <q-item-label class="dynamic-text text-weight-bold">Liste automatisch aufräumen</q-item-label>
                  </q-item-section>
                  <q-item-section side><q-toggle v-model="autoCleanupList" color="primary" /></q-item-section>
                </q-item>
              </q-card>
            </div>

            <div class="col-12">
              <q-expansion-item label="Daten-Management & Sicherheit" icon="security"
                header-class="text-weight-bold dynamic-text-muted rounded-borders dynamic-border"
                class="dynamic-card rounded-borders overflow-hidden shadow-1">
                <div class="q-pa-lg q-gutter-y-md bg-dynamic-soft">
                  <div class="row q-col-gutter-md">
                    <div class="col-12 col-sm-6">
                      <q-btn color="primary" icon="cloud_download" label="Backup exportieren (.json)"
                        class="full-width q-py-sm rounded-borders" @click="handleExport" no-caps unelevated />
                    </div>
                    <div class="col-12 col-sm-6">
                      <q-btn outline color="negative" icon="delete_forever" label="Account & Daten löschen"
                        class="full-width q-py-sm rounded-borders" @click="confirmAccountDeletion" no-caps />
                    </div>
                  </div>
                </div>
              </q-expansion-item>
            </div>
          </div>
        </q-tab-panel>

        <q-tab-panel name="account" class="q-pa-none">
          <div class="row q-col-gutter-lg">
            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md text-primary">E-Mail Adresse</div>
                <q-input v-model="newEmail" label="E-Mail ändern" filled :dark="isDarkMode" color="primary"
                  class="q-mb-lg custom-dynamic-input" hint="Änderung erfordert einen frischen Login" />
                <q-btn label="Speichern" color="primary" @click="handleUpdateEmail" no-caps
                  class="full-width rounded-borders shadow-2" unelevated />
              </q-card>
            </div>
            <div class="col-12 col-md-6">
              <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-lg full-height card-hover">
                <div class="text-subtitle1 text-weight-bold q-mb-md text-primary">Passwort ändern</div>
                <q-input v-model="newPassword" type="password" label="Neues Passwort" filled :dark="isDarkMode"
                  color="primary" class="q-mb-sm custom-dynamic-input" />
                <q-input v-model="confirmPassword" type="password" label="Passwort bestätigen" filled :dark="isDarkMode"
                  color="primary" class="q-mb-lg custom-dynamic-input" />
                <q-btn label="Passwort speichern" color="primary" @click="handleUpdatePassword" no-caps
                  class="full-width rounded-borders shadow-2" unelevated />
              </q-card>
            </div>
          </div>
        </q-tab-panel>

        <q-tab-panel name="wg" class="q-pa-none">
          <div v-if="wgInfo" class="column items-center">
            <q-card flat class="dynamic-card dynamic-border rounded-xl q-pa-xl text-center full-width shadow-10">
              <div class="text-h6 dynamic-text-muted q-mb-xs">WG-Gruppe</div>
              <div class="text-h3 text-weight-bolder dynamic-text q-mb-md">{{ wgInfo.name }}</div>

              <div class="wg-code-container q-mt-lg">
                <div class="text-caption text-primary text-uppercase text-weight-bold q-mb-xs">Einladungs-Code</div>
                <div class="wg-code-box cursor-pointer row no-wrap items-center justify-center q-pa-md"
                  @click="copyCode(wgInfo.code)">
                  <span class="text-h3 text-primary text-weight-bolder letter-spacing-2">{{ wgInfo.code }}</span>
                  <q-icon name="content_copy" size="sm" color="primary" class="q-ml-md" />
                </div>
              </div>

              <q-separator :dark="isDarkMode" class="q-my-xl opacity-20" />

              <div class="text-left max-width-600 center-block">
                <div class="text-subtitle2 dynamic-text-muted q-mb-md row items-center">
                  <q-icon name="group" class="q-mr-sm" /> Mitglieder ({{ wgMembers.length }})
                </div>
                <q-list class="q-gutter-y-sm">
                  <q-item v-for="member in wgMembers" :key="member.id"
                    class="bg-dynamic-soft rounded-borders dynamic-border q-pa-md">
                    <q-item-section avatar>
                      <q-avatar color="primary" text-color="white" size="44px" class="text-weight-bold shadow-1">
                        {{ member.name.charAt(0).toUpperCase() }}
                      </q-avatar>
                    </q-item-section>
                    <q-item-section>
                      <q-item-label class="text-weight-bold dynamic-text">{{ member.name }}</q-item-label>
                      <q-item-label caption class="dynamic-text-muted">{{ member.email }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </q-list>
              </div>

              <q-btn outline color="negative" label="Gruppe verlassen" @click="handleLeaveWG"
                class="q-mt-xl q-px-xl rounded-borders" no-caps />
            </q-card>
          </div>

          <div v-else class="row q-col-gutter-xl">
            <div class="col-12 col-md-6">
              <q-card flat
                class="dynamic-card dynamic-border rounded-xl q-pa-xl text-center full-height flex flex-center">
                <div class="full-width">
                  <q-icon name="group_add" size="4rem" color="primary" class="q-mb-md opacity-40" />
                  <div class="text-h5 text-weight-bold q-mb-md dynamic-text">Neue WG gründen</div>
                  <q-input v-model="createWgName" label="Name der Gruppe" filled :dark="isDarkMode" color="primary"
                    class="custom-dynamic-input q-mb-lg" />
                  <q-btn @click="handleCreateWG" label="WG erstellen"
                    class="full-width q-py-md text-weight-bold shadow-2" color="primary" unelevated no-caps />
                </div>
              </q-card>
            </div>
            <div class="col-12 col-md-6">
              <q-card flat
                class="dynamic-card dynamic-border rounded-xl q-pa-xl text-center full-height flex flex-center">
                <div class="full-width">
                  <q-icon name="input" size="4rem" color="primary" class="q-mb-md opacity-40" />
                  <div class="text-h5 text-weight-bold q-mb-md dynamic-text">WG beitreten</div>
                  <q-input v-model="joinWgCode" label="6-stelliger Code" filled :dark="isDarkMode" color="primary"
                    class="custom-dynamic-input q-mb-lg" input-class="text-center text-h5 letter-spacing-1" />
                  <q-btn @click="handleJoinWG" label="Code absenden" class="full-width q-py-md text-weight-bold" outline
                    color="primary" no-caps />
                </div>
              </q-card>
            </div>
          </div>
        </q-tab-panel>

        <q-tab-panel name="supermarkets" class="q-pa-none">
          <div class="row items-center justify-between q-mb-lg">
            <h2 class="text-h5 text-weight-bold q-my-none dynamic-text">Märkte</h2>
            <q-btn color="primary" icon="add" label="Neu" @click="openAddMarket" no-caps unelevated
              class="rounded-borders shadow-2" />
          </div>
          <q-card flat class="dynamic-card dynamic-border rounded-xl overflow-hidden shadow-2">
            <q-list separator>
              <q-item v-for="m in supermarkets" :key="m.id" class="q-py-lg q-px-lg list-item-hover">
                <q-item-section avatar><q-icon name="storefront" color="primary" size="md" /></q-item-section>
                <q-item-section>
                  <q-item-label class="text-h6 text-weight-bold dynamic-text">{{ m.name }}</q-item-label>
                  <q-item-label caption class="dynamic-text-muted">{{ m.categoryOrder?.length || 0 }}
                    Kategorien</q-item-label>
                </q-item-section>
                <q-item-section side>
                  <div class="row q-gutter-md">
                    <q-btn flat round icon="edit" color="grey-5" @click="openEditMarket(m)" class="bg-dynamic-soft" />
                    <q-btn flat round icon="delete_outline" color="red-4" @click="confirmDeleteMarket(m)"
                      class="bg-dynamic-soft" />
                  </div>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </q-tab-panel>

        <q-tab-panel name="ingredients" class="q-pa-none">
          <div class="row items-center justify-between q-mb-md">
            <div class="row items-center q-gutter-sm">
              <h2 class="text-h5 text-weight-bold q-my-none dynamic-text">Zutaten-Wartung</h2>

              <q-chip v-if="isSpecialAdmin" color="amber-8" text-color="white" icon="warning" size="sm"
                class="text-weight-bold shadow-1">
                {{ unverifiedIngredients.length }} eigene
              </q-chip>
              <q-chip color="grey-7" text-color="white" icon="hide_image" size="sm" class="text-weight-bold shadow-1">
                {{ ingredientsWithoutImage.length }} ohne Bild
              </q-chip>
            </div>

            <div class="row q-gutter-sm items-center">
              <q-btn v-if="isSpecialAdmin" outline color="secondary" icon="upload_file" label="Seed" unelevated no-caps
                size="sm" class="relative-position rounded-borders">
                <input type="file" accept=".json" @change="seedDatabaseWithJson"
                  style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;" />
              </q-btn>
              <q-btn color="primary" icon="add" label="Neue Zutat" @click="openAddIngredientDialog" unelevated no-caps
                class="rounded-borders shadow-2" />
            </div>
          </div>

          <q-card flat class="dynamic-card dynamic-border rounded-xl q-mb-xl bg-dynamic-soft shadow-1">
            <q-card-section class="q-pa-md q-gutter-y-md">

              <div v-if="isSpecialAdmin" class="row">
                <q-input v-model="ingredientSearchQuery" filled :dark="isDarkMode" color="primary"
                  class="custom-dynamic-input full-width" placeholder="Zutaten durchsuchen (hebt alle Filter auf)..."
                  clearable dense>
                  <template v-slot:prepend><q-icon name="search" /></template>
                </q-input>
              </div>

              <div class="row q-col-gutter-md items-end">

                <div class="col-12 col-md-5">
                  <div class="text-caption text-weight-bold dynamic-text-muted q-mb-xs text-uppercase tracking-widest"
                    style="font-size: 10px; opacity: 0.7;">Ansicht</div>
                  <q-btn-toggle v-model="ingredientImageFilter" spread no-caps unelevated toggle-color="primary"
                    color="transparent" text-color="grey-7" :dark="isDarkMode"
                    class="dynamic-border rounded-borders full-width" size="13px" :options="[
                      { label: 'Wartung', value: 'maintenance', icon: 'build' },
                      { label: 'Alle', value: 'all', icon: 'list' },
                      { label: 'Mit Bild', value: 'withImage', icon: 'image' },
                      { label: 'Ohne Bild', value: 'withoutImage', icon: 'hide_image' }
                    ]" />
                </div>

                <div class="col-12 col-sm-6 col-md-3">
                  <q-select v-model="ingredientFilterCategory" :options="allCategories" option-value="id"
                    option-label="name" label="Kategorie filtern" filled clearable emit-value map-options
                    :dark="isDarkMode" color="primary" class="custom-dynamic-input" dense hide-bottom-space>
                    <template v-slot:prepend><q-icon name="filter_list" size="xs" /></template>
                  </q-select>
                </div>

                <div v-if="isSpecialAdmin" class="col-12 col-sm-6 col-md-4">
                  <div class="text-caption text-weight-bold dynamic-text-muted q-mb-xs text-uppercase tracking-widest"
                    style="font-size: 10px; opacity: 0.7;">Datenquelle</div>
                  <q-btn-toggle v-model="ingredientFilterSource" spread no-caps unelevated toggle-color="primary"
                    color="transparent" text-color="grey-7" :dark="isDarkMode"
                    class="dynamic-border rounded-borders full-width" size="13px" :options="[
                      { label: 'Alle', value: 'all' },
                      { label: 'Nur User', value: 'user' },
                      { label: 'Nur System', value: 'system' }
                    ]" />
                </div>

              </div>
            </q-card-section>
          </q-card>

          <q-card flat class="dynamic-card dynamic-border rounded-xl shadow-2">
            <q-list separator>
              <q-item v-for="ing in maintenanceIngredients" :key="ing.id"
                class="q-py-lg q-px-lg list-item-hover column items-stretch">

                <div class="row items-center full-width q-mb-md">
                  <q-item-section avatar>
                    <q-avatar size="60px" class="bg-dynamic-soft dynamic-border">
                      <img v-if="ing.image" :src="ing.image" />
                      <q-icon v-else name="help_outline" color="amber-8" />
                    </q-avatar>
                  </q-item-section>

                  <q-item-section>
                    <q-item-label class="text-h6 text-weight-bold dynamic-text">{{ ing.name }}</q-item-label>
                    <q-item-label caption class="dynamic-text-muted">ID: {{ ing.id }}</q-item-label>
                  </q-item-section>

                  <q-item-section side>
                    <div class="row q-gutter-sm">
                      <q-btn-group flat class="bg-dynamic-soft rounded-borders">
                        <q-btn flat icon="cloud_upload" color="primary">
                          <q-tooltip>Neues Bild hochladen</q-tooltip>
                          <q-file style="position:absolute; inset:0; opacity:0; cursor:pointer" :model-value="null"
                            accept="image/*" @update:model-value="(f) => uploadImage(f as File | null, ing.id)" />
                        </q-btn>
                        <q-btn flat icon="photo_library" color="primary" @click="openImagePicker(ing.id)">
                          <q-tooltip>Aus Galerie wählen</q-tooltip>
                        </q-btn>
                      </q-btn-group>

                      <q-btn v-if="ing.image" flat round icon="no_photography" color="orange-8"
                        @click="removeImage(ing.id)" class="bg-dynamic-soft">
                        <q-tooltip>Bild entfernen</q-tooltip>
                      </q-btn>

                      <q-btn flat round icon="delete_outline" color="negative" @click="initiateDelete(ing)"
                        class="bg-dynamic-soft" />
                    </div>
                  </q-item-section>
                </div>

                <div v-if="ingredientEdits[ing.id]"
                  class="row q-col-gutter-md items-end bg-dynamic-soft q-pa-md rounded-borders dynamic-border">

                  <div class="col-12 col-sm-4">
                    <q-input v-model="ingredientEdits[ing.id]!.plural" label="Plural Form" dense filled
                      :dark="isDarkMode" />
                  </div>

                  <div class="col-12 col-sm-4">
                    <q-select v-model="ingredientEdits[ing.id]!.categoryId" :options="allCategories" option-value="id"
                      option-label="name" emit-value map-options label="Kategorie" dense filled :dark="isDarkMode" />
                  </div>

                  <div class="col-12 col-sm-4">
                    <q-btn v-if="ing.isVerified === false" color="positive" icon="verified"
                      label="Bestätigen & Speichern" @click="verifyIngredient(ing.id)" class="full-width" unelevated
                      no-caps />
                    <q-btn v-else color="primary" icon="save" label="Details Speichern"
                      @click="verifyIngredient(ing.id)" class="full-width" unelevated no-caps />
                  </div>

                </div>

              </q-item>
            </q-list>
          </q-card>
        </q-tab-panel>

      </q-tab-panels>
    </div>

    <q-dialog v-model="showImagePicker" backdrop-filter="blur(5px)">
      <q-card class="dynamic-card dynamic-text dialog-card-large rounded-xl">
        <q-card-section class="row items-center q-pb-none">
          <div class="text-h6 text-weight-bold text-primary">Bild wählen</div>
          <q-space /><q-btn icon="close" flat round v-close-popup color="grey-5" />
        </q-card-section>
        <q-card-section class="q-pa-lg">
          <div class="image-grid">
            <q-img v-for="img in uniqueExistingImages" :key="img" :src="img"
              class="cursor-pointer rounded-xl gallery-img transition-ease shadow-4" @click="selectExistingImage(img)"
              :ratio="1" />
          </div>
        </q-card-section>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showAddIngredientDialog" persistent backdrop-filter="blur(5px)">
      <q-card class="dynamic-card dynamic-text rounded-xl" style="width: 500px; max-width: 95vw;">
        <q-card-section class="row items-center bg-dynamic-soft">
          <div class="text-h6 text-weight-bold text-primary">Neue Zutat erstellen</div>
          <q-space />
          <q-btn icon="close" flat round v-close-popup color="grey-5" />
        </q-card-section>

        <q-card-section class="q-pa-lg q-gutter-y-md">
          <q-input v-model="newIngredient.name" label="Name *" filled :dark="isDarkMode" color="primary"
            class="custom-dynamic-input" />
          <q-input v-model="newIngredient.plural" label="Plural Form" filled :dark="isDarkMode" color="primary"
            class="custom-dynamic-input" />

          <q-select v-model="newIngredient.categoryId" :options="allCategories" option-value="id" option-label="name"
            emit-value map-options label="Kategorie *" filled :dark="isDarkMode" color="primary"
            class="custom-dynamic-input" />

          <div class="text-subtitle2 text-weight-bold q-mt-lg q-mb-sm">Zutaten-Bild</div>
          <div class="row q-gutter-md items-center bg-dynamic-soft q-pa-md rounded-borders dynamic-border">
            <q-avatar size="60px" class="bg-white dynamic-border shadow-1">
              <img v-if="newIngredient.image" :src="newIngredient.image" />
              <q-icon v-else-if="newIngredientImageFile" name="check_circle" color="positive" size="lg" />
              <q-icon v-else name="image" color="grey-4" size="lg" />
            </q-avatar>

            <div class="column q-gutter-y-sm">
              <q-btn outline icon="cloud_upload" color="primary" label="Upload von Gerät"
                class="relative-position rounded-borders bg-white" no-caps size="sm">
                <q-file style="position:absolute; inset:0; opacity:0; cursor:pointer"
                  :model-value="newIngredientImageFile" accept="image/*"
                  @update:model-value="val => { newIngredientImageFile = val as File; newIngredient.image = ''; }" />
              </q-btn>
              <q-btn outline icon="photo_library" label="Aus Galerie wählen" color="primary"
                @click="openImagePicker('NEW')" class="rounded-borders bg-white" no-caps size="sm" />
            </div>
          </div>

          <q-item tag="label" v-if="isSpecialAdmin"
            class="bg-dynamic-soft rounded-borders q-mt-md q-pa-sm dynamic-border">
            <q-item-section>
              <q-item-label class="text-weight-bold text-primary">Als System-Zutat anlegen</q-item-label>
              <q-item-label caption>Zutat ist direkt für alle verifiziert</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-toggle v-model="newIngredient.isSystem" color="primary" />
            </q-item-section>
          </q-item>
        </q-card-section>

        <q-card-actions align="right" class="q-pa-lg bg-dynamic-soft dynamic-border">
          <q-btn flat label="Abbrechen" v-close-popup color="grey-6" no-caps />
          <q-btn color="primary" label="Zutat speichern" @click="handleSaveNewIngredient" unelevated no-caps
            class="rounded-borders q-px-lg text-weight-bold shadow-2" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showMarketDialog" persistent backdrop-filter="blur(5px)">
      <q-card class="dynamic-card dynamic-text dialog-card-medium rounded-xl overflow-hidden">
        <q-card-section class="bg-dynamic-soft q-pa-lg">
          <div class="text-h5 text-weight-bold">Supermarkt-Layout</div>
        </q-card-section>
        <q-card-section class="q-pa-lg">
          <q-input v-model="editingMarket.name" label="Name" filled :dark="isDarkMode" color="primary"
            class="q-mb-xl custom-dynamic-input text-h6" />
          <div class="row q-col-gutter-lg">
            <div class="col-12 col-md-6">
              <div class="text-subtitle2 text-primary text-uppercase text-weight-bold q-mb-md tracking-widest">
                Reihenfolge</div>
              <q-list separator class="bg-dynamic-soft rounded-borders dynamic-border shadow-inset scroll"
                style="max-height: 400px">
                <q-item v-for="(cat, i) in selectedCategoriesObjects" :key="cat.id" class="q-py-md list-item-hover">
                  <q-item-section avatar><q-badge color="primary">{{ i + 1 }}</q-badge></q-item-section>
                  <q-item-section class="text-weight-bold">{{ cat.name }}</q-item-section>
                  <q-item-section side>
                    <div class="row no-wrap q-gutter-xs">
                      <q-btn flat dense icon="expand_less" color="grey-5" @click="moveCategory(i, -1)"
                        :disable="i === 0" />
                      <q-btn flat dense icon="expand_more" color="grey-5" @click="moveCategory(i, 1)"
                        :disable="i === editingMarket.categoryOrder.length - 1" />
                      <q-btn flat dense icon="remove_circle_outline" color="red-4"
                        @click="removeCategoryFromMarket(cat.id)" />
                    </div>
                  </q-item-section>
                </q-item>
              </q-list>
            </div>
            <div class="col-12 col-md-6">
              <div class="text-subtitle2 dynamic-text-muted text-uppercase text-weight-bold q-mb-md tracking-widest">
                Verfügbar</div>
              <q-list class="bg-dynamic-soft rounded-borders dynamic-border scroll" style="max-height: 400px">
                <q-item v-for="c in availableCategoriesForEdit" :key="c.id" clickable @click="addCategoryToMarket(c.id)"
                  class="list-item-hover q-py-md">
                  <q-item-section>{{ c.name }}</q-item-section><q-item-section side><q-icon name="add"
                      color="primary" /></q-item-section>
                </q-item>
              </q-list>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-lg bg-dynamic-soft dynamic-border">
          <q-btn flat label="Abbrechen" v-close-popup color="grey-6" no-caps />
          <q-btn color="primary" label="Speichern" @click="saveMarket" no-caps unelevated
            class="q-px-xl text-weight-bold rounded-borders" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-dialog v-model="showDeleteDialog" persistent>
      <q-card class="dynamic-card dynamic-text rounded-xl" style="width: 450px">
        <q-card-section class="bg-negative text-white q-pa-lg">
          <div class="text-h6 text-weight-bold">Löschen bestätigen</div>
        </q-card-section>
        <q-card-section class="q-pa-lg">
          <p class="text-body1">Möchtest du <strong>{{ ingredientToDelete?.name }}</strong> wirklich löschen?</p>
          <div v-if="recipesUsingIngredient.length > 0"
            class="bg-dynamic-soft q-pa-md rounded-borders dynamic-border q-mt-md">
            <p class="text-amber-8 text-weight-bold q-mb-sm">Achtung!</p>
            <p class="text-caption dynamic-text-muted q-mb-md">Zutat ist in {{ recipesUsingIngredient.length }}
              Rezepten. Wähle einen Ersatz:</p>
            <q-select v-model="swapIngredientId" :options="allIngredientsOptions" emit-value map-options filled
              :dark="isDarkMode" dense color="primary" class="custom-dynamic-input" label="Ersatz-Zutat" />
          </div>
        </q-card-section>
        <q-card-actions align="right" class="q-pa-lg">
          <q-btn flat label="Abbrechen" v-close-popup color="grey-6" no-caps />
          <q-btn color="negative" label="Löschen" @click="executeDeleteAndSwap" :loading="isDeleting" no-caps unelevated
            class="rounded-borders q-px-lg" />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </q-page>
</template>

<style scoped>
/* GLOBALE STRUKTUR */
.max-width-container {
  max-width: 1400px;
  /* Einheitlich mit MealPlanPage */
  margin: 0 auto;
  width: 100%;
}

.transition-ease {
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

/* TABS STYLING */
.tabs-container {
  width: 100%;
  display: block;
  /* Sicherstellen, dass kein Flex-Wrapping des Vaters stört */
}

.settings-tabs {
  width: 100% !important;
  padding: 4px;
}

@media (max-width: 600px) {
  .tabs-container {
    width: 100%;
  }

  .settings-tabs {
    width: 100%;
  }

  :deep(.q-tab__label) {
    font-size: 11px;
  }
}

@media (max-width: 800px) {
  :deep(.q-tab) {
    flex: 0 0 auto;
    /* Auf Handy zurück zu Auto-Breite für Scrollbarkeit */
    padding: 0 20px;
  }
}

/* Fix für Quasar: Stellt sicher, dass der interne Container der Tabs 100% nutzt */
:deep(.q-tabs__content) {
  width: 100%;
}

:deep(.q-tabs__content) {
  overflow: visible !important;
}

:deep(.q-tab) {
  flex: 1 1 0;
  /* Jedes Tab wächst gleichmäßig */
  min-height: 56px;
}

/* KARTEN & KOMPONENTEN */
.rounded-xl {
  border-radius: 20px;
}

.card-hover {
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
}

.card-hover:hover {
  border-color: var(--q-primary) !important;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--q-primary), transparent 85%);
}

.profile-avatar {
  border: 3px solid rgba(255, 255, 255, 0.08);
}

.wg-code-box {
  background: color-mix(in srgb, var(--q-primary), transparent 90%);
  border: 2px dashed var(--q-primary);
  display: inline-flex;
  border-radius: 16px;
  transition: transform 0.2s, background 0.2s;
}

.wg-code-box:hover {
  transform: scale(1.03);
  background: color-mix(in srgb, var(--q-primary), transparent 85%);
}

/* INPUTS */
:deep(.custom-dynamic-input .q-field__control) {
  border-radius: 14px;
  padding: 0 16px;
}

:global(.body--dark) :deep(.custom-dynamic-input .q-field__control) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

:global(.body--light) :deep(.custom-dynamic-input .q-field__control) {
  background-color: rgba(0, 0, 0, 0.04) !important;
}

/* UTILS */
.center-block {
  margin-left: auto;
  margin-right: auto;
}

.max-width-600 {
  max-width: 600px;
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 14px;
}

.dialog-card-large {
  width: 900px;
  max-width: 95vw;
}

.dialog-card-medium {
  width: 800px;
  max-width: 95vw;
}

.hover-negative-btn:hover {
  color: var(--q-negative) !important;
}
</style>
