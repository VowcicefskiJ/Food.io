# Food.io Mobile App — Full Handoff Package

## Context

You (the user) want a complete, self-contained dump of the Food.io mobile application so you can paste it into a stronger AI and continue development. This document is the handoff.

Everything below is verbatim from the current `claude/ingredient-lookup-app-n47R7` branch — no uncommitted mobile changes exist. The backend contract is included alongside the mobile source because the mobile app is a thin client over the FastAPI backend at `main.py`; a stronger AI cannot meaningfully extend the mobile app without knowing the response shapes it consumes.

**One notable gap** the stronger AI should be aware of: the web frontend calls **8 backend endpoints** (info, image, cooking, authenticity, markets, cultivation, preservation, recipes), but the mobile app currently calls only **4** (info, markets, recipes, meals). The four newest endpoints — image, cooking, authenticity, cultivation, preservation — are backend-ready but have no mobile UI yet. That is the most obvious next mobile task.

**Note on plan mode:** the user asked to put this info "in the food.io branch." Plan mode blocks writes to anything but this plan file, so the intended follow-up after plan approval is to write a copy of this document to `MOBILE_HANDOFF.md` at the repo root on `claude/ingredient-lookup-app-n47R7`, commit, and push.

---

## Repo layout (mobile portion)

```
Food.io/
├── main.py                    (FastAPI backend — mobile talks to this)
├── requirements.txt
├── static/                    (web frontend — reference only for mobile)
└── mobile/
    ├── App.js
    ├── app.json
    ├── babel.config.js
    ├── package.json
    └── src/
        ├── api.js
        ├── theme.js
        └── screens/
            ├── DetailScreen.js
            ├── ExploreScreen.js
            └── PlannerScreen.js
```

No lock file, no `.env`, no assets/images/fonts, no `metro.config.js`, no `eas.json`, no TypeScript, no `expo-router`. Entry point is `App.js` via `"main": "App.js"` in `package.json`.

**Git state:** branch `claude/ingredient-lookup-app-n47R7`, working tree clean for `mobile/`.

---

## Framework + dependencies

- Expo SDK `~51.0.28`
- React Native `0.74.5`
- React `18.2.0`
- Navigation: `@react-navigation/native` `^6.1.18`, `bottom-tabs` `^6.5.20`, `native-stack` `^6.9.26`
- `react-native-screens` `~3.31.1`, `react-native-safe-area-context` `4.10.5`
- `@expo/vector-icons` `^14.0.2` (Ionicons only)
- `expo-status-bar` `~1.12.1`
- Dev: `@babel/core` `^7.24.0`

**Icons used (Ionicons names):** `search`, `search-outline`, `restaurant`, `restaurant-outline`, `chevron-back`, `chevron-down`, `chevron-up`, `checkmark-circle-outline`, `eye-outline`, `time-outline`, `pricetag-outline`, `add`, `checkmark`.

**Fonts:** system serif only — `Platform.select({ ios: 'Georgia', android: 'serif' })`. No custom fonts loaded.

**Inline emoji in text:** `📍`, `⚠`.

---

## Backend contract (what the mobile app consumes)

Base URL (hardcoded in `mobile/src/api.js`):
- iOS Simulator → `http://localhost:8000`
- Android Emulator → `http://10.0.2.2:8000`
- Physical device → `http://<your-computer-lan-ip>:8000`

All requests are `POST` with JSON. Error contract: FastAPI-style `{"detail": "..."}` on 4xx/5xx.

### Endpoints currently called by mobile

| Endpoint | Request | Response shape |
|---|---|---|
| `/ingredient/info` | `{ ingredient, language }` | `{ name, description, origin, nutritional_highlights, history, best_season, selection_tips, storage_tips, fun_fact }` |
| `/ingredient/markets` | `{ ingredient, location, language }` | `{ ingredient, sources: [{ type, description, why_quality, what_to_look_for, typical_availability, price_context }], seasonal_advice, quality_indicators, sourcing_tip }` |
| `/ingredient/recipes` | `{ ingredient, language }` | `{ ingredient, historical_recipes: [{ name, era, period, region, description, historical_context, ingredients_summary, method }], modern_recipes: [{ name, style, description, ingredients_summary, method }] }` |
| `/meals` | `{ ingredients: string[], meal_type: 'breakfast'\|'lunch'\|'dinner', language }` | `{ suggestions: [{ dish, region, description }] }` |

### Endpoints available on backend, not yet wired to mobile

