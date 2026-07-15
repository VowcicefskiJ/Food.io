/* =========================================
   FOOD.IO — App Logic
   ========================================= */

let ingredientTags = [];
let currentUser    = null;   // {id, username} when logged in
let lastSearch     = null;   // {ingredient, location} of the current results
let authMode       = 'login';
let drawerTab      = 'favorites';
const recipeStore  = {};     // recipe-card id -> recipe data (for saving favorites)

// =========================================
// ACCOUNT / AUTH
// =========================================

async function initAccount() {
  try {
    const res = await fetch('/auth/me');
    if (res.ok) currentUser = await res.json();
  } catch (_) { /* stay logged out */ }
  renderAccountArea();
}

function renderAccountArea() {
  const area = document.getElementById('accountArea');
  if (currentUser) {
    area.innerHTML = `
      <button class="btn-account logged-in" onclick="openDrawer()">
        <span class="account-avatar">${escHtml(currentUser.username[0].toUpperCase())}</span>
        ${escHtml(currentUser.username)}
      </button>
      <button class="btn-account-secondary" onclick="logout()">Log out</button>
    `;
  } else {
    area.innerHTML = `<button class="btn-account" id="loginNavBtn" onclick="openAuthModal()">Log in</button>`;
  }
  updateSaveSearchBtn();
}

function openAuthModal() {
  document.getElementById('authModal').style.display = 'flex';
  document.getElementById('authError').style.display = 'none';
  setAuthMode('login');
  document.getElementById('authUsername').focus();
}

function closeAuthModal() {
  document.getElementById('authModal').style.display = 'none';
}

function setAuthMode(mode) {
  authMode = mode;
  const login = mode === 'login';
  document.getElementById('authTabLogin').classList.toggle('active', login);
  document.getElementById('authTabSignup').classList.toggle('active', !login);
  document.getElementById('authTitle').textContent = login ? 'Welcome back' : 'Create your account';
  document.getElementById('authSub').textContent = login
    ? 'Log in to keep your search history and favorites.'
    : 'Pick a username to start saving searches and recipes.';
  document.getElementById('authSubmitBtn').textContent = login ? 'Log In' : 'Sign Up';
  document.getElementById('authError').style.display = 'none';
}

