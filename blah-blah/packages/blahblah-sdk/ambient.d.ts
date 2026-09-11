/**
 * Ambient module declarations for external npm packages in BlahBlah scripts.
 *
 * BlahBlah resolves and bundles any bare specifier (e.g. 'canvas-confetti',
 * 'pixi.js', 'three', 'gsap') at runtime via esm.sh. Because user projects do not
 * maintain a local node_modules folder, this wildcard declaration tells VS Code
 * and TypeScript that any imported package exists, preventing TS2307
 * ("Cannot find module ...") errors while preserving full editor flexibility.
 */
declare module '*';
