/**
 * H3: business enums are displayed through label maps that live in `shared/`,
 * where the UI dictionary cannot reach them. Rather than duplicating every map
 * at each call site, the maps stay French (the reference) and are wrapped here:
 * the same object answers in English once the interface language is switched.
 *
 * The wrapper is a Proxy, so the ~100 existing `LABEL[value]` call sites keep
 * working unchanged and cannot drift from the dictionary.
 */
export type LabelLanguage = 'fr' | 'en';

let language: LabelLanguage = 'fr';

export function setLabelLanguage(next: string | null | undefined): void {
  language = next === 'en' ? 'en' : 'fr';
}

export function getLabelLanguage(): LabelLanguage {
  return language;
}

/**
 * `fr` is the reference map; `en` only overrides the keys that are translated,
 * so a key added to French still reads correctly in English until translated.
 */
export function localised<T extends Record<string, string>>(
  fr: T,
  en: Partial<Record<keyof T, string>>,
): T {
  return new Proxy(fr, {
    get(target, property, receiver) {
      if (language === 'en' && typeof property === 'string') {
        const translated = en[property as keyof T];
        if (translated) return translated;
      }
      return Reflect.get(target, property, receiver);
    },
    // `Object.keys`/spread must keep returning the enum keys, not proxy traps.
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
  }) as T;
}
