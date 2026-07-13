import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchIngredientInfo, fetchImage, fetchCooking, fetchAuthenticity,
  fetchCultivation, fetchPreservation, fetchMarkets, fetchRecipes,
} from '../api';
import { colors, serif } from '../theme';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'leaf-outline' },
  { key: 'cooking',  label: 'Cook',     icon: 'flame-outline' },
  { key: 'real',     label: 'Real?',    icon: 'shield-checkmark-outline' },
  { key: 'find',     label: 'Find',     icon: 'location-outline' },
  { key: 'grow',     label: 'Grow',     icon: 'flower-outline' },
  { key: 'store',    label: 'Store',    icon: 'archive-outline' },
  { key: 'recipes',  label: 'Recipes',  icon: 'book-outline' },
];

// The AI occasionally returns a field as a string (or object) where we expect a
// list. asArr() guarantees an array so a tab never crashes on an odd shape:
// arrays pass through, a lone value is wrapped, empty/missing becomes [].
function asArr(x) {
  if (Array.isArray(x)) return x;
  if (x === null || x === undefined || x === '') return [];
  return [x];
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN
// ─────────────────────────────────────────────────────────────────────────────

export default function DetailScreen({ route, navigation }) {
  const { ingredient, location } = route.params;
  const [activeTab, setActiveTab] = useState('overview');

  const [info, setInfo]           = useState(null);
  const [infoErr, setInfoErr]     = useState(null);
  const [imageUrl, setImageUrl]   = useState(null);
  const [cooking, setCooking]     = useState(null);
  const [cookErr, setCookErr]     = useState(null);
  const [authent, setAuthent]     = useState(null);
  const [authErr, setAuthErr]     = useState(null);
  const [markets, setMarkets]     = useState(null);
  const [mktErr, setMktErr]       = useState(null);
  const [growing, setGrowing]     = useState(null);
  const [growErr, setGrowErr]     = useState(null);
  const [preserve, setPreserve]   = useState(null);
  const [presErr, setPresErr]     = useState(null);
  const [recipes, setRecipes]     = useState(null);
  const [recErr, setRecErr]       = useState(null);

  useEffect(() => {
    fetchIngredientInfo(ingredient).then(setInfo).catch(e => setInfoErr(e.message));
    fetchImage(ingredient).then(d => setImageUrl(d.image_url)).catch(() => {});
    fetchCooking(ingredient).then(setCooking).catch(e => setCookErr(e.message));
    fetchAuthenticity(ingredient).then(setAuthent).catch(e => setAuthErr(e.message));
    fetchMarkets(ingredient, location || null).then(setMarkets).catch(e => setMktErr(e.message));
    fetchCultivation(ingredient).then(setGrowing).catch(e => setGrowErr(e.message));
    fetchPreservation(ingredient).then(setPreserve).catch(e => setPresErr(e.message));
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

        {/* ── Tab Bar (horizontally scrollable) ── */}
        <View style={styles.tabBarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBar}
          >
            {TABS.map(tab => {
              const active = activeTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tabItem, active && styles.tabItemActive]}
                  onPress={() => setActiveTab(tab.key)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={tab.icon}
                    size={15}
                    color={active ? colors.green700 : colors.text3}
                  />
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Tab Content ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {activeTab === 'overview' && <OverviewTab data={info} error={infoErr} imageUrl={imageUrl} />}
          {activeTab === 'cooking'  && <CookingTab data={cooking} error={cookErr} />}
          {activeTab === 'real'     && <AuthenticityTab data={authent} error={authErr} />}
          {activeTab === 'find'     && <MarketsTab data={markets} error={mktErr} />}
          {activeTab === 'grow'     && <CultivationTab data={growing} error={growErr} />}
          {activeTab === 'store'    && <PreservationTab data={preserve} error={presErr} />}
          {activeTab === 'recipes'  && <RecipesTab data={recipes} error={recErr} />}
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

function InsightStrip({ label, body, warn, children }) {
  return (
    <Card style={warn ? sh.warnCard : sh.insightCard}>
      <CardLabel color={warn ? colors.terra : colors.green700}>{label}</CardLabel>
      {body ? <CardBody>{body}</CardBody> : null}
      {children}
    </Card>
  );
}

function BulletList({ items }) {
  return (
    <View style={{ gap: 7, marginTop: 2 }}>
      {asArr(items).map((item, i) => (
        <View key={i} style={sh.bulletRow}>
          <Text style={sh.bulletDot}>•</Text>
          <Text style={sh.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function StepList({ steps }) {
  steps = asArr(steps);
  return (
    <View style={{ gap: 10, marginTop: 4 }}>
      {steps.map((step, i) => (
        <View key={i} style={sh.stepRow}>
          <View style={sh.stepNum}>
            <Text style={sh.stepNumText}>{i + 1}</Text>
          </View>
          <Text style={sh.stepText}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionBox({ label, text }) {
  return (
    <View style={sh.recipeSection}>
      <Text style={sh.recipeSectionLabel}>{label}</Text>
      <View style={sh.recipeSectionBox}>
        <Text style={sh.recipeSectionText}>{text}</Text>
      </View>
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

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({ data, error, imageUrl }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Loading ingredient info…" />;

  return (
    <View style={{ gap: 12 }}>
      {/* Hero photo (Wikipedia) */}
      {imageUrl && !imgFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={sh.heroImage}
          resizeMode="cover"
          onError={() => setImgFailed(true)}
        />
      ) : null}

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
// COOKING TAB
// ─────────────────────────────────────────────────────────────────────────────

function CookingTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Studying how to cook it right…" />;

  return (
    <View style={{ gap: 12 }}>
      {data.preparation ? (
        <InsightStrip label="Preparation" body={data.preparation} />
      ) : null}

      <EraHeading label="Cooking Methods" />
      {asArr(data.primary_methods).map((m, i) => (
        <Card key={i}>
          <View style={sh.methodHead}>
            <View style={sh.methodPill}>
              <Text style={sh.methodPillText}>{m.method}</Text>
            </View>
            {m.time_and_temp ? (
              <Text style={sh.methodTemp}>🕒 {m.time_and_temp}</Text>
            ) : null}
          </View>
          {m.why_it_works ? (
            <CardBody style={{ marginBottom: 10 }}>
              <Text style={sh.boldLabel}>Why it works:  </Text>
              {m.why_it_works}
            </CardBody>
          ) : null}
          {m.step_by_step ? <SectionBox label="Steps" text={m.step_by_step} /> : null}
          {m.doneness_cues ? <SectionBox label="Doneness Cues" text={m.doneness_cues} /> : null}
        </Card>
      ))}

      {asArr(data.common_mistakes).length > 0 ? (
        <InsightStrip label="Common Mistakes to Avoid" warn>
          <BulletList items={data.common_mistakes} />
        </InsightStrip>
      ) : null}

      {data.flavor_pairings ? (
        <InsightStrip label="Flavor Pairings" body={data.flavor_pairings} />
      ) : null}

      {data.pro_tips ? (
        <Card style={sh.cardAmber}>
          <CardLabel color={colors.amber}>Pro Tips</CardLabel>
          <CardBody style={{ color: colors.text }}>{data.pro_tips}</CardBody>
        </Card>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICITY TAB (real or fake)
// ─────────────────────────────────────────────────────────────────────────────

const RISK_COLORS = {
  'low':       colors.green600,
  'medium':    colors.amber,
  'high':      colors.terra,
  'very high': '#A23A1C',
};

function riskColor(risk) {
  const r = (risk || '').toLowerCase();
  if (r.includes('very high')) return RISK_COLORS['very high'];
  if (r.includes('high'))      return RISK_COLORS['high'];
  if (r.includes('medium'))    return RISK_COLORS['medium'];
  if (r.includes('low'))       return RISK_COLORS['low'];
  return colors.text3;
}

function AuthenticityTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Investigating fakes and the real thing…" />;

  const rc = riskColor(data.fraud_risk);

  return (
    <View style={{ gap: 12 }}>
      {/* Risk banner */}
      <Card style={{ borderLeftWidth: 5, borderLeftColor: rc }}>
        <CardLabel>Fraud Risk</CardLabel>
        <Text style={[sh.riskValue, { color: rc }]}>{data.fraud_risk || '—'}</Text>
        <CardBody>{data.fraud_overview}</CardBody>
      </Card>

      {asArr(data.common_fakes).length > 0 ? (
        <>
          <EraHeading label="Common Fakes" />
          {asArr(data.common_fakes).map((f, i) => (
            <Card key={i}>
              <Text style={sh.fakeName}>{f.fake_name}</Text>
              {f.how_it_is_faked ? (
                <CardBody style={{ marginBottom: 8 }}>
                  <Text style={sh.boldLabel}>How it's faked:  </Text>
                  {f.how_it_is_faked}
                </CardBody>
              ) : null}
              {f.how_to_spot_it ? (
                <CardBody>
                  <Text style={sh.boldLabel}>How to spot it:  </Text>
                  {f.how_to_spot_it}
                </CardBody>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {asArr(data.authenticity_checks).length > 0 ? (
        <InsightStrip label="Checks You Can Do">
          <BulletList items={data.authenticity_checks} />
        </InsightStrip>
      ) : null}

      {data.trusted_certifications ? (
        <InsightStrip label="Trusted Certifications" body={data.trusted_certifications} />
      ) : null}

      {data.where_to_buy_authentic ? (
        <InsightStrip label="Where to Buy the Real Thing" body={data.where_to_buy_authentic} />
      ) : null}

      {asArr(data.red_flags).length > 0 ? (
        <InsightStrip label="Red Flags" warn>
          <BulletList items={data.red_flags} />
        </InsightStrip>
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
      {asArr(data.sources).map((s, i) => (
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

      {data.seasonal_advice    && <InsightStrip label="Seasonal Advice"    body={data.seasonal_advice} warn />}
      {data.quality_indicators && <InsightStrip label="Quality Indicators" body={data.quality_indicators} warn />}
      {data.sourcing_tip       && <InsightStrip label="Insider Tip"        body={data.sourcing_tip} warn />}
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

// ─────────────────────────────────────────────────────────────────────────────
// CULTIVATION TAB (grow it)
// ─────────────────────────────────────────────────────────────────────────────

function CultivationTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Researching how to grow it…" />;

  return (
    <View style={{ gap: 12 }}>
      {/* Summary stats */}
      <View style={sh.growStatCard}>
        <GrowStat label="Growability" value={data.growability} />
        <GrowStat label="Time to Harvest" value={data.time_to_harvest} />
        <GrowStat label="Container Friendly" value={data.container_friendly} last />
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <CardLabel>Climate</CardLabel>
          <CardBody>{data.climate}</CardBody>
        </Card>
        <Card style={{ flex: 1 }}>
          <CardLabel>Soil</CardLabel>
          <CardBody>{data.soil}</CardBody>
        </Card>
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <CardLabel>Sun &amp; Water</CardLabel>
          <CardBody>{data.sunlight_water}</CardBody>
        </Card>
        <Card style={{ flex: 1 }}>
          <CardLabel>Propagation</CardLabel>
          <CardBody>{data.propagation}</CardBody>
        </Card>
      </View>

      {asArr(data.growing_steps).length > 0 ? (
        <InsightStrip label="Growing Steps">
          <StepList steps={data.growing_steps} />
        </InsightStrip>
      ) : null}

      {data.harvest_signs ? (
        <InsightStrip label="When to Harvest" body={data.harvest_signs} />
      ) : null}

      {data.common_pests_diseases ? (
        <InsightStrip label="Pests &amp; Diseases" body={data.common_pests_diseases} warn />
      ) : null}
    </View>
  );
}

function GrowStat({ label, value, last }) {
  return (
    <View style={[sh.growStatRow, last && { borderBottomWidth: 0 }]}>
      <Text style={sh.growStatLabel}>{label}</Text>
      <Text style={sh.growStatValue}>{value || '—'}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESERVATION TAB (store + preserve + shelf life)
// ─────────────────────────────────────────────────────────────────────────────

function PreservationTab({ data, error }) {
  if (error) return <ErrCard msg={error} />;
  if (!data)  return <Loader label="Looking up storage and preservation…" />;

  const sl = data.shelf_life || {};
  const revival = data.freshness_revival || '';
  const hasRevival = revival && revival.trim().toLowerCase() !== 'n/a';

  return (
    <View style={{ gap: 12 }}>
      {/* Shelf-life row */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ShelfCard emoji="🥫" label="Pantry"  value={sl.pantry} />
        <ShelfCard emoji="❄️" label="Fridge"  value={sl.refrigerator} />
        <ShelfCard emoji="🧊" label="Freezer" value={sl.freezer} />
      </View>

      {data.best_storage ? (
        <InsightStrip label="Best Way to Store" body={data.best_storage} />
      ) : null}

      {asArr(data.storage_dos_and_donts).length > 0 ? (
        <InsightStrip label="Do's &amp; Don'ts">
          <BulletList items={data.storage_dos_and_donts} />
        </InsightStrip>
      ) : null}

      {asArr(data.preservation_methods).length > 0 ? (
        <>
          <EraHeading label="Preservation Methods" />
          {asArr(data.preservation_methods).map((m, i) => (
            <Card key={i}>
              <View style={sh.methodHead}>
                <View style={sh.methodPill}>
                  <Text style={sh.methodPillText}>{m.method}</Text>
                </View>
                {m.shelf_life ? (
                  <Text style={sh.methodTemp}>🗓 {m.shelf_life}</Text>
                ) : null}
              </View>
              {m.how_to ? <SectionBox label="How To" text={m.how_to} /> : null}
              {m.safety_notes ? <SectionBox label="Safety Notes" text={m.safety_notes} /> : null}
            </Card>
          ))}
        </>
      ) : null}

      {data.spoilage_signs ? (
        <InsightStrip label="Signs It's Gone Bad" body={data.spoilage_signs} warn />
      ) : null}

      {hasRevival ? (
        <InsightStrip label="Reviving Freshness" body={revival} />
      ) : null}
    </View>
  );
}

function ShelfCard({ emoji, label, value }) {
  return (
    <View style={sh.shelfCard}>
      <Text style={sh.shelfEmoji}>{emoji}</Text>
      <Text style={sh.shelfLabel}>{label}</Text>
      <Text style={sh.shelfValue}>{value || 'N/A'}</Text>
    </View>
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
      {asArr(data.historical_recipes).map((r, i) => (
        <RecipeCard key={`h${i}`} recipe={r} historical />
      ))}

      <EraHeading label="Modern Interpretations" style={{ marginTop: 24 }} />
      {asArr(data.modern_recipes).map((r, i) => (
        <RecipeCard key={`m${i}`} recipe={r} historical={false} />
      ))}
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
            <SectionBox label="Ingredients" text={recipe.ingredients_summary} />
          ) : null}
          {recipe.method ? (
            <SectionBox label="Method" text={recipe.method} />
          ) : null}
        </View>
      )}
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

  tabBarWrap: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabBar: { paddingHorizontal: 8 },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 13,
    paddingHorizontal: 13,
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

  heroImage: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    backgroundColor: colors.green100,
  },

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
  boldLabel: { fontWeight: '700', color: colors.text },

  insightCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.green600,
    borderColor: colors.green100,
    backgroundColor: colors.green50,
  },
  warnCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.terra,
    borderColor: 'rgba(184,92,56,0.15)',
    backgroundColor: colors.terraBg,
  },

  bulletRow: { flexDirection: 'row', gap: 8 },
  bulletDot: { color: colors.text3, fontSize: 14, lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 14, color: colors.text2, lineHeight: 21 },

  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.green700,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  stepText: { flex: 1, fontSize: 14, color: colors.text2, lineHeight: 21 },

  // Cooking / preservation method cards
  methodHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  methodPill: {
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderColor: colors.green100,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  methodPillText: { fontSize: 12, fontWeight: '700', color: colors.green700 },
  methodTemp: { fontSize: 12, color: colors.text3, fontWeight: '600' },

  // Authenticity
  riskValue: {
    fontFamily: serif,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  fakeName: {
    fontFamily: serif,
    fontSize: 16,
    fontWeight: '700',
    color: colors.terra,
    marginBottom: 8,
  },

  // Grow stats
  growStatCard: {
    backgroundColor: colors.green50,
    borderWidth: 1,
    borderColor: colors.green200,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  growStatRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.green100,
  },
  growStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.green700,
    marginBottom: 3,
  },
  growStatValue: {
    fontFamily: serif,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 22,
  },

  // Shelf life
  shelfCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  shelfEmoji: { fontSize: 24, marginBottom: 6 },
  shelfLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.text3,
    marginBottom: 4,
  },
  shelfValue: {
    fontFamily: serif,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },

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
