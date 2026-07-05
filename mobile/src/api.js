import { Platform } from 'react-native';

// ─── API Configuration ───────────────────────────────────────────────────────
// iOS Simulator    → http://localhost:8000
// Android Emulator → http://10.0.2.2:8000  (auto-selected below)
// Physical device  → set to http://<your-computer-lan-ip>:8000
export const API_BASE_URL = Platform.select({
  android: 'http://10.0.2.2:8000',
  default: 'http://localhost:8000',
});

async function post(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `Server error ${res.status}`);
  return data;
}

export const fetchIngredientInfo = (ingredient, language = 'English') =>
  post('/ingredient/info', { ingredient, language });

export const fetchImage = (ingredient) =>
  post('/ingredient/image', { ingredient, language: 'English' });

export const fetchCooking = (ingredient, language = 'English') =>
  post('/ingredient/cooking', { ingredient, language });

export const fetchAuthenticity = (ingredient, language = 'English') =>
  post('/ingredient/authenticity', { ingredient, language });

export const fetchCultivation = (ingredient, language = 'English') =>
  post('/ingredient/cultivation', { ingredient, language });

export const fetchPreservation = (ingredient, language = 'English') =>
  post('/ingredient/preservation', { ingredient, language });

export const fetchMarkets = (ingredient, location, language = 'English') =>
  post('/ingredient/markets', { ingredient, location: location || null, language });

export const fetchRecipes = (ingredient, language = 'English') =>
  post('/ingredient/recipes', { ingredient, language });

export const fetchMeals = (ingredients, meal_type, language = 'English') =>
  post('/meals', { ingredients, meal_type, language });
