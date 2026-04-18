/**
 * Remote theme catalog (Supabase Storage public). Used by content script and service worker.
 * Packaged theme/ remains the fallback when the network or remote index fails.
 * forest_default.json is always read from the extension package when the catalog is remote.
 */
(function (g) {
  'use strict';

  var PRESETS_URL =
    'https://alztwhogvtlrzqbngocs.supabase.co/storage/v1/object/public/Extension%20Theme/presets.json';
  var FILES_BASE =
    'https://alztwhogvtlrzqbngocs.supabase.co/storage/v1/object/public/Extension%20Theme/';

  /** Packaged fallback when remote is used — never fetch this file from Supabase. */
  var FOREST_DEFAULT_THEME_FILE = 'forest_default.json';

  /**
   * @param {string} safeName from safeThemeFileName
   * @returns {boolean}
   */
  function isForestDefaultThemeFile(safeName) {
    return typeof safeName === 'string' && safeName.toLowerCase() === FOREST_DEFAULT_THEME_FILE;
  }

  /**
   * @param {string} name
   * @returns {string} basename safe for a flat bucket, or '' if invalid
   */
  function safeThemeFileName(name) {
    var file = typeof name === 'string' ? name.trim() : '';
    if (!file || !/\.json$/i.test(file)) return '';
    if (file.toLowerCase() === 'presets.json') return '';
    var safeName = file.replace(/^\/+/, '').replace(/\\/g, '/');
    if (safeName.indexOf('..') >= 0 || safeName.indexOf('/') >= 0) return '';
    return safeName;
  }

  /**
   * @param {string} safeName
   * @param {{ bustCache?: boolean, cacheBustToken?: number }} [options]
   */
  function themeFileUrl(safeName, options) {
    var u = FILES_BASE + encodeURIComponent(safeName);
    if (options && options.bustCache) {
      var tok = options.cacheBustToken != null ? options.cacheBustToken : Date.now();
      u += (u.indexOf('?') >= 0 ? '&' : '?') + '_cs=' + tok;
    }
    return u;
  }

  /**
   * @param {{ bustCache?: boolean, cacheBustToken?: number }} [options]
   * @returns {Promise<object|null>} Parsed presets.json or null on failure
   */
  async function fetchPresetsIndex(options) {
    try {
      var url = PRESETS_URL;
      if (options && options.bustCache) {
        var t = options.cacheBustToken != null ? options.cacheBustToken : Date.now();
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_cs=' + t;
      }
      var fetchOpts = { credentials: 'omit' };
      if (options && options.bustCache) fetchOpts.cache = 'no-store';
      var res = await fetch(url, fetchOpts);
      if (!res.ok) return null;
      var data = await res.json();
      return data && typeof data === 'object' ? data : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {object|null} [prefetchedIndex] result of fetchPresetsIndex() to avoid a second fetch
   * @returns {Promise<boolean>} true if remote index lists at least one theme file
   */
  async function remoteCatalogAvailable(prefetchedIndex) {
    var data = prefetchedIndex != null ? prefetchedIndex : await fetchPresetsIndex();
    var files = data && Array.isArray(data.files) ? data.files : [];
    for (var i = 0; i < files.length; i++) {
      if (safeThemeFileName(files[i])) return true;
    }
    return false;
  }

  g.CS_THEME_REMOTE = {
    PRESETS_URL: PRESETS_URL,
    FILES_BASE: FILES_BASE,
    FOREST_DEFAULT_THEME_FILE: FOREST_DEFAULT_THEME_FILE,
    safeThemeFileName: safeThemeFileName,
    isForestDefaultThemeFile: isForestDefaultThemeFile,
    themeFileUrl: themeFileUrl,
    fetchPresetsIndex: fetchPresetsIndex,
    remoteCatalogAvailable: remoteCatalogAvailable,
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);
