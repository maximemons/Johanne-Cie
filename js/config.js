// Configuration du site : Firebase + EmailJS (notifications de commande à l'atelier)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyAmpowlkzQ0pwJCxGAB1nwIElzJ2U2dLRw",
  authDomain: "johanne-and-cie.firebaseapp.com",
  projectId: "johanne-and-cie",
  storageBucket: "johanne-and-cie.firebasestorage.app",
  messagingSenderId: "602743020099",
  appId: "1:602743020099:web:45e12828f32b5e8a0152f6"
};

// ---------- EmailJS (https://dashboard.emailjs.com) ----------
// 1. Account → General : copiez la « Public Key ».
// 2. Email Services : connectez votre messagerie, copiez le « Service ID ».
// 3. Email Templates : créez un modèle (voir README), copiez son « Template ID ».
//    Un même modèle peut servir aux deux événements (la variable {{evenement}} les distingue).
// 4. Account → Security : ajoutez le domaine du site dans les domaines autorisés.
// Tant que publicKey est vide, aucun e-mail n'est envoyé (la commande, elle, est bien enregistrée).
export const EMAILJS = {
  publicKey: "",                       // ex. "AbCdEf123456789"
  serviceId: "",                       // ex. "service_xxxxxxx"
  templateCommandePassee: "",          // ex. "template_xxxxxxx"
  templateCommandeAnnulee: "",         // vide = même modèle que templateCommandePassee
  destinataire: "pro.maxime.mons@gmail.com" // adresse qui reçoit les notifications ({{to_email}} dans le modèle)
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// Session conservée dans le navigateur (survit à la fermeture de l'onglet / du navigateur)
export const authReady = setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Persistance de session indisponible :", err);
});
