/* =========================================
   FOOD.IO — App Logic
   ========================================= */

let ingredientTags = [];

// =========================================
// INGREDIENT SEARCH
// =========================================

async function searchIngredient() {
  const ingredient = document.getElementById('ingredientInput').value.trim();
  const location   = document.getElementById('locationInput').value.trim();

  if (!ingredient) {
    document.getElementById('ingredientInput').focus();
    shake(document.getElementById('ingredientInput'));
    return;
  }

  const btn = document.getElementById('searchBtn');
  const lbl = document.getElementById('searchBtnLabel');
  btn.disabled = true;
  lbl.textContent = 'Searching...';

  // Show results section and scroll to it
  const section = document.getElementById('resultsSection');
  section.style.display = 'block';

  // Heading
  document.getElementById('ingredientHeading').innerHTML = `
    <span class="ing-badge">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
      Ingredient
    </span>
    <h2>${escHtml(ingredient)}</h2>
    ${location ? `<p class="ing-location">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      Sourcing near ${escHtml(location)}
    </p>` : ''}
  `;

  switchTab('overview');

  // Reset all panes to loading
  document.getElementById('overviewContent').innerHTML = loadingHtml('Loading ingredient info...');
  document.getElementById('marketsContent').innerHTML  = loadingHtml('Finding the best local sources...');
  document.getElementById('recipesContent').innerHTML  = loadingHtml('Searching through centuries of history...');

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Fire all three fetches in parallel
  await Promise.all([
    doFetchInfo(ingredient),
    doFetchMarkets(ingredient, location || null),
    doFetchRecipes(ingredient),
  ]);

  btn.disabled = false;
  lbl.textContent = 'Explore Ingredient';
}

async function doFetchInfo(ingredient) {
  try {
    const data = await post('/ingredient/info', { ingredient, language: 'English' });
    renderOverview(data);
  } catch (e) {
    document.getElementById('overviewContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchMarkets(ingredient, location) {
  try {
    const data = await post('/ingredient/markets', { ingredient, location, language: 'English' });
    renderMarkets(data);
  } catch (e) {
    document.getElementById('marketsContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchRecipes(ingredient) {
  try {
    const data = await post('/ingredient/recipes', { ingredient, language: 'English' });
    renderRecipes(data);
  } catch (e) {
    document.getElementById('recipesContent').innerHTML = errorHtml(e.message);
  }
}

// =========================================
// RENDER — OVERVIEW
// =========================================

function renderOverview(d) {
  document.getElementById('overviewContent').innerHTML = `
    <div class="overview-grid">

      <div class="info-card hero-card full-width">
        <div class="card-label">About</div>
        <div class="card-body">${escHtml(d.description || '')}</div>
      </div>

      <div class="info-card">
        <div class="card-icon">🌍</div>
        <div class="card-label">Origin &amp; History</div>
        <div class="card-big">${escHtml(d.origin || '—')}</div>
        <div class="card-body">${escHtml(d.history || '')}</div>
      </div>

      <div class="info-card">
        <div class="card-icon">🥦</div>
        <div class="card-label">Nutrition</div>
        <div class="card-body">${escHtml(d.nutritional_highlights || '')}</div>
      </div>

      <div class="info-card">
        <div class="card-icon">🗓</div>
        <div class="card-label">Best Season to Buy</div>
        <div class="card-big">${escHtml(d.best_season || '—')}</div>
        <div class="card-body">${escHtml(d.selection_tips || '')}</div>
      </div>

      <div class="info-card">
        <div class="card-icon">📦</div>
        <div class="card-label">Storage</div>
        <div class="card-body">${escHtml(d.storage_tips || '')}</div>
      </div>

      ${d.fun_fact ? `
      <div class="info-card fun-fact-card full-width">
        <div class="card-label">Did You Know?</div>
        <div class="card-body">${escHtml(d.fun_fact)}</div>
      </div>` : ''}

    </div>
  `;
}

// =========================================
// RENDER — MARKETS
// =========================================

function renderMarkets(d) {
  const sources = (d.sources || []).map(s => `
    <div class="market-card">
      <span class="market-badge">${escHtml(s.type)}</span>
      <h4>${escHtml(s.type)}</h4>
      <p class="market-desc">${escHtml(s.description || '')}</p>
      <div class="market-details">
        ${s.why_quality ? `
        <div class="market-detail">
          <span class="md-icon">✓</span>
          <span class="md-text"><span class="md-bold">Why quality: </span>${escHtml(s.why_quality)}</span>
        </div>` : ''}
        ${s.what_to_look_for ? `
        <div class="market-detail">
          <span class="md-icon">👁</span>
          <span class="md-text"><span class="md-bold">Look for: </span>${escHtml(s.what_to_look_for)}</span>
        </div>` : ''}
        ${s.typical_availability ? `
        <div class="market-detail">
          <span class="md-icon">🕐</span>
          <span class="md-text"><span class="md-bold">Availability: </span>${escHtml(s.typical_availability)}</span>
        </div>` : ''}
        ${s.price_context ? `
        <div class="market-detail">
          <span class="md-icon">💰</span>
          <span class="md-text"><span class="md-bold">Price: </span>${escHtml(s.price_context)}</span>
        </div>` : ''}
      </div>
    </div>
  `).join('');

  document.getElementById('marketsContent').innerHTML = `
    <div class="markets-grid">${sources}</div>
    ${d.seasonal_advice ? `
    <div class="insight-strip">
      <div class="card-label">Seasonal Advice</div>
      <div class="card-body">${escHtml(d.seasonal_advice)}</div>
    </div>` : ''}
    ${d.quality_indicators ? `
    <div class="insight-strip">
      <div class="card-label">Quality Indicators</div>
      <div class="card-body">${escHtml(d.quality_indicators)}</div>
    </div>` : ''}
    ${d.sourcing_tip ? `
    <div class="insight-strip">
      <div class="card-label">Insider Tip</div>
      <div class="card-body">${escHtml(d.sourcing_tip)}</div>
    </div>` : ''}
  `;
}

// =========================================
// RENDER — RECIPES
// =========================================

function renderRecipes(d) {
  const historical = (d.historical_recipes || []).map((r, i) => recipeCard(r, `h${i}`, true)).join('');
  const modern     = (d.modern_recipes || []).map((r, i) => recipeCard(r, `m${i}`, false)).join('');

  document.getElementById('recipesContent').innerHTML = `
    <div class="era-divider">
      <span class="era-divider-title">Through History</span>
      <span class="era-divider-line"></span>
    </div>
    <div class="recipes-list">${historical}</div>

    <div class="era-divider">
      <span class="era-divider-title">Modern Interpretations</span>
      <span class="era-divider-line"></span>
    </div>
    <div class="recipes-list">${modern}</div>
  `;
}

function recipeCard(r, id, isHistorical) {
  const pillClass = isHistorical ? 'historical' : 'modern';
  const pillText  = isHistorical ? (r.era || 'Historical') : (r.style || 'Modern');

  return `
    <div class="recipe-card" id="rc-${id}">
      <div class="recipe-card-header" onclick="toggleRecipe('rc-${id}')">
        <div class="recipe-meta">
          <span class="era-pill ${pillClass}">${escHtml(pillText)}</span>
          <h4>${escHtml(r.name || '')}</h4>
          <p class="recipe-region">${isHistorical && r.region ? '📍 ' + escHtml(r.region) : ''}</p>
        </div>
        ${isHistorical && r.period ? `<span class="recipe-period-badge">${escHtml(r.period)}</span>` : ''}
        <span class="recipe-toggle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </span>
      </div>
      <div class="recipe-body">
        <p class="recipe-desc">${escHtml(r.description || '')}</p>
        ${r.historical_context ? `<div class="recipe-context">${escHtml(r.historical_context)}</div>` : ''}
        ${r.ingredients_summary ? `
        <div class="recipe-section">
          <div class="recipe-section-label">Ingredients</div>
          <div class="recipe-section-text">${escHtml(r.ingredients_summary)}</div>
        </div>` : ''}
        ${r.method ? `
        <div class="recipe-section">
          <div class="recipe-section-label">Method</div>
          <div class="recipe-section-text">${escHtml(r.method)}</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

function toggleRecipe(id) {
  document.getElementById(id).classList.toggle('open');
}

// =========================================
// TABS
// =========================================

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `${name}-pane`));
}

// =========================================
// MEAL PLANNER
// =========================================

function handleTagInput(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,+$/, '');
    if (val && !ingredientTags.includes(val)) {
      ingredientTags.push(val);
      renderTags();
    }
    e.target.value = '';
  } else if (e.key === 'Backspace' && !e.target.value && ingredientTags.length) {
    ingredientTags.pop();
    renderTags();
  }
}

