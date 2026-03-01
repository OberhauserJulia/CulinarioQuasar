<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar, setCssVar } from 'quasar';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { auth } from '../firebase/index';

const router = useRouter();
const $q = useQuasar();

const isLogin = ref(true); // Toggle zwischen Login und Registrierung
const email = ref('');
const password = ref('');
const isLoading = ref(false);

onMounted(() => {
  setCssVar('primary', '#66a182');
});

const handleSubmit = async () => {
  if (!email.value || !password.value) {
    $q.notify({ type: 'warning', message: 'Bitte E-Mail und Passwort eingeben.' });
    return;
  }

  isLoading.value = true;
  try {
    if (isLogin.value) {
      // Benutzer einloggen
      await signInWithEmailAndPassword(auth, email.value, password.value);
      $q.notify({ type: 'positive', message: 'Erfolgreich eingeloggt!', icon: 'login' });
    } else {
      // Neuen Benutzer registrieren
      await createUserWithEmailAndPassword(auth, email.value, password.value);
      $q.notify({ type: 'positive', message: 'Account erstellt & eingeloggt!', icon: 'check_circle' });
    }
    // Nach Erfolg zur Startseite leiten
    void router.push('/');
  } catch (error: unknown) {
    console.error("Auth-Fehler:", error);
    let errorMessage = 'Ein Fehler ist aufgetreten.';

    // Wir prüfen, ob der Fehler ein Objekt mit einer 'code' Eigenschaft ist
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const firebaseError = error as { code: string };
      if (firebaseError.code === 'auth/invalid-credential') errorMessage = 'Falsche E-Mail oder Passwort.';
      if (firebaseError.code === 'auth/email-already-in-use') errorMessage = 'Diese E-Mail wird bereits verwendet.';
      if (firebaseError.code === 'auth/weak-password') errorMessage = 'Das Passwort muss mindestens 6 Zeichen lang sein.';
    }

    $q.notify({ type: 'negative', message: errorMessage });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <q-layout view="lHh Lpr lFf">
    <q-page-container>

      <q-page class="bg-dark-page flex flex-center text-white q-pa-md">
        <q-card class="auth-card bg-dark border-dark shadow-10 q-pa-lg">

          <div class="text-center q-mb-xl">
            <q-avatar size="70px" color="primary" text-color="white" class="shadow-4 q-mb-md">
              <q-icon name="restaurant_menu" size="xl" />
            </q-avatar>
            <h1 class="text-h4 text-weight-bold q-my-none">Culinario</h1>
            <div class="text-grey-5 q-mt-sm">{{ isLogin ? 'Willkommen zurück!' : 'Erstelle deinen Account' }}</div>
          </div>

          <q-form @submit.prevent="handleSubmit" class="q-gutter-y-md">
            <q-input v-model="email" type="email" label="E-Mail Adresse" filled dark class="custom-dark-input"
              hide-bottom-space>
              <template v-slot:prepend><q-icon name="mail" color="grey-5" /></template>
            </q-input>

            <q-input v-model="password" type="password" label="Passwort" filled dark class="custom-dark-input q-mb-lg"
              hide-bottom-space>
              <template v-slot:prepend><q-icon name="lock" color="grey-5" /></template>
            </q-input>

            <q-btn type="submit" color="primary" :label="isLogin ? 'Einloggen' : 'Registrieren'"
              class="full-width text-weight-bold" size="lg" style="border-radius: 12px;" unelevated :loading="isLoading"
              no-caps />
          </q-form>

          <div class="text-center q-mt-lg">
            <q-btn flat no-caps color="grey-5" class="hover-primary" @click="isLogin = !isLogin">
              {{ isLogin ? 'Noch keinen Account? Registrieren' : 'Bereits einen Account? Einloggen' }}
            </q-btn>
          </div>

        </q-card>
      </q-page>

    </q-page-container>
  </q-layout>
</template>

<style scoped>
.bg-dark-page {
  background-color: #121212;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  border-radius: 24px;
}

.border-dark {
  border: 1px solid rgba(255, 255, 255, 0.05);
}

:deep(.custom-dark-input .q-field__control) {
  background-color: #1a1a1a !important;
  border-radius: 12px;
  height: 56px;
}

:deep(.custom-dark-input .q-field__control:before) {
  border-bottom: none !important;
}

.hover-primary:hover {
  color: #66a182 !important;
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
</style>
