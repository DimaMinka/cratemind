import { getDB } from './LocalDBService.js';
import { logToFile } from './LoggerService.js';

export interface SpotifyAudioFeatures {
  danceability: number;
  energy: number;
  acousticness: number;
  instrumentalness: number;
  valence: number;
  tempo: number;
  genres?: string[];
}

let _accessToken: string | null = null;
let _tokenExpiresAt = 0;

/**
 * Helper to obtain a Spotify Access Token using the Client Credentials Flow.
 * Caches token in-memory and handles automatic renewal.
 */
async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  // Use cached token if still valid
  if (_accessToken && Date.now() < _tokenExpiresAt) {
    return _accessToken;
  }

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await globalThis.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error(`Auth failed with status ${response.status}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    _accessToken = data.access_token;
    _tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000; // buffer of 1 minute

    logToFile('SPOTIFY', 'Successfully authenticated with Spotify API.');
    return _accessToken;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile('SPOTIFY_ERROR', `Authentication failed: ${msg}`);
    return null;
  }
}

/**
 * Searches SQLite cache for Spotify features.
 */
function getCachedFeatures(artist: string, title: string): SpotifyAudioFeatures | null {
  const db = getDB();
  try {
    const row = db
      .prepare(
        'SELECT danceability, energy, acousticness, instrumentalness, valence, tempo, spotify_genres FROM spotify_cache WHERE LOWER(artist) = ? AND LOWER(title) = ?'
      )
      .get(artist.toLowerCase().trim(), title.toLowerCase().trim()) as any;

    if (!row) return null;

    return {
      danceability: row.danceability,
      energy: row.energy,
      acousticness: row.acousticness,
      instrumentalness: row.instrumentalness,
      valence: row.valence,
      tempo: row.tempo,
      genres: row.spotify_genres ? JSON.parse(row.spotify_genres) : undefined
    };
  } catch {
    return null;
  }
}

/**
 * Writes Spotify features to SQLite cache.
 */
function cacheFeatures(artist: string, title: string, features: SpotifyAudioFeatures): void {
  const db = getDB();
  try {
    db.prepare(
      `
      INSERT OR REPLACE INTO spotify_cache (artist, title, danceability, energy, acousticness, instrumentalness, valence, tempo, spotify_genres, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      artist,
      title,
      features.danceability,
      features.energy,
      features.acousticness,
      features.instrumentalness,
      features.valence,
      features.tempo,
      features.genres ? JSON.stringify(features.genres) : null,
      Date.now()
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile('SPOTIFY_ERROR', `Failed to write cache to SQLite: ${msg}`);
  }
}

/**
 * Retreives Spotify Audio Features for a specific track.
 * Checks SQLite local cache first.
 */
export async function getTrackFeatures(
  artist: string,
  title: string
): Promise<SpotifyAudioFeatures | null> {
  const hasCreds = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  if (!hasCreds) {
    return null;
  }

  // 1. Check local SQLite Cache first
  const cached = getCachedFeatures(artist, title);
  if (cached) {
    logToFile('SPOTIFY', `Cache HIT for [${artist} - ${title}]`);
    return cached;
  }

  // 2. Fetch access token
  const token = await getAccessToken();
  if (!token) return null;

  try {
    logToFile('SPOTIFY', `Searching Spotify for [${artist} - ${title}]`);

    // Clean artist/title keywords for Spotify search
    const cleanTitle = title.replace(/\s*[[(](?:original|extended|radio|dub|club|remix).*?[\])]/gi, '').trim();
    const cleanArtist = artist.replace(/\s*feat\..*$/gi, '').trim();

    const query = encodeURIComponent(`track:"${cleanTitle}" artist:"${cleanArtist}"`);
    const searchRes = await globalThis.fetch(
      `https://api.spotify.com/v1/search?q=${query}&type=track&limit=1`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!searchRes.ok) {
      throw new Error(`Search request failed with status ${searchRes.status}`);
    }

    const searchData = (await searchRes.json()) as {
      tracks?: {
        items?: {
          id: string;
          artists: { id: string }[];
        }[];
      };
    };

    const trackItem = searchData.tracks?.items?.[0];
    if (!trackItem) {
      logToFile('SPOTIFY', `No track found on Spotify for: "${artist} - ${title}"`);
      return null;
    }

    const trackId = trackItem.id;
    const artistId = trackItem.artists?.[0]?.id;

    // 3. Fetch Audio Features
    logToFile('SPOTIFY', `Fetching audio features for track ID: ${trackId}`);
    const featuresRes = await globalThis.fetch(
      `https://api.spotify.com/v1/audio-features/${trackId}`,
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );

    if (!featuresRes.ok) {
      throw new Error(`Audio features request failed with status ${featuresRes.status}`);
    }

    const featuresData = (await featuresRes.json()) as {
      danceability: number;
      energy: number;
      acousticness: number;
      instrumentalness: number;
      valence: number;
      tempo: number;
    };

    // 4. Optionally fetch genres from the Spotify Artist endpoint (artists hold the genres, tracks don't)
    let genres: string[] = [];
    if (artistId) {
      try {
        const artistRes = await globalThis.fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (artistRes.ok) {
          const artistData = (await artistRes.json()) as { genres?: string[] };
          if (artistData.genres) {
            genres = artistData.genres;
          }
        }
      } catch {
        // Safe to ignore genre errors, proceed with core audio features
      }
    }

    const result: SpotifyAudioFeatures = {
      danceability: featuresData.danceability,
      energy: featuresData.energy,
      acousticness: featuresData.acousticness,
      instrumentalness: featuresData.instrumentalness,
      valence: featuresData.valence,
      tempo: Math.round(featuresData.tempo),
      genres
    };

    // 5. Store in local cache
    cacheFeatures(artist, title, result);
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile('SPOTIFY_ERROR', `Failed to retrieve track context: ${msg}`);
    return null;
  }
}
