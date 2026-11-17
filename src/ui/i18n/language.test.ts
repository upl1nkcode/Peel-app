import { describe, expect, it } from 'vitest'
import { en } from './en'
import { format, pickLanguage, readChoice, writeChoice } from './language'
import { ro } from './ro'

const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('languages (spec 0013)', () => {
  it('should_pick_romanian_only_when_it_comes_first (AC-24)', () => {
    expect(pickLanguage(['ro-RO', 'en'])).toBe('ro')
    expect(pickLanguage(['ro'])).toBe('ro')
    expect(pickLanguage(['ro-MD'])).toBe('ro')
    expect(pickLanguage(['en-GB', 'ro'])).toBe('en')
    expect(pickLanguage(['de', 'ro'])).toBe('ro')
    expect(pickLanguage(['de', 'fr'])).toBe('en')
    expect(pickLanguage([])).toBe('en')
    // "rom" or "roa" are other languages, not Romanian.
    expect(pickLanguage(['roa', 'en'])).toBe('en')
  })

  it('should_keep_the_two_catalogs_alike (AC-26)', () => {
    expect(Object.keys(ro).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      const enForms = en[key].split('|')
      const roForms = ro[key].split('|')
      const want = placeholders(en[key]).filter((p, i, a) => a.indexOf(p) === i)
      expect(
        [...new Set(placeholders(ro[key]))],
        `placeholders of ${key}`,
      ).toEqual(want)
      if (key.endsWith('_plural')) {
        expect(enForms, `en forms of ${key}`).toHaveLength(2)
        expect(roForms, `ro forms of ${key}`).toHaveLength(3)
      } else {
        expect(enForms, `${key} has no plural forms`).toHaveLength(1)
        expect(roForms, `${key} has no plural forms`).toHaveLength(1)
      }
    }
  })

  it('should_use_comma_below_letters (AC-26)', () => {
    const cedilla = /[ŞşŢţ]/
    for (const [key, value] of Object.entries(ro)) {
      expect(cedilla.test(value), `${key}: ${value}`).toBe(false)
    }
  })

  it('should_choose_romanian_plural_forms (AC-26)', () => {
    const say = (n: number) =>
      format('ro', 'library.selected_plural', { count: n })
    expect(say(1)).toBe('1 autocolant selectat')
    expect(say(2)).toBe('2 autocolante selectate')
    expect(say(20)).toBe('20 de autocolante selectate')
    expect(format('en', 'library.selected_plural', { count: 1 })).toBe(
      '1 selected',
    )
    expect(format('en', 'library.selected_plural', { count: 3 })).toBe(
      '3 selected',
    )
  })

  it('should_fill_placeholders (AC-26)', () => {
    expect(format('en', 'offline.downloading', { percent: 42 })).toBe(
      'Downloading for offline use… 42%',
    )
  })

  it('should_keep_the_choice_when_storage_throws (AC-24)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(readChoice(broken)).toBe('auto')
    expect(() => {
      writeChoice('ro', broken)
    }).not.toThrow()
    const items = new Map<string, string>()
    const ok = {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
    } as unknown as Storage
    writeChoice('ro', ok)
    expect(items.get('peel.language')).toBe('ro')
    expect(readChoice(ok)).toBe('ro')
    items.set('peel.language', 'klingon')
    expect(readChoice(ok)).toBe('auto')
    expect(readChoice(undefined)).toBe('auto')
  })
})
