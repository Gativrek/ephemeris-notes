/**
 * PDF highlights in notes (SPECS 10.8.1): reading every link to a passage of a PDF from
 * the index, appending new ones to the PDF's highlights note, and removing one from it.
 * Notes are edited through their editor state (one undoable edit, then the normal save),
 * as the History restore does, so an open note takes the change at once.
 */
import { useEffect, useState } from 'react';
import type { PdfHighlightLink } from '@shared/bridge';
import { useCatalog } from '../lib/catalog';
import { unwrap, vx } from '../lib/vx';
import { editOpenDoc, openDoc, saveDoc } from '../workspace/docs';
import { appendChange, highlightRange, highlightsNotePath, newHighlightsNote } from './highlights';

/** The links to passages of `pdfPath`, kept current as notes change. */
export function usePdfHighlightLinks(pdfPath: string): PdfHighlightLink[] {
  const [links, setLinks] = useState<PdfHighlightLink[]>([]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      void unwrap(vx().index.pdfHighlights(pdfPath)).then(
        (l) => live && setLinks(l),
        () => undefined,
      );
    load();
    const off = vx().index.onChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 150);
    });
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [pdfPath]);
  return links;
}

/** How notes link to the PDF: the shortest unambiguous link text (SPECS 5). */
export const pdfLinkText = (pdfPath: string): string => useCatalog.getState().links.shortestLink(pdfPath);

const exists = async (path: string) => {
  try {
    await unwrap(vx().fs.stat(path));
    return true;
  } catch {
    return false;
  }
};

/** Appends highlight blocks to the PDF's highlights note, making it first if needed. Returns its path. */
export async function appendToHighlightsNote(pdfPath: string, blocks: string): Promise<string> {
  const note = highlightsNotePath(pdfPath);
  if (!(await exists(note))) {
    await unwrap(vx().fs.create(note, newHighlightsNote(pdfPath, pdfLinkText(pdfPath)) + blocks));
    return note;
  }
  const state = await openDoc(note);
  editOpenDoc(note, appendChange(state.doc.toString(), blocks), 'pdf.highlight');
  await saveDoc(note);
  return note;
}

/** Whether a highlight can be removed from the list: it is in the PDF's highlights note, written as one. */
export async function removableRange(
  pdfPath: string,
  link: PdfHighlightLink,
): Promise<{ from: number; to: number } | null> {
  if (link.path !== highlightsNotePath(pdfPath)) return null;
  const state = await openDoc(link.path);
  return highlightRange(state.doc.toString(), link.line);
}

/** Removes a highlight from its note, as one undoable edit. */
export async function removeHighlight(pdfPath: string, link: PdfHighlightLink): Promise<boolean> {
  const range = await removableRange(pdfPath, link);
  if (!range) return false;
  editOpenDoc(link.path, { ...range, insert: '' }, 'pdf.unhighlight');
  await saveDoc(link.path);
  return true;
}
