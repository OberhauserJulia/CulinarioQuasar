<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useQuasar } from 'quasar';
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
  const storedTheme = localStorage.getItem('darkMode');
  if (storedTheme !== null) {
    $q.dark.set(storedTheme === 'true');
  } else {

    $q.dark.set(true);
  }

  // Deine bestehende Logik
  try {
    await initializeUserGroup();
  } finally {
    isReady.value = true;
  }
});

</script>

<template>
  <q-layout view="hHh LpR lFf" class="bg-dark-page text-white">

    <q-drawer v-model="leftDrawerOpen" show-if-above :mini="isMiniMode" :width="260" :mini-width="90" :breakpoint="599"
      class="bg-sidebar border-right gt-xs">
      <div class="row items-center q-py-lg q-px-md" :class="isMiniMode ? 'justify-center' : 'justify-start'"
        style="border-bottom: 1.5px solid #333333 !important;">
        <q-avatar size="42px" color="primary" text-color="white" class="shadow-4">
          <q-icon name="restaurant_menu" size="sm" />
        </q-avatar>
        <div v-if="!isMiniMode" class="text-h6 text-weight-bolder q-ml-md text-white letter-spacing-1">
          Culinario
        </div>
      </div>

      <q-scroll-area class="fit" style="height: calc(100% - 90px);">
        <q-list padding class="q-px-sm q-gutter-y-xs">

          <q-item-label v-if="!isMiniMode" header class="text-grey-6 text-weight-bold text-uppercase q-mt-sm q-mb-xs"
            style="font-size: 11px; letter-spacing: 1px;">
            Navigation
          </q-item-label>

          <q-item v-for="link in navLinks" :key="link.to" clickable v-ripple :to="link.to" :exact="link.exact"
            class="nav-item rounded-borders text-grey-5 transition-ease"
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

    <q-footer class="bg-sidebar border-top lt-sm" style="padding-bottom: env(safe-area-inset-bottom);">
      <q-tabs align="justify" indicator-color="transparent" active-color="primary" class="text-grey-6"
        style="height: 60px;">
        <q-route-tab v-for="link in navLinks" :key="link.to" :to="link.to" :icon="link.icon" :label="link.label"
          :exact="link.exact" no-caps :ripple="false" class="mobile-tab" />
      </q-tabs>
    </q-footer>

  </q-layout>
</template>

<style scoped>
/* Globale App-Hintergründe */
.bg-dark-page {
  background-color: #121212;
}

.bg-sidebar {
  background-color: #1a1a1a !important;
}

/* Rahmen-Styling */
.border-right {
  border-right: 1px solid rgba(255, 255, 255, 0.05);
}

.border-top {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
  /* Schicker Drop-Shadow für die Bottom-Bar */
}

/* Typografie */
.letter-spacing-1 {
  letter-spacing: 1px;
}

.transition-ease {
  transition: all 0.2s ease;
}

/* Sidebar Hover & Active States */
.nav-item {
  padding: 10px 16px;
  min-height: 48px;
}

.nav-item:hover {
  background-color: rgba(255, 255, 255, 0.03);
  color: #fff !important;
}

.active-nav-item {
  background-color: rgba(102, 161, 130, 0.1) !important;
  /* Leichtes Grün als Hintergrund */
}

/* Mobile Tab Bar Optimierungen */
.mobile-tab {
  padding: 4px 0;
}

/* Reduziert die Schriftgröße der Labels auf dem Handy leicht, damit sie gut nebeneinander passen */
:deep(.mobile-tab .q-tab__label) {
  font-size: 10px;
  margin-top: 4px;
  font-weight: 500;
}

:deep(.mobile-tab .q-icon) {
  font-size: 22px;
}

/* Wenn ein Tab aktiv ist, das Icon etwas hervorheben */
:deep(.q-tab--active .q-icon) {
  transform: scale(1.1);
  transition: transform 0.2s ease;
}

:deep(.q-drawer__content) {
  overflow: hidden !important;
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}
</style>