| Endpoint | Request | Response shape |
|---|---|---|
| `/ingredient/image` | `{ ingredient, language }` | `{ image_url: string \| null }` (Wikipedia thumbnail) |
| `/ingredient/cooking` | `{ ingredient, language }` | `{ ingredient, preparation, primary_methods: [{ method, why_it_works, step_by_step, time_and_temp, doneness_cues }], common_mistakes: string[], flavor_pairings, pro_tips }` |
| `/ingredient/authenticity` | `{ ingredient, language }` | `{ ingredient, fraud_risk: 'Low'\|'Medium'\|'High'\|'Very High', fraud_overview, common_fakes: [{ fake_name, how_it_is_faked, how_to_spot_it }], authenticity_checks: string[], trusted_certifications, where_to_buy_authentic, red_flags: string[] }` |
| `/ingredient/cultivation` | `{ ingredient, language }` | `{ ingredient, growability, climate, soil, sunlight_water, propagation, growing_steps: string[], time_to_harvest, harvest_signs, common_pests_diseases, container_friendly }` |
| `/ingredient/preservation` | `{ ingredient, language }` | `{ ingredient, shelf_life: { pantry, refrigerator, freezer }, best_storage, storage_dos_and_donts: string[], preservation_methods: [{ method, how_to, shelf_life, safety_notes }], spoilage_signs, freshness_revival }` |

Backend also has: `GET /health` → `{status: "ok"}`, `GET /` → serves web UI, `GET /.well-known/openai-apps-challenge`. All AI endpoints use `gpt-4.1-mini` via the OpenAI Responses API; `/ingredient/*` (except `/meals` and `/image`) attach the `web_search_preview` tool.

---

## Known quirks / opportunities for the stronger AI

1. **Mobile is behind web by 5 features.** Cooking, authenticity, cultivation, preservation, and the Wikipedia photo are backend-live but have no mobile UI. Adding tabs (or a scrollable segmented control, since 7 tabs is too many for phones) is the highest-value next task.
2. **Language is broken in Explore/Detail.** `PlannerScreen` has a language picker but `ExploreScreen` → `DetailScreen` always requests English. If you add a language picker to Explore or persist a global language preference, all `fetchIngredientInfo`/`fetchMarkets`/`fetchRecipes` calls should pass it through.
3. **`POPULAR` in `ExploreScreen.js` has `'Miso'` duplicated** (lines 10 and 12); de-duped at render via `[...new Set(POPULAR)]`. Harmless but worth cleaning up.
4. **No error retry, no cache, no offline story.** Fetches fire once on `useEffect` mount and errors stick until re-navigation. No `AsyncStorage`, no react-query, no SWR.
5. **Hardcoded `API_BASE_URL`.** No env config; switching between simulator/device requires code edits. An `expo-constants` + `extra` setup or a runtime-configurable settings screen would help.
6. **No native icon / splash image.** `app.json` only sets background colors. iOS/Android builds will use Expo defaults.
7. **No lock file.** First `npm install` will resolve floating versions — for reproducible builds add `package-lock.json` or `yarn.lock`.
8. **No `.gitignore` in `mobile/`.** Root `.gitignore` may cover `node_modules`, but confirm before the receiving AI installs.
9. **No TypeScript.** Everything is plain JS. Backend response types are only informally documented (see the tables above).
10. **Detail tab count.** Currently 3 tabs. Web has 7. On mobile, consider a horizontally-scrollable tab bar or grouping (e.g., Overview / Cook / Source / Grow & Store / Recipes).

---

## Verbatim source files

### `mobile/App.js`

Root component that wires up React Navigation with a bottom-tab layout (Explore stack + Planner) and applies the app's status bar and tab-bar styling.

```javascript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import ExploreScreen from './src/screens/ExploreScreen';
import DetailScreen from './src/screens/DetailScreen';
import PlannerScreen from './src/screens/PlannerScreen';
import { colors } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ExploreStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="ExploreHome" component={ExploreScreen} />
      <Stack.Screen name="Detail" component={DetailScreen} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.green700,
          tabBarInactiveTintColor: colors.text3,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: colors.border,
            borderTopWidth: 1,
            paddingTop: 6,
            height: 60,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '600',
            marginBottom: 6,
          },
          tabBarIcon: ({ focused, color }) => {
            const icons = {
              Explore: focused ? 'search' : 'search-outline',
              Planner: focused ? 'restaurant' : 'restaurant-outline',
            };
            return <Ionicons name={icons[route.name]} size={22} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Explore" component={ExploreStack} />
        <Tab.Screen name="Planner" component={PlannerScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
```

### `mobile/app.json`

Expo app manifest declaring app name/slug/version, bundle identifiers, and splash / adaptive-icon background colors.

