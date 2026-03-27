import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const port = 8787;
const TILE_SIZE = 512;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json({ limit: "4mb" }));

console.log("Starting Dynamic Fact Finder API...");

app.get("/", (req, res) => {
  res.send("Dynamic Fact Finder API is running");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shorten(value = "", max = 44) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

function normalizeFactType(value = "fun") {
  const normalized = String(value || "fun").toLowerCase();
  if (normalized === "scary") return "spooky";
  if (normalized === "spooky") return "spooky";
  if (normalized === "historical") return "historical";
  return "fun";
}

function factTypeLabel(value = "fun") {
  const normalized = normalizeFactType(value);
  if (normalized === "spooky") return "Spooky";
  if (normalized === "historical") return "Historical";
  return "Fun";
}

function getStaticStyleForFactType() {
  return "arcgis/community";
}

function wrapTileX(x, z) {
  const n = 2 ** z;
  return ((x % n) + n) % n;
}

function clampTileY(y, z) {
  const max = 2 ** z - 1;
  return Math.max(0, Math.min(max, y));
}

function lonLatToTileFraction(lon, lat, z) {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** z;

  const tileX = ((lon + 180) / 360) * n;
  const tileY =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;

  return { tileX, tileY };
}

async function fetchTileDataUrl(style, z, x, y) {
  if (!process.env.ARCGIS_ACCESS_TOKEN) {
    throw new Error("Missing ARCGIS_ACCESS_TOKEN");
  }

  const safeX = wrapTileX(x, z);
  const safeY = clampTileY(y, z);

  const url = `https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/${style}/static/tile/${z}/${safeY}/${safeX}?token=${encodeURIComponent(
    process.env.ARCGIS_ACCESS_TOKEN,
  )}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Tile request failed with ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return `data:image/png;base64,${base64}`;
}

async function fetchCenteredBasemapSnapshot(mapLocation) {
  if (
    !mapLocation ||
    typeof mapLocation.x !== "number" ||
    typeof mapLocation.y !== "number" ||
    !process.env.ARCGIS_ACCESS_TOKEN
  ) {
    return null;
  }

  const lon = mapLocation.x;
  const lat = mapLocation.y;
  const z = 13;
  const style = getStaticStyleForFactType();

  const { tileX, tileY } = lonLatToTileFraction(lon, lat, z);
  const centerTileX = Math.floor(tileX);
  const centerTileY = Math.floor(tileY);

  const startTileX = centerTileX - 1;
  const startTileY = centerTileY - 1;

  const tileRequests = [];

  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      tileRequests.push(
        fetchTileDataUrl(style, z, startTileX + col, startTileY + row).then(
          (imageUrl) => ({
            imageUrl,
            x: col * TILE_SIZE,
            y: row * TILE_SIZE,
          }),
        ),
      );
    }
  }

  const tiles = await Promise.all(tileRequests);

  const centerLocalX = (tileX - startTileX) * TILE_SIZE;
  const centerLocalY = (tileY - startTileY) * TILE_SIZE;

  const cropLeft = centerLocalX - TILE_SIZE / 2;
  const cropTop = centerLocalY - TILE_SIZE / 2;

  const imageTags = tiles
    .map((tile) => {
      const drawX = tile.x - cropLeft;
      const drawY = tile.y - cropTop;
      return `<image href="${tile.imageUrl}" x="${drawX}" y="${drawY}" width="${TILE_SIZE}" height="${TILE_SIZE}" preserveAspectRatio="none" />`;
    })
    .join("");

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${TILE_SIZE}" height="${TILE_SIZE}" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}">
    <rect width="${TILE_SIZE}" height="${TILE_SIZE}" fill="#eef4ff" />
    ${imageTags}
  </svg>`;

  return {
    imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    style,
    zoom: z,
    centered: true,
  };
}

function buildFallbackPostcardDataUri(
  location,
  discoveries = [],
  factType = "fun",
  currentDiscovery = null,
) {
  const palette = {
    fun: {
      bg1: "#f8fbff",
      bg2: "#eaf2ff",
      accent: "#2563eb",
      accentSoft: "#bfdbfe",
      ink: "#0f172a",
      card: "rgba(255,255,255,0.84)",
    },
    spooky: {
      bg1: "#111827",
      bg2: "#312e81",
      accent: "#8b5cf6",
      accentSoft: "#c4b5fd",
      ink: "#f8fafc",
      card: "rgba(30,41,59,0.78)",
    },
    historical: {
      bg1: "#fff8f1",
      bg2: "#ffedd5",
      accent: "#b45309",
      accentSoft: "#fdba74",
      ink: "#431407",
      card: "rgba(255,255,255,0.84)",
    },
  };

  const normalizedType = normalizeFactType(factType);
  const colors = palette[normalizedType] || palette.fun;
  const safeLocation = escapeXml(shorten(location || "Somewhere cool", 28));
  const safeVibe = escapeXml(factTypeLabel(normalizedType).toUpperCase());
  const focusHeadline = escapeXml(
    shorten(currentDiscovery?.headline || "Collected fact", 34),
  );
  const focusReward = escapeXml(
    shorten(currentDiscovery?.rewardLabel || "Unlocked", 18),
  );

  const safeDiscoveries = (discoveries || []).slice(-3).map((item, index) => ({
    label: escapeXml(
      `${index + 1}. ${factTypeLabel(item.factType || "fun").toUpperCase()}`,
    ),
    headline: escapeXml(shorten(item.headline || "Interesting fact", 34)),
  }));

  while (safeDiscoveries.length < 3) {
    safeDiscoveries.push({
      label: `${safeDiscoveries.length + 1}. MORE`,
      headline: "Next discovery",
    });
  }

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536" fill="none">
    <defs>
      <linearGradient id="bg" x1="64" y1="64" x2="960" y2="1472" gradientUnits="userSpaceOnUse">
        <stop stop-color="${colors.bg1}"/>
        <stop offset="1" stop-color="${colors.bg2}"/>
      </linearGradient>
    </defs>

    <rect x="28" y="28" width="968" height="1480" rx="42" fill="url(#bg)" stroke="${colors.accentSoft}" stroke-width="8"/>
    <rect x="72" y="72" width="880" height="1392" rx="28" fill="${colors.card}" stroke="${colors.accentSoft}" stroke-width="4"/>

    <text x="118" y="164" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" letter-spacing="1">DYNAMIC FACT FINDER</text>
    <text x="118" y="250" fill="${colors.ink}" font-family="Georgia, serif" font-size="66" font-weight="700">${safeLocation}</text>
    <text x="118" y="300" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="24" opacity="0.86">Collected postcard</text>

    <rect x="118" y="360" width="788" height="120" rx="22" fill="rgba(255,255,255,0.74)" stroke="${colors.accentSoft}" stroke-width="3"/>
    <text x="148" y="410" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="800">${safeVibe}</text>
    <text x="148" y="448" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="34" font-weight="700">${focusHeadline}</text>

    <rect x="744" y="130" width="126" height="154" rx="16" fill="rgba(255,255,255,0.74)" stroke="${colors.accent}" stroke-width="5"/>
    <text x="767" y="182" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="900">STAMP</text>
    <text x="767" y="218" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="16">${escapeXml(focusReward)}</text>
    <text x="767" y="244" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="16">COLLECTIBLE</text>

    <line x1="118" y1="570" x2="906" y2="570" stroke="${colors.accentSoft}" stroke-width="4"/>
    <text x="118" y="628" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="800">RECENT DISCOVERIES</text>

    <rect x="118" y="676" width="788" height="108" rx="18" fill="rgba(255,255,255,0.8)" stroke="${colors.accentSoft}" stroke-width="3"/>
    <text x="146" y="720" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800">${safeDiscoveries[0].label}</text>
    <text x="146" y="760" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="29" font-weight="600">${safeDiscoveries[0].headline}</text>

    <rect x="118" y="816" width="788" height="108" rx="18" fill="rgba(255,255,255,0.8)" stroke="${colors.accentSoft}" stroke-width="3"/>
    <text x="146" y="860" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800">${safeDiscoveries[1].label}</text>
    <text x="146" y="900" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="29" font-weight="600">${safeDiscoveries[1].headline}</text>

    <rect x="118" y="956" width="788" height="108" rx="18" fill="rgba(255,255,255,0.8)" stroke="${colors.accentSoft}" stroke-width="3"/>
    <text x="146" y="1000" fill="${colors.accent}" font-family="Inter, Arial, sans-serif" font-size="17" font-weight="800">${safeDiscoveries[2].label}</text>
    <text x="146" y="1040" fill="${colors.ink}" font-family="Inter, Arial, sans-serif" font-size="29" font-weight="600">${safeDiscoveries[2].headline}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

app.get("/api/suggest", async (req, res) => {
  try {
    const text = (req.query.text || "").trim();
    const lat = req.query.lat;
    const lon = req.query.lon;

    if (!text) {
      return res.json({ ok: true, suggestions: [] });
    }

    const url = new URL(
      "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest",
    );

    url.searchParams.set("f", "json");
    url.searchParams.set("text", text);
    url.searchParams.set("maxSuggestions", "5");

    if (lat != null && lon != null) {
      url.searchParams.set("location", `${lon},${lat}`);
    }

    const arcgisResponse = await fetch(url, {
      headers: {
        "X-Esri-Authorization": `Bearer ${process.env.ARCGIS_ACCESS_TOKEN}`,
      },
    });

    if (!arcgisResponse.ok) {
      throw new Error(`ArcGIS suggest failed with ${arcgisResponse.status}`);
    }

    const data = await arcgisResponse.json();

    res.json({
      ok: true,
      suggestions: (data.suggestions || []).map((item) => ({
        text: item.text,
        magicKey: item.magicKey,
      })),
    });
  } catch (error) {
    console.error("suggest error:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to fetch suggestions",
    });
  }
});

app.post("/api/resolve-place", async (req, res) => {
  try {
    const { text = "", magicKey = "" } = req.body || {};

    if (!text || !magicKey) {
      return res.status(400).json({
        ok: false,
        error: "text and magicKey are required",
      });
    }

    const url = new URL(
      "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates",
    );

    url.searchParams.set("f", "json");
    url.searchParams.set("SingleLine", text);
    url.searchParams.set("magicKey", magicKey);
    url.searchParams.set("maxLocations", "1");

    const arcgisResponse = await fetch(url, {
      headers: {
        "X-Esri-Authorization": `Bearer ${process.env.ARCGIS_ACCESS_TOKEN}`,
      },
    });

    if (!arcgisResponse.ok) {
      throw new Error(`ArcGIS resolve failed with ${arcgisResponse.status}`);
    }

    const data = await arcgisResponse.json();
    const candidate = data.candidates?.[0];

    if (!candidate) {
      return res.json({
        ok: true,
        found: false,
      });
    }

    res.json({
      ok: true,
      found: true,
      label: candidate.address,
      location: candidate.location,
      score: candidate.score,
    });
  } catch (error) {
    console.error("resolve-place error:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to resolve place",
    });
  }
});

app.post("/api/location-fact", async (req, res) => {
  try {
    const location = String(req.body?.location || "Unknown place").trim();
    const factType = normalizeFactType(req.body?.factType || "fun");
    const vibeLabel = factTypeLabel(factType);

    const prompt = `
You are helping power a conference web demo called Dynamic Fact Finder.

Generate one concise location fact card for ${location}.
Selected vibe: ${vibeLabel}.

Audience:
- developers
- curious people who like maps, math, computer science, and playful interfaces

Style rules:
- smart, crisp, lightly playful
- not corny
- presentation-ready
- for Historical: grounded and interesting
- for Spooky: eerie but plausible
- for Fun: delightful and surprising
- headline should be 2 to 7 words
- fact should be 1 or 2 sentences, max 42 words
- rewardLabel should feel like a short achievement tag, max 3 words

Return structured data only.
`.trim();

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "location_fact_card",
          strict: true,
          schema: {
            type: "object",
            properties: {
              headline: { type: "string" },
              fact: { type: "string" },
              rewardLabel: { type: "string" },
            },
            required: ["headline", "fact", "rewardLabel"],
            additionalProperties: false,
          },
        },
      },
    });

    const parsed = JSON.parse(response.output_text);

    res.json({
      ok: true,
      location,
      factType,
      headline: parsed.headline,
      fact: parsed.fact,
      rewardLabel: parsed.rewardLabel,
    });
  } catch (error) {
    console.error("location-fact error:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to generate fact",
    });
  }
});