async function submitAuth(e) {
  e.preventDefault();
  const username = document.getElementById('authUsername').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl    = document.getElementById('authError');
  const btn      = document.getElementById('authSubmitBtn');

  if (!username || !password) {
    errEl.textContent = 'Please enter a username and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  try {
    currentUser = await post(authMode === 'login' ? '/auth/login' : '/auth/register', { username, password });
    closeAuthModal();
    document.getElementById('authPassword').value = '';
    renderAccountArea();
    showToast(authMode === 'login' ? `Welcome back, ${currentUser.username}!` : `Welcome to Food.io, ${currentUser.username}!`);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  try { await post('/auth/logout', {}); } catch (_) { /* clear locally anyway */ }
  currentUser = null;
  closeDrawer();
  renderAccountArea();
  showToast('Logged out.');
}

// =========================================
// FAVORITES + HISTORY DRAWER
// =========================================

function openDrawer(tab) {
  if (!currentUser) { openAuthModal(); return; }
  document.getElementById('drawerOverlay').style.display = 'block';
  document.getElementById('accountDrawer').classList.add('open');
  switchDrawerTab(tab || drawerTab);
}

function closeDrawer() {
  document.getElementById('drawerOverlay').style.display = 'none';
  document.getElementById('accountDrawer').classList.remove('open');
}

function switchDrawerTab(tab) {
  drawerTab = tab;
  document.getElementById('drawerTabFavs').classList.toggle('active', tab === 'favorites');
  document.getElementById('drawerTabHist').classList.toggle('active', tab === 'history');
  if (tab === 'favorites') loadFavorites(); else loadHistory();
}

async function loadFavorites() {
  const box = document.getElementById('drawerContent');
  box.innerHTML = loadingHtml('Loading favorites...');
  try {
    const data = await getJson('/favorites');
    const favs = data.favorites || [];
    if (!favs.length) {
      box.innerHTML = `<div class="drawer-empty">No favorites yet.<br/>Star a search or a recipe to save it here.</div>`;
      return;
    }
    box.innerHTML = favs.map(f => f.kind === 'search' ? favSearchItem(f) : favRecipeItem(f)).join('');
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
  }
}

function favSearchItem(f) {
  const p = f.payload || {};
  return `
    <div class="drawer-item" onclick="rerunSearch('${escAttr(p.ingredient || f.title)}', '${escAttr(p.location || '')}')">
      <div class="drawer-item-main">
        <span class="drawer-item-kind">🔍 Search</span>
        <span class="drawer-item-title">${escHtml(f.title)}</span>
        ${p.location ? `<span class="drawer-item-sub">📍 ${escHtml(p.location)}</span>` : ''}
      </div>
      <button class="drawer-item-delete" onclick="deleteFavorite(event, ${f.id})" title="Remove">×</button>
    </div>
  `;
}

function favRecipeItem(f) {
  const p = f.payload || {};
  return `
    <div class="drawer-item recipe" onclick="this.classList.toggle('expanded')">
      <div class="drawer-item-main">
        <span class="drawer-item-kind recipe">📜 Recipe</span>
        <span class="drawer-item-title">${escHtml(f.title)}</span>
        ${p.era || p.style ? `<span class="drawer-item-sub">${escHtml(p.era || p.style)}${p.region ? ' · ' + escHtml(p.region) : ''}</span>` : ''}
        <div class="drawer-item-detail">
          ${p.description ? `<p>${escHtml(p.description)}</p>` : ''}
          ${p.ingredients_summary ? `<p><span class="md-bold">Ingredients: </span>${escHtml(p.ingredients_summary)}</p>` : ''}
          ${p.method ? `<p><span class="md-bold">Method: </span>${escHtml(p.method)}</p>` : ''}
        </div>
      </div>
      <button class="drawer-item-delete" onclick="deleteFavorite(event, ${f.id})" title="Remove">×</button>
    </div>
  `;
}

async function deleteFavorite(e, id) {
  e.stopPropagation();
  try {
    await del(`/favorites/${id}`);
    loadFavorites();
  } catch (err) {
    showToast(err.message);
  }
}

async function loadHistory() {
  const box = document.getElementById('drawerContent');
  box.innerHTML = loadingHtml('Loading history...');
  try {
    const data = await getJson('/history');
    const items = data.history || [];
    if (!items.length) {
      box.innerHTML = `<div class="drawer-empty">No searches yet.<br/>Your ingredient and meal searches will show up here.</div>`;
      return;
    }
    box.innerHTML = `
      <button class="drawer-clear" onclick="clearHistory()">Clear history</button>
      ${items.map(h => `
        <div class="drawer-item" ${h.search_type === 'ingredient'
          ? `onclick="rerunSearch('${escAttr(h.query)}', '${escAttr(h.location || '')}')"` : ''}>
          <div class="drawer-item-main">
            <span class="drawer-item-kind">${h.search_type === 'meal' ? '🍽 Meal plan' : '🔍 Search'}</span>
            <span class="drawer-item-title">${escHtml(h.query)}</span>
            <span class="drawer-item-sub">${h.location ? '📍 ' + escHtml(h.location) + ' · ' : ''}${timeAgo(h.created_at)}</span>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    box.innerHTML = errorHtml(e.message);
  }
}

async function clearHistory() {
  try {
    await del('/history');
    loadHistory();
  } catch (e) {
    showToast(e.message);
  }
}

function rerunSearch(ingredient, location) {
  closeDrawer();
  document.getElementById('ingredientInput').value = ingredient;
  document.getElementById('locationInput').value = location || '';
  searchIngredient();
}

// =========================================
// SAVING FAVORITES
// =========================================

function updateSaveSearchBtn() {
  const btn = document.getElementById('saveSearchBtn');
  if (btn) btn.style.display = lastSearch ? 'inline-flex' : 'none';
}

async function saveCurrentSearch() {
  if (!lastSearch) return;
  if (!currentUser) { openAuthModal(); return; }
  try {
    await post('/favorites', {
      kind: 'search',
      title: lastSearch.ingredient,
      payload: lastSearch,
    });
    showToast('★ Search saved to favorites');
  } catch (e) {
    showToast(e.message);
  }
}

async function saveRecipeFav(e, cardId) {
  e.stopPropagation();
  if (!currentUser) { openAuthModal(); return; }
  const r = recipeStore[cardId];
  if (!r) return;
  try {
    await post('/favorites', { kind: 'recipe', title: r.name || 'Recipe', payload: r });
    showToast('★ Recipe saved to favorites');
  } catch (err) {
    showToast(err.message);
  }
}

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

  lastSearch = location ? { ingredient, location } : { ingredient };

  // Heading
  document.getElementById('ingredientHeading').innerHTML = `
    <span class="ing-badge">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
      Ingredient
    </span>
    <h2>${escHtml(ingredient)}
      <button class="btn-save-search" id="saveSearchBtn" onclick="saveCurrentSearch()" title="Save this search to favorites">★ Save search</button>
    </h2>
    ${location ? `<p class="ing-location">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      Sourcing near ${escHtml(location)}
    </p>` : ''}
  `;

  switchTab('overview');

  // Reset all panes to loading
  const imgSlot = document.getElementById('ingredientImageSlot');
  if (imgSlot) { imgSlot.innerHTML = ''; imgSlot.style.display = 'none'; }
  document.getElementById('overviewContent').innerHTML     = loadingHtml('Loading ingredient info...');
  document.getElementById('cookingContent').innerHTML      = loadingHtml('Studying how to cook it right...');
  document.getElementById('authenticityContent').innerHTML = loadingHtml('Investigating fakes and the real thing...');
  document.getElementById('marketsContent').innerHTML      = loadingHtml('Finding the best local sources...');
  document.getElementById('growContent').innerHTML         = loadingHtml('Researching how to grow it...');
  document.getElementById('preserveContent').innerHTML     = loadingHtml('Looking up storage and preservation...');
  document.getElementById('recipesContent').innerHTML      = loadingHtml('Searching through centuries of history...');

  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Fire all fetches in parallel
  await Promise.all([
    doFetchInfo(ingredient, location || null),
    doFetchImage(ingredient),
    doFetchCooking(ingredient),
    doFetchAuthenticity(ingredient),
    doFetchMarkets(ingredient, location || null),
    doFetchCultivation(ingredient),
    doFetchPreservation(ingredient),
    doFetchRecipes(ingredient),
  ]);

  btn.disabled = false;
  lbl.textContent = 'Explore Ingredient';
}

