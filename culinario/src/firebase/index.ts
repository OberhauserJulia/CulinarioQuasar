// src/firebase/index.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// DEINE Firebase Konfiguration (aus der Firebase Console kopieren)
const firebaseConfig = {
  apiKey: "AIzaSyCmRpBspsdnqbbgP30i2GV99y3d4rdrdbo",
  authDomain: "culinariorecipeapp.firebaseapp.com",
  projectId: "culinariorecipeapp",
  storageBucket: "culinariorecipeapp.firebasestorage.app",
  messagingSenderId: "1048920261192",
  appId: "1:1048920261192:web:ed3a053bf60523b8878e7d",
  measurementId: "G-PELJH97HJT"
};


// Firebase initialisieren
const app = initializeApp(firebaseConfig);

// Firestore Datenbank referenzieren und exportieren
const db = getFirestore(app);

export { db };
