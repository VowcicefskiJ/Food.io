from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from typing import List, Optional
import os
import json
import re
import urllib.parse
import urllib.request


class MealRequest(BaseModel):
    ingredients: List[str]
    meal_type: str
    language: str


class MealSuggestion(BaseModel):
    dish: str
    region: str
    description: str


class MealResponse(BaseModel):
    suggestions: List[MealSuggestion]


class IngredientRequest(BaseModel):
    ingredient: str
    location: Optional[str] = None
    language: str = "English"


app = FastAPI()

api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")
client = OpenAI(api_key=api_key)

verification_token = os.getenv("OPENAI_APPS_CHALLENGE", "")

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/.well-known/openai-apps-challenge", response_class=PlainTextResponse)
def openai_apps_challenge():
    return verification_token


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/")
def serve_ui():
    return FileResponse("static/index.html")


@app.post("/meals", response_model=MealResponse)
def suggest_meals(request: MealRequest):
    if not request.ingredients:
        raise HTTPException(status_code=400, detail="Ingredients list cannot be empty")

    if request.meal_type not in {"breakfast", "lunch", "dinner"}:
        raise HTTPException(
            status_code=400,
            detail="meal_type must be breakfast, lunch, or dinner",
        )

    prompt = f"""You are a traditional cooking expert.

RULES:
- Use only traditional cooking methods
- No modern or processed food techniques
- Keep explanations very short
- Focus on regional dishes from around the world
- Respond in {request.language}

OUTPUT RULES (VERY IMPORTANT):
- Return ONLY valid JSON
- Do NOT include explanations, markdown, or extra text
- The JSON MUST match this structure exactly:

{{
  "suggestions": [
    {{
      "dish": "string",
      "region": "string",
      "description": "string"
    }}
  ]
}}

Ingredients: {", ".join(request.ingredients)}
Meal type: {request.meal_type}

Return 3-5 meal suggestions."""

    response = client.responses.create(model="gpt-4.1-mini", input=prompt)
    data = _parse_json(response.output_text)

    try:
        validated = MealResponse(**data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Response JSON does not match expected schema") from exc

    return validated


_MD_LINK = re.compile(r"\[([^\]]*)\]\((https?://[^)\s]+)\)")
# A parenthetical made up entirely of one or more markdown links, e.g. "([FDA](url), [Oceana](url))"
_PAREN_CITATION = re.compile(r"\s*\(\s*(?:\[[^\]]*\]\(https?://[^)\s]+\)\s*[,;]?\s*)+\)")


def _clean_url(url: str) -> str:
    url = re.sub(r"[?&]utm_source=openai\b", "", url)
    return url.rstrip("?&")


def _strip_citations(value, collected: list):
    """Recursively remove inline markdown citations from string fields,
    collecting every URL into `collected` so nothing is lost."""
    if isinstance(value, str):
        for m in _MD_LINK.finditer(value):
            title, url = m.group(1).strip(), _clean_url(m.group(2))
            collected.append({"title": title or url, "url": url})
        text = _PAREN_CITATION.sub("", value)
        text = _MD_LINK.sub(lambda m: m.group(1), text)
        return re.sub(r"\s{2,}", " ", text).replace(" .", ".").strip()
    if isinstance(value, list):
        return [_strip_citations(v, collected) for v in value]
    if isinstance(value, dict):
        return {k: _strip_citations(v, collected) for k, v in value.items()}
    return value


def _citation_sources(response) -> list:
    """Pull url_citation annotations attached by the web-search tool."""
    sources = []
    for item in getattr(response, "output", None) or []:
        for part in getattr(item, "content", None) or []:
            for ann in getattr(part, "annotations", None) or []:
                if getattr(ann, "type", "") == "url_citation":
                    url = _clean_url(getattr(ann, "url", "") or "")
                    if url:
                        sources.append({"title": getattr(ann, "title", "") or url, "url": url})
    return sources


def _dedupe_sources(sources: list) -> list:
    seen, out = set(), []
    for s in sources:
        key = s["url"].rstrip("/")
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def _parse_json(raw_text: str):
    """Parse model output tolerantly: strip code fences and surrounding prose."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                pass
    raise HTTPException(status_code=502, detail="Model returned invalid JSON")


_NO_INLINE_CITATIONS = """

IMPORTANT: Do NOT put citations, source names, URLs, or markdown links inside any JSON string value — keep the prose clean and readable. Your search citations are captured separately."""


def _run_json_prompt(prompt: str, with_search: bool = True):
    kwargs = {"model": "gpt-4.1-mini", "input": prompt + (_NO_INLINE_CITATIONS if with_search else "")}
    if with_search:
        kwargs["tools"] = [{"type": "web_search_preview"}]
    response = client.responses.create(**kwargs)
    data = _parse_json(response.output_text)
    if isinstance(data, dict):
        inline_sources = []
        data = _strip_citations(data, inline_sources)
        data["sources"] = _dedupe_sources(_citation_sources(response) + inline_sources)
    return data


def _wikipedia_image(ingredient: str) -> Optional[str]:
    try:
        title = urllib.parse.quote(ingredient.strip().replace(" ", "_"))
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
        req = urllib.request.Request(url, headers={"User-Agent": "Food.io/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        thumb = (data.get("originalimage") or {}).get("source") or (data.get("thumbnail") or {}).get("source")
        return thumb
    except Exception:
        return None


@app.post("/ingredient/image")
def ingredient_image(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")
    return {"image_url": _wikipedia_image(request.ingredient)}


@app.post("/ingredient/info")
def ingredient_info(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a culinary historian and nutritionist expert.

Search the web to find accurate, up-to-date information about the ingredient: "{request.ingredient}"
Use your search results to ground your response in real sources.
Respond in {request.language}.

Keep everything SHORT, plain, and scannable. Prefer simple wording a busy home cook can skim.
Write full sentences only for "description" and "history" (and keep those brief); everything else should be short bullet phrases, NOT paragraphs.

Return ONLY valid JSON with this exact structure — no markdown, no extra text:
{{
  "name": "string",
  "description": "string (2-3 short, simple sentences — what it is and what it tastes like)",
  "key_facts": ["3-5 very short bullet phrases: flavor, texture, typical cook time, diet notes, etc. (e.g. 'Nutty, chewy', 'Cooks in ~30 min', 'High in fiber')"],
  "origin": "string (short — region + rough era, e.g. 'Fertile Crescent, ~10,000 years ago')",
  "history": "string (2-3 short sentences max — no walls of text)",
  "nutritional_highlights": "string (one short sentence summary)",
  "nutrition_facts": ["short bullet phrases with numbers where known (e.g. '170 cal per 1/4 cup', '6g protein', '5g fiber')"],
  "common_uses": ["3-5 short bullet phrases of how it's used (e.g. 'Salads', 'Soups & stews', 'Grain bowls')"],
  "best_season": "string (short)",
  "buying_tips": ["2-4 short bullet phrases on what to look for when buying"],
  "storage_tips": ["2-4 short bullet phrases on how to store it"],
  "fun_fact": "string (one short surprising sentence)"
}}"""

    return _run_json_prompt(prompt)


@app.post("/ingredient/cooking")
def ingredient_cooking(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a master chef and culinary instructor.

Research how to correctly cook and prepare "{request.ingredient}" based on authoritative cooking sources, traditional culinary practice, and food science.
Cover the full life-cycle: cleaning, prepping, ideal cooking methods, common mistakes, doneness cues, and pairings.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "preparation": "string (cleaning, peeling, trimming, soaking — whatever applies)",
  "primary_methods": [
    {{
      "method": "string (e.g., 'Steaming', 'Roasting', 'Braising', 'Toasting')",
      "why_it_works": "string (food-science reasoning)",
      "step_by_step": "string (numbered or sequential steps)",
      "time_and_temp": "string (specific minutes / °F or °C)",
      "doneness_cues": "string (visual / texture / aroma cues)"
    }}
  ],
  "common_mistakes": ["string", "string", "string"],
  "common_uses": "string (what this ingredient is used for day to day: cuisines it stars in, dish types, condiments, drinks, desserts)",
  "classic_dishes": ["string (a famous dish it's essential to, with one-line description)", "string", "string"],
  "flavor_pairings": "string (classic ingredients that pair well)",
  "pro_tips": "string (2-3 expert tips)"
}}

