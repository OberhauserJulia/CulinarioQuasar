export type WithId<T> = T & { id: string };

export interface IngredientItem {
  ingredientID: string; //IngredientId von Firestore
  amount: number;
  unit: string;
  note?: string;
}

export interface Ingredient {
  categoryId: string; //IngredientCategoryId von Firestore
  image: string;
  name: string;
  plural: string;
}
export type IngredientFirebase = WithId<Ingredient>;

export interface IngredientCategory {
  name: string;
}
export type IngredientCategoryFirebase = WithId<IngredientCategory>;

export interface PreparationStep {
  stepNumber: number;
  description: string;
  ingredients: IngredientItem[];
}

export interface Recipe {
  name: string;
  category: string;
  image: string;
  ovensettings: string;
  recipeamount: {
    amount: number;
    unit: string;
  };
  source: string;
  ingredients: IngredientItem[];
  preparationSteps: PreparationStep[];
}
export type RecipeFirebase = WithId<Recipe>;

export interface RecipeCategory {
  name: string;
}
export type RecipeCategoryFirebase = WithId<RecipeCategory>;

export interface MealPlan {
  date: string;
  recipes: Recipe[];
}

export interface ShoppingList {
  amount: number;
  checked: boolean;
  ingredientid: string;
  unit: string;
  customName?: string;
  customCategoryId?: string;
  customImage?: string;
}

export type ShoppingListFirebase = WithId<ShoppingList>;

export interface Markets {
  name: string;
  categoryOrder: string[];
}

