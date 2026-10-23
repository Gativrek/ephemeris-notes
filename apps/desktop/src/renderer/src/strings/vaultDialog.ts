export const vaultDialogStrings = {
  newTitle: 'New Vault',
  editTitle: 'Edit Vault',
  name: 'Vault Name',
  domain: 'Domain',
  cover: 'Cover',
  chooseImage: 'Choose Image…',
  replaceImage: 'Replace Image…',
  removeImage: 'Remove Image',
  coverHint: 'Best at 600 × 1140 px or larger. PNG, JPG or WebP.',
  focus: 'Focus point',
  focusHint: 'Click or drag on the image, or use the arrow keys, to choose the part that stays in view.',
  zoom: 'Zoom',
  preview: 'Preview',
  create: 'Create Vault',
  save: 'Save Changes',
  cancel: 'Cancel',
  delete: 'Delete Vault…',
  errors: {
    empty: 'Give the Vault a name.',
    long: 'Use at most 60 characters.',
    taken: 'A Vault with this name already exists in this Domain.',
  },
  move: {
    title: (domain: string) => `Move this Vault to ${domain}?`,
    body: (notes: number, linking: number) =>
      `Its folder moves, with ${notes} ${notes === 1 ? 'note' : 'notes'}. ` +
      (linking === 0
        ? 'No notes elsewhere link to it by path.'
        : `${linking} ${linking === 1 ? 'note elsewhere links' : 'notes elsewhere link'} to it by path; links by name keep working.`),
    confirm: 'Move Vault',
  },
  remove: {
    body: (name: string) =>
      `The Vault folder and everything in it go to the trash. Type "${name}" to confirm.`,
    label: 'Vault name',
    confirm: 'Delete Vault',
  },
};
