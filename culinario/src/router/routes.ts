import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/HomePage.vue') },
      { path: 'add-recipe', component: () => import('pages/AddRecipePage.vue') },
      { path: 'recipe/:id', component: () => import('pages/RecipeDetailPage.vue') },
      { path: 'meal-plan', component: () => import('pages/MealPlanPage.vue') },
      { path: 'shopping-list', component: () => import('pages/ShoppingListPage.vue') },
      { path: 'settings', component: () => import('pages/SettingsPage.vue') }
    ],
  },
];

export default routes;
