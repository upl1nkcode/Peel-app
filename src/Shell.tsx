import { useEffect, useReducer, useRef, useState } from 'react'
import type { InstallEnv, InstallPrompt } from './services/install'
import type { OfflineStatus } from './services/segmentation'
import type { UpdateWatch } from './services/update'
import {
  EditorScreen,
  type EditorHandle,
  type EditorScreenProps,
} from './ui/editor/EditorScreen'
import {
  I18nProvider,
  readChoice,
  resolveChoice,
  say,
  useT,
  writeChoice,
  type LangChoice,
} from './ui/i18n'
import { ConfirmDialog } from './ui/library/ConfirmDialog'
import { InstallCard } from './ui/library/InstallCard'
import { InstallGuide } from './ui/library/InstallGuide'
import { installOffer } from './ui/library/installOffer'
import { LibraryScreen } from './ui/library/LibraryScreen'
import { MoreMenu } from './ui/library/MoreMenu'
import { UpdateBar } from './ui/library/UpdateBar'
import { useLibrary, type StickerDeps } from './ui/library/useLibrary'
import { useShareFiles, type ShareRenderer } from './ui/library/useShareFiles'

/** The browser around the app; tests pass their own. */
export interface ShellEnv extends InstallEnv {
  ua: string
  maxTouchPoints: number
  /** `navigator.languages`, for the Automatic language (spec 0013 AC-24). */
  languages: readonly string[]
  /** Where the language choice is kept. */
  storage: Storage | undefined
}

export interface ShellProps {
  editor: Omit<
    EditorScreenProps,
    'library' | 'handle' | 'onLibrary' | 'visible'
  >
  stickers: StickerDeps
  env: ShellEnv
  install?: InstallPrompt
  update?: UpdateWatch
  /** Starts the first-visit model download once the Library shows (spec 0013 AC-18). */
  prefetch?: (onStatus: (status: OfflineStatus) => void) => void
  /** Share from the Library (AC-8); without it there's no Share. */
  share?: {
    createRenderer: () => ShareRenderer
    nav: Pick<Navigator, 'share' | 'canShare'> | undefined
  }
  now?: () => Date
}

type Screen = 'library' | 'editor'
type Leaving = 'new' | 'changed'

const NEVER: InstallPrompt = {
  available: () => false,
  prompt: () => Promise.reject(new Error('no install prompt')),
  onChange: () => () => undefined,
}

const peelState = (state: unknown): string | undefined => {
  const peel = (state as { peel?: unknown } | null)?.peel
  return typeof peel === 'string' ? peel : undefined
}

/**
 * The app (spec 0013): the Library is home, the editor stays mounted behind
 * it. Opening the editor adds a history entry, so Android's Back gesture
 * (and the browser's Back) goes back like the "Library" button (Decision 14).
 */
export function Shell(props: ShellProps) {
  const [choice, setChoice] = useState<LangChoice>(() =>
    readChoice(props.env.storage),
  )
  return (
    <I18nProvider lang={resolveChoice(choice, props.env.languages)}>
      <Body
        {...props}
        choice={choice}
        onChoice={(c) => {
          writeChoice(c, props.env.storage)
          setChoice(c)
        }}
      />
    </I18nProvider>
  )
}