```json
{
  "expo": {
    "name": "Food.io",
    "slug": "food-io",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "splash": {
      "backgroundColor": "#1B3B1A"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.foodio.app"
    },
    "android": {
      "adaptiveIcon": {
        "backgroundColor": "#1B3B1A"
      },
      "package": "com.foodio.app"
    }
  }
}
```

### `mobile/babel.config.js`

Standard Expo Babel config that enables `babel-preset-expo` with API cache on.

```javascript
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

### `mobile/package.json`

```json
{
  "name": "food-io",
  "version": "1.0.0",
  "main": "App.js",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios"
  },
  "dependencies": {
    "expo": "~51.0.28",
    "expo-status-bar": "~1.12.1",
    "react": "18.2.0",
    "react-native": "0.74.5",
    "@react-navigation/native": "^6.1.18",
    "@react-navigation/bottom-tabs": "^6.5.20",
    "@react-navigation/native-stack": "^6.9.26",
    "react-native-screens": "~3.31.1",
    "react-native-safe-area-context": "4.10.5",
    "@expo/vector-icons": "^14.0.2"
  },
  "devDependencies": {
    "@babel/core": "^7.24.0"
  },
  "private": true
}
```

### `mobile/src/api.js`

Thin fetch wrapper that POSTs JSON to a hardcoded backend at `http://localhost:8000` and exports four typed helpers.

```javascript
// ─── API Configuration ───────────────────────────────────────────────────────
// iOS Simulator  → http://localhost:8000
// Android Emulator → http://10.0.2.2:8000
// Physical device  → http://<your-computer-lan-ip>:8000
export const API_BASE_URL = 'http://localhost:8000';

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

export const fetchMarkets = (ingredient, location, language = 'English') =>
  post('/ingredient/markets', { ingredient, location: location || null, language });

export const fetchRecipes = (ingredient, language = 'English') =>
  post('/ingredient/recipes', { ingredient, language });

export const fetchMeals = (ingredients, meal_type, language = 'English') =>
  post('/meals', { ingredients, meal_type, language });
```

### `mobile/src/theme.js`

Central design tokens — colors, platform-selected serif, three shadow presets.

```javascript
import { Platform } from 'react-native';

export const colors = {
  green950: '#0D1F0D',
  green800: '#1B3B1A',
  green700: '#2E6B28',
  green600: '#3D8035',
  green500: '#4E9342',
  green200: '#B6D4B0',
  green100: '#D5ECD0',
  green50:  '#EBF5E8',
  amber:    '#C4962A',
  amberBg:  '#FDF6E3',
  terra:    '#B85C38',
  terraBg:  '#FAE8DF',
  bg:       '#F6F3EE',
  surface:  '#FFFFFF',
  text:     '#191917',
  text2:    '#48453E',
  text3:    '#807C74',
  border:   '#E2DDD4',
};

export const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });

export const shadow = {
  sm: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10 },
    android: { elevation: 3 },
    default: {},
  }),
  md: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.12, shadowRadius: 20 },
    android: { elevation: 6 },
    default: {},
  }),
  lg: Platform.select({
    ios:     { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 28 },
    android: { elevation: 12 },
    default: {},
  }),
};
```

### `mobile/src/screens/ExploreScreen.js`

Landing screen: hero banner, ingredient/location search form, chip grid of popular ingredients navigating to `Detail`.

