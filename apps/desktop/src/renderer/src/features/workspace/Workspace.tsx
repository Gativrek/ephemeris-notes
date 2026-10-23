import { useApp } from '../../store/app';

/** Placeholder until M2 builds the workspace shell (SPECS 9). */
export function Workspace({ vaultPath }: { vaultPath: string }) {
  const vault = useApp((s) => s.vaults.find((v) => v.path === vaultPath));
  return (
    <main className="vx-firstrun" data-testid="workspace">
      <h1 className="vx-firstrun__title">{vault?.name ?? vaultPath}</h1>
      <button type="button" className="vx-btn" onClick={() => useApp.getState().showChooser()}>
        Switch Vault
      </button>
    </main>
  );
}
