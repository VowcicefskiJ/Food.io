/* =========================================
   FOOD.IO — App Logic
   ========================================= */

let ingredientTags = [];

// ── Auth state ──
let auth = null;
try { auth = JSON.parse(localStorage.getItem('foodio_auth') || 'null'); } catch (_) { auth = null; }

let authMode = 'login';           // 'login' | 'register'
let currentSearch = null;         // { ingredient, location } of the last search
const recipeStore = {};           // recipe payloads keyed by card id, for saving

function setAuth(next) {
  auth = next;
  if (next) localStorage.setItem('foodio_auth', JSON.stringify(next));
  else localStorage.removeItem('foodio_auth');
  updateAuthUI();
}

function updateAuthUI() {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; };
  // Landing header
  show('authBtn', !auth); show('userChip', auth); show('savesNavBtn', auth);
  // Dashboard rail
  show('dashLoginBtn', !auth); show('dashUserChip', auth); show('dashSavesBtn', auth);
  if (auth) {
    const u = document.getElementById('userName'); if (u) u.textContent = auth.username;
    const du = document.getElementById('dashUserName'); if (du) du.textContent = auth.username;
  }
}

// =========================================
// LANDING PAGE HELPERS
// =========================================

/** Quick-try chips in the hero: fill the input and search immediately. */
function quickSearch(name) {
  document.getElementById('ingredientInput').value = name;
  searchIngredient();
}

