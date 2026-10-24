import { plural } from '../lib/time';

export const chooserStrings = {
  title: 'Ephemeris',
  domainsLabel: 'Domains',
  stat: (n: number) => ({
    value: n.toLocaleString('en-US'),
    label: n === 1 ? 'note in this Domain' : 'notes in this Domain',
  }),
  header: (domain: string, n: number) => ({ domain, count: n, noun: n === 1 ? 'Vault' : 'Vaults' }),
  noVaults: 'No Vaults yet',
  meta: (notes: number, edited: string | null) =>
    notes === 0
      ? 'No notes yet'
      : edited
        ? `${plural(notes, 'note')} · edited ${edited}`
        : plural(notes, 'note'),
  cardLabel: (name: string, meta: string) => `${name}, ${meta}`,
  editVault: (name: string) => `Edit Vault ${name}`,
  editTitle: 'Edit Vault',
  newVault: 'New Vault',
  newVaultHint: 'Pick a name, a Domain and a cover',
  arranging: 'Arranging',
  arrangeHint: 'Drag a card, or select one and press ← →',
  done: 'Done',
  hints: {
    select: 'Select',
    open: 'Open',
    domain: 'Domain',
    edit: 'Edit Vault',
    back: 'Back',
    arrange: 'Arrange',
    move: 'Move',
    done: 'Done',
    cancel: 'Cancel',
  },
  broken: 'vault.json needs fixing',
};
