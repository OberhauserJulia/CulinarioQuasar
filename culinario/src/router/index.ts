import { route } from 'quasar/wrappers';
import { createRouter, createMemoryHistory, createWebHistory, createWebHashHistory } from 'vue-router';
import routes from './routes';

// NEUE IMPORTS FÜR DEN LOGIN-CHECK
import { auth } from '../firebase/index';
import { onAuthStateChanged } from 'firebase/auth';

export default route(function (/* { store, ssrContext } */) {
  const createHistory = process.env.SERVER
    ? createMemoryHistory
    : (process.env.VUE_ROUTER_MODE === 'history' ? createWebHistory : createWebHashHistory);

  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,
    history: createHistory(process.env.VUE_ROUTER_BASE)
  });

  // --- AB HIER STARTET DER TÜRSTEHER ---

  // Hilfsfunktion: Checkt den echten Firebase-Status beim Neuladen der Seite
  const getCurrentUser = () => {
    return new Promise((resolve, reject) => {
      const unsubscribe = onAuthStateChanged(auth, user => {
        unsubscribe();
        resolve(user);
      }, reject);
    });
  };

  Router.beforeEach(async (to, from, next) => {
    const requiresAuth = to.matched.some(record => record.meta.requiresAuth);
    const currentUser = await getCurrentUser();

    if (requiresAuth && !currentUser) {
      // Route ist geschützt, aber User ist nicht eingeloggt -> ab zum Login!
      next('/login');
    } else if (to.path === '/login' && currentUser) {
      // User ist eingeloggt und will zum Login -> ab zur Startseite!
      next('/');
    } else {
      // Alles in Ordnung, Route laden!
      next();
    }
  });

  // --- ENDE DES TÜRSTEHERS ---

  return Router;
});