function removeTag(i) {
  ingredientTags.splice(i, 1);
  renderTags();
}

function renderTags() {
  document.getElementById('tagList').innerHTML = ingredientTags.map((t, i) => `
    <span class="tag">
      ${escHtml(t)}
      <span class="tag-x" onclick="removeTag(${i})">×</span>
    </span>
  `).join('');
}

async function planMeal() {
  if (!ingredientTags.length) {
    shake(document.getElementById('tagWrap'));
    document.getElementById('tagRawInput').focus();
    return;
  }

  const mealType = document.getElementById('mealType').value;
  const language = document.getElementById('mealLanguage').value;
  const btn      = document.getElementById('planBtn');
  const lbl      = document.getElementById('planBtnLabel');

  btn.disabled = true;
  lbl.textContent = 'Finding dishes...';

  document.getElementById('mealResults').innerHTML = loadingHtml('Discovering traditional dishes...');

  try {
    const data = await post('/meals', { ingredients: ingredientTags, meal_type: mealType, language });
    document.getElementById('mealResults').innerHTML = `
      <div class="meal-results-grid">
        ${data.suggestions.map(s => `
          <div class="meal-card">
            <span class="meal-region">${escHtml(s.region)}</span>
            <h4>${escHtml(s.dish)}</h4>
            <p>${escHtml(s.description)}</p>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    document.getElementById('mealResults').innerHTML = errorHtml(e.message);
  } finally {
    btn.disabled = false;
    lbl.textContent = 'Get Suggestions';
  }
}

// =========================================
// UTILITIES
// =========================================

async function post(url, body) {
  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadingHtml(msg) {
  return `<div class="loading-state"><div class="spinner"></div><p>${msg}</p></div>`;
}

function errorHtml(msg) {
  return `<div class="error-state">⚠ ${escHtml(msg)}</div>`;
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake .35s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}
