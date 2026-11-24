// Learn more: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#web-setup
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/*
 * The web build of expo-sqlite is SQLite compiled to WebAssembly, so Metro has
 * to treat `.wasm` as an asset it can serve. Native builds never request one.
 */
config.resolver.assetExts.push("wasm");

/*
 * expo-sqlite on web runs in a worker and needs `SharedArrayBuffer`, which a
 * browser only provides to a cross-origin-isolated page. These two headers are
 * what make the development server's page isolated; a host serving the
 * exported web build has to send the same two (roadmap step 14.7).
 */
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    middleware(req, res, next);
  };
};

module.exports = config;
