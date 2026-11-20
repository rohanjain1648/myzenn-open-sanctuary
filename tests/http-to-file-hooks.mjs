// Node module hooks for the cross-origin tests. The runtime loads a site's actions
// module with import("http://<site>/site-actions.js"), as a browser does. Node cannot
// import over http, so these hooks map each test origin to the site's folder on disk.
// Anything else resolves as usual.

let origins = {};

export async function initialize(data) {
  origins = data.origins;
}

export async function resolve(specifier, context, nextResolve) {
  let url = null;
  try {
    url = new URL(specifier);
  } catch {
    url = null;
  }
  if (url && (url.protocol === "http:" || url.protocol === "https:") && origins[url.origin]) {
    return { url: new URL(`.${url.pathname}`, origins[url.origin]).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