/** Header CTA + feature cards: scroll to the search card and focus the input. */
function focusSearch(e) {
  if (e) e.preventDefault();
  document.getElementById('search-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => document.getElementById('ingredientInput').focus({ preventScroll: true }), 450);
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

  // Open the dashboard (full-screen app view) and lock the page behind it.
  const section = document.getElementById('resultsSection');
  section.style.display = 'block';
  document.body.style.overflow = 'hidden';

  currentSearch = { ingredient, location: location || null };

  // Topbar identity
  const cap = ingredient.charAt(0).toUpperCase() + ingredient.slice(1);
  document.getElementById('dashName').textContent = cap;
  document.getElementById('dashMeta').innerHTML = location
    ? `<span class="dash-chip">
         <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
         Sourcing near ${escHtml(location)}
       </span>`
    : '';
  const saveBtn = document.getElementById('saveSearchBtn');
  if (saveBtn) { saveBtn.textContent = '☆ Save'; saveBtn.classList.remove('saved'); }
  const ph = document.getElementById('dashPhoto');
  if (ph) { ph.innerHTML = ''; ph.classList.remove('has-img'); }
  const dsi = document.getElementById('dashSearchInput');
  if (dsi) dsi.value = '';

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

  // Fire all fetches in parallel
  await Promise.all([
    doFetchInfo(ingredient),
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
      const url = data.image_url;
      // Small photo in the topbar…
      const ph = document.getElementById('dashPhoto');
      if (ph) {
        ph.innerHTML = `<img src="${escAttr(url)}" alt="${escAttr(ingredient)}" onerror="this.closest('.dash-photo').classList.remove('has-img'); this.remove();"/>`;
        ph.classList.add('has-img');
      }
      // …and the large hero photo on the Overview tab.
      const slot = document.getElementById('ingredientImageSlot');
      if (slot) {
        slot.innerHTML = `<img class="ingredient-photo" src="${escAttr(url)}" alt="${escAttr(ingredient)}" onerror="this.parentElement.style.display='none'"/>`;
        slot.style.display = 'block';
      }
    }
  } catch (_) { /* image is best-effort */ }
}

// Search again from inside the dashboard topbar.
function dashSearch(e) {
  if (e) e.preventDefault();
  const val = document.getElementById('dashSearchInput').value.trim();
  if (!val) return false;
  document.getElementById('ingredientInput').value = val;
  searchIngredient();
  return false;
}

// Close the dashboard and return to the landing page.
function exitDashboard(e) {
  if (e) e.preventDefault();
  document.getElementById('resultsSection').style.display = 'none';
  document.body.style.overflow = '';
}

async function doFetchInfo(ingredient) {
  try {
    const data = await post('/ingredient/info', { ingredient, language: 'English' });
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

async function doFetchMarkets(ingredient, location, coords) {
  try {
    const body = { ingredient, location, language: 'English' };
    if (coords) { body.latitude = coords.latitude; body.longitude = coords.longitude; }
    const data = await post('/ingredient/markets', body);
    renderMarkets(data);
  } catch (e) {
    document.getElementById('marketsContent').innerHTML = errorHtml(e.message);
  }
}

// Ask the browser for the user's location, then re-run the "Where to Find"
// search so the AI can surface real farmers/organic markets nearby.
function useMyLocation() {
  if (!currentSearch) return;
  const btn = document.getElementById('useLocBtn');
  if (!navigator.geolocation) {
    if (btn) btn.insertAdjacentHTML('afterend', '<p class="loc-note">Your browser can\'t share location — type a city in the search box instead.</p>');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Locating…'; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('marketsContent').innerHTML =
        loadingHtml('Finding farmers &amp; organic markets near you…');
      doFetchMarkets(currentSearch.ingredient, null, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    },
    (err) => {
      if (btn) { btn.disabled = false; btn.textContent = '📍 Use my location'; }
      const msg = err.code === 1
        ? 'Location permission was denied. You can type a city in the search box instead.'
        : 'Couldn\'t get your location. You can type a city in the search box instead.';
      const note = document.getElementById('locNote');
      if (note) { note.textContent = msg; note.style.display = 'block'; }
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
  );
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
// PER-TAB SOURCES FOOTER
// =========================================

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; }
}

/** Compact strip of source links, appended inside the tab it belongs to. */
function sourcesFooter(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  return `
    <div class="tab-sources">
      <span class="tab-sources-label">Sources</span>
      ${sources.slice(0, 8).map(s => `
        <a class="src-pill" href="${escAttr(s.url)}" target="_blank" rel="noopener noreferrer" title="${escAttr(s.title || '')}">
          ${escHtml(domainOf(s.url))}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>
        </a>
      `).join('')}
    </div>`;
}

// =========================================
// RENDER — OVERVIEW
// =========================================

function renderOverview(d) {
  // Accept either the new bullet arrays or the older string fields (mobile-compat).
  const asList = (v) => Array.isArray(v) ? v.filter(Boolean)
                      : (typeof v === 'string' && v.trim()) ? [v.trim()] : [];
  const chips  = asList(d.key_facts);
  const nutri  = asList(d.nutrition_facts).length ? asList(d.nutrition_facts) : asList(d.nutritional_highlights);
  const uses   = asList(d.common_uses);
  const buying = asList(d.buying_tips).length ? asList(d.buying_tips) : asList(d.selection_tips);
  const storage = asList(d.storage_tips);

  const bullets = (items) => `<ul class="overview-bullets">${items.map(x => `<li>${escHtml(x)}</li>`).join('')}</ul>`;

  document.getElementById('overviewContent').innerHTML = `
    <div class="bento">

      <div class="info-card hero-card span-8">
        <div class="card-label">About</div>
        <div class="card-body">${escHtml(d.description || '')}</div>
        ${chips.length ? `<div class="fact-chips">${chips.map(f => `<span class="fact-chip">${escHtml(f)}</span>`).join('')}</div>` : ''}
      </div>

      <div class="info-card span-4">
        <div class="card-icon">🌍</div>
        <div class="card-label">Origin &amp; History</div>
        <div class="card-big">${escHtml(d.origin || '—')}</div>
        ${d.history ? `<div class="card-body">${escHtml(d.history)}</div>` : ''}
      </div>

      <div class="info-card span-4">
        <div class="card-icon">🥦</div>
        <div class="card-label">Nutrition</div>
        ${nutri.length ? bullets(nutri) : '<div class="card-body">—</div>'}
      </div>

      ${uses.length ? `
      <div class="info-card span-4">
        <div class="card-icon">🍽</div>
        <div class="card-label">Common Uses</div>
        ${bullets(uses)}
      </div>` : ''}

      <div class="info-card span-4">
        <div class="card-icon">🗓</div>
        <div class="card-label">Best Season &amp; Buying</div>
        <div class="card-big">${escHtml(d.best_season || '—')}</div>
        ${buying.length ? bullets(buying) : ''}
      </div>

      <div class="info-card span-6">
        <div class="card-icon">📦</div>
        <div class="card-label">Storage</div>
        ${storage.length ? bullets(storage) : '<div class="card-body">—</div>'}
      </div>

      ${d.fun_fact ? `
      <div class="info-card fun-fact-card span-6">
        <div class="card-label">Did You Know?</div>
        <div class="card-body">${escHtml(d.fun_fact)}</div>
      </div>` : ''}

    </div>

    ${sourcesFooter(d.sources)}
  `;
}

// =========================================
// RENDER — COOKING
// =========================================

function renderCooking(d) {
  const methods = asArr(d.primary_methods).map(m => `
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

  const mistakes = asArr(d.common_mistakes).map(m => `<li>${escHtml(m)}</li>`).join('');
  const dishes   = asArr(d.classic_dishes).map(x => `<li>${escHtml(x)}</li>`).join('');

  document.getElementById('cookingContent').innerHTML = `
    <div class="bento">
      ${d.common_uses ? `
      <div class="insight-strip span-4">
        <div class="card-label">What It's Used For</div>
        <div class="card-body">${escHtml(d.common_uses)}</div>
      </div>` : ''}

      ${dishes ? `
      <div class="insight-strip span-4">
        <div class="card-label">Classic Dishes to Make With It</div>
        <ul class="bullet-list">${dishes}</ul>
      </div>` : ''}

      ${d.preparation ? `
      <div class="insight-strip span-4">
        <div class="card-label">Preparation</div>
        <div class="card-body">${escHtml(d.preparation)}</div>
      </div>` : ''}

      <div class="era-divider span-12"><span class="era-divider-title">Primary Cooking Methods</span><span class="era-divider-line"></span></div>
      <div class="methods-list span-12">${methods}</div>

      ${mistakes ? `
      <div class="insight-strip warn span-6">
        <div class="card-label">Common Mistakes to Avoid</div>
        <ul class="bullet-list">${mistakes}</ul>
      </div>` : ''}

      ${d.flavor_pairings ? `
      <div class="insight-strip span-6">
        <div class="card-label">Flavor Pairings</div>
        <div class="card-body">${escHtml(d.flavor_pairings)}</div>
      </div>` : ''}

      ${d.pro_tips ? `
      <div class="insight-strip span-12">
        <div class="card-label">Pro Tips</div>
        <div class="card-body">${escHtml(d.pro_tips)}</div>
      </div>` : ''}
    </div>

    ${sourcesFooter(d.sources)}
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

  const fakes = asArr(d.common_fakes).map(f => `
    <div class="fake-card">
      <h4>${escHtml(f.fake_name || '')}</h4>
      ${f.how_it_is_faked ? `<p><span class="md-bold">How it's faked: </span>${escHtml(f.how_it_is_faked)}</p>` : ''}
      ${f.how_to_spot_it ? `<p><span class="md-bold">How to spot it: </span>${escHtml(f.how_to_spot_it)}</p>` : ''}
    </div>
  `).join('');

  const checks  = asArr(d.authenticity_checks).map(c => `<li>${escHtml(c)}</li>`).join('');
  const reds    = asArr(d.red_flags).map(r => `<li>${escHtml(r)}</li>`).join('');

  document.getElementById('authenticityContent').innerHTML = `
    <div class="bento">
      <div class="risk-banner ${riskClass} span-12">
        <div class="risk-label">Fraud Risk</div>
        <div class="risk-value">${escHtml(d.fraud_risk || '—')}</div>
        <div class="risk-overview">${escHtml(d.fraud_overview || '')}</div>
      </div>

      ${d.gmo_status ? `
      <div class="info-card span-6">
        <div class="card-icon">🧬</div>
        <div class="card-label">GMO Status</div>
        <div class="card-big">${escHtml(d.gmo_status)}</div>
        ${d.gmo_details ? `<div class="card-body">${escHtml(d.gmo_details)}</div>` : ''}
      </div>` : ''}
      ${d.organic_guidance ? `
      <div class="info-card span-6">
        <div class="card-icon">🌱</div>
        <div class="card-label">Buying Organic</div>
        <div class="card-body">${escHtml(d.organic_guidance)}</div>
      </div>` : ''}

      ${fakes ? `
      <div class="era-divider span-12"><span class="era-divider-title">Common Fakes &amp; Adulterations</span><span class="era-divider-line"></span></div>
      <div class="fakes-grid span-12">${fakes}</div>` : ''}

      ${checks ? `
      <div class="insight-strip span-6">
        <div class="card-label">Authenticity Checks You Can Do</div>
        <ul class="bullet-list">${checks}</ul>
      </div>` : ''}

      ${d.trusted_certifications ? `
      <div class="insight-strip span-6">
        <div class="card-label">Trusted Certifications</div>
        <div class="card-body">${escHtml(d.trusted_certifications)}</div>
      </div>` : ''}

      ${d.where_to_buy_authentic ? `
      <div class="insight-strip span-6">
        <div class="card-label">Where to Buy the Real Thing</div>
        <div class="card-body">${escHtml(d.where_to_buy_authentic)}</div>
      </div>` : ''}

      ${reds ? `
      <div class="insight-strip warn span-6">
        <div class="card-label">Red Flags</div>
        <ul class="bullet-list">${reds}</ul>
      </div>` : ''}
    </div>

    ${sourcesFooter(d.sources)}
  `;
}

// =========================================
// RENDER — CULTIVATION (grow it)
// =========================================

function renderCultivation(d) {
  const steps = asArr(d.growing_steps).map((s, i) => `
    <li><span class="step-num">${i + 1}</span><span>${escHtml(s)}</span></li>
  `).join('');

  document.getElementById('growContent').innerHTML = `
    <div class="bento">
      <div class="grow-summary span-12">
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

      <div class="info-card span-3">
        <div class="card-icon">🌡</div>
        <div class="card-label">Climate</div>
        <div class="card-body">${escHtml(d.climate || '')}</div>
      </div>
      <div class="info-card span-3">
        <div class="card-icon">🪴</div>
        <div class="card-label">Soil</div>
        <div class="card-body">${escHtml(d.soil || '')}</div>
      </div>
      <div class="info-card span-3">
        <div class="card-icon">☀️</div>
        <div class="card-label">Sun &amp; Water</div>
        <div class="card-body">${escHtml(d.sunlight_water || '')}</div>
      </div>
      <div class="info-card span-3">
        <div class="card-icon">🌱</div>
        <div class="card-label">Propagation</div>
        <div class="card-body">${escHtml(d.propagation || '')}</div>
      </div>

      ${steps ? `
      <div class="insight-strip span-6">
        <div class="card-label">Growing Steps</div>
        <ol class="step-list">${steps}</ol>
      </div>` : ''}

      ${d.harvest_signs ? `
      <div class="insight-strip span-6">
        <div class="card-label">When to Harvest</div>
        <div class="card-body">${escHtml(d.harvest_signs)}</div>
      </div>` : ''}

      ${d.common_pests_diseases ? `
      <div class="insight-strip warn span-12">
        <div class="card-label">Pests &amp; Diseases</div>
        <div class="card-body">${escHtml(d.common_pests_diseases)}</div>
      </div>` : ''}
    </div>

    ${sourcesFooter(d.sources)}
  `;
}

// =========================================
// RENDER — PRESERVATION (store + preserve + shelf life)
// =========================================

function renderPreservation(d) {
  const sl = d.shelf_life || {};
  const methods = asArr(d.preservation_methods).map(m => `
    <div class="method-card">
      <div class="method-head">
        <span class="method-pill">${escHtml(m.method || '')}</span>
        ${m.shelf_life ? `<span class="method-temp">🗓 ${escHtml(m.shelf_life)}</span>` : ''}
      </div>
      ${m.how_to ? `<div class="recipe-section"><div class="recipe-section-label">How To</div><div class="recipe-section-text">${escHtml(m.how_to)}</div></div>` : ''}
      ${m.safety_notes ? `<div class="recipe-section"><div class="recipe-section-label">Safety Notes</div><div class="recipe-section-text">${escHtml(m.safety_notes)}</div></div>` : ''}
    </div>
  `).join('');

  const dos = asArr(d.storage_dos_and_donts).map(s => `<li>${escHtml(s)}</li>`).join('');

  document.getElementById('preserveContent').innerHTML = `
    <div class="bento">
      <div class="shelf-life-grid span-12">
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
      <div class="insight-strip span-6">
        <div class="card-label">Best Way to Store</div>
        <div class="card-body">${escHtml(d.best_storage)}</div>
      </div>` : ''}

      ${dos ? `
      <div class="insight-strip span-6">
        <div class="card-label">Storage Do's &amp; Don'ts</div>
        <ul class="bullet-list">${dos}</ul>
      </div>` : ''}

      ${methods ? `
      <div class="era-divider span-12"><span class="era-divider-title">Preservation Methods</span><span class="era-divider-line"></span></div>
      <div class="methods-list span-12">${methods}</div>` : ''}

      ${d.spoilage_signs ? `
      <div class="insight-strip warn span-6">
        <div class="card-label">Signs It's Gone Bad</div>
        <div class="card-body">${escHtml(d.spoilage_signs)}</div>
      </div>` : ''}

      ${d.freshness_revival && d.freshness_revival.toLowerCase() !== 'n/a' ? `
      <div class="insight-strip span-6">
        <div class="card-label">Reviving Freshness</div>
        <div class="card-body">${escHtml(d.freshness_revival)}</div>
      </div>` : ''}
    </div>

    ${sourcesFooter(d.sources)}
  `;
}

// =========================================
// RENDER — MARKETS
// =========================================

function renderMarkets(d) {
  const near = d.searched_near || (currentSearch && currentSearch.location) || '';

  // Prompt to use device location when we don't already have a place.
  const locPrompt = near ? `
    <div class="loc-banner located">
      <span class="loc-icon">📍</span>
      <div>
        <div class="loc-title">Showing markets near <strong>${escHtml(near)}</strong></div>
        <button class="loc-link" id="useLocBtn" onclick="useMyLocation()">Use my exact location instead</button>
      </div>
    </div>` : `
    <div class="loc-banner">
      <span class="loc-icon">📍</span>
      <div>
        <div class="loc-title">Find farmers &amp; organic markets near you</div>
        <div class="loc-sub">Share your location and we'll look up real nearby markets that sell this.</div>
        <button class="btn-primary loc-cta" id="useLocBtn" onclick="useMyLocation()">📍 Use my location</button>
        <p class="loc-note" id="locNote" style="display:none"></p>
      </div>
    </div>`;

  const places = asArr(d.places).map(s => `
    <div class="market-card">
      <span class="market-badge">${escHtml(s.type)}</span>
      <h4>${escHtml(s.name || s.type)}</h4>
      ${s.name && s.name !== s.type ? `<p class="market-sub">${escHtml(s.type)}</p>` : ''}
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
    <div class="bento">
      <div class="span-12">${locPrompt}</div>
      <div class="markets-grid span-12">${places}</div>
      ${d.seasonal_advice ? `
      <div class="insight-strip span-4">
        <div class="card-label">Seasonal Advice</div>
        <div class="card-body">${escHtml(d.seasonal_advice)}</div>
      </div>` : ''}
      ${d.quality_indicators ? `
      <div class="insight-strip span-4">
        <div class="card-label">Quality Indicators</div>
        <div class="card-body">${escHtml(d.quality_indicators)}</div>
      </div>` : ''}
      ${d.sourcing_tip ? `
      <div class="insight-strip span-4">
        <div class="card-label">Insider Tip</div>
        <div class="card-body">${escHtml(d.sourcing_tip)}</div>
      </div>` : ''}
    </div>

    ${sourcesFooter(d.sources)}
  `;
}

// =========================================
// RENDER — RECIPES
// =========================================

function renderRecipes(d) {
  const historical = asArr(d.historical_recipes).map((r, i) => recipeCard(r, `h${i}`, true)).join('');
  const modern     = asArr(d.modern_recipes).map((r, i) => recipeCard(r, `m${i}`, false)).join('');

  document.getElementById('recipesContent').innerHTML = `
    <div class="bento">
      <div class="era-divider span-12">
        <span class="era-divider-title">Through History</span>
        <span class="era-divider-line"></span>
      </div>
      <div class="recipes-list span-12">${historical}</div>

      <div class="era-divider span-12">
        <span class="era-divider-title">Modern Interpretations</span>
        <span class="era-divider-line"></span>
      </div>
      <div class="recipes-list span-12">${modern}</div>
    </div>

    ${sourcesFooter(d.sources)}
  `;
}

function recipeCard(r, id, isHistorical) {
  const pillClass = isHistorical ? 'historical' : 'modern';
  const pillText  = isHistorical ? (r.era || 'Historical') : (r.style || 'Modern');
  recipeStore[`rc-${id}`] = { ...r, historical: !!isHistorical, ingredient: currentSearch ? currentSearch.ingredient : '' };

  return `
    <div class="recipe-card" id="rc-${id}">
      <div class="recipe-card-header" onclick="toggleRecipe('rc-${id}')">
        <div class="recipe-meta">
          <span class="era-pill ${pillClass}">${escHtml(pillText)}</span>
          <h4>${escHtml(r.name || '')}</h4>
          <p class="recipe-region">${isHistorical && r.region ? '📍 ' + escHtml(r.region) : ''}</p>
        </div>
        ${isHistorical && r.period ? `<span class="recipe-period-badge">${escHtml(r.period)}</span>` : ''}
        <button class="recipe-save" onclick="saveRecipe('rc-${id}', event)" title="Save this recipe">☆</button>
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
        ${videoLink(r.video_url)}
      </div>
    </div>
  `;
}

/**
 * Return a "Watch on YouTube" button, but only if the URL is a genuine
 * YouTube watch/short link. Guards against the AI inventing a bogus link.
 */
function youtubeId(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (u.pathname === '/watch') {
        const id = u.searchParams.get('v');
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/);
      return m ? m[1] : null;
    }
  } catch (_) { /* malformed URL */ }
  return null;
}

function videoLink(url) {
  const id = youtubeId(url);
  if (!id) return '';
  const clean = `https://www.youtube.com/watch?v=${id}`;
  return `
    <a class="video-link" href="${escAttr(clean)}" target="_blank" rel="noopener noreferrer">
      <svg class="video-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/></svg>
      Watch on YouTube
    </a>`;
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
  const dc = document.getElementById('dashContent');
  if (dc) dc.scrollTop = 0;
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

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (auth && auth.token) h['Authorization'] = `Bearer ${auth.token}`;
  return h;
}

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: authHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && !url.startsWith('/auth/')) {
    // Session expired — sign out locally and let the caller's error surface.
    setAuth(null);
  }
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

const post = (url, body) => request('POST', url, body);
const get  = (url)       => request('GET', url);
const del  = (url)       => request('DELETE', url);

// The AI occasionally returns a field as a string (or object) where we expect
// a list. asArr() guarantees we always get an array to map over, so a tab can
// never crash on an unexpected shape: arrays pass through, a lone value is
// wrapped, and empty/missing values become [].
function asArr(x) {
  if (Array.isArray(x)) return x;
  if (x === null || x === undefined || x === '') return [];
  return [x];
}

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

let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toastNote');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// =========================================
// AUTH MODAL
// =========================================

function openAuth() {
  authMode = 'login';
  applyAuthMode();
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('authUser').focus();
}

function closeAuth() {
  document.getElementById('authOverlay').style.display = 'none';
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  applyAuthMode();
}

function applyAuthMode() {
  const login = authMode === 'login';
  document.getElementById('authTitle').textContent       = login ? 'Log in' : 'Create account';
  document.getElementById('authSub').textContent         = login
    ? 'Save your searches and favorite recipes.'
    : 'Pick a username (3-30 letters/numbers) and a password of 8+ characters.';
  document.getElementById('authSubmitLabel').textContent = login ? 'Log in' : 'Create account';
  document.getElementById('authSwitchText').textContent  = login ? 'New here?' : 'Already have an account?';
  document.getElementById('authSwitchLink').textContent  = login ? 'Create an account' : 'Log in instead';
  document.getElementById('authPass').autocomplete       = login ? 'current-password' : 'new-password';
}

async function submitAuth() {
  const username = document.getElementById('authUser').value.trim();
  const password = document.getElementById('authPass').value;
  const errEl    = document.getElementById('authError');
  const btn      = document.getElementById('authSubmitBtn');
  errEl.style.display = 'none';

  if (!username || !password) {
    errEl.textContent = 'Enter a username and password.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  try {
    const data = await post(authMode === 'login' ? '/auth/login' : '/auth/register', { username, password });
    setAuth({ token: data.token, username: data.username });
    closeAuth();
    document.getElementById('authPass').value = '';
    showToast(authMode === 'login' ? `Welcome back, ${data.username}!` : `Account created — welcome, ${data.username}!`);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
  }
}

async function signOut() {
  try { await post('/auth/logout'); } catch (_) { /* session may already be gone */ }
  setAuth(null);
  showToast('Signed out');
}

// =========================================
// SAVING SEARCHES & RECIPES
// =========================================

async function saveCurrentSearch() {
  if (!auth) { openAuth(); return; }
  if (!currentSearch) return;
  const btn = document.getElementById('saveSearchBtn');
  try {
    await post('/me/favorites', {
      kind: 'search',
      title: currentSearch.ingredient,
      payload: currentSearch,
    });
    if (btn) { btn.textContent = '★ Saved'; btn.classList.add('saved'); }
    showToast(`Saved "${currentSearch.ingredient}" to your favorites`);
  } catch (e) {
    showToast(e.message);
  }
}

async function saveRecipe(cardId, event) {
  if (event) event.stopPropagation();
  if (!auth) { openAuth(); return; }
  const r = recipeStore[cardId];
  if (!r || !r.name) return;
  try {
    await post('/me/favorites', { kind: 'recipe', title: r.name, payload: r });
    const btn = document.querySelector(`#${cardId} .recipe-save`);
    if (btn) { btn.textContent = '★'; btn.classList.add('saved'); }
    showToast(`Saved recipe "${r.name}"`);
  } catch (e) {
    showToast(e.message);
  }
}

// =========================================
// MY SAVES PANEL
// =========================================

function openSaves() {
  document.getElementById('savesOverlay').style.display = 'flex';
  loadSaves();
}

function closeSaves() {
  document.getElementById('savesOverlay').style.display = 'none';
}

async function loadSaves() {
  const favEl  = document.getElementById('favList');
  const histEl = document.getElementById('histList');
  favEl.innerHTML  = '<p class="saves-empty">Loading…</p>';
  histEl.innerHTML = '<p class="saves-empty">Loading…</p>';

  try {
    const [favs, hist] = await Promise.all([get('/me/favorites'), get('/me/history')]);
    renderFavorites(favs.favorites || []);
    renderHistory(hist.history || []);
  } catch (e) {
    favEl.innerHTML  = `<p class="saves-empty">⚠ ${escHtml(e.message)}</p>`;
    histEl.innerHTML = '';
  }
}

function renderFavorites(items) {
  const el = document.getElementById('favList');
  if (!items.length) {
    el.innerHTML = '<p class="saves-empty">Nothing saved yet — use “☆ Save search” on a result or the ☆ on any recipe.</p>';
    return;
  }
  el.innerHTML = items.map(f => {
    const p = f.payload || {};
    if (f.kind === 'search') {
      return `
        <div class="saves-item">
          <button class="saves-link" onclick="runSaved('${escAttr(p.ingredient || f.title)}', '${escAttr(p.location || '')}')">
            🔍 ${escHtml(f.title)}${p.location ? ` <span class="saves-sub">near ${escHtml(p.location)}</span>` : ''}
          </button>
          <button class="saves-remove" onclick="removeFav(${f.id})" title="Remove">×</button>
        </div>`;
    }
    return `
      <div class="saves-item saves-recipe" id="fav-${f.id}">
        <button class="saves-link" onclick="document.getElementById('fav-${f.id}').classList.toggle('open')">
          🍲 ${escHtml(f.title)}${p.ingredient ? ` <span class="saves-sub">· ${escHtml(p.ingredient)}</span>` : ''}
        </button>
        <button class="saves-remove" onclick="removeFav(${f.id})" title="Remove">×</button>
        <div class="saves-recipe-body">
          ${p.description ? `<p>${escHtml(p.description)}</p>` : ''}
          ${p.ingredients_summary ? `<p><strong>Ingredients:</strong> ${escHtml(p.ingredients_summary)}</p>` : ''}
          ${p.method ? `<p><strong>Method:</strong> ${escHtml(p.method)}</p>` : ''}
        </div>
      </div>`;
  }).join('');
}

function renderHistory(items) {
  const el = document.getElementById('histList');
  if (!items.length) {
    el.innerHTML = '<p class="saves-empty">No searches yet — searches are recorded while you\'re signed in.</p>';
    return;
  }
  el.innerHTML = items.map(h => `
    <div class="saves-item">
      <button class="saves-link" onclick="runSaved('${escAttr(h.ingredient)}', '${escAttr(h.location || '')}')">
        ${escHtml(h.ingredient)}${h.location ? ` <span class="saves-sub">near ${escHtml(h.location)}</span>` : ''}
        <span class="saves-sub">· ${timeAgo(h.searched_at)}</span>
      </button>
    </div>
  `).join('');
}

function runSaved(ingredient, location) {
  closeSaves();
  document.getElementById('ingredientInput').value = ingredient;
  document.getElementById('locationInput').value = location || '';
  searchIngredient();
}

async function removeFav(id) {
  try {
    await del(`/me/favorites/${id}`);
    loadSaves();
  } catch (e) {
    showToast(e.message);
  }
}

async function clearHistory() {
  try {
    await del('/me/history');
    loadSaves();
  } catch (e) {
    showToast(e.message);
  }
}

function timeAgo(ts) {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// =========================================
// INIT
// =========================================

updateAuthUI();
if (auth) {
  // Validate the stored session quietly; clears it if expired.
  get('/auth/me').catch(() => {});
}
