import { db } from '../firebase/index';
import {
  collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc,
  query, where, setDoc, arrayUnion, arrayRemove, writeBatch, onSnapshot, type Unsubscribe
} from 'firebase/firestore';

// Importiere deine Typen (Pfad anpassen, falls die Datei index.ts in einem anderen Ordner liegt)
import type {
  Recipe, RecipeFirebase,
  Ingredient, IngredientFirebase,
  RecipeCategoryFirebase,
  ShoppingList, ShoppingListFirebase,
  Markets, WithId
} from '../types/index';


// ==========================================
// REZEPTE (Recipes)
// ==========================================

export const getRecipes = async (): Promise<RecipeFirebase[]> => {
  const snap = await getDocs(collection(db, 'recipes'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeFirebase));
};

export const getRecipeById = async (id: string): Promise<RecipeFirebase | null> => {
  const snap = await getDoc(doc(db, 'recipes', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RecipeFirebase;
};

export const addRecipe = async (data: Recipe): Promise<string> => {
  const docRef = await addDoc(collection(db, 'recipes'), data);
  return docRef.id;
};

export const updateRecipe = async (id: string, data: Partial<Recipe>): Promise<void> => {
  await updateDoc(doc(db, 'recipes', id), data);
};

export const deleteRecipe = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'recipes', id));
};


// ==========================================
// ZUTATEN (Ingredients)
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
// KATEGORIEN (Recipe Categories)
// ==========================================

export const getRecipeCategories = async (): Promise<RecipeCategoryFirebase[]> => {
  const snap = await getDocs(collection(db, 'recipeCategory'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeCategoryFirebase));
};


// ==========================================
// SUPERMÄRKTE (Markets)
// ==========================================

export const getMarkets = async (): Promise<WithId<Markets>[]> => {
  const snap = await getDocs(collection(db, 'supermarkets'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as WithId<Markets>));
};

export const addMarket = async (data: Markets): Promise<string> => {
  const docRef = await addDoc(collection(db, 'supermarkets'), data);
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

export const getMealPlans = async (): Promise<Record<string, { recipes: string[] }>> => {
  const snap = await getDocs(collection(db, 'mealPlan'));
  const plans: Record<string, { recipes: string[] }> = {};
  snap.docs.forEach(d => {
    plans[d.id] = d.data() as { recipes: string[] };
  });

  return plans;
};

export const addRecipeToMealPlan = async (dateStr: string, recipeId: string): Promise<void> => {
  const docRef = doc(db, 'mealPlan', dateStr);
  const docSnap = await getDoc(docRef);

  if (docSnap.exists()) {
    await updateDoc(docRef, { recipes: arrayUnion(recipeId) });
  } else {
    // Falls noch kein Plan für den Tag existiert, legen wir ihn an
    await setDoc(docRef, { recipes: [recipeId], date: new Date(dateStr) });
  }
};

export const removeRecipeFromMealPlan = async (dateStr: string, recipeId: string): Promise<void> => {
  const docRef = doc(db, 'mealPlan', dateStr);
  await updateDoc(docRef, { recipes: arrayRemove(recipeId) });
};


// ==========================================
// EINKAUFSLISTE (Shopping List)
// ==========================================

export const getShoppingList = async (): Promise<ShoppingListFirebase[]> => {
  const snap = await getDocs(collection(db, 'shoppingList'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingListFirebase));
};

export const addShoppingListItem = async (data: ShoppingList): Promise<string> => {
  const docRef = await addDoc(collection(db, 'shoppingList'), data);
  return docRef.id;
};

export const updateShoppingListItem = async (id: string, data: Partial<ShoppingList>): Promise<void> => {
  await updateDoc(doc(db, 'shoppingList', id), data);
};

export const deleteShoppingListItem = async (id: string): Promise<void> => {
  await deleteDoc(doc(db, 'shoppingList', id));
};

// Echtzeit-Listener (wird in ShoppingListPage.vue gebraucht)
export const subscribeToShoppingList = (callback: (items: ShoppingListFirebase[]) => void): Unsubscribe => {
  return onSnapshot(collection(db, 'shoppingList'), (snapshot) => {
    const items = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as ShoppingList) }));
    callback(items);
  });
};

// Batch Update für den Button "Woche einkaufen" im MealPlan
export const batchUpdateShoppingList = async (
  itemsToUpdate: { docId: string; amount: number }[],
  itemsToAdd: ShoppingList[]
): Promise<void> => {
  const batch = writeBatch(db);

  itemsToUpdate.forEach(item => {
    const ref = doc(db, 'shoppingList', item.docId);
    batch.update(ref, { amount: item.amount });
  });

  itemsToAdd.forEach(item => {
    const newRef = doc(collection(db, 'shoppingList'));
    batch.set(newRef, item);
  });

  await batch.commit();
};
