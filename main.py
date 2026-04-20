from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from typing import List, Optional
import os
import json


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
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    try:
        validated = MealResponse(**data)
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Response JSON does not match expected schema") from exc

    return validated


@app.post("/ingredient/info")
def ingredient_info(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a culinary historian and nutritionist expert.

Provide rich information about the ingredient: "{request.ingredient}"
Respond in {request.language}.

Return ONLY valid JSON with this exact structure:
{{
  "name": "string",
  "description": "string (2-3 rich paragraphs)",
  "origin": "string",
  "nutritional_highlights": "string",
  "history": "string (2 paragraphs of fascinating historical context)",
  "best_season": "string",
  "selection_tips": "string",
  "storage_tips": "string",
  "fun_fact": "string (one surprising little-known fact)"
}}"""

    response = client.responses.create(model="gpt-4.1-mini", input=prompt)
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    return data


@app.post("/ingredient/markets")
def ingredient_markets(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    location_context = f"near {request.location}" if request.location else "in a typical city"

    prompt = f"""You are a local food sourcing expert helping people find fresh, high-quality ingredients.

The user wants to find: "{request.ingredient}" {location_context}

Suggest ONLY these types of sources:
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

Do NOT suggest large chain supermarkets (Walmart, Target, Kroger, etc.)
Respond in {request.language}.

Return ONLY valid JSON:
{{
  "ingredient": "string",
  "sources": [
    {{
      "type": "string",
      "description": "string",
      "why_quality": "string",
      "what_to_look_for": "string",
      "typical_availability": "string",
      "price_context": "string"
    }}
  ],
  "seasonal_advice": "string",
  "quality_indicators": "string",
  "sourcing_tip": "string"
}}

Provide 3-5 most relevant source types for this ingredient."""

    response = client.responses.create(model="gpt-4.1-mini", input=prompt)
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    return data


@app.post("/ingredient/recipes")
def ingredient_recipes(request: IngredientRequest):
    if not request.ingredient.strip():
        raise HTTPException(status_code=400, detail="Ingredient cannot be empty")

    prompt = f"""You are a culinary historian with encyclopedic knowledge of recipes from ancient times to today.

For the ingredient: "{request.ingredient}"
Provide recipes spanning human culinary history.
Respond in {request.language}.

Return ONLY valid JSON:
{{
  "ingredient": "string",
  "historical_recipes": [
    {{
      "name": "string",
      "era": "string (e.g., 'Ancient Egypt', 'Tang Dynasty China', 'Medieval Europe')",
      "period": "string (e.g., '3000 BCE', '700s CE', '1300s AD')",
      "region": "string",
      "description": "string",
      "historical_context": "string",
      "ingredients_summary": "string",
      "method": "string"
    }}
  ],
  "modern_recipes": [
    {{
      "name": "string",
      "style": "string (e.g., 'Contemporary French', 'Modern Japanese')",
      "description": "string",
      "ingredients_summary": "string",
      "method": "string"
    }}
  ]
}}

Provide 4-5 historical recipes spanning different eras and world regions (at least 1000 years of history), and 2-3 modern recipes."""

    response = client.responses.create(model="gpt-4.1-mini", input=prompt)
    raw_text = response.output_text

    try:
        data = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Model returned invalid JSON") from exc

    return data