async function doFetchImage(ingredient) {
  try {
    const data = await post('/ingredient/image', { ingredient, language: 'English' });
    if (data && data.image_url) {
      const slot = document.getElementById('ingredientImageSlot');
      if (slot) {
        slot.innerHTML = `<img class="ingredient-photo" src="${escAttr(data.image_url)}" alt="${escAttr(ingredient)}" onerror="this.parentElement.style.display='none'"/>`;
        slot.style.display = 'block';
      }
    }
  } catch (_) { /* image is best-effort */ }
}

async function doFetchInfo(ingredient, location) {
  try {
    const data = await post('/ingredient/info', { ingredient, location, language: 'English' });
    renderOverview(data);
  } catch (e) {
    document.getElementById('overviewContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchCooking(ingredient) {
  try {
    const data = await post('/ingredient/cooking', { ingredient, language: 'English' });
    renderCooking(data);
  } catch (e) {
    document.getElementById('cookingContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchAuthenticity(ingredient) {
  try {
    const data = await post('/ingredient/authenticity', { ingredient, language: 'English' });
    renderAuthenticity(data);
  } catch (e) {
    document.getElementById('authenticityContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchCultivation(ingredient) {
  try {
    const data = await post('/ingredient/cultivation', { ingredient, language: 'English' });
    renderCultivation(data);
  } catch (e) {
    document.getElementById('growContent').innerHTML = errorHtml(e.message);
  }
}

async function doFetchPreservation(ingredient) {
  try {
    const data = await post('/ingredient/preservation', { ingredient, language: 'English' });
    renderPreservation(data);
  } catch (e) {
    document.getElementById('preserveContent').innerHTML = errorHtml(e.message);
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
// RENDER — COOKING
// =========================================

function renderCooking(d) {
  const methods = (d.primary_methods || []).map(m => `
    <div class="method-card">
      <div class="method-head">
        <span class="method-pill">${escHtml(m.method || '')}</span>
        ${m.time_and_temp ? `<span class="method-temp">🕒 ${escHtml(m.time_and_temp)}</span>` : ''}
      </div>
      ${m.why_it_works ? `<p class="method-why"><span class="md-bold">Why it works: </span>${escHtml(m.why_it_works)}</p>` : ''}
      ${m.step_by_step ? `<div class="recipe-section"><div class="recipe-section-label">Steps</div><div class="recipe-section-text">${escHtml(m.step_by_step)}</div></div>` : ''}
      ${m.doneness_cues ? `<div class="recipe-section"><div class="recipe-section-label">Doneness Cues</div><div class="recipe-section-text">${escHtml(m.doneness_cues)}</div></div>` : ''}
    </div>
  `).join('');

  const mistakes = (d.common_mistakes || []).map(m => `<li>${escHtml(m)}</li>`).join('');

  document.getElementById('cookingContent').innerHTML = `
    ${d.preparation ? `
    <div class="insight-strip">
      <div class="card-label">Preparation</div>
      <div class="card-body">${escHtml(d.preparation)}</div>
    </div>` : ''}

    <div class="era-divider"><span class="era-divider-title">Primary Cooking Methods</span><span class="era-divider-line"></span></div>
    <div class="methods-list">${methods}</div>

    ${mistakes ? `
    <div class="insight-strip warn">
      <div class="card-label">Common Mistakes to Avoid</div>
      <ul class="bullet-list">${mistakes}</ul>
    </div>` : ''}

    ${d.flavor_pairings ? `
    <div class="insight-strip">
      <div class="card-label">Flavor Pairings</div>
      <div class="card-body">${escHtml(d.flavor_pairings)}</div>
    </div>` : ''}

    ${d.pro_tips ? `
    <div class="insight-strip">
      <div class="card-label">Pro Tips</div>
      <div class="card-body">${escHtml(d.pro_tips)}</div>
    </div>` : ''}
  `;
}

// =========================================
// RENDER — AUTHENTICITY (real or fake)
// =========================================

function renderAuthenticity(d) {
  const risk = (d.fraud_risk || '').toLowerCase();
  const riskClass = risk.includes('very high') ? 'very-high'
                  : risk.includes('high')      ? 'high'
                  : risk.includes('medium')    ? 'medium'
                  : risk.includes('low')       ? 'low' : '';

  const fakes = (d.common_fakes || []).map(f => `
    <div class="fake-card">
      <h4>${escHtml(f.fake_name || '')}</h4>
      ${f.how_it_is_faked ? `<p><span class="md-bold">How it's faked: </span>${escHtml(f.how_it_is_faked)}</p>` : ''}
      ${f.how_to_spot_it ? `<p><span class="md-bold">How to spot it: </span>${escHtml(f.how_to_spot_it)}</p>` : ''}
    </div>
  `).join('');

  const checks  = (d.authenticity_checks || []).map(c => `<li>${escHtml(c)}</li>`).join('');
  const reds    = (d.red_flags || []).map(r => `<li>${escHtml(r)}</li>`).join('');

  document.getElementById('authenticityContent').innerHTML = `
    <div class="risk-banner ${riskClass}">
      <div class="risk-label">Fraud Risk</div>
      <div class="risk-value">${escHtml(d.fraud_risk || '—')}</div>
      <div class="risk-overview">${escHtml(d.fraud_overview || '')}</div>
    </div>

    ${fakes ? `
    <div class="era-divider"><span class="era-divider-title">Common Fakes &amp; Adulterations</span><span class="era-divider-line"></span></div>
    <div class="fakes-grid">${fakes}</div>` : ''}

    ${checks ? `
    <div class="insight-strip">
      <div class="card-label">Authenticity Checks You Can Do</div>
      <ul class="bullet-list">${checks}</ul>
    </div>` : ''}

    ${d.trusted_certifications ? `
    <div class="insight-strip">
      <div class="card-label">Trusted Certifications</div>
      <div class="card-body">${escHtml(d.trusted_certifications)}</div>
    </div>` : ''}

    ${d.where_to_buy_authentic ? `
    <div class="insight-strip">
      <div class="card-label">Where to Buy the Real Thing</div>
      <div class="card-body">${escHtml(d.where_to_buy_authentic)}</div>
    </div>` : ''}

    ${reds ? `
    <div class="insight-strip warn">
      <div class="card-label">Red Flags</div>
      <ul class="bullet-list">${reds}</ul>
    </div>` : ''}
  `;
}

// =========================================
// RENDER — CULTIVATION (grow it)
// =========================================

function renderCultivation(d) {
  const steps = (d.growing_steps || []).map((s, i) => `
    <li><span class="step-num">${i + 1}</span><span>${escHtml(s)}</span></li>
  `).join('');

  document.getElementById('growContent').innerHTML = `
    <div class="grow-summary">
      <div class="grow-stat">
        <span class="grow-stat-label">Growability</span>
        <span class="grow-stat-value">${escHtml(d.growability || '—')}</span>
      </div>
      <div class="grow-stat">
        <span class="grow-stat-label">Time to Harvest</span>
        <span class="grow-stat-value">${escHtml(d.time_to_harvest || '—')}</span>
      </div>
      <div class="grow-stat">
        <span class="grow-stat-label">Container Friendly</span>
        <span class="grow-stat-value">${escHtml(d.container_friendly || '—')}</span>
      </div>
    </div>

    <div class="overview-grid">
      <div class="info-card">
        <div class="card-icon">🌡</div>
        <div class="card-label">Climate</div>
        <div class="card-body">${escHtml(d.climate || '')}</div>
      </div>
      <div class="info-card">
        <div class="card-icon">🪴</div>
        <div class="card-label">Soil</div>
        <div class="card-body">${escHtml(d.soil || '')}</div>
      </div>
      <div class="info-card">
        <div class="card-icon">☀️</div>
        <div class="card-label">Sun &amp; Water</div>
        <div class="card-body">${escHtml(d.sunlight_water || '')}</div>
      </div>
      <div class="info-card">
        <div class="card-icon">🌱</div>
        <div class="card-label">Propagation</div>
        <div class="card-body">${escHtml(d.propagation || '')}</div>
      </div>
    </div>

    ${steps ? `
    <div class="insight-strip">
      <div class="card-label">Growing Steps</div>
      <ol class="step-list">${steps}</ol>
    </div>` : ''}

    ${d.harvest_signs ? `
    <div class="insight-strip">
      <div class="card-label">When to Harvest</div>
      <div class="card-body">${escHtml(d.harvest_signs)}</div>
    </div>` : ''}

    ${d.common_pests_diseases ? `
    <div class="insight-strip warn">
      <div class="card-label">Pests &amp; Diseases</div>
      <div class="card-body">${escHtml(d.common_pests_diseases)}</div>
    </div>` : ''}
  `;
}

// =========================================
// RENDER — PRESERVATION (store + preserve + shelf life)
// =========================================

function renderPreservation(d) {
  const sl = d.shelf_life || {};
  const methods = (d.preservation_methods || []).map(m => `
    <div class="method-card">
      <div class="method-head">
        <span class="method-pill">${escHtml(m.method || '')}</span>
        ${m.shelf_life ? `<span class="method-temp">🗓 ${escHtml(m.shelf_life)}</span>` : ''}
      </div>
      ${m.how_to ? `<div class="recipe-section"><div class="recipe-section-label">How To</div><div class="recipe-section-text">${escHtml(m.how_to)}</div></div>` : ''}
      ${m.safety_notes ? `<div class="recipe-section"><div class="recipe-section-label">Safety Notes</div><div class="recipe-section-text">${escHtml(m.safety_notes)}</div></div>` : ''}
    </div>
  `).join('');

  const dos = (d.storage_dos_and_donts || []).map(s => `<li>${escHtml(s)}</li>`).join('');

  document.getElementById('preserveContent').innerHTML = `
    <div class="shelf-life-grid">
      <div class="shelf-card">
        <span class="shelf-icon">🥫</span>
        <div class="shelf-label">Pantry</div>
        <div class="shelf-value">${escHtml(sl.pantry || 'N/A')}</div>
      </div>
      <div class="shelf-card">
        <span class="shelf-icon">❄️</span>
        <div class="shelf-label">Refrigerator</div>
        <div class="shelf-value">${escHtml(sl.refrigerator || 'N/A')}</div>
      </div>
      <div class="shelf-card">
        <span class="shelf-icon">🧊</span>
        <div class="shelf-label">Freezer</div>
        <div class="shelf-value">${escHtml(sl.freezer || 'N/A')}</div>
      </div>
    </div>

    ${d.best_storage ? `
    <div class="insight-strip">
      <div class="card-label">Best Way to Store</div>
      <div class="card-body">${escHtml(d.best_storage)}</div>
    </div>` : ''}

    ${dos ? `
    <div class="insight-strip">
      <div class="card-label">Storage Do's &amp; Don'ts</div>
      <ul class="bullet-list">${dos}</ul>
    </div>` : ''}

    ${methods ? `
    <div class="era-divider"><span class="era-divider-title">Preservation Methods</span><span class="era-divider-line"></span></div>
    <div class="methods-list">${methods}</div>` : ''}

    ${d.spoilage_signs ? `
    <div class="insight-strip warn">
      <div class="card-label">Signs It's Gone Bad</div>
      <div class="card-body">${escHtml(d.spoilage_signs)}</div>
    </div>` : ''}

    ${d.freshness_revival && d.freshness_revival.toLowerCase() !== 'n/a' ? `
    <div class="insight-strip">
      <div class="card-label">Reviving Freshness</div>
      <div class="card-body">${escHtml(d.freshness_revival)}</div>
    </div>` : ''}
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
  recipeStore[`rc-${id}`] = r;

  return `
    <div class="recipe-card" id="rc-${id}">
      <div class="recipe-card-header" onclick="toggleRecipe('rc-${id}')">
        <div class="recipe-meta">
          <span class="era-pill ${pillClass}">${escHtml(pillText)}</span>
          <h4>${escHtml(r.name || '')}</h4>
          <p class="recipe-region">${isHistorical && r.region ? '📍 ' + escHtml(r.region) : ''}</p>
        </div>
        ${isHistorical && r.period ? `<span class="recipe-period-badge">${escHtml(r.period)}</span>` : ''}
        <button class="btn-save-recipe" onclick="saveRecipeFav(event, 'rc-${id}')" title="Save this recipe to favorites">★</button>
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
  if (!res.ok) throw new Error(friendlyError(res, data));
  return data;
}

async function getJson(url) {
  const res  = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(friendlyError(res, data));
  return data;
}

async function del(url) {
  const res  = await fetch(url, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(friendlyError(res, data));
  return data;
}

function friendlyError(res, data) {
  if (res.status === 429) return data.detail || 'Slow down a little — too many requests. Try again in a minute.';
  if (res.status === 401 && !data.detail) return 'Please log in first.';
  return data.detail || `HTTP ${res.status}`;
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function timeAgo(unixSeconds) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - unixSeconds));
  if (s < 60)     return 'just now';
  if (s < 3600)   return `${Math.floor(s / 60)} min ago`;
  if (s < 86400)  return `${Math.floor(s / 3600)} hr ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}

initAccount();

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