app.post("/api/reverse-geocode", async (req, res) => {
  try {
    const { lat, lon } = req.body || {};

    if (lat == null || lon == null) {
      return res.status(400).json({
        ok: false,
        error: "lat and lon are required",
      });
    }

    const url = new URL(
      "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode",
    );

    url.searchParams.set("f", "json");
    url.searchParams.set("location", `${lon},${lat}`);

    const arcgisResponse = await fetch(url, {
      headers: {
        "X-Esri-Authorization": `Bearer ${process.env.ARCGIS_ACCESS_TOKEN}`,
      },
    });

    if (!arcgisResponse.ok) {
      throw new Error(
        `ArcGIS reverse geocode failed with ${arcgisResponse.status}`,
      );
    }

    const data = await arcgisResponse.json();

    res.json({
      ok: true,
      label:
        data.address?.LongLabel ||
        data.address?.Match_addr ||
        "Current location",
      address: data.address || null,
      location: data.location || null,
    });
  } catch (error) {
    console.error("reverse-geocode error:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to reverse geocode location",
    });
  }
});

app.post("/api/map-snapshot", async (req, res) => {
  try {
    const mapLocation =
      req.body?.mapLocation &&
      typeof req.body.mapLocation === "object" &&
      typeof req.body.mapLocation.x === "number" &&
      typeof req.body.mapLocation.y === "number"
        ? req.body.mapLocation
        : null;

    const snapshot = await fetchCenteredBasemapSnapshot(mapLocation);

    res.json({
      ok: true,
      snapshot,
    });
  } catch (error) {
    console.error("map-snapshot error:", error);
    res.json({
      ok: false,
      snapshot: null,
      error: "Failed to generate map snapshot",
    });
  }
});

