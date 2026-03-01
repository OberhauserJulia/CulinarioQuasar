import { auth, db } from '../firebase/index';
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, setDoc, arrayUnion, arrayRemove, writeBatch, onSnapshot, type Unsubscribe, or, and
} from 'firebase/firestore';

import type {
  Recipe, RecipeFirebase,
  Ingredient, IngredientFirebase,
  RecipeCategoryFirebase,
  ShoppingList, ShoppingListFirebase,
  Markets, WithId
} from '../types/index';

// ==========================================
// 1. NUTZER & PROFILE (User & Settings)
// ==========================================

// Cache für die Gruppen-ID zur Performance-Optimierung
let cachedGroupId: string | null = null;

export const initializeUserGroup = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  if (userSnap.exists() && userSnap.data().groupId) {
    cachedGroupId = userSnap.data().groupId;
  } else {
    // Erster Login: Profil erstellen und Solo-WG zuweisen
    cachedGroupId = user.uid;
    await setDoc(doc(db, 'users', user.uid), {
      groupId: user.uid,
      email: user.email,
      name: user.displayName || ''
    });
  }
};

/** Aktualisiert beliebige Felder im Nutzerprofil (Name, Einheiten, Kochmodus etc.) */
export const updateUserPrefs = async (prefs: Record<string, any>) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), prefs);
};

/** Veraltet: Nutze updateUserPrefs für alle Profil-Updates */
export const updateUserProfile = async (data: { name: string }) => {
  await updateUserPrefs(data);
};

/** Speziell für die WG-Berechtigungen (Abwärtskompatibilität) */
export const updateUserWGPrefs = async (prefs: { shareMealPlan: boolean, shareShoppingList: boolean }) => {
  await updateUserPrefs(prefs);
};

export const getGroupMemberSettings = async (): Promise<Record<string, { shareMealPlan: boolean, shareShoppingList: boolean }>> => {
  const gid = getGroupId();
  const q = query(collection(db, 'users'), where('groupId', '==', gid));
  const snap = await getDocs(q);

  const settings: Record<string, { shareMealPlan: boolean; shareShoppingList: boolean }> = {};
  snap.docs.forEach(d => {
    const data = d.data();
    settings[d.id] = {
      shareMealPlan: data.shareMealPlan ?? true,
      shareShoppingList: data.shareShoppingList ?? true
    };
  });
  return settings;
};

export const deleteUserAccount = async () => {
  const user = auth.currentUser;
  if (!user) return;
  // Profildaten in Firestore löschen
  await deleteDoc(doc(db, 'users', user.uid));
  // Authentifizierung löschen (erfordert ggf. frischen Login)
  await user.delete();
};

// ==========================================
// 2. WG-MANAGEMENT (Groups)
// ==========================================

export const getGroupId = (): string => {
  if (cachedGroupId) return cachedGroupId;
  const user = auth.currentUser;
  if (!user) throw new Error("Nicht eingeloggt!");
  return user.uid;
};

export const getWGInfo = async () => {
  const gid = getGroupId();
  const user = auth.currentUser;
  if (!user || gid === user.uid) return null;

  const groupSnap = await getDoc(doc(db, 'groups', gid));
  if (groupSnap.exists()) {
    return { id: groupSnap.id, ...groupSnap.data() } as { id: string, name: string, code: string };
  }
  return null;
};

export const createWG = async (name: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const newGroupRef = await addDoc(collection(db, 'groups'), {
    name,
    code,
    members: [user.uid]
  });

  cachedGroupId = newGroupRef.id;
  await updateDoc(doc(db, 'users', user.uid), { groupId: newGroupRef.id });
};

export const joinWG = async (code: string): Promise<string> => {
  const user = auth.currentUser;
  if (!user) throw new Error("Nicht eingeloggt");

  const q = query(collection(db, 'groups'), where('code', '==', code.toUpperCase()));
  const snap = await getDocs(q);

  if (snap.empty || !snap.docs[0]) {
    throw new Error("Code ungültig oder WG existiert nicht.");
  }

  const groupDoc = snap.docs[0];
  const groupId = groupDoc.id;

  await updateDoc(doc(db, 'groups', groupId), { members: arrayUnion(user.uid) });

  cachedGroupId = groupId;
  await updateDoc(doc(db, 'users', user.uid), { groupId });

  return (groupDoc.data() as { name: string }).name;
};

export const leaveWG = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const oldGroupId = cachedGroupId;

  cachedGroupId = user.uid;
  await updateDoc(doc(db, 'users', user.uid), { groupId: user.uid });

  if (oldGroupId && oldGroupId !== user.uid) {
    await updateDoc(doc(db, 'groups', oldGroupId), { members: arrayRemove(user.uid) });
  }
};

