import * as http from 'http';
import { URL, URLSearchParams } from 'url';
import { getDB, getSetting, setSetting } from './LocalDBService.js';
import { logToFile } from './LoggerService.js';

export interface SpotifyAudioFeatures {
  danceability?: number | null;
  energy?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  valence?: number | null;
  tempo?: number | null;
  genres?: string[];
}

let _accessToken: string | null = null;
let _tokenExpiresAt = 0;

/**
 * Spins up a temporary Node.js HTTP server on port 8888
 * and guides the user to authenticate through the Spotify browser window.
 */
async function startLocalServerAndAuthorize(clientId: string): Promise<string> {
  const redirectUri = 'http://127.0.0.1:8888/callback';
  const authorizeUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&scope=user-read-private%20user-library-read`;

  console.log('\n========================================================');
  console.log('         SPOTIFY OAUTH USER AUTHORIZATION REQUIRED      ');
  console.log('========================================================');
  console.log('We need to authorize CrateMind through Spotify once to avoid 403 errors.');
  console.log(`Please open this URL in your web browser:\n`);
  console.log(`👉 ${authorizeUrl}\n`);
  console.log('Waiting for callback on http://127.0.0.1:8888/callback ...');
  console.log('========================================================\n');

  return new Promise<string>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const reqUrl = req.url || '';
      if (reqUrl.includes('/callback')) {
        const urlParams = new URL(reqUrl, 'http://127.0.0.1:8888');
        const code = urlParams.searchParams.get('code');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<h1>Authorization Successful!</h1><p>You can now close this tab and return to the terminal.</p>'
          );

          // Close server cleanly
          server.close();
          resolve(code);
        } else {
          const err = urlParams.searchParams.get('error');
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<h1>Authorization Failed</h1><p>${err || 'Unknown error'}</p>`);

          server.close();
          reject(new Error(`Spotify authorization failed: ${err || 'Unknown error'}`));
        }
      }
    });

    server.listen(8888);
  });
}

/**
 * Helper to obtain a Spotify Access Token using the Authorization Code Flow.
 * Caches token in-memory and automatically refreshes using a persistent SQLite token.
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

  const refreshToken = getSetting('spotify_refresh_token');

  try {
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    // 1. If we have a refresh token, do the refresh flow (Server-to-Server, transparent!)
    if (refreshToken) {
      logToFile('SPOTIFY', 'Refreshing Spotify Access Token...');
      const response = await globalThis.fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
        })
      });

      if (response.ok) {
        const data = (await response.json()) as {
          access_token: string;
          expires_in: number;
          refresh_token?: string;
        };
        _accessToken = data.access_token;
        _tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000;

        if (data.refresh_token) {
          setSetting('spotify_refresh_token', data.refresh_token);
        }
        logToFile('SPOTIFY', 'Spotify Access Token refreshed successfully.');
        return _accessToken;
      } else {
        logToFile(
          'SPOTIFY_ERROR',
          `Refresh failed: ${response.status}. Falling back to clean authorization...`
        );
      }
    }

    // 2. If no refresh token, or refresh fails -> trigger the interactive User Auth Code Flow
    const code = await startLocalServerAndAuthorize(clientId);
    const redirectUri = 'http://127.0.0.1:8888/callback';

    logToFile('SPOTIFY', 'Exchanging authorization code for tokens...');
    const response = await globalThis.fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed with status ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    _accessToken = data.access_token;
    _tokenExpiresAt = Date.now() + data.expires_in * 1000 - 60000;

    // Persist refresh token so user never has to log in again!
    setSetting('spotify_refresh_token', data.refresh_token);
    logToFile('SPOTIFY', 'Spotify User Authorized and token stored.');
    return _accessToken;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logToFile('SPOTIFY_ERROR', `Authentication flow failed: ${msg}`);
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
      .get(artist.toLowerCase().trim(), title.toLowerCase().trim()) as
      | {
          danceability: number | null;
          energy: number | null;
          acousticness: number | null;
          instrumentalness: number | null;
          valence: number | null;
          tempo: number | null;
          spotify_genres: string | null;
        }
      | undefined;

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
    const cleanTitle = title
      .replace(/\s*[[(](?:original|extended|radio|dub|club|remix).*?[\])]/gi, '')
      .trim();
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
    let danceability: number | null = null;
    let energy: number | null = null;
    let acousticness: number | null = null;
    let instrumentalness: number | null = null;
    let valence: number | null = null;
    let tempo: number | null = null;

    try {
      logToFile('SPOTIFY', `Fetching audio features for track ID: ${trackId}`);
      const featuresRes = await globalThis.fetch(
        `https://api.spotify.com/v1/audio-features/${trackId}`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (featuresRes.ok) {
        const featuresData = (await featuresRes.json()) as {
          danceability: number;
          energy: number;
          acousticness: number;
          instrumentalness: number;
          valence: number;
          tempo: number;
        };
        danceability = featuresData.danceability;
        energy = featuresData.energy;
        acousticness = featuresData.acousticness;
        instrumentalness = featuresData.instrumentalness;
        valence = featuresData.valence;
        tempo = Math.round(featuresData.tempo);
      } else {
        logToFile(
          'SPOTIFY',
          `Audio features endpoint returned status ${featuresRes.status} (restricted/deprecated for this account). Proceeding with genres-only fallback.`
        );
      }
    } catch (featErr) {
      const featErrMsg = featErr instanceof Error ? featErr.message : String(featErr);
      logToFile(
        'SPOTIFY_ERROR',
        `Audio features request failed: ${featErrMsg}. Proceeding with genres-only fallback.`
      );
    }

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
      danceability,
      energy,
      acousticness,
      instrumentalness,
      valence,
      tempo,
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
