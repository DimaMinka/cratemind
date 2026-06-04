/**
 * KeyboardService.ts
 *
 * Utility to map Cyrillic input characters (from Russian keyboard layout)
 * to their corresponding QWERTY Latin characters. This allows hotkeys to
 * work seamlessly across layout changes.
 */

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  // Lowercase (Standard ЙЦУКЕН + Phonetic QWERTY)
  й: 'q', // standard q
  я: 'q', // phonetic q (standard z)
  ц: 'c', // phonetic c (standard w)
  с: 'c', // standard c
  у: 'e', // standard e
  к: 'r', // standard r
  е: 't', // standard t
  н: 'y', // standard y / phonetic n (mapped to y for Yes support)
  ы: 'y', // phonetic y (standard s)
  т: 'n', // standard n
  г: 'u',
  ш: 'i',
  щ: 'o',
  з: 'p', // standard p
  п: 'p', // phonetic p (standard g)
  ф: 'a', // standard a
  а: 'a', // phonetic a
  в: 'v', // phonetic v (standard d)
  м: 'v', // standard v
  л: 'l', // phonetic l (standard k)
  д: 'l', // standard l
  // Uppercase (Standard ЙЦУКЕН + Phonetic QWERTY)
  Й: 'Q',
  Я: 'Q',
  Ц: 'C',
  С: 'C',
  У: 'E',
  К: 'R',
  Е: 'T',
  Н: 'Y',
  Ы: 'Y',
  Т: 'N',
  Г: 'U',
  Ш: 'I',
  Щ: 'O',
  З: 'P',
  П: 'P',
  Ф: 'A',
  А: 'A',
  В: 'V',
  М: 'V',
  Л: 'L',
  Д: 'L'
};

/**
 * Normalizes input key character, converting Cyrillic symbols to their Latin layout equivalents.
 */
export function normalizeKey(input: string): string {
  if (!input) return input;
  if (input.length === 1 && CYRILLIC_TO_LATIN_MAP[input]) {
    return CYRILLIC_TO_LATIN_MAP[input];
  }
  return input;
}