```javascript
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, serif, shadow } from '../theme';

const POPULAR = [
  'Turmeric', 'Miso', 'Saffron', 'Ginger',
  'Farro', 'Sumac', 'Cardamom', 'Preserved Lemon',
  'Miso', 'Tamarind', 'Shiso', 'Za\'atar',
];

export default function ExploreScreen({ navigation }) {
  const [ingredient, setIngredient] = useState('');
  const [location, setLocation] = useState('');

  function go() {
    const val = ingredient.trim();
    if (!val) return;
    navigation.navigate('Detail', { ingredient: val, location: location.trim() });
  }

  function quickSearch(name) {
    navigation.navigate('Detail', { ingredient: name, location: '' });
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── Hero ── */}
            <View style={styles.hero}>
              <Text style={styles.logo}>Food.io</Text>
              <Text style={styles.heroTitle}>
                From Ancient{'\n'}Recipes to{'\n'}Local Farms
              </Text>
              <Text style={styles.heroSub}>
                Search any ingredient — discover where to source it fresh and explore centuries of recipes.
              </Text>
            </View>

            {/* ── Search Card ── */}
            <View style={[styles.card, shadow.lg]}>
              <Text style={styles.cardTitle}>Find an Ingredient</Text>
              <Text style={styles.cardSub}>Sourcing tips · History · Recipes</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Ingredient</Text>
                <TextInput
                  style={styles.input}
                  value={ingredient}
                  onChangeText={setIngredient}
                  placeholder="e.g. turmeric, miso, saffron…"
                  placeholderTextColor={colors.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Location{'  '}
                  <Text style={styles.optional}>(optional)</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={location}
                  onChangeText={setLocation}
                  placeholder="City or neighborhood…"
                  placeholderTextColor={colors.text3}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={go}
                />
              </View>

              <TouchableOpacity style={styles.btn} onPress={go} activeOpacity={0.85}>
                <Text style={styles.btnText}>Explore Ingredient  →</Text>
              </TouchableOpacity>
            </View>

            {/* ── Popular Searches ── */}
            <View style={styles.popular}>
              <Text style={styles.popularLabel}>Popular</Text>
              <View style={styles.chips}>
                {[...new Set(POPULAR)].map((name) => (
                  <TouchableOpacity
                    key={name}
                    style={styles.chip}
                    onPress={() => quickSearch(name)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.chipText}>{name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.green800 },
  scroll: { paddingBottom: 40 },

  hero: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 36 },
  logo: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '700',
    fontFamily: serif,
    marginBottom: 28,
    opacity: 0.9,
  },
  heroTitle: {
    color: '#FFF',
    fontSize: 40,
    fontWeight: '700',
    fontFamily: serif,
    lineHeight: 48,
    marginBottom: 14,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 15,
    lineHeight: 24,
  },

  card: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.text,
    marginBottom: 3,
  },
  cardSub: { fontSize: 13, color: colors.text3, marginBottom: 24 },

  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text2, marginBottom: 8 },
  optional: { fontWeight: '400', color: colors.text3 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
  },

  btn: {
    backgroundColor: colors.green700,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  btnText: { color: '#FFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  popular: { paddingHorizontal: 24, paddingTop: 32 },
  popularLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.45)',
    marginBottom: 14,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  chipText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
});
```

### `mobile/src/screens/DetailScreen.js`

Ingredient detail view with three tabs (Overview, Find It / Markets, Recipes). Fetches `fetchIngredientInfo`, `fetchMarkets`, `fetchRecipes` in parallel on mount.

