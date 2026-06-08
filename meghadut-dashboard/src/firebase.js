import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCpvnp7AiWnmo6V0J7CgejR4vxQtJScUIE",
  authDomain: "meghadut.firebaseapp.com",
  databaseURL: "https://meghadut-default-rtdb.firebaseio.com",
  projectId: "meghadut",
  storageBucket: "meghadut.firebasestorage.app",
  messagingSenderId: "745982328098",
  appId: "1:745982328098:web:eef09d95c46604524d397b"
};
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
