/**
 * Every user-facing text in English (spec 0013 AC-25). Keys ending in
 * `_plural` hold the forms for `Intl.PluralRules('en')`, "one|other".
 * `**word**` marks a name shown in bold.
 */
export const en = {
  // Shared
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.delete': 'Delete',
  'common.somethingWrong': 'Something went wrong. Try again.',

  // Editor
  'editor.photo': 'Photo',
  'editor.done': 'Done',
  'editor.stickers': 'Stickers',
  'editor.library': 'Library',
  'editor.pickPhoto': 'Pick a photo',
  'editor.undo': 'Undo',
  'editor.redo': 'Redo',
  'editor.resetAuto': 'Reset to auto',
  'editor.compare': 'Compare',
  'editor.tools': 'Tools',
  'editor.differentSize':
    'This photo opened at a different size here; the outline may be off.',
  'photo.unreadable': "This photo can't be opened. Try a JPEG or PNG.",

  'tool.auto': 'Auto',
  'tool.lasso': 'Lasso',
  'tool.dots': 'Dots',
  'tool.brush': 'Brush',
  'tool.view': 'View',

  'view.overlay': 'Overlay',
  'view.checkerboard': 'Checkerboard',
  'view.black': 'Black',
  'view.white': 'White',
  'view.red': 'Red',

  // Auto (spec 0007)
  'auto.hint': 'Tap to add · Hold to remove · Slide to aim',
  'auto.useLasso': 'Use Lasso',
  'auto.offline': "You're offline. The cutout model needs one download first.",
  'auto.download':
    "The cutout model didn't download. Check the connection and try again.",
  'auto.storage': 'Not enough storage for the cutout model.',
  'auto.unsupported': "Auto cutout doesn't work in this browser.",
  'auto.nothingFound': 'Nothing found there. Tap on the subject.',
  'auto.sharperReady': 'Sharper cutout ready',
  'auto.preciseUnavailable': 'Sharper cutout not available on this device',
  'auto.cutting': 'Cutting out…',
  'auto.sharpening': 'Sharpening…',
  'auto.downloading': 'Downloading cutout model: {loaded} of {total} MB',

  // Dots (spec 0010)
  'dots.hint':
    'Drag a dot · Tap the line to add · Double-tap to delete · Hold for corner',
  'dots.emptyHint': 'Start with a shape, or use Auto',
  'dots.fine': 'Fine',
  'dots.rectangle': 'Rectangle',
  'dots.ellipse': 'Ellipse',
  'dots.fewer': 'Fewer',
  'dots.slider': 'Dots',
  'dots.more': 'More',
  'dots.nudge.left': 'Nudge left',
  'dots.nudge.up': 'Nudge up',
  'dots.nudge.down': 'Nudge down',
  'dots.nudge.right': 'Nudge right',

  // Lasso (spec 0011)
  'lasso.hint': 'Trace around it with one finger · Lift to pause',
  'lasso.openHint': 'Drag the end dot to go on · End at the start to close',
  'lasso.busyHint': 'Making dots…',
  'lasso.add': 'Add',
  'lasso.subtract': 'Subtract',
  'lasso.mode': 'Lasso mode',
  'lasso.snap': 'Snap to edges',
  'lasso.raw': 'Raw',
  'lasso.smoothing': 'Smoothing',
  'lasso.smooth': 'Smooth',
  'lasso.finish': 'Finish',
  'lasso.discard': 'Discard',
  'lasso.invalid': 'Draw around the area to cut out',
  'lasso.snapFailed': "Couldn't snap to edges here, kept your line",

  // Brush (spec 0011)
  'brush.eraseHint': 'Paint over what to remove',
  'brush.restoreHint': 'Paint over what to bring back',
  'brush.erase': 'Erase',
  'brush.restore': 'Restore',
  'brush.mode': 'Brush mode',
  'brush.size': 'Size',
  'brush.sizeValue': 'Size {px} px',
  'brush.hardness': 'Hardness',
  'brush.hardnessValue': 'Hardness {percent}%',

  // Stickers and storage (spec 0008)
  'stickers.panel': 'Saved stickers',
  'stickers.exportAll': 'Export all',
  'stickers.import': 'Import',
  'stickers.open': 'Open sticker',
  'stickers.deleteOne': 'Delete this sticker?',
  'stickers.nothingToSave': 'Nothing to save: the cutout is empty.',
  'stickers.notABackup': "This file isn't a Peel backup.",
  'stickers.tooBigForZip':
    'Too many stickers for one backup file. Delete some, then export again.',
  'storage.persisted': 'Stickers are kept on this device.',
  'storage.notPersisted':
    "Your browser may clear stickers if Peel isn't used for a while. Add Peel to your Home Screen, or export a backup.",
  'storage.full':
    'Not enough space to save this sticker. Delete some stickers or free up space on your phone.',
  'storage.outdated':
    'Peel was updated in another tab. Reload to use your stickers.',
  'storage.unavailable': "Stickers can't be saved in this browser.",
  'import.result_plural':
    'Imported {count} sticker.|Imported {count} stickers.',
  'import.existing': '{count} were already here.',
  'import.damaged': "{count} couldn't be read.",

  // Finish (spec 0012)
  'finish.region': 'Finish sticker',
  'finish.back': 'Back',
  'finish.title': 'Finish',
  'finish.preview': 'Sticker preview',
  'finish.preparing': 'Preparing…',
  'finish.output': 'Output',
  'finish.out.sticker': 'Sticker',
  'finish.out.original': 'Original',
  'finish.out.whatsapp': 'WhatsApp-style',
  'finish.outline': 'Outline',
  'finish.outlineColour': 'Outline colour',
  'finish.white': 'White',
  'finish.black': 'Black',
  'finish.width': 'Width',
  'finish.widthValue': 'Width {value}%',
  'finish.softness': 'Edge softness',
  'finish.softnessValue': 'Softness {value} px',
  'finish.padding': 'Padding',
  'finish.paddingValue': 'Padding {value}%',
  'finish.share': 'Share',
  'finish.copy': 'Copy',
  'finish.copied': 'Copied',
  'finish.download': 'Download',
  'finish.shareFailed': "Couldn't share. Try Download instead.",
  'finish.copyFailed': "Couldn't copy. Try Share or Download instead.",
  'finish.empty': 'Nothing is selected yet.',
  'finish.tooLarge':
    'This sticker is too detailed for WhatsApp-style (over 100 KB). Try the Sticker output.',
  'finish.encoderUnavailable':
    "Couldn't load the WebP encoder. Connect to the internet and try again.",
  'finish.failed': "Couldn't make the file. Try again.",

  // iPhone "Add to Stickers" guide (spec 0012 AC-19)
  'guide.toggle': 'How to add to iPhone Stickers',
  'guide.share1': 'Choose **Sticker**, then tap **Share**.',
  'guide.share2': 'Tap **Save Image**.',
  'guide.download1': 'Choose **Sticker**, then tap **Download**.',
  'guide.download2':
    'Open the download and tap **Share**, then **Save Image**.',
  'guide.step3': 'Open **Photos** and open the image.',
  'guide.step4': 'Touch and hold the sticker until it lifts, then let go.',
  'guide.step5': 'Tap **Add Sticker**.',
  'guide.after':
    'Your sticker is now in the stickers of Messages and the keyboard.',

  // Library (spec 0013)
  'library.select': 'Select',
  'library.done': 'Done',
  'library.new': 'New sticker',
  'library.emptyTitle': 'No stickers yet',
  'library.emptyBody': 'Tap + to make your first one.',
  'library.open': 'Open sticker',
  'library.selected_plural': '{count} selected|{count} selected',
  'library.share': 'Share',
  'library.duplicate': 'Duplicate',
  'library.export': 'Export',
  'library.delete': 'Delete',
  'library.preparing': 'Preparing…',
  'library.shareFailed': "Couldn't share. Try Export instead.",
  'library.deleteOne': 'Delete this sticker?',
  'library.deleteMany_plural':
    'Delete {count} sticker?|Delete {count} stickers?',
  'library.cantUndo': "This can't be undone.",
  'unsaved.changed': 'Save changes to this sticker?',
  'unsaved.new': 'Save this sticker?',
  'unsaved.dontSave': "Don't save",

  'menu.more': 'More',
  'menu.exportAll': 'Export all',
  'menu.import': 'Import',
  'menu.language': 'Language',
  'menu.install': 'Install Peel',
  'lang.auto': 'Automatic',
  'lang.en': 'English',
  'lang.ro': 'Română',

  'install.card':
    "Install Peel to keep your stickers safe. Browsers can clear a website's data after a few days without a visit.",
  'install.cardInstall': 'Install',
  'install.guideTitle': 'Install Peel',
  'install.step1':
    "Tap **Share** in Safari (on newer iPhones it's in the **⋯** menu).",
  'install.step2':
    "Tap **Add to Home Screen**. If you don't see it, tap **View More**.",
  'install.step3': 'Tap **Add**, then open Peel from your Home Screen.',
  'install.after':
    'Your stickers stay on this phone, and Peel works without internet.',

  'offline.downloading': 'Downloading for offline use… {percent}%',
  'offline.ready': 'Ready to use offline.',
  'offline.needsInternet': 'Auto needs the internet the first time.',

  'update.ready': 'A new version of Peel is ready.',
  'update.reload': 'Reload',
} as const

export type MessageKey = keyof typeof en
