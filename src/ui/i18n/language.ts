import { en, type MessageKey } from './en'
import { ro } from './ro'

export type Lang = 'en' | 'ro'
export type LangChoice = 'auto' | Lang
export type MessageParams = Record<string, string | number>

/** A message to show, as data: services return these and the UI formats them. */
export interface Message {
  key: MessageKey
  params?: MessageParams
}

const CATALOGS: Record<Lang, Record<MessageKey, string>> = { en, ro }
/** `Intl.PluralRules` categories each language uses, in the order its `_plural` forms are written. */
const PLURAL_ORDER: Record<Lang, readonly Intl.LDMLPluralRule[]> = {
  en: ['one', 'other'],
  ro: ['one', 'few', 'other'],
}
const STORAGE_KEY = 'peel.language'

/** AC-24: the first of the phone's languages that is English or Romanian wins; English otherwise. */
export function pickLanguage(languages: readonly string[]): Lang {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'ro') return 'ro'
    if (base === 'en') return 'en'
  }
  return 'en'
}

/** The text of `key` in `lang`, with `{name}` replaced; `_plural` keys pick the form for `params.count`. */
export function format(
  lang: Lang,
  key: MessageKey,
  params: MessageParams = {},
): string {
  let text = CATALOGS[lang][key]
  if (key.endsWith('_plural')) {
    const forms = text.split('|')
    const category = new Intl.PluralRules(lang).select(Number(params.count))
    const at = PLURAL_ORDER[lang].indexOf(category)
    text = forms[at >= 0 ? at : forms.length - 1] ?? text
  }
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}

/** AC-24, Decision 12: the kept choice; anything unreadable is "auto". */
export function readChoice(storage: Storage | undefined): LangChoice {
  try {
    const v = storage?.getItem(STORAGE_KEY)
    return v === 'en' || v === 'ro' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeChoice(choice: LangChoice, storage: Storage | undefined) {
  try {
    storage?.setItem(STORAGE_KEY, choice)
  } catch {
    // A blocked storage only means the choice isn't kept.
  }
}

/** The language a choice means on this phone. */
export const resolveChoice = (
  choice: LangChoice,
  languages: readonly string[],
): Lang => (choice === 'auto' ? pickLanguage(languages) : choice)
