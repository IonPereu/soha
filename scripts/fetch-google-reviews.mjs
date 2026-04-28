/**
 * Fetch Google Maps reviews via Places API (server-side).
 *
 * Required env vars:
 * - GOOGLE_PLACES_API_KEY
 *
 * One of:
 * - GOOGLE_PLACE_ID (preferred, stable id like "ChIJ...") OR
 * - GOOGLE_PLACE_QUERY (text query, e.g. "SOHA BARBERSHOP, strada Cojocarilor 20B, Chișinău")
 *
 * Output:
 * - writes ./data/reviews.json
 */
import fs from "node:fs/promises";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACE_ID = process.env.GOOGLE_PLACE_ID;
const PLACE_QUERY = process.env.GOOGLE_PLACE_QUERY;

function must(value, name) {
  if (!value || String(value).trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function safeText(value) {
  if (value == null) return "";
  // Keep it simple: no control chars, trim extreme length
  const s = String(value).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return s.length > 900 ? s.slice(0, 900) + "…" : s;
}

function pickLang(reviews) {
  // Prefer Russian (ru) if present, else keep as-is
  return reviews;
}

function normalizePlaceId(value) {
  if (!value) return "";
  const s = String(value).trim();
  // Google "cid" / hex-like ids (0x...) are NOT Places placeIds.
  // A valid placeId usually looks like "ChIJ...."
  return s;
}

async function apiJson(url, key, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      "X-Goog-Api-Key": key,
      ...headers,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Places API failed: ${res.status} ${res.statusText}\n${text}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  return res.json();
}

async function resolvePlaceId({ key, placeId, placeQuery }) {
  const id = normalizePlaceId(placeId);
  if (id) return id;

  const q = String(placeQuery || "").trim();
  if (!q) {
    throw new Error("Provide GOOGLE_PLACE_ID or GOOGLE_PLACE_QUERY");
  }

  const fields = ["places.id", "places.displayName", "places.formattedAddress"].join(",");
  const url = "https://places.googleapis.com/v1/places:searchText";
  const payload = JSON.stringify({
    textQuery: q,
    languageCode: "ru",
    maxResultCount: 1,
  });

  const data = await apiJson(url, key, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Goog-FieldMask": fields,
    },
    body: payload,
  });

  const place = Array.isArray(data.places) ? data.places[0] : null;
  if (!place?.id) {
    throw new Error(`No place found for query: ${q}`);
  }
  return place.id;
}

async function main() {
  const key = must(API_KEY, "GOOGLE_PLACES_API_KEY");
  const resolvedId = await resolvePlaceId({
    key,
    placeId: PLACE_ID,
    placeQuery: PLACE_QUERY,
  });

  const fields = [
    "id",
    "displayName",
    "rating",
    "userRatingCount",
    "reviews",
  ].join(",");

  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
    resolvedId
  )}?fields=${encodeURIComponent(fields)}&languageCode=ru`;

  let place;
  try {
    place = await apiJson(url, key, {
      headers: { "X-Goog-FieldMask": fields },
    });
  } catch (e) {
    // If cached placeId became invalid, try to re-resolve via query (if provided).
    if (e && e.status === 404 && PLACE_QUERY) {
      const id2 = await resolvePlaceId({ key, placeQuery: PLACE_QUERY });
      const url2 = `https://places.googleapis.com/v1/places/${encodeURIComponent(
        id2
      )}?fields=${encodeURIComponent(fields)}&languageCode=ru`;
      place = await apiJson(url2, key, { headers: { "X-Goog-FieldMask": fields } });
    } else {
      throw e;
    }
  }
  const rawReviews = Array.isArray(place.reviews) ? place.reviews : [];

  const normalized = pickLang(rawReviews)
    .filter(Boolean)
    .map((r) => ({
      author_name: safeText(r.authorAttribution?.displayName || r.author_name || r.author || "Гость"),
      rating: Number(r.rating || 0),
      relative_time_description: safeText(r.relativePublishTimeDescription || r.relative_time_description || ""),
      text: safeText(r.text?.text || r.text || ""),
      profile_photo_url: safeText(r.authorAttribution?.photoUri || r.profile_photo_url || ""),
      time: r.publishTime || "",
    }))
    .sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));

  const out = {
    updated_at: new Date().toISOString(),
    source: "google_places_api",
    place_id: resolvedId,
    place_name: safeText(place.displayName?.text || place.name || "SOHA BARBERSHOP"),
    rating: Number(place.rating || 0),
    user_ratings_total: Number(place.userRatingCount || 0),
    reviews: normalized,
  };

  await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await fs.writeFile(
    new URL("../data/reviews.json", import.meta.url),
    JSON.stringify(out, null, 2),
    "utf8"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

