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
