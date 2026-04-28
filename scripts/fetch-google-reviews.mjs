/**
 * Fetch Google Maps reviews via Places API (server-side).
 *
 * Required env vars:
 * - GOOGLE_PLACES_API_KEY
 * - GOOGLE_PLACE_ID
 *
 * Output:
 * - writes ./data/reviews.json
 */
import fs from "node:fs/promises";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const PLACE_ID = process.env.GOOGLE_PLACE_ID;

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

async function main() {
  const key = must(API_KEY, "GOOGLE_PLACES_API_KEY");
  const placeId = must(PLACE_ID, "GOOGLE_PLACE_ID");

  const fields = [
    "id",
    "displayName",
    "rating",
    "userRatingCount",
    "reviews",
  ].join(",");

  // Places API (New) endpoint
  // Docs: https://developers.google.com/maps/documentation/places/web-service/overview
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(
    placeId
  )}?fields=${encodeURIComponent(fields)}&languageCode=ru`;

  const res = await fetch(url, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fields,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Places API failed: ${res.status} ${res.statusText}\n${body}`);
  }

  const place = await res.json();
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
    place_id: placeId,
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

