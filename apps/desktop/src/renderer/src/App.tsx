import { useEffect } from 'react';
import { Chooser } from './features/chooser/Chooser';
import { FirstRun } from './features/firstrun/FirstRun';
import { VaultDialog } from './features/vault-dialog/VaultDialog';
import { Workspace } from './features/workspace/Workspace';
import { applyTheme } from './lib/theme';
import { unwrap, vx } from './lib/vx';
import { useApp } from './store/app';
import { recording } from './lib/hotkeys';
import { stopPlugins } from './plugins/host';
import { saveAll } from './workspace/docs';

export function App() {
  const library = useApp((s) => s.library);
  const screen = useApp((s) => s.screen);
  const dialog = useApp((s) => s.dialog);
  const openVault = useApp((s) => s.openVault);

  useEffect(() => {
    const app = useApp.getState;
    const offLib = vx().library.onChanged((lib) => void app().setLibrary(lib));
    const offVaults = vx().vaults.onChanged(() => void app().refreshVaults());
    void unwrap(vx().library.current()).then(
      (lib) => app().setLibrary(lib),
      () => app().setLibrary(null),
    );
    const offTheme = applyTheme();
    // Save before the window closes (SPECS 4.8 rule 8), whatever screen is showing.
    const offClose = vx().window.onBeforeClose(() => {
      void saveAll()
        .then(() => stopPlugins())
        .finally(() => void vx().window.readyToClose());
    });
    return () => {
      offLib();
      offVaults();
      offTheme();
      offClose();
    };
  }, []);

  // Switch Vault (SPECS 11.4) works from anywhere once a library is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (recording.active) return;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o' && useApp.getState().library) {
        e.preventDefault();
        useApp.getState().showChooser();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (library === undefined) return null;
  if (library === null) return <FirstRun />;
  return (
    <>
      {screen === 'workspace' && openVault ? (
        <Workspace key={openVault} vaultPath={openVault} />
      ) : (
        <Chooser />
      )}
      {dialog && (
        <VaultDialog key={dialog.mode === 'edit' ? `edit:${dialog.path}` : `new:${dialog.domain}`} />
      )}
    </>
  );
}
