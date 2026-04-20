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