Provide 3-4 primary cooking methods that genuinely suit this ingredient, and 3-5 classic dishes."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/authenticity")
def ingredient_authenticity(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a food authentication and fraud-prevention expert.

Research how "{request.ingredient}" is commonly faked, adulterated, mislabeled, or substituted in the global food market.
Use real reporting (e.g., FDA, EU food fraud reports, Oceana, Olive Oil Times, Saffron Trade Association, journalism) to ground your answer.
Explain how a regular consumer can tell the real version from a counterfeit, and where to source the authentic product.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "fraud_risk": "string ('Low' | 'Medium' | 'High' | 'Very High')",
  "fraud_overview": "string (1-2 paragraphs explaining how it's commonly faked)",
  "common_fakes": [
    {{
      "fake_name": "string (e.g., 'Safflower passed off as saffron')",
      "how_it_is_faked": "string",
      "how_to_spot_it": "string (specific tests, visual / smell / taste cues)"
    }}
  ],
  "authenticity_checks": ["string (concrete at-home tests or label checks)", "string", "string"],
  "trusted_certifications": "string (e.g., DOP, PDO, Fair Trade, organic seals — list real ones)",
  "where_to_buy_authentic": "string (types of trusted vendors, regions of origin to look for)",
  "red_flags": ["string", "string", "string"]
}}