```javascript
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchIngredientInfo, fetchMarkets, fetchRecipes } from '../api';
import { colors, serif } from '../theme';

const TABS = ['Overview', 'Find It', 'Recipes'];

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function DetailScreen({ route, navigation }) {
  const { ingredient, location } = route.params;
  const [activeTab, setActiveTab] = useState(0);

  const [info, setInfo]         = useState(null);
  const [infoErr, setInfoErr]   = useState(null);
  const [markets, setMarkets]   = useState(null);
  const [mktErr, setMktErr]     = useState(null);
  const [recipes, setRecipes]   = useState(null);
  const [recErr, setRecErr]     = useState(null);

  useEffect(() => {
    fetchIngredientInfo(ingredient).then(setInfo).catch(e => setInfoErr(e.message));
    fetchMarkets(ingredient, location || null).then(setMarkets).catch(e => setMktErr(e.message));
    fetchRecipes(ingredient).then(setRecipes).catch(e => setRecErr(e.message));
  }, []);

  const title = ingredient.charAt(0).toUpperCase() + ingredient.slice(1);

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={26} color={colors.green800} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            {location ? (
              <Text style={styles.headerSub} numberOfLines={1}>📍 {location}</Text>
            ) : null}
          </View>
        </View>

        {/* ── Tab Bar ── */}
        <View style={styles.tabBar}>
          {TABS.map((tab, i) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabItem, activeTab === i && styles.tabItemActive]}
              onPress={() => setActiveTab(i)}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Tab Content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {activeTab === 0 && <OverviewTab data={info} error={infoErr} />}
          {activeTab === 1 && <MarketsTab  data={markets} error={mktErr} />}
          {activeTab === 2 && <RecipesTab  data={recipes} error={recErr} />}
        </ScrollView>

      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function Loader({ label = 'Loading…' }) {
  return (
    <View style={sh.loader}>
      <ActivityIndicator color={colors.green600} size="large" />
      <Text style={sh.loaderText}>{label}</Text>
    </View>
  );
}

function ErrCard({ msg }) {
  return (
    <View style={sh.errCard}>
      <Text style={sh.errText}>⚠  {msg}</Text>
    </View>
  );
}

function Card({ style, children }) {
  return <View style={[sh.card, style]}>{children}</View>;
}

function CardLabel({ children, color }) {
  return <Text style={[sh.cardLabel, color && { color }]}>{children}</Text>;
}

function CardBody({ children, style }) {
  return <Text style={[sh.cardBody, style]}>{children}</Text>;
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Loading ingredient info…" />;

  return (
    <View style={{ gap: 12 }}>
      {/* Hero card — about */}
      <Card style={sh.cardDark}>
        <CardLabel color={colors.green200}>About</CardLabel>
        <CardBody style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, lineHeight: 24 }}>
          {data.description}
        </CardBody>
      </Card>

      {/* Origin + History */}
      <Card>
        <CardLabel>Origin &amp; History</CardLabel>
        <Text style={sh.cardBig}>{data.origin || '—'}</Text>
        <CardBody>{data.history}</CardBody>
      </Card>

      {/* Nutrition */}
      <Card>
        <CardLabel>Nutrition Highlights</CardLabel>
        <CardBody>{data.nutritional_highlights}</CardBody>
      </Card>

      {/* Season + Storage — side by side */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <CardLabel>Best Season</CardLabel>
          <Text style={[sh.cardBig, { fontSize: 16 }]}>{data.best_season || '—'}</Text>
          <CardBody>{data.selection_tips}</CardBody>
        </Card>
        <Card style={{ flex: 1 }}>
          <CardLabel>Storage</CardLabel>
          <CardBody>{data.storage_tips}</CardBody>
        </Card>
      </View>

      {/* Fun fact */}
      {data.fun_fact ? (
        <Card style={sh.cardAmber}>
          <CardLabel color={colors.amber}>Did You Know?</CardLabel>
          <CardBody style={{ color: colors.text }}>{data.fun_fact}</CardBody>
        </Card>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MARKETS TAB
// ─────────────────────────────────────────────────────────────────────────────

function MarketsTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Finding the best local sources…" />;

  return (
    <View style={{ gap: 12 }}>
      {(data.sources || []).map((s, i) => (
        <Card key={i}>
          <View style={sh.marketBadge}>
            <Text style={sh.marketBadgeText}>{s.type}</Text>
          </View>
          <Text style={sh.marketTitle}>{s.type}</Text>
          <Text style={sh.marketDesc}>{s.description}</Text>

          {s.why_quality && (
            <MarketRow icon="checkmark-circle-outline" label="Why quality" text={s.why_quality} />
          )}
          {s.what_to_look_for && (
            <MarketRow icon="eye-outline" label="Look for" text={s.what_to_look_for} />
          )}
          {s.typical_availability && (
            <MarketRow icon="time-outline" label="When" text={s.typical_availability} />
          )}
          {s.price_context && (
            <MarketRow icon="pricetag-outline" label="Price" text={s.price_context} />
          )}
        </Card>
      ))}

      {data.seasonal_advice    && <InsightStrip label="Seasonal Advice"      body={data.seasonal_advice} />}
      {data.quality_indicators && <InsightStrip label="Quality Indicators"   body={data.quality_indicators} />}
      {data.sourcing_tip       && <InsightStrip label="Insider Tip"          body={data.sourcing_tip} />}
    </View>
  );
}

function MarketRow({ icon, label, text }) {
  return (
    <View style={sh.marketRow}>
      <Ionicons name={icon} size={15} color={colors.text3} style={{ marginTop: 2 }} />
      <Text style={sh.marketRowText}>
        <Text style={sh.marketRowLabel}>{label}:{'  '}</Text>
        {text}
      </Text>
    </View>
  );
}

function InsightStrip({ label, body }) {
  return (
    <Card style={sh.insightCard}>
      <CardLabel color={colors.terra}>{label}</CardLabel>
      <CardBody>{body}</CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECIPES TAB
// ─────────────────────────────────────────────────────────────────────────────

function RecipesTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Searching through centuries of history…" />;

  return (
    <View>
      <EraHeading label="Through History" />
      {(data.historical_recipes || []).map((r, i) => (
        <RecipeCard key={`h${i}`} recipe={r} historical />
      ))}

      <EraHeading label="Modern Interpretations" style={{ marginTop: 24 }} />
      {(data.modern_recipes || []).map((r, i) => (
        <RecipeCard key={`m${i}`} recipe={r} historical={false} />
      ))}
    </View>
  );
}

function EraHeading({ label, style }) {
  return (
    <View style={[sh.eraRow, style]}>
      <Text style={sh.eraLabel}>{label}</Text>
      <View style={sh.eraLine} />
    </View>
  );
}

function RecipeCard({ recipe, historical }) {
  const [open, setOpen] = useState(false);

  return (
    <View style={sh.recipeCard}>
      <TouchableOpacity
        style={sh.recipeHeader}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.8}
      >
        <View style={{ flex: 1 }}>
          <View style={[sh.eraPill, historical ? sh.eraPillGreen : sh.eraPillTerra]}>
            <Text style={sh.eraPillText}>
              {historical ? (recipe.era || 'Historical') : (recipe.style || 'Modern')}
            </Text>
          </View>
          <Text style={sh.recipeName}>{recipe.name}</Text>
          {recipe.region ? (
            <Text style={sh.recipeRegion}>📍 {recipe.region}</Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          {recipe.period ? (
            <View style={sh.periodBadge}>
              <Text style={sh.periodText}>{recipe.period}</Text>
            </View>
          ) : null}
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.text3}
          />
        </View>
      </TouchableOpacity>

      {open && (
        <View style={sh.recipeBody}>
          {recipe.description ? (
            <Text style={sh.recipeDesc}>{recipe.description}</Text>
          ) : null}
          {recipe.historical_context ? (
            <View style={sh.contextBox}>
              <Text style={sh.contextText}>{recipe.historical_context}</Text>
            </View>
          ) : null}
          {recipe.ingredients_summary ? (
            <RecipeSection label="Ingredients" text={recipe.ingredients_summary} />
          ) : null}
          {recipe.method ? (
            <RecipeSection label="Method" text={recipe.method} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function RecipeSection({ label, text }) {
  return (
    <View style={sh.recipeSection}>
      <Text style={sh.recipeSectionLabel}>{label}</Text>
      <View style={sh.recipeSectionBox}>
        <Text style={sh.recipeSectionText}>{text}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 2, marginRight: 6 },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: serif,
    color: colors.text,
    textTransform: 'capitalize',
  },
  headerSub: { fontSize: 13, color: colors.text3, marginTop: 1 },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 13,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: colors.green600 },
  tabText: { fontSize: 13, fontWeight: '500', color: colors.text3 },
  tabTextActive: { color: colors.green700, fontWeight: '700' },

  content: { padding: 14, paddingBottom: 48 },
});

// Shared card styles used across all tabs
const sh = StyleSheet.create({
  loader: { alignItems: 'center', paddingVertical: 60, gap: 16 },
  loaderText: { fontSize: 14, color: colors.text3 },

  errCard: { backgroundColor: colors.terraBg, borderRadius: 14, padding: 18 },
  errText: { color: colors.terra, fontSize: 14, lineHeight: 22 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardDark: { backgroundColor: colors.green800, borderColor: 'transparent' },
  cardAmber: {
    backgroundColor: colors.amberBg,
    borderColor: 'rgba(196,150,42,0.2)',
    borderLeftWidth: 4,
    borderLeftColor: colors.amber,
  },

  cardLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.text3,
    marginBottom: 8,
  },
  cardBig: {
    fontFamily: serif,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  cardBody: { fontSize: 14, color: colors.text2, lineHeight: 22 },

  // Markets
  marketBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.green50,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.green100,
  },
  marketBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.green700,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  marketTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  marketDesc: { fontSize: 14, color: colors.text2, lineHeight: 21, marginBottom: 8 },
  marketRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 9,
    marginTop: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  marketRowText: { flex: 1, fontSize: 13, color: colors.text3, lineHeight: 20 },
  marketRowLabel: { fontWeight: '600', color: colors.text2 },

  insightCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.terra,
    borderColor: 'rgba(184,92,56,0.15)',
    backgroundColor: colors.terraBg,
  },

  // Recipes
  eraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    marginTop: 8,
  },
  eraLabel: { fontFamily: serif, fontSize: 20, fontWeight: '700', color: colors.text },
  eraLine: { flex: 1, height: 1, backgroundColor: colors.border },

  recipeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  recipeHeader: { flexDirection: 'row', padding: 16, gap: 12 },

  eraPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 100,
    marginBottom: 8,
  },
  eraPillGreen: { backgroundColor: colors.green800 },
  eraPillTerra: { backgroundColor: colors.terra },
  eraPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  recipeName: { fontSize: 17, fontWeight: '700', fontFamily: serif, color: colors.text },
  recipeRegion: { fontSize: 13, color: colors.text3, marginTop: 4 },

  periodBadge: {
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderColor: colors.green100,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  periodText: { fontSize: 12, fontWeight: '700', color: colors.green700 },

  recipeBody: {
    padding: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recipeDesc: { fontSize: 14, color: colors.text2, lineHeight: 22, marginBottom: 12 },
  contextBox: {
    backgroundColor: colors.green50,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.green100,
  },
  contextText: { fontSize: 13, color: colors.green800, fontStyle: 'italic', lineHeight: 20 },

  recipeSection: { marginTop: 12 },
  recipeSectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.text3,
    marginBottom: 7,
  },
  recipeSectionBox: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recipeSectionText: { fontSize: 14, color: colors.text2, lineHeight: 22 },
});
```

