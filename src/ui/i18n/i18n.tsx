import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from 'react'
import type { MessageKey } from './en'
import { format, type Lang, type Message, type MessageParams } from './language'

const LangContext = createContext<Lang>('en')

/** Gives its children the language; `<html lang>` follows it (AC-24). */
export function I18nProvider(props: { lang: Lang; children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = props.lang
  }, [props.lang])
  return (
    <LangContext.Provider value={props.lang}>
      {props.children}
    </LangContext.Provider>
  )
}

export const useLang = (): Lang => useContext(LangContext)

export type Translate = (key: MessageKey, params?: MessageParams) => string

/** `t(key, params)` in the current language; English without a provider. */
export function useT(): Translate {
  const lang = useLang()
  return useCallback(
    (key: MessageKey, params?: MessageParams) => format(lang, key, params),
    [lang],
  )
}

/** A `Message` from a service, in the current language. */
export const say = (t: Translate, m: Message) => t(m.key, m.params)

/** Text with `**name**` parts in bold. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text
        .split('**')
        .map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i}>{part}</strong>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          ),
        )}
    </>
  )
}
