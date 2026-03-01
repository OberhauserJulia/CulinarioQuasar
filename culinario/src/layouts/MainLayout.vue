<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar, setCssVar } from 'quasar';
import { useRoute } from 'vue-router';
import { initializeUserGroup } from '../firebase/services';

const $q = useQuasar();
const route = useRoute();
const isReady = ref(false);

const navLinks = [
  { label: 'Rezepte', icon: 'menu_book', to: '/', exact: true },
  { label: 'Neu', icon: 'add_circle', to: '/add-recipe' },
  { label: 'Wochenplan', icon: 'event_note', to: '/meal-plan' },
  { label: 'Einkaufen', icon: 'shopping_cart', to: '/shopping-list' },
  { label: 'Einstellungen', icon: 'settings', to: '/settings' },
];

const leftDrawerOpen = ref(false);

const isMiniMode = computed(() => {
  return $q.screen.sm || route.path.startsWith('/recipe/');
});

onMounted(async () => {
  // Theme & Farbe aus LocalStorage laden
  const storedTheme = localStorage.getItem('darkMode');
  if (storedTheme !== null) {
    $q.dark.set(storedTheme === 'true');
  } else {
    $q.dark.set(true);
  }

  const savedColor = localStorage.getItem('primaryColor');
  if (savedColor) {
    setCssVar('primary', savedColor);
    setCssVar('accent', savedColor);
  }

  try {
    await initializeUserGroup();
  } finally {
    isReady.value = true;
  }
});
</script>

<template>
  <q-layout view="hHh LpR lFf" class="bg-dynamic-page dynamic-text">

    <q-drawer v-model="leftDrawerOpen" show-if-above :mini="isMiniMode" :width="260" :mini-width="90" :breakpoint="599"
      class="bg-dynamic-sidebar border-right gt-xs">

      <div class="row items-center q-py-lg q-px-md border-bottom"
        :class="isMiniMode ? 'justify-center' : 'justify-start'">
        <q-avatar size="42px" color="primary" text-color="white" class="shadow-4">
          <q-icon name="restaurant_menu" size="sm" />
        </q-avatar>
        <div v-if="!isMiniMode" class="text-h6 text-weight-bolder q-ml-md letter-spacing-1">
          Culinario
        </div>
      </div>

      <q-scroll-area class="fit" style="height: calc(100% - 90px);">
        <q-list padding class="q-px-sm q-gutter-y-xs">

          <q-item-label v-if="!isMiniMode" header
            class="text-weight-bold text-uppercase q-mt-sm q-mb-xs dynamic-text-muted"
            style="font-size: 11px; letter-spacing: 1px;">
            Navigation
          </q-item-label>

          <q-item v-for="link in navLinks" :key="link.to" clickable v-ripple :to="link.to" :exact="link.exact"
            class="nav-item rounded-borders transition-ease dynamic-text-muted"
            active-class="active-nav-item text-primary text-weight-bold">
            <q-item-section avatar :class="isMiniMode ? 'items-center' : ''">
              <q-icon :name="link.icon" size="sm" />
            </q-item-section>

            <q-item-section v-if="!isMiniMode">
              {{ link.label }}
            </q-item-section>

            <q-tooltip v-if="isMiniMode" anchor="center right" self="center left" :offset="[10, 10]"
              class="bg-primary text-white text-weight-bold shadow-4">
              {{ link.label }}
            </q-tooltip>
          </q-item>

        </q-list>
      </q-scroll-area>
    </q-drawer>

    <q-page-container>
      <router-view v-if="isReady" />
      <div v-else class="flex flex-center" style="height: 80vh;">
        <q-spinner-dots color="primary" size="3em" />
      </div>
    </q-page-container>

    <q-footer class="bg-dynamic-sidebar border-top lt-sm" style="padding-bottom: env(safe-area-inset-bottom);">
      <q-tabs align="justify" indicator-color="transparent" active-color="primary" class="dynamic-text-muted"
        style="height: 60px;">
        <q-route-tab v-for="link in navLinks" :key="link.to" :to="link.to" :icon="link.icon" :label="link.label"
          :exact="link.exact" no-caps :ripple="false" class="mobile-tab" />
      </q-tabs>
    </q-footer>

  </q-layout>
</template>

<style>
/* ===================================================
   GLOBALES DESIGN SYSTEM FÜR DIE GANZE APP
   =================================================== */
body.body--dark .bg-dynamic-page {
  background-color: #121212;
}

body.body--light .bg-dynamic-page {
  background-color: #f4f6f8;
}

body.body--dark .bg-dynamic-sidebar {
  background-color: #1a1a1a !important;
}

body.body--light .bg-dynamic-sidebar {
  background-color: #ffffff !important;
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.03);
}

