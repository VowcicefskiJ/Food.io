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
