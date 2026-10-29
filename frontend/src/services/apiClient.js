const envBase = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '';
export const PRIMARY_API_BASE = envBase ? envBase.replace(/\/+$/, '') : 'https://sih-9phl.onrender.com';
export const LOCAL_API_BASE = 'http://localhost:8000';

/**
 * Intelligent fetch utility that tries primary backend (Render or configured URL)
 * and automatically falls back to local backend (http://localhost:8000) or vice-versa
 * when running locally.
 */
export async function apiFetch(path, options = {}, timeoutMs = 4000) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Decide candidate URLs to try in order
  const isLocalHost = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const candidates = [];
  if (isLocalHost) {
    candidates.push(LOCAL_API_BASE);
    if (PRIMARY_API_BASE && PRIMARY_API_BASE !== LOCAL_API_BASE) {
      candidates.push(PRIMARY_API_BASE);
    }
  } else {
    if (PRIMARY_API_BASE) {
      candidates.push(PRIMARY_API_BASE);
    }
    if (!candidates.includes('https://sih-9phl.onrender.com')) {
      candidates.push('https://sih-9phl.onrender.com');
    }
  }

  let lastError = null;

  for (const base of candidates) {
    const url = `${base}${cleanPath}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        return await res.json();
      } else {
        let errData;
        try {
          errData = await res.json();
        } catch {
          errData = { detail: `HTTP ${res.status}: ${res.statusText}` };
        }
        const message = errData.detail || errData.error || `HTTP ${res.status}`;
        lastError = new Error(typeof message === 'object' ? JSON.stringify(message) : message);
        // If it's a 4xx client validation error (e.g. 400 SEATS_FULL, 404), do not fall back to another server
        if (res.status >= 400 && res.status < 500) {
          throw lastError;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn(`Request to ${url} timed out after ${timeoutMs}ms. Trying fallback...`);
      } else {
        console.warn(`Request to ${url} failed:`, err.message);
      }
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to connect to backend on ${candidates.join(', ')}`);
}

