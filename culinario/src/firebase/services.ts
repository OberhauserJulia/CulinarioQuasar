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
// WG-MANAGEMENT & GRUPPEN-ID
// ==========================================

// Wir cachen die ID, damit wir nicht bei jedem Klick die Datenbank fragen müssen
let cachedGroupId: string | null = null;

export const initializeUserGroup = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  // Schauen, ob der Nutzer schon ein Profil hat
  const userSnap = await getDoc(doc(db, 'users', user.uid));
  if (userSnap.exists() && userSnap.data().groupId) {
    cachedGroupId = userSnap.data().groupId;
  } else {
    // Erster Login! Wir erstellen ein Profil und er ist seine eigene "Solo-WG"
    cachedGroupId = user.uid;
    await setDoc(doc(db, 'users', user.uid), {
      groupId: user.uid,
      email: user.email
    });
  }
};

export const updateUserPrefs = async (prefs: Record<string, any>) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), prefs);
};

export const updateUserProfile = async (data: { name: string }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  // Wir aktualisieren das Dokument in der 'users' Kollektion
  await updateDoc(doc(db, 'users', uid), data);
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

export const getGroupId = (): string => {
  if (cachedGroupId) return cachedGroupId;
  const user = auth.currentUser;
  if (!user) throw new Error("Nicht eingeloggt!");
  return user.uid; // Fallback
};

export const getWGInfo = async () => {
  const gid = getGroupId();
  const user = auth.currentUser;
  if (!user || gid === user.uid) return null; // Wenn groupId == uid, ist er in keiner WG

  const groupSnap = await getDoc(doc(db, 'groups', gid));
  if (groupSnap.exists()) {
    return { id: groupSnap.id, ...groupSnap.data() } as { id: string, name: string, code: string };
  }
  return null;
};

export const createWG = async (name: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;

  // 6-stelligen Code generieren (z.B. A7X9P2)
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

  if (snap.empty || !snap.docs[0]) { // Sicherheits-Check hinzugefügt
    throw new Error("Code ungültig oder WG existiert nicht.");
  }

  const groupDoc = snap.docs[0];
  const groupId = groupDoc.id;

  await updateDoc(doc(db, 'groups', groupId), { members: arrayUnion(user.uid) });

  cachedGroupId = groupId;
  await updateDoc(doc(db, 'users', user.uid), { groupId });

  return (groupDoc.data() as { name: string }).name; // Typ-Cast für den Namen
};

export const leaveWG = async (): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return;
  const oldGroupId = cachedGroupId;

  // Zurück in die Solo-WG
  cachedGroupId = user.uid;
  await updateDoc(doc(db, 'users', user.uid), { groupId: user.uid });

  // Aus der alten Gruppe austragen
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
    name: d.data().name || d.data().email.split('@')[0], // Fallback auf E-Mail Name
    email: d.data().email
  }));
};


// ==========================================
// REZEPTE (Recipes)
// ==========================================

export const getRecipes = async (): Promise<RecipeFirebase[]> => {
  const gid = getGroupId();
  const uid = auth.currentUser?.uid;

  // Wir kapseln alles in ein and(), damit die Typen für TypeScript eindeutig sind
  const q = query(
    collection(db, 'recipes'),
    and(
      where('groupId', '==', gid),
      or(
        where('visibility', '==', 'public'),
        where('authorId', '==', uid)
      )
    )
  );

  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeFirebase));
};

export const addRecipeCategory = async (name: string): Promise<string> => {
  const docRef = await addDoc(collection(db, 'recipeCategory'), {
    name,
    groupId: getGroupId() // Damit Kategorien innerhalb der WG geteilt werden
  });
  return docRef.id;
};

export const deleteRecipe = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'recipes', id));
};

export const getRecipeById = async (id: string): Promise<RecipeFirebase | null> => {
  const snap = await getDoc(doc(db, 'recipes', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RecipeFirebase;
};

export const addRecipe = async (data: Recipe): Promise<string> => {
  const uid = auth.currentUser?.uid;

  // Wir erstellen ein temporäres Objekt mit dem richtigen Typ statt 'any'
  const recipeToSave = {
    ...data,
    groupId: getGroupId(),
    authorId: uid,
    // Wir prüfen, ob im data-Objekt eine Sichtbarkeit steckt, sonst 'public'
    visibility: (data as Recipe & { visibility?: string }).visibility || 'public'
  };

  const docRef = await addDoc(collection(db, 'recipes'), recipeToSave);
  return docRef.id;
};


// ==========================================
// ZUTATEN & KATEGORIEN (Global für alle)
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

export const updateRecipe = async (id: string, data: Partial<Recipe>): Promise<void> => {
  await updateDoc(doc(db, 'recipes', id), data);
};

export const getRecipeCategories = async (): Promise<RecipeCategoryFirebase[]> => {
  const snap = await getDocs(collection(db, 'recipeCategory'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeCategoryFirebase));
};


// ==========================================
// SUPERMÄRKTE (Markets)
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
// MEAL PLAN (Wochenplan)
// ==========================================

// NEU: Damit WGs nicht die Pläne von anderen überschreiben, kleben wir die groupId in die Dokument-ID!
const getMealPlanDocId = (dateStr: string) => `${getGroupId()}_${dateStr}`;

export const getMealPlans = async (): Promise<Record<string, { recipes: string[] }>> => {
  const q = query(collection(db, 'mealPlan'), where('groupId', '==', getGroupId()));
  const snap = await getDocs(q);
  const plans: Record<string, { recipes: string[] }> = {};

  snap.docs.forEach(d => {
    const data = d.data();
    // Wenn das Dokument schon den dateString gespeichert hat, nutzen wir den.
    // Ansonsten extrahieren wir ihn aus der ID (z.B. "UID_2023-10-25" -> "2023-10-25")
    const dateKey = data.dateString || d.id.replace(`${getGroupId()}_`, '');
    plans[dateKey] = data as { recipes: string[] };
  });

  return plans;
};

export const addRecipeToMealPlan = async (dateStr: string, recipeId: string, cookId: string): Promise<void> => {
  const docRef = doc(db, 'mealPlan', getMealPlanDocId(dateStr));
  const docSnap = await getDoc(docRef);

  const entry = { recipeId, cookId }; // Wir speichern beides als Objekt

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
// EINKAUFSLISTE (Shopping List)
// ==========================================

export const getShoppingList = async (): Promise<ShoppingListFirebase[]> => {
  const q = query(collection(db, 'shoppingList'), where('groupId', '==', getGroupId()));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingListFirebase));
};

export const addShoppingListItem = async (data: ShoppingList): Promise<string> => {
  const uid = auth.currentUser?.uid; // Hol die ID des aktuellen Nutzers
  const docRef = await addDoc(collection(db, 'shoppingList'), {
    ...data,
    groupId: getGroupId(),
    authorId: uid // NEU: Damit wir wissen, wer es hinzugefügt hat
  });
  return docRef.id;
};

// --- UPDATE: Batch-Update ebenfalls mit authorId ---
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
    // NEU: authorId beim Erstellen hinzufügen
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
  // NEU: Der Live-Listener hört nur noch auf die Einkaufsliste der eigenen WG!
  const q = query(collection(db, 'shoppingList'), where('groupId', '==', getGroupId()));
  return onSnapshot(q, (snapshot) => {
    const items = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as ShoppingList) }));
    callback(items);
  });
};

export const updateUserWGPrefs = async (prefs: { shareMealPlan: boolean, shareShoppingList: boolean }) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), prefs);
};