function Body(
  props: ShellProps & {
    choice: LangChoice
    onChoice: (choice: LangChoice) => void
  },
) {
  const t = useT()
  const library = useLibrary(props.stickers)
  const editor = useRef<EditorHandle>(null)
  const [screen, setScreenState] = useState<Screen>('library')
  const screenRef = useRef<Screen>('library')
  const [leaving, setLeavingState] = useState<Leaving | null>(null)
  const leavingRef = useRef<Leaving | null>(null)
  const [ticked, setTicked] = useState<readonly string[]>([])
  const [offline, setOffline] = useState<OfflineStatus | null>(null)
  const [guide, setGuide] = useState(false)
  const [cardClosed, setCardClosed] = useState(true)
  const [, installChanged] = useReducer((n: number) => n + 1, 0)
  const now = props.now ?? (() => new Date())

  const setScreen = (s: Screen) => {
    screenRef.current = s
    setScreenState(s)
  }
  const setLeaving = (l: Leaving | null) => {
    leavingRef.current = l
    setLeavingState(l)
  }

  const goEditor = () => {
    if (screenRef.current === 'editor') return
    setScreen('editor')
    window.history.pushState({ peel: 'editor' }, '')
  }
  /** The Library shows again; `pop` drops the editor's history entry too. */
  const goLibrary = (pop: boolean) => {
    setLeaving(null)
    setScreen('library')
    if (pop) window.history.back()
  }
  const requestLibrary = () => {
    const unsaved = editor.current?.unsaved() ?? 'none'
    if (unsaved === 'none') goLibrary(true)
    else setLeaving(unsaved)
  }

  // A reload keeps the history entry but opens on the Library.
  useEffect(() => {
    if (peelState(window.history.state)) window.history.replaceState(null, '')
  }, [])

  // Back gesture (Decision 14, Review Focus 4). Our own buttons change the
  // screen first, so their popstate finds nothing left to do.
  const onPop = (e: PopStateEvent) => {
    const target = peelState(e.state) ?? 'library'
    if (screenRef.current === 'library' || target === 'finish') return
    // On the Finish screen, Back closes it first.
    editor.current?.back()
    if (target === 'editor') return
    if (leavingRef.current) {
      // Back with the dialog open is Cancel.
      setLeaving(null)
      window.history.pushState({ peel: 'editor' }, '')
      return
    }
    const unsaved = editor.current?.unsaved() ?? 'none'
    if (unsaved === 'none') {
      goLibrary(false)
    } else {
      setLeaving(unsaved)
      window.history.pushState({ peel: 'editor' }, '')
    }
  }
  const popRef = useRef(onPop)
  useEffect(() => {
    popRef.current = onPop
  })
  useEffect(() => {
    const listener = (e: PopStateEvent) => {
      popRef.current(e)
    }
    window.addEventListener('popstate', listener)
    return () => {
      window.removeEventListener('popstate', listener)
    }
  }, [])

  // The first-visit download starts once the Library has shown (AC-18).
  const prefetched = useRef(false)
  useEffect(() => {
    if (prefetched.current) return
    prefetched.current = true
    props.prefetch?.(setOffline)
  }, [props])

  useEffect(() => props.install?.onChange(installChanged), [props.install])

  useEffect(() => {
    if (!library.store) return
    let alive = true
    void library.meta.get('installCardClosed').then(
      (v) => {
        if (alive) setCardClosed(v === true)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
    // Read once when the store opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.store])

  const offer = installOffer(props.env, props.install ?? NEVER, () => {
    setGuide(true)
  })
  const share = useShareFiles(screen === 'library' ? ticked : [], {
    store: library.store,
    createRenderer: props.share?.createRenderer ?? noRenderer,
    now,
    nav: props.share?.nav,
  })
  const message = library.message?.map((m) => say(t, m)).join('\n') ?? null

  return (
    <main>
      <div hidden={screen !== 'library'} inert={screen !== 'library'}>
        <LibraryScreen
          stickers={library.stickers}
          blocked={library.blocked && t(library.blocked)}
          message={message}
          busy={library.busy}
          onNew={(file) => {
            void editor.current?.openFile(file).then((error) => {
              if (error) {
                library.say([{ key: error }])
                return
              }
              library.say(null)
              goEditor()
            })
          }}
          onOpen={(id) => {
            void editor.current?.openSticker(id).then((ok) => {
              if (ok) goEditor()
            })
          }}
          onDuplicate={library.duplicate}
          onExport={library.exportSome}
          onDelete={async (ids) => {
            await library.remove(ids)
            editor.current?.deleted(ids)
          }}
          onTicked={setTicked}
          share={share}
          menu={
            <MoreMenu
              canExportAll={
                library.stickers.length > 0 &&
                library.blocked === null &&
                !library.busy
              }
              canImport={
                library.store !== null &&
                library.blocked === null &&
                !library.busy
              }
              onExportAll={() => {
                void library.exportSome(null)
              }}
              onImport={(file) => {
                void library.importFile(file)
              }}
              choice={props.choice}
              onChoice={props.onChoice}
              install={offer}
              storageLine={library.status ? t(library.status) : ''}
              offline={offline}
            />
          }
          top={
            <>
              {props.update && <UpdateBar watch={props.update} />}
              {!cardClosed && (
                <InstallCard
                  offer={offer}
                  stickers={library.stickers.length}
                  onClose={() => {
                    setCardClosed(true)
                    void library.meta.set('installCardClosed', true)
                  }}
                />
              )}
            </>
          }
        />
      </div>
      <EditorScreen
        {...props.editor}
        library={library}
        handle={editor}
        onLibrary={requestLibrary}
        visible={screen === 'editor'}
      />
      {leaving && (
        <ConfirmDialog
          title={t(leaving === 'new' ? 'unsaved.new' : 'unsaved.changed')}
          actions={[
            {
              label: t('common.save'),
              kind: 'primary',
              onClick: () => {
                void editor.current?.save().then((ok) => {
                  if (ok) goLibrary(true)
                  else setLeaving(null)
                })
              },
            },
            {
              label: t('unsaved.dontSave'),
              kind: 'danger',
              onClick: () => {
                goLibrary(true)
              },
            },
            {
              label: t('common.cancel'),
              kind: 'plain',
              onClick: () => {
                setLeaving(null)
              },
            },
          ]}
          onCancel={() => {
            setLeaving(null)
          }}
        />
      )}
      {guide && (
        <InstallGuide
          onClose={() => {
            setGuide(false)
          }}
        />
      )}
    </main>
  )
}

const noRenderer = (): ShareRenderer => {
  throw new Error('no share renderer')
}
