import { describe, expect, it } from 'vitest';
import { decodeText, encodeText } from './encoding';

const bytes = (s: string, enc: BufferEncoding = 'utf8') => Buffer.from(s, enc);

describe('decodeText / encodeText', () => {
  it.each([
    ['LF', '# a\n\nb\n', 'lf'],
    ['CRLF', '# a\r\n\r\nb\r\n', 'crlf'],
    ['no newline', 'single line', 'lf'],
    ['no trailing newline, CRLF', 'a\r\nb', 'crlf'],
    ['lone CR kept', 'a\rb\n', 'lf'],
    ['empty', '', 'lf'],
  ])('round-trips %s byte for byte', (_name, text, eol) => {
    const b = bytes(text);
    const d = decodeText(b);
    expect(d.eol).toBe(eol);
    expect(d.mixedEol).toBe(false);
    expect(d.text.includes('\r\n')).toBe(false);
    expect(encodeText(d.text, d.eol, d.bom).equals(b)).toBe(true);
  });

  it('keeps a UTF-8 BOM', () => {
    const b = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes('x\r\ny\r\n')]);
    const d = decodeText(b);
    expect(d.bom).toBe(true);
    expect(d.text).toBe('x\ny\n');
    expect(encodeText(d.text, d.eol, d.bom).equals(b)).toBe(true);
  });

  it('reports mixed line endings and saves the dominant style', () => {
    const d = decodeText(bytes('a\r\nb\r\nc\nd\r\n'));
    expect(d.mixedEol).toBe(true);
    expect(d.eol).toBe('crlf');
    expect(encodeText(d.text, d.eol, d.bom).toString()).toBe('a\r\nb\r\nc\r\nd\r\n');
  });

  it('breaks a tie with the first line ending', () => {
    expect(decodeText(bytes('a\nb\r\n')).eol).toBe('lf');
    expect(decodeText(bytes('a\r\nb\n')).eol).toBe('crlf');
  });

  it('marks invalid UTF-8 as read-only', () => {
    const d = decodeText(bytes('Caf\xe9\n', 'latin1'));
    expect(d.readOnly).toBe(true);
    expect(d.text).toContain('�');
  });

  it('tracks the trailing newline', () => {
    expect(decodeText(bytes('a\n')).finalNewline).toBe(true);
    expect(decodeText(bytes('a')).finalNewline).toBe(false);
  });

  it('does not double CR when given CRLF text', () => {
    expect(encodeText('a\r\nb\n', 'crlf', false).toString()).toBe('a\r\nb\r\n');
  });
});
