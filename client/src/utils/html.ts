const HEIGHT_SCRIPT = `<script>
(function(){
  function report(){parent.postMessage({type:'iframe-height',h:document.documentElement.scrollHeight},'*');}
  new ResizeObserver(report).observe(document.documentElement);
  document.addEventListener('DOMContentLoaded',report);
  window.addEventListener('load',report);
})();
</script>`;

export function prepareHtml(raw: string): string {
  const style = '<style>html,body{background-color:#ffffff}</style>';
  const withBase = raw.includes('<head>') ? raw.replace('<head>', `<head>${style}`) : `${style}${raw}`;
  const withLinks = withBase.replace(/<a(\s[^>]*)?href=/gi, '<a$1target="_blank" rel="noopener noreferrer" href=');
  return withLinks.includes('</body>')
    ? withLinks.replace('</body>', `${HEIGHT_SCRIPT}</body>`)
    : withLinks + HEIGHT_SCRIPT;
}
