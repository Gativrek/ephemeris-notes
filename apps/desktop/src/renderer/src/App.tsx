import { useEffect, useState } from 'react';
import type { LibraryInfo } from '@shared/bridge';
import { FirstRun } from './features/firstrun/FirstRun';
import { unwrap, vx } from './lib/vx';

export function App() {
  const [library, setLibrary] = useState<LibraryInfo | null | undefined>(undefined);

  useEffect(() => {
    const off = vx().library.onChanged(setLibrary);
    void unwrap(vx().library.current()).then(setLibrary, () => setLibrary(null));
    return off;
  }, []);

  if (library === undefined) return null;
  if (library === null) return <FirstRun />;
  return (
    <main className="vx-firstrun" data-testid="library-open">
      <h1 className="vx-firstrun__title">{library.name}</h1>
    </main>
  );
}
