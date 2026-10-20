// Where a relative link in a rendered record document should point.
// ctx: { folder, pages, blobBase }. Returns the new href, or null to leave the link alone.
// "..": URL rules apply, so a link can leave the record folder and reach the repository.
function resolveLink(ctx, href) {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return null;
  var base = new URL(ctx.blobBase);
  var url = new URL(ctx.folder ? ctx.folder + "/" + href : href, base);
  if (url.pathname.indexOf(base.pathname) === 0) {
    var path = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (Object.prototype.hasOwnProperty.call(ctx.pages, path)) return ctx.pages[path] + url.hash;
  }
  return url.href;
}
