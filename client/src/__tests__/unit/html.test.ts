import { describe, it, expect } from 'vitest';
import { prepareHtml } from '../../utils/html';

describe('prepareHtml', () => {
  it('injects the background style inside an existing <head>', () => {
    const result = prepareHtml('<html><head><title>x</title></head><body>hi</body></html>');
    expect(result).toContain('<head><style>html,body{background-color:#ffffff}</style>');
  });

  it('prepends the background style when there is no <head>', () => {
    const result = prepareHtml('<body>hi</body>');
    expect(result.startsWith('<style>html,body{background-color:#ffffff}</style>')).toBe(true);
  });

  it('rewrites <a href> links with target and rel attributes', () => {
    const result = prepareHtml('<a href="https://example.com">link</a>');
    expect(result).toContain('target="_blank" rel="noopener noreferrer" href="https://example.com"');
  });

  it('rewrites links case-insensitively', () => {
    const result = prepareHtml('<A HREF="https://example.com">link</A>');
    expect(result).toContain('target="_blank" rel="noopener noreferrer" href=');
  });

  it('preserves existing attributes on the anchor when rewriting', () => {
    const result = prepareHtml('<a class="btn" href="https://example.com">link</a>');
    expect(result).toContain('<a class="btn" target="_blank" rel="noopener noreferrer" href="https://example.com"');
  });

  it('injects the height script before </body> when present', () => {
    const result = prepareHtml('<body>hi</body>');
    const scriptIdx = result.indexOf('iframe-height');
    const bodyCloseIdx = result.indexOf('</body>');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it('appends the height script when there is no </body>', () => {
    const result = prepareHtml('<div>fragment</div>');
    expect(result).toContain('iframe-height');
    expect(result.trimEnd().endsWith('</script>')).toBe(true);
  });
});