Provide 3-5 common fakes/adulterations and 3-5 authenticity checks."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/cultivation")
def ingredient_cultivation(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a horticulturist and small-farm grower.

Research how to grow "{request.ingredient}" at home, in a garden, or on a small farm. Use authoritative horticulture and extension-service sources.
If the ingredient cannot reasonably be grown by a regular person (e.g., it's an animal product, a deep-sea fish, an industrial extract), say so clearly in "growability" and explain what is realistic instead (e.g., raising chickens for eggs, sourcing wild-foraged, etc.).
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "growability": "string ('Easy' | 'Moderate' | 'Hard' | 'Not typically grown — explanation')",
  "climate": "string (zones, temperature ranges)",
  "soil": "string (pH, drainage, composition)",
  "sunlight_water": "string",
  "propagation": "string (seed, cutting, division, tuber, etc., with timing)",
  "growing_steps": ["string (step 1)", "string (step 2)", "string (step 3)", "string (step 4)"],
  "time_to_harvest": "string",
  "harvest_signs": "string (when and how to harvest)",
  "common_pests_diseases": "string",
  "container_friendly": "string (yes/no + tips for pot growing if applicable)"
}}"""

    return _run_json_prompt(prompt)


@app.post("/ingredient/preservation")
def ingredient_preservation(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a food-safety and preservation expert (USDA / NCHFP / Ball Canning–level knowledge).

Research safe, effective ways to store and preserve "{request.ingredient}", with realistic shelf-life estimates from authoritative sources (USDA FoodKeeper, NCHFP, StillTasty, etc.).
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "shelf_life": {{
    "pantry": "string (or 'N/A')",
    "refrigerator": "string (or 'N/A')",
    "freezer": "string (or 'N/A')"
  }},
  "best_storage": "string (the optimal default storage method and why)",
  "storage_dos_and_donts": ["string", "string", "string"],
  "preservation_methods": [
    {{
      "method": "string (e.g., 'Freezing', 'Pickling', 'Drying', 'Fermenting', 'Canning', 'Curing')",
      "how_to": "string (step-by-step at home)",
      "shelf_life": "string (realistic span)",
      "safety_notes": "string (botulism / acidity / temp / sealing concerns where relevant)"
    }}
  ],
  "spoilage_signs": "string (smell, texture, color, mold cues)",
  "freshness_revival": "string (e.g., wilted greens in ice water — only if applicable; else 'N/A')"
}}

Provide 3-4 preservation methods that actually suit this ingredient."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/markets")
def ingredient_markets(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    location_context = f"near {request.location}" if request.location else "in a typical city"
    location_search  = f"in {request.location}" if request.location else "at farmers markets and specialty stores"

    prompt = f"""You are a local food sourcing expert helping people find fresh, high-quality ingredients.