export const getGroupMembers = async (): Promise<{ id: string, name: string, email: string }[]> => {
  const gid = getGroupId();
  const q = query(collection(db, 'users'), where('groupId', '==', gid));
  const snap = await getDocs(q);

  return snap.docs.map(d => ({
    id: d.id,
    name: d.data().name || d.data().email.split('@')[0],
    email: d.data().email
  }));
};

// ==========================================
// 3. DATEN-MANAGEMENT (Backup & Export)
// ==========================================

/** Exportiert alle Rezepte der aktuellen WG als JSON-Datei */
export const exportRecipeData = async () => {
  const recipes = await getRecipes();
  const dataStr = JSON.stringify(recipes, null, 2);
  const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

  const linkElement = document.createElement('a');
  linkElement.setAttribute('href', dataUri);
  linkElement.setAttribute('download', 'culinario_backup.json');
  linkElement.click();
};

// ==========================================
// 4. REZEPTE (Recipes)
// ==========================================

export const getRecipes = async (): Promise<RecipeFirebase[]> => {
  const gid = getGroupId();
  const uid = auth.currentUser?.uid;

  if (!uid) return [];

  try {
    // 1. Hole ALLE deine eigenen Rezepte (egal aus welcher WG oder aus der Zeit davor)
    const myRecipesQuery = query(
      collection(db, 'recipes'),
      where('authorId', '==', uid)
    );

    // 2. Hole ALLE öffentlichen Rezepte, die andere in deiner aktuellen WG erstellt haben
    const groupRecipesQuery = query(
      collection(db, 'recipes'),
      where('groupId', '==', gid),
      where('visibility', '==', 'public')
    );

    // Beide Abfragen parallel ausführen für maximale Geschwindigkeit
    const [mySnap, groupSnap] = await Promise.all([
      getDocs(myRecipesQuery),
      getDocs(groupRecipesQuery)
    ]);

    // Eine Map verhindert, dass Rezepte doppelt angezeigt werden
    const recipesMap = new Map<string, RecipeFirebase>();

    // Eigene Rezepte eintragen
    mySnap.docs.forEach(d => {
      recipesMap.set(d.id, { id: d.id, ...d.data() } as RecipeFirebase);
    });

    // WG Rezepte dazupacken (falls sie nicht schon drin sind)
    groupSnap.docs.forEach(d => {
      if (!recipesMap.has(d.id)) {
        recipesMap.set(d.id, { id: d.id, ...d.data() } as RecipeFirebase);
      }
    });

    return Array.from(recipesMap.values());
  } catch (error) {
    console.error("Fehler beim Laden der Rezepte:", error);
    return [];
  }
};

export const getRecipeById = async (id: string): Promise<RecipeFirebase | null> => {
  const snap = await getDoc(doc(db, 'recipes', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RecipeFirebase;
};

export const addRecipe = async (data: Recipe): Promise<string> => {
  const uid = auth.currentUser?.uid;
  const recipeToSave = {
    ...data,
    groupId: getGroupId(),
    authorId: uid,
    visibility: (data as Recipe & { visibility?: string }).visibility || 'public'
  };

  const docRef = await addDoc(collection(db, 'recipes'), recipeToSave);
  return docRef.id;
};

export const updateRecipe = async (id: string, data: Partial<Recipe>): Promise<void> => {
  await updateDoc(doc(db, 'recipes', id), data);
};

export const deleteRecipe = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'recipes', id));
};

export const getRecipeCategories = async (): Promise<RecipeCategoryFirebase[]> => {
  const gid = getGroupId();
  const q = query(
    collection(db, 'recipeCategory'),
    or(
      where('groupId', '==', gid),
      where('groupId', '==', 'system')
    )
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeCategoryFirebase));
};

export const addRecipeCategory = async (name: string): Promise<string> => {
  const docRef = await addDoc(collection(db, 'recipeCategory'), {
    name,
    groupId: getGroupId()
  });
  return docRef.id;
};

// ==========================================
// 5. ZUTATEN (Ingredients)
// ==========================================

export const getIngredients = async (): Promise<IngredientFirebase[]> => {
  const snap = await getDocs(collection(db, 'ingredients'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as IngredientFirebase));
};

