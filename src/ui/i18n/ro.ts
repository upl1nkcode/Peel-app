import type { MessageKey } from './en'

/**
 * Every user-facing text in Romanian (spec 0013 AC-26): ș and ț with a comma
 * below. Keys ending in `_plural` hold "one|few|other" for
 * `Intl.PluralRules('ro')`: 1 autocolant, 2 autocolante, 20 de autocolante.
 */
export const ro: Record<MessageKey, string> = {
  'common.save': 'Salvează',
  'common.saved': 'Salvat',
  'common.cancel': 'Anulează',
  'common.close': 'Închide',
  'common.delete': 'Șterge',
  'common.somethingWrong': 'Ceva n-a mers. Încearcă din nou.',

  'editor.photo': 'Poză',
  'editor.done': 'Gata',
  'editor.stickers': 'Autocolante',
  'editor.library': 'Bibliotecă',
  'editor.pickPhoto': 'Alege o poză',
  'editor.undo': 'Desfă',
  'editor.redo': 'Refă',
  'editor.resetAuto': 'Revino la automat',
  'editor.compare': 'Compară',
  'editor.tools': 'Instrumente',
  'editor.differentSize':
    'Poza s-a deschis aici la altă dimensiune; conturul poate fi deplasat.',
  'photo.unreadable':
    'Poza asta nu poate fi deschisă. Încearcă un JPEG sau un PNG.',

  'tool.auto': 'Auto',
  'tool.lasso': 'Lasou',
  'tool.dots': 'Puncte',
  'tool.brush': 'Pensulă',
  'tool.view': 'Fundal',

  'view.overlay': 'Suprapunere',
  'view.checkerboard': 'Tablă de șah',
  'view.black': 'Negru',
  'view.white': 'Alb',
  'view.red': 'Roșu',

  'auto.hint':
    'Atinge ca să adaugi · Ține apăsat ca să elimini · Glisează ca să țintești',
  'auto.useLasso': 'Folosește lasoul',
  'auto.offline':
    'Ești offline. Modelul de decupare trebuie descărcat o dată mai întâi.',
  'auto.download':
    'Modelul de decupare nu s-a descărcat. Verifică conexiunea și încearcă din nou.',
  'auto.storage': 'Nu e destul spațiu pentru modelul de decupare.',
  'auto.unsupported': 'Decuparea automată nu merge în acest browser.',
  'auto.nothingFound': 'N-am găsit nimic acolo. Atinge subiectul.',
  'auto.sharperReady': 'Decupajul mai precis e gata',
  'auto.preciseUnavailable':
    'Decupajul mai precis nu e disponibil pe acest dispozitiv',
  'auto.cutting': 'Se decupează…',
  'auto.sharpening': 'Se rafinează…',
  'auto.downloading':
    'Se descarcă modelul de decupare: {loaded} din {total} MB',

  'dots.hint':
    'Trage un punct · Atinge linia ca să adaugi · Atinge de două ori ca să ștergi · Ține apăsat pentru colț',
  'dots.emptyHint': 'Începe cu o formă sau folosește Auto',
  'dots.fine': 'Fin',
  'dots.rectangle': 'Dreptunghi',
  'dots.ellipse': 'Elipsă',
  'dots.fewer': 'Mai puține',
  'dots.slider': 'Puncte',
  'dots.more': 'Mai multe',
  'dots.nudge.left': 'Mută la stânga',
  'dots.nudge.up': 'Mută în sus',
  'dots.nudge.down': 'Mută în jos',
  'dots.nudge.right': 'Mută la dreapta',

  'lasso.hint': 'Conturează cu un deget · Ridică degetul ca să faci pauză',
  'lasso.openHint':
    'Trage punctul de la capăt ca să continui · Termină în punctul de start ca să închizi',
  'lasso.busyHint': 'Se fac punctele…',
  'lasso.add': 'Adaugă',
  'lasso.subtract': 'Scade',
  'lasso.mode': 'Modul lasoului',
  'lasso.snap': 'Lipește de margini',
  'lasso.raw': 'Brut',
  'lasso.smoothing': 'Netezire',
  'lasso.smooth': 'Neted',
  'lasso.finish': 'Termină',
  'lasso.discard': 'Renunță',
  'lasso.invalid': 'Desenează în jurul zonei de decupat',
  'lasso.snapFailed': 'Nu s-a putut lipi de margini aici, am păstrat linia ta',

  'brush.eraseHint': 'Pictează peste ce vrei să elimini',
  'brush.restoreHint': 'Pictează peste ce vrei să aduci înapoi',
  'brush.erase': 'Șterge',
  'brush.restore': 'Restaurează',
  'brush.mode': 'Modul pensulei',
  'brush.size': 'Mărime',
  'brush.sizeValue': 'Mărime {px} px',
  'brush.hardness': 'Duritate',
  'brush.hardnessValue': 'Duritate {percent}%',

  'stickers.panel': 'Autocolante salvate',
  'stickers.exportAll': 'Exportă tot',
  'stickers.import': 'Importă',
  'stickers.open': 'Deschide autocolantul',
  'stickers.deleteOne': 'Ștergi acest autocolant?',
  'stickers.nothingToSave': 'Nimic de salvat: decupajul e gol.',
  'stickers.notABackup': 'Acest fișier nu e o copie de rezervă Peel.',
  'stickers.tooBigForZip':
    'Prea multe autocolante pentru un singur fișier de rezervă. Șterge câteva, apoi exportă din nou.',
  'storage.persisted': 'Autocolantele sunt păstrate pe acest dispozitiv.',
  'storage.notPersisted':
    'Browserul poate șterge autocolantele dacă nu folosești Peel o vreme. Adaugă Peel pe ecranul principal sau exportă o copie de rezervă.',
  'storage.full':
    'Nu e destul spațiu ca să salvezi acest autocolant. Șterge câteva autocolante sau eliberează spațiu pe telefon.',
  'storage.outdated':
    'Peel a fost actualizat în altă filă. Reîncarcă pagina ca să-ți folosești autocolantele.',
  'storage.unavailable': 'Autocolantele nu pot fi salvate în acest browser.',
  'import.result_plural':
    'Am importat {count} autocolant.|Am importat {count} autocolante.|Am importat {count} de autocolante.',
  'import.existing': '{count} erau deja aici.',
  'import.damaged': '{count} nu au putut fi citite.',

  'finish.region': 'Finalizează autocolantul',
  'finish.back': 'Înapoi',
  'finish.title': 'Finalizare',
  'finish.preview': 'Previzualizarea autocolantului',
  'finish.preparing': 'Se pregătește…',
  'finish.output': 'Rezultat',
  'finish.out.sticker': 'Autocolant',
  'finish.out.original': 'Original',
  'finish.out.whatsapp': 'Stil WhatsApp',
  'finish.outline': 'Contur',
  'finish.outlineColour': 'Culoarea conturului',
  'finish.white': 'Alb',
  'finish.black': 'Negru',
  'finish.width': 'Lățime',
  'finish.widthValue': 'Lățime {value}%',
  'finish.softness': 'Moliciunea marginii',
  'finish.softnessValue': 'Moliciune {value} px',
  'finish.padding': 'Spațiu în jur',
  'finish.paddingValue': 'Spațiu în jur {value}%',
  'finish.share': 'Partajează',
  'finish.copy': 'Copiază',
  'finish.copied': 'Copiat',
  'finish.download': 'Descarcă',
  'finish.shareFailed': 'Nu s-a putut partaja. Încearcă Descarcă.',
  'finish.copyFailed': 'Nu s-a putut copia. Încearcă Partajează sau Descarcă.',
  'finish.empty': 'Nu e nimic selectat încă.',
  'finish.tooLarge':
    'Autocolantul e prea detaliat pentru stilul WhatsApp (peste 100 KB). Încearcă rezultatul Autocolant.',
  'finish.encoderUnavailable':
    'Nu s-a putut încărca codorul WebP. Conectează-te la internet și încearcă din nou.',
  'finish.failed': 'Nu s-a putut face fișierul. Încearcă din nou.',

  'guide.toggle': 'Cum îl adaugi la autocolantele iPhone',
  'guide.share1': 'Alege **Autocolant**, apoi atinge **Partajează**.',
  'guide.share2': 'Atinge **Salvează imaginea**.',
  'guide.download1': 'Alege **Autocolant**, apoi atinge **Descarcă**.',
  'guide.download2':
    'Deschide descărcarea și atinge **Partajează**, apoi **Salvează imaginea**.',
  'guide.step3': 'Deschide **Poze** și deschide imaginea.',
  'guide.step4':
    'Ține apăsat pe autocolant până se ridică, apoi ridică degetul.',
  'guide.step5': 'Atinge **Adaugă autocolant**.',
  'guide.after':
    'Autocolantul tău e acum printre autocolantele din Mesaje și de pe tastatură.',

  'library.select': 'Selectează',
  'library.done': 'Gata',
  'library.new': 'Autocolant nou',
  'library.emptyTitle': 'Niciun autocolant încă',
  'library.emptyBody': 'Atinge + ca să-l faci pe primul.',
  'library.open': 'Deschide autocolantul',
  'library.selected_plural':
    '{count} autocolant selectat|{count} autocolante selectate|{count} de autocolante selectate',
  'library.share': 'Partajează',
  'library.duplicate': 'Duplică',
  'library.export': 'Exportă',
  'library.delete': 'Șterge',
  'library.preparing': 'Se pregătește…',
  'library.shareFailed': 'Nu s-a putut partaja. Încearcă Exportă.',
  'library.shareLimit':
    'Poți partaja cel mult {count} autocolante odată. Exportul merge cu oricâte.',
  'library.deleteOne': 'Ștergi acest autocolant?',
  'library.deleteMany_plural':
    'Ștergi {count} autocolant?|Ștergi {count} autocolante?|Ștergi {count} de autocolante?',
  'library.cantUndo': 'Nu se poate anula.',
  'unsaved.changed': 'Salvezi modificările acestui autocolant?',
  'unsaved.new': 'Salvezi acest autocolant?',
  'unsaved.dontSave': 'Nu salva',

  'menu.more': 'Mai multe',
  'menu.exportAll': 'Exportă tot',
  'menu.import': 'Importă',
  'menu.language': 'Limbă',
  'menu.install': 'Instalează Peel',
  'lang.auto': 'Automat',
  'lang.en': 'English',
  'lang.ro': 'Română',

  'install.card':
    'Instalează Peel ca să-ți păstrezi autocolantele în siguranță. Browserele pot șterge datele unui site după câteva zile fără vizite.',
  'install.cardInstall': 'Instalează',
  'install.guideTitle': 'Instalează Peel',
  'install.step1':
    'Atinge **Partajează** în Safari (pe iPhone-urile mai noi e în meniul **⋯**).',
  'install.step2':
    'Atinge **Adaugă pe ecranul principal**. Dacă nu vezi opțiunea, atinge **Vezi mai multe**.',
  'install.step3':
    'Atinge **Adaugă**, apoi deschide Peel de pe ecranul principal.',
  'install.after':
    'Autocolantele rămân pe acest telefon, iar Peel merge fără internet.',

  'offline.downloading': 'Se descarcă pentru folosire offline… {percent}%',
  'offline.ready': 'Gata de folosit offline.',
  'offline.needsInternet': 'Auto are nevoie de internet prima dată.',

  'update.ready': 'O versiune nouă de Peel e gata.',
  'update.reload': 'Reîncarcă',
}