Search the web to find real, current places to buy "{request.ingredient}" {location_search}.
Look for actual farmers markets, ethnic grocery stores, food co-ops, and specialty shops — not big chains.

Focus ONLY on these source types:
- Farmers markets and farm stands
- Chinese / Asian supermarkets
- Korean markets (like H Mart)
- Japanese grocery stores
- Mexican or Latin American mercados
- Middle Eastern or specialty ethnic grocery stores
- Italian delis and specialty stores
- Food co-ops and buying clubs
- CSA (Community Supported Agriculture) farm boxes
- Local independent grocers known for fresh produce

Do NOT suggest Walmart, Target, Kroger, Safeway, or similar large chains.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "sources": [
    {{
      "type": "string",
      "description": "string (include real store names or market names if found online)",
      "why_quality": "string",
      "what_to_look_for": "string",
      "typical_availability": "string",
      "price_context": "string"
    }}
  ],
  "seasonal_advice": "string",
  "quality_indicators": "string",
  "sourcing_tip": "string (a specific real-world tip from your search)"
}}

Provide 3-5 most relevant source types."""

    return _run_json_prompt(prompt)


@app.post("/ingredient/recipes")
def ingredient_recipes(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a culinary historian researching real recipes for "{request.ingredient}".

Search the web for:
- Documented historical recipes using "{request.ingredient}" from ancient, medieval, and pre-modern sources
- Real traditional cooking methods and techniques from different cultures
- Authentic modern recipes from reputable food sites, chefs, or culinary publications
- For each recipe, an actual YouTube video that demonstrates making that dish (search "<dish name> recipe youtube")

Use your search results to provide accurate, sourced recipes spanning human culinary history.
Respond in {request.language}.

Return ONLY valid JSON — no markdown, no extra text:
{{
  "ingredient": "string",
  "historical_recipes": [
    {{
      "name": "string",
      "era": "string (e.g., 'Ancient Egypt', 'Tang Dynasty China', 'Medieval Europe')",
      "period": "string (e.g., '3000 BCE', '700s CE', '1300s AD')",
      "region": "string",
      "description": "string",
      "historical_context": "string (include source or reference if found)",
      "ingredients_summary": "string",
      "method": "string (authentic traditional technique)",
      "video_url": "string (a real, full YouTube watch URL you actually found in search that shows how to make this dish, e.g. 'https://www.youtube.com/watch?v=...'; use an empty string '' if you did not find a genuine one — never invent or guess a URL)"
    }}
  ],
  "modern_recipes": [
    {{
      "name": "string",
      "style": "string (e.g., 'Contemporary French', 'Modern Japanese')",
      "description": "string",
      "ingredients_summary": "string",
      "method": "string",
      "video_url": "string (a real, full YouTube watch URL you actually found in search that shows how to make this dish; use an empty string '' if you did not find a genuine one — never invent or guess a URL)"
    }}
  ]
}}

For video_url, only include a link you genuinely encountered in your web search results. If unsure, leave it as an empty string — a wrong link is worse than none.

Provide 4-5 historical recipes spanning different eras and world regions (covering at least 1000 years), and 2-3 modern recipes."""

    return _run_json_prompt(prompt)