### `mobile/src/screens/PlannerScreen.js`

Meal-planner tab: tag ingredients, pick meal type + language, POST to `/meals`, render suggestion cards; bottom-sheet language picker.

```javascript
import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fetchMeals } from '../api';
import { colors, serif, shadow } from '../theme';

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const LANGUAGES  = [
  'English', 'Spanish', 'French', 'Japanese',
  'Chinese', 'Arabic',  'Italian', 'Portuguese', 'Korean',
];

export default function PlannerScreen() {
  const [tags, setTags]           = useState([]);
  const [inputVal, setInputVal]   = useState('');
  const [mealType, setMealType]   = useState('dinner');
  const [language, setLanguage]   = useState('English');
  const [langModal, setLangModal] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [results, setResults]     = useState(null);
  const [error, setError]         = useState(null);

  function addTag() {
    const val = inputVal.trim();
    if (val && !tags.includes(val)) setTags(t => [...t, val]);
    setInputVal('');
  }

  function removeTag(i) {
    setTags(t => t.filter((_, idx) => idx !== i));
  }

  async function plan() {
    if (!tags.length) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const data = await fetchMeals(tags, mealType, language);
      setResults(data.suggestions || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>Traditional Cooking</Text>
            <Text style={styles.title}>Meal Planner</Text>
            <Text style={styles.subtitle}>
              Add ingredients you have — we'll suggest authentic dishes from around the world.
            </Text>
          </View>

          {/* ── Planner Card ── */}
          <View style={[styles.card, shadow.sm]}>

            {/* Ingredient input */}
            <View style={styles.field}>
              <Text style={styles.label}>Ingredients you have</Text>

              {tags.length > 0 && (
                <View style={styles.tagList}>
                  {tags.map((t, i) => (
                    <View key={i} style={styles.tag}>
                      <Text style={styles.tagText}>{t}</Text>
                      <TouchableOpacity
                        onPress={() => removeTag(i)}
                        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                      >
                        <Text style={styles.tagX}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={inputVal}
                  onChangeText={setInputVal}
                  placeholder="Type an ingredient…"
                  placeholderTextColor={colors.text3}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={addTag}
                />
                <TouchableOpacity style={styles.addBtn} onPress={addTag} activeOpacity={0.8}>
                  <Ionicons name="add" size={20} color={colors.green700} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Meal Type — segmented */}
            <View style={styles.field}>
              <Text style={styles.label}>Meal Type</Text>
              <View style={styles.segmented}>
                {MEAL_TYPES.map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.segment, mealType === type && styles.segmentActive]}
                    onPress={() => setMealType(type)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.segmentText, mealType === type && styles.segmentTextActive]}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Language picker */}
            <View style={styles.field}>
              <Text style={styles.label}>Language</Text>
              <TouchableOpacity
                style={styles.langBtn}
                onPress={() => setLangModal(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.langBtnText}>{language}</Text>
                <Ionicons name="chevron-down" size={18} color={colors.text3} />
              </TouchableOpacity>
            </View>

            {/* Submit */}
            <TouchableOpacity
              style={[styles.submitBtn, (!tags.length || loading) && styles.submitBtnDisabled]}
              onPress={plan}
              disabled={!tags.length || loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#FFF" />
                : <Text style={styles.submitBtnText}>Get Meal Suggestions  →</Text>
              }
            </TouchableOpacity>
          </View>

          {/* ── Error ── */}
          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>⚠  {error}</Text>
            </View>
          ) : null}

          {/* ── Results ── */}
          {results ? (
            <View style={{ marginTop: 28, gap: 12 }}>
              <Text style={styles.resultsCount}>{results.length} suggestions</Text>
              {results.map((meal, i) => (
                <View key={i} style={[styles.mealCard, shadow.sm]}>
                  <View style={styles.regionBadge}>
                    <Text style={styles.regionText}>{meal.region}</Text>
                  </View>
                  <Text style={styles.mealName}>{meal.dish}</Text>
                  <Text style={styles.mealDesc}>{meal.description}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      {/* ── Language Modal ── */}
      <Modal
        visible={langModal}
        transparent
        animationType="slide"
        onRequestClose={() => setLangModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setLangModal(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Language</Text>
            {LANGUAGES.map(l => (
              <TouchableOpacity
                key={l}
                style={[styles.modalOption, l === language && styles.modalOptionActive]}
                onPress={() => { setLanguage(l); setLangModal(false); }}
              >
                <Text style={[styles.modalOptionText, l === language && styles.modalOptionTextActive]}>
                  {l}
                </Text>
                {l === language && (
                  <Ionicons name="checkmark" size={18} color={colors.green700} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },

  header: { marginBottom: 20 },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.green600,
    marginBottom: 8,
  },
  title: { fontFamily: serif, fontSize: 32, fontWeight: '700', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: colors.text3, lineHeight: 23 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
  },

  field: { marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text2, marginBottom: 9 },

  tagList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.green700,
    paddingLeft: 12,
    paddingRight: 9,
    paddingVertical: 7,
    borderRadius: 8,
  },
  tagText: { color: '#FFF', fontSize: 13, fontWeight: '500' },
  tagX: { color: 'rgba(255,255,255,0.75)', fontSize: 20, lineHeight: 20 },

  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.green200,
    backgroundColor: colors.green50,
    alignItems: 'center',
    justifyContent: 'center',
  },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  segmentActive: { backgroundColor: colors.green700 },
  segmentText: { fontSize: 14, fontWeight: '500', color: colors.text3 },
  segmentTextActive: { color: '#FFF', fontWeight: '700' },

  langBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: colors.bg,
  },
  langBtnText: { fontSize: 15, color: colors.text, fontWeight: '500' },

  submitBtn: {
    backgroundColor: colors.green700,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },

  errorCard: {
    backgroundColor: colors.terraBg,
    borderRadius: 14,
    padding: 16,
    marginTop: 16,
  },
  errorText: { color: colors.terra, fontSize: 14, lineHeight: 22 },

  resultsCount: { fontSize: 13, fontWeight: '600', color: colors.text3 },
  mealCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  regionBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.terraBg,
    borderWidth: 1,
    borderColor: 'rgba(184,92,56,0.18)',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 10,
  },
  regionText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.terra,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  mealName: { fontFamily: serif, fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 6 },
  mealDesc: { fontSize: 14, color: colors.text2, lineHeight: 22 },

  // Language modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingTop: 12,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 20 },
      android: { elevation: 16 },
    }),
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 100,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: serif,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  modalOptionActive: { backgroundColor: colors.green50 },
  modalOptionText: { fontSize: 16, color: colors.text2 },
  modalOptionTextActive: { color: colors.green700, fontWeight: '600' },
});
```

