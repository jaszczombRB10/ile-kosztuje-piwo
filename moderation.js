/**
 * PoIlePiwko - Moderation & Profanity Filter Module
 * Universal UMD module for Browser & Node.js (Vercel Serverless)
 * Protects usernames, display names, and bio from offensive, vulgar, and abusive content.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ProfanityFilter = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  function normalizeText(text) {
    if (!text) return "";
    let s = String(text).toLowerCase();

    // 1. Polish diacritics replacement
    const plMap = {
      'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n',
      'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z'
    };
    s = s.replace(/[ąćęłńóśźż]/g, m => plMap[m] || m);

    // 2. Unicode diacritics / accents removal
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    return s;
  }

  function getVariants(text) {
    const norm = normalizeText(text);

    // Leetspeak substitutions
    const leet = norm
      .replace(/@/g, 'a')
      .replace(/0/g, 'o')
      .replace(/1/g, 'i')
      .replace(/!/g, 'i')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/\$/g, 's')
      .replace(/7/g, 't')
      .replace(/8/g, 'b');

    // Phonetic substitutions:
    // 'oo' to 'u' (e.g. koorwa -> kurwa, chooj -> chuj)
    // 'v' to 'u' (e.g. kvrwa -> kurwa, chvj -> chuj)
    const phonetic = leet
      .replace(/oo/g, 'u')
      .replace(/v/g, 'u');

    // Collapsed: strip separators, spaces, dots, dashes, underscores, asterisks
    const collapsed = phonetic.replace(/[^a-z0-9]/g, '');

    // Deduplicated consecutive letters (e.g. chuuuuj -> chuj, kurrrwa -> kurwa)
    const deduplicated = collapsed.replace(/(.)\1+/g, '$1');

    // Handle ch -> h and h -> ch variants for chuj / huj, choj / hoj
    const hToCh = collapsed.replace(/\bh/g, 'ch');
    const hToChDedup = deduplicated.replace(/\bh/g, 'ch');

    return {
      raw: text,
      norm,
      leet,
      collapsed,
      deduplicated,
      hToCh,
      hToChDedup
    };
  }

  // Strong substring matches (these roots NEVER appear in legitimate Polish/English words or names)
  const STRONG_ROOTS = [
    // Polish
    'kurw', 'skurw', 'wkurw',
    'chuj', 'huj', 'choj', 'ch0j', 'chvj',
    'jeb', 'zjeb', 'pojeb', 'dojeb', 'wyjeb', 'najeb',
    'pierdol', 'pierdal', 'spierdal', 'wypierdal',
    'pizd',
    'cwel',
    'kutas',
    'dziwk',
    'szmat',
    'sukinsyn',
    'pedal', 'pedau',
    'pedofil',
    'gwalciciel',
    'czarnuch',
    'ciapaty',
    'rucha',
    'cipk', 'cipeczk', 'cipsk',
    'dupek',
    'guwno', 'gowno',

    // English & International
    'fuck', 'fuk', 'fck', 'motherfuck',
    'shit', 'shyt', 'bullshit',
    'bitch', 'btch',
    'cunt',
    'asshole', 'jackass', 'dumbass',
    'nigger', 'nigga',
    'faggot',
    'hitler', 'nazist', 'nazi',
    'porno', 'xvideos', 'hentai'
  ];

  // Exact / Word boundary matches (to prevent false positives with innocent words like cocktail, pass, compass)
  const BOUNDARY_PATTERNS = [
    /\b(cipa|cipo|cipy)\b/i,
    /\b(dupa|dupy|dupie)\b/i,
    /\b(suka|suki|suko)\b/i,
    /\b(ciul|ciulu|ciule)\b/i,
    /\b(frajer|frajerze|frajery)\b/i,
    /\b(cock|cocks|cocksucker)\b/i,
    /\b(dick|dicks|dickhead)\b/i,
    /\b(pussy|pussies)\b/i,
    /\b(whore|whores|slut|sluts)\b/i,
    /\b(bastard|bastards)\b/i,
    /\b(retard|retards)\b/i
  ];

  const EXACT_BAD_COLLAPSED = [
    'cipa', 'cipo', 'cipy', 'suka', 'suko', 'dupa', 'ciul', 'dick', 'cock', 'slut', 'fag'
  ];

  /**
   * Check if a given string contains offensive or vulgar words
   * @param {string} text - User input to check
   * @returns {boolean} true if offensive content is detected
   */
  function isOffensive(text) {
    if (!text || typeof text !== 'string') return false;

    const vars = getVariants(text);
    const toCheck = [vars.collapsed, vars.deduplicated, vars.hToCh, vars.hToChDedup];

    // 1. Check strong substring roots
    for (const root of STRONG_ROOTS) {
      for (const v of toCheck) {
        if (v.includes(root)) {
          return true;
        }
      }
    }

    // 2. Check boundary patterns on normalized text with spaces
    const wordsStr = `${vars.norm} ${vars.leet}`;
    for (const pattern of BOUNDARY_PATTERNS) {
      if (pattern.test(wordsStr) || pattern.test(vars.raw)) {
        return true;
      }
    }

    // 3. Explicit check for standalone words in collapsed representation
    for (const v of toCheck) {
      if (EXACT_BAD_COLLAPSED.includes(v)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validates a username format and content
   * @param {string} username
   * @returns {{ valid: boolean, error?: string, clean?: string }}
   */
  function validateUsername(username) {
    if (!username || typeof username !== 'string') {
      return { valid: false, error: "Nick nie może być pusty." };
    }

    const clean = username.trim().toLowerCase().replace(/^@/, '');
    if (clean.length < 3 || clean.length > 20) {
      return { valid: false, error: "Nick musi mieć od 3 do 20 znaków." };
    }

    if (!/^[a-z0-9_]+$/.test(clean)) {
      return { valid: false, error: "Nick może zawierać tylko małe litery alfabetu łacińskiego, cyfry i znak _." };
    }

    if (isOffensive(clean)) {
      return { valid: false, error: "Ten nick zawiera niedozwolone lub obraźliwe słowa. Wybierz inny." };
    }

    return { valid: true, clean };
  }

  /**
   * Validates a display name format and content
   * @param {string} displayName
   * @returns {{ valid: boolean, error?: string, clean?: string }}
   */
  function validateDisplayName(displayName) {
    if (!displayName || typeof displayName !== 'string') {
      return { valid: true, clean: "" };
    }

    const clean = displayName.trim();
    if (clean.length > 30) {
      return { valid: false, error: "Wyświetlana nazwa może mieć maksymalnie 30 znaków." };
    }

    if (clean.length > 0 && isOffensive(clean)) {
      return { valid: false, error: "Wyświetlana nazwa zawiera niedozwolone lub obraźliwe słowa." };
    }

    return { valid: true, clean };
  }

  /**
   * Validates user biography
   * @param {string} bio
   * @returns {{ valid: boolean, error?: string, clean?: string }}
   */
  function validateBio(bio) {
    if (!bio || typeof bio !== 'string') {
      return { valid: true, clean: "" };
    }

    const clean = bio.trim();
    if (clean.length > 200) {
      return { valid: false, error: "Opis bio może mieć maksymalnie 200 znaków." };
    }

    if (clean.length > 0 && isOffensive(clean)) {
      return { valid: false, error: "Opis bio zawiera niedozwolone lub obraźliwe słowa." };
    }

    return { valid: true, clean };
  }

  return {
    isOffensive,
    validateUsername,
    validateDisplayName,
    validateBio,
    normalizeText
  };
}));
