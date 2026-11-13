import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmpowlkzQ0pwJCxGAB1nwIElzJ2U2dLRw",
  authDomain: "johanne-and-cie.firebaseapp.com",
  projectId: "johanne-and-cie",
  storageBucket: "johanne-and-cie.firebasestorage.app",
  messagingSenderId: "602743020099",
  appId: "1:602743020099:web:45e12828f32b5e8a0152f6"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Session conservée dans le navigateur (survit à la fermeture de l'onglet / du navigateur)
export const authReady = setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Persistance de session indisponible :", err);
});
