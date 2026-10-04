/** Escapes text for safe use inside HTML (emails, the packing slip). Anything user-supplied goes through this. */
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c] ?? c,
  );