body.body--dark .dynamic-card {
  background-color: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

body.body--light .dynamic-card {
  background-color: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
}

body.body--dark .dynamic-text {
  color: #ffffff;
}

body.body--light .dynamic-text {
  color: #1d1d1d;
}

body.body--dark .dynamic-text-muted {
  color: #9e9e9e;
}

body.body--light .dynamic-text-muted {
  color: #757575;
}

body.body--dark .bg-dynamic-soft {
  background-color: rgba(255, 255, 255, 0.03);
}

body.body--light .bg-dynamic-soft {
  background-color: rgba(0, 0, 0, 0.03);
}

body.body--dark .dynamic-border {
  border: 1px solid rgba(255, 255, 255, 0.05);
}

body.body--light .dynamic-border {
  border: 1px solid rgba(0, 0, 0, 0.08);
}

body.body--dark .dynamic-border-right {
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

body.body--light .dynamic-border-right {
  border-right: 1px solid rgba(0, 0, 0, 0.05);
}

body.body--dark .dynamic-border-bottom {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

body.body--light .dynamic-border-bottom {
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

body.body--dark .dynamic-border-top {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
}

body.body--light .dynamic-border-top {
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.05);
}

/* Globale Quasar Overrides für konsistente Farben */
.text-primary {
  color: var(--q-primary) !important;
}

.bg-primary {
  background: var(--q-primary) !important;
}

.q-tabs__indicator {
  background: var(--q-primary) !important;
}

.q-toggle__inner--truthy {
  color: var(--q-primary) !important;
}
</style>

<style scoped>
/* ===================================================
   MAGIE: Globale Dark/Light Mode Klassen
   Quasar setzt automatisch .body--dark oder .body--light
   Wir nutzen das, um unsere eigenen Klassen umzuschalten!
   =================================================== */

/* Hintergrund der App */
:global(.body--dark) .bg-dynamic-page {
  background-color: #121212;
}

:global(.body--light) .bg-dynamic-page {
  background-color: #f4f6f8;
}

/* Hintergrund der Sidebar/Footer */
:global(.body--dark) .bg-dynamic-sidebar {
  background-color: #1a1a1a !important;
}

:global(.body--light) .bg-dynamic-sidebar {
  background-color: #ffffff !important;
}

/* Textfarben */
:global(.body--dark) .dynamic-text {
  color: #ffffff;
}

:global(.body--light) .dynamic-text {
  color: #1d1d1d;
}

:global(.body--dark) .dynamic-text-muted {
  color: #9e9e9e;
}

/* grey-5 */
:global(.body--light) .dynamic-text-muted {
  color: #757575;
}

/* Rahmen */
:global(.body--dark) .border-right {
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

:global(.body--light) .border-right {
  border-right: 1px solid rgba(0, 0, 0, 0.08);
}

:global(.body--dark) .border-bottom {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

:global(.body--light) .border-bottom {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

:global(.body--dark) .border-top {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

:global(.body--light) .border-top {
  border-top: 1px solid rgba(0, 0, 0, 0.08);
}

/* --- Restliches Styling --- */
.letter-spacing-1 {
  letter-spacing: 1px;
}

.transition-ease {
  transition: all 0.2s ease;
}

.nav-item {
  padding: 10px 16px;
  min-height: 48px;
}

/* Hover (passt sich leicht an) */
:global(.body--dark) .nav-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: #fff !important;
}

:global(.body--light) .nav-item:hover {
  background-color: rgba(0, 0, 0, 0.03);
  color: #000 !important;
}

/* Aktiver Tab nutzt die primäre Akzentfarbe als leichten Hintergrund! */
.active-nav-item {
  background-color: color-mix(in srgb, var(--q-primary), transparent 85%) !important;
}

.mobile-tab {
  padding: 4px 0;
}

:deep(.mobile-tab .q-tab__label) {
  font-size: 10px;
  margin-top: 4px;
  font-weight: 500;
}

:deep(.mobile-tab .q-icon) {
  font-size: 22px;
}

:deep(.q-tab--active .q-icon) {
  transform: scale(1.1);
  transition: transform 0.2s ease;
}

:deep(.q-drawer__content) {
  overflow: hidden !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}

/* ===================================================
   GLOBALE THEME-KLASSEN (Wie im Layout)
   =================================================== */
:global(.body--dark) .dynamic-card {
  background-color: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

:global(.body--light) .dynamic-card {
  background-color: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
}

:global(.body--dark) .dynamic-text-muted {
  color: #9e9e9e;
}

:global(.body--light) .dynamic-text-muted {
  color: #757575;
}

.max-width-container {
  max-width: 1000px;
  margin: 0 auto;
}

.rounded-xl {
  border-radius: 20px;
}

/* Hover-Effekte nutzen jetzt die dynamische Quasar-Variable! */
.card-hover {
  transition: transform 0.2s, border-color 0.2s;
}

.card-hover:hover {
  border-color: var(--q-primary) !important;
  transform: translateY(-2px);
}

.color-picker-btn {
  border: 2px solid transparent;
  transition: transform 0.2s;
}

.color-picker-btn:hover {
  transform: scale(1.15);
  border-color: var(--q-primary);
}

/* ERZWINGE DIE CSS VARIABLEN FÜR QUASAR ELEMENTE */
:deep(.text-primary) {
  color: var(--q-primary) !important;
}

:deep(.bg-primary) {
  background: var(--q-primary) !important;
}

:deep(.q-tabs__indicator) {
  background: var(--q-primary) !important;
}

:deep(.q-toggle__inner--truthy) {
  color: var(--q-primary) !important;
}
</style>