export const getIngredientById = async (id: string): Promise<IngredientFirebase | null> => {
  const snap = await getDoc(doc(db, 'ingredients', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as IngredientFirebase;
};

export const getIngredientByName = async (name: string): Promise<IngredientFirebase | null> => {
  const q = query(collection(db, 'ingredients'), where('name', '==', name));
  const snap = await getDocs(q);
  const firstDoc = snap.docs[0];
  if (!firstDoc) return null;
  return { id: firstDoc.id, ...firstDoc.data() } as IngredientFirebase;
};

export const addIngredient = async (data: Ingredient): Promise<string> => {
  const docRef = await addDoc(collection(db, 'ingredients'), data);
  return docRef.id;
};

export const updateIngredient = async (id: string, data: Partial<Ingredient>): Promise<void> => {
  await updateDoc(doc(db, 'ingredients', id), data);
};

// ==========================================
// 6. SUPERMÄRKTE (Markets)
// ==========================================

export const getMarkets = async (): Promise<WithId<Markets>[]> => {
  const q = query(collection(db, 'supermarkets'), where('groupId', '==', getGroupId()));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Markets>));
};

export const addMarket = async (data: Markets): Promise<string> => {
  const docRef = await addDoc(collection(db, 'supermarkets'), { ...data, groupId: getGroupId() });
  return docRef.id;
};

export const updateMarket = async (id: string, data: Partial<Markets>): Promise<void> => {
  await updateDoc(doc(db, 'supermarkets', id), data);
};

export const deleteMarket = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'supermarkets', id));
};

// ==========================================
// 7. WOCHENPLAN (Meal Plan)
// ==========================================

const getMealPlanDocId = (dateStr: string) => `${getGroupId()}_${dateStr}`;

export const getMealPlans = async (): Promise<Record<string, { recipes: string[] }>> => {
  const q = query(collection(db, 'mealPlan'), where('groupId', '==', getGroupId()));
  const snap = await getDocs(q);
  const plans: Record<string, { recipes: string[] }> = {};

  snap.docs.forEach(d => {
    const data = d.data();
    const dateKey = data.dateString || d.id.replace(`${getGroupId()}_`, '');
    plans[dateKey] = data as { recipes: string[] };
  });

  return plans;
};

export const addRecipeToMealPlan = async (dateStr: string, recipeId: string, cookId: string): Promise<void> => {
  const docRef = doc(db, 'mealPlan', getMealPlanDocId(dateStr));
  const docSnap = await getDoc(docRef);
  const entry = { recipeId, cookId };

  if (docSnap.exists()) {
    await updateDoc(docRef, { recipes: arrayUnion(entry) });
  } else {
    await setDoc(docRef, {
      recipes: [entry],
      date: new Date(dateStr),
      dateString: dateStr,
      groupId: getGroupId()
    });
  }
};

export const removeRecipeFromMealPlan = async (dateStr: string, recipeId: string): Promise<void> => {
  const docRef = doc(db, 'mealPlan', getMealPlanDocId(dateStr));
  await updateDoc(docRef, { recipes: arrayRemove(recipeId) });
};

// ==========================================
// 8. EINKAUFSLISTE (Shopping List)
// ==========================================

export const getShoppingList = async (): Promise<ShoppingListFirebase[]> => {
  const q = query(collection(db, 'shoppingList'), where('groupId', '==', getGroupId()));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingListFirebase));
};

export const addShoppingListItem = async (data: ShoppingList): Promise<string> => {
  const uid = auth.currentUser?.uid;
  const docRef = await addDoc(collection(db, 'shoppingList'), {
    ...data,
    groupId: getGroupId(),
    authorId: uid
  });
  return docRef.id;
};

export const batchUpdateShoppingList = async (
  itemsToUpdate: { docId: string; amount: number }[],
  itemsToAdd: ShoppingList[]
): Promise<void> => {
  const batch = writeBatch(db);
  const uid = auth.currentUser?.uid;

  itemsToUpdate.forEach(item => {
    const ref = doc(db, 'shoppingList', item.docId);
    batch.update(ref, { amount: item.amount });
  });

  itemsToAdd.forEach(item => {
    const newRef = doc(collection(db, 'shoppingList'));
    batch.set(newRef, { ...item, groupId: getGroupId(), authorId: uid });
  });

  await batch.commit();
};

export const updateShoppingListItem = async (id: string, data: Partial<ShoppingList>): Promise<void> => {
  await updateDoc(doc(db, 'shoppingList', id), data);
};

export const deleteShoppingListItem = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'shoppingList', id));
};

export const subscribeToShoppingList = (callback: (items: ShoppingListFirebase[]) => void): Unsubscribe => {
  const q = query(collection(db, 'shoppingList'), where('groupId', '==', getGroupId()));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as ShoppingList) }));
    callback(items as ShoppingListFirebase[]);
  });
};