---

## How to run

**Backend (from repo root):**
```bash
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Mobile:**
```bash
cd mobile
npm install
npx expo start
```
Then press `i` for iOS Simulator, `a` for Android emulator, or scan the QR code with Expo Go on a physical device.

- iOS Simulator uses `http://localhost:8000` (already the default in `api.js`)
- Android Emulator needs `http://10.0.2.2:8000` — edit `API_BASE_URL` in `mobile/src/api.js`
- Physical device needs `http://<your-computer-lan-ip>:8000` — same file

---

## Verification checklist for the receiving AI

1. Run backend + mobile per above.
2. Open Explore, tap a popular chip (e.g. "Turmeric"). Detail screen should show three tabs, each loading independently, no errors.
3. Try an obscure ingredient with no Wikipedia page (once image endpoint is wired): image slot should hide gracefully.
4. Open Planner, add 2-3 ingredients, pick dinner, change language to Spanish → results should return Spanish text.
5. Test empty ingredient → button should stay disabled.
6. Kill backend mid-fetch → error card should render, not crash.

---

## Next-step suggestion (for the receiving AI)

Mirror the web's 5 new backend features in the mobile Detail screen. Concrete slice:

1. Add 4 helpers to `mobile/src/api.js`: `fetchImage`, `fetchCooking`, `fetchAuthenticity`, `fetchCultivation`, `fetchPreservation` — copy the pattern of `fetchIngredientInfo`.
2. In `DetailScreen.js`, expand `TABS` to something like `['Overview', 'Cook', 'Real?', 'Find', 'Grow', 'Store', 'Recipes']` and switch the tab bar to a horizontal `ScrollView` (`horizontal`, `showsHorizontalScrollIndicator={false}`).
3. Add a `<HeroImage />` component at the top of `OverviewTab` that shows the Wikipedia thumbnail returned from `/ingredient/image`, hiding gracefully on `null`.
4. Add `CookingTab`, `AuthenticityTab`, `CultivationTab`, `PreservationTab` components that render the response shapes documented above, following the existing `Card` / `CardLabel` / `CardBody` primitives and color palette.
5. Fire all 8 fetches in parallel from a single `useEffect` in `DetailScreen`.

---

## Post-approval action

After `ExitPlanMode` is approved, copy this document to `MOBILE_HANDOFF.md` at the repo root on branch `claude/ingredient-lookup-app-n47R7`, commit as `Add mobile app handoff doc for external AI review`, and push. That is what fulfills the user's "put it in the food.io branch" instruction.
