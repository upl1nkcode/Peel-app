import { format, type Message } from '../ui/i18n'

/** Messages as the English UI words them: one joined line (spec 0013). */
export const english = (messages: Message | readonly Message[]): string =>
  (Array.isArray(messages) ? messages : [messages])
    .map((m: Message) => format('en', m.key, m.params))
    .join(' ')

/** Each message on its own, in English. */
export const englishLines = (messages: readonly Message[]): string[] =>
  messages.map((m) => format('en', m.key, m.params))