app.post("/api/postcard", async (req, res) => {
  const location = String(req.body?.location || "Somewhere cool").trim();
  const factType = normalizeFactType(req.body?.factType || "fun");
  const discoveries = Array.isArray(req.body?.discoveries)
    ? req.body.discoveries.slice(-3)
    : [];
  const currentDiscovery =
    req.body?.currentDiscovery && typeof req.body.currentDiscovery === "object"
      ? req.body.currentDiscovery
      : discoveries[discoveries.length - 1] || null;

  const mapLocation =
    req.body?.mapLocation &&
    typeof req.body.mapLocation === "object" &&
    typeof req.body.mapLocation.x === "number" &&
    typeof req.body.mapLocation.y === "number"
      ? req.body.mapLocation
      : currentDiscovery?.mapLocation &&
          typeof currentDiscovery.mapLocation.x === "number" &&
          typeof currentDiscovery.mapLocation.y === "number"
        ? currentDiscovery.mapLocation
        : null;

  const recentSummary = discoveries.length
    ? discoveries
        .map((item, index) => {
          return `${index + 1}. ${factTypeLabel(item.factType || "fun")} - ${
            item.headline || "Interesting fact"
          }: ${item.fact || ""}`;
        })
        .join("\n")
    : "No recent discoveries were provided.";

  const focusSummary = currentDiscovery
    ? `
Primary fact to visualize:
- vibe: ${factTypeLabel(currentDiscovery.factType || factType)}
- headline: ${currentDiscovery.headline || "Interesting fact"}
- fact: ${currentDiscovery.fact || ""}
- reward label: ${currentDiscovery.rewardLabel || "Unlocked"}
`.trim()
    : `
Primary fact to visualize:
- vibe: ${factTypeLabel(factType)}
- headline: Collected discovery
- fact: Turn the current location into a stylish postcard collectible
- reward label: Unlocked
`.trim();

  try {
    const [mapSnapshot, imageResult] = await Promise.all([
      fetchCenteredBasemapSnapshot(mapLocation).catch((error) => {
        console.error("map snapshot for postcard error:", error);
        return null;
      }),
      client.images.generate({
        model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
        prompt: `
Create a stylish illustrated souvenir postcard for ${location}.

This postcard is for a conference demo called Dynamic Fact Finder.
It should feel like a collectible reward that a curious developer earned after exploring AI-generated facts.

${focusSummary}

Recent discoveries to subtly reference:
${recentSummary}

Art direction:
- polished modern postcard illustration
- smart, playful, developer-friendly tone
- bold shapes and clean composition
- editorial rather than childish
- high legibility
- include the location name in the design
- visually prioritize the primary fact first
- use a full vertical postcard composition
- keep the location title and major landmarks comfortably inside the frame
- avoid any text or major object being cropped by the top or bottom edge
- leave generous safe margins around the whole composition
- not photorealistic
- no browser chrome, no app UI, no extra captions outside the postcard
`.trim(),
        size: "1024x1536",
        quality: "medium",
      }),
    ]);

    const imageBase64 = imageResult.data?.[0]?.b64_json;

    if (!imageBase64) {
      throw new Error("No image data returned from image generation request");
    }

    res.json({
      ok: true,
      imageUrl: `data:image/png;base64,${imageBase64}`,
      mapSnapshot,
      fallback: false,
    });
  } catch (error) {
    console.error("postcard error, using fallback postcard:", error);

    let mapSnapshot = null;
    try {
      mapSnapshot = await fetchCenteredBasemapSnapshot(mapLocation);
    } catch (snapshotError) {
      console.error("fallback map snapshot error:", snapshotError);
    }

    res.json({
      ok: true,
      imageUrl: buildFallbackPostcardDataUri(
        location,
        discoveries,
        factType,
        currentDiscovery,
      ),
      mapSnapshot,
      fallback: true,
    });
  }
});

app.listen(port, () => {
  console.log(`Dynamic Fact Finder API running at http://localhost:${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
});
