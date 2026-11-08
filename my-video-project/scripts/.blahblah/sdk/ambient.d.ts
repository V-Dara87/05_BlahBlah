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

// Ambient global types for BlahBlah script reference fields
declare type EntityRef = import('./index.d.ts').EntityRef;
declare type AssetRef = import('./index.d.ts').AssetRef;


// Prop helpers are globals in every script (no import needed). Each one returns
// a definition typed with the value the script will receive, so
// `props: { size: num(40) }` gives `props.size: number` inside `draw`.
declare type PropDef<T = unknown> = import('./index.d.ts').PropDef<T>;
declare interface PropOpts {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  [attribute: string]: any;
}
declare function num(value: number, opts?: PropOpts): PropDef<number>;
declare function bool(value: boolean, opts?: PropOpts): PropDef<boolean>;
declare function color(value: string, opts?: PropOpts): PropDef<string>;
declare function text(value: string, opts?: PropOpts & { multiline?: boolean }): PropDef<string>;
declare function select<T extends string | number>(
  value: T,
  options: ReadonlyArray<T | { label: string; value: T }>,
  opts?: PropOpts,
): PropDef<T>;
declare function font(value: string, opts?: PropOpts): PropDef<string>;
declare function asset(assetType?: string | PropOpts, opts?: PropOpts): PropDef<AssetRef>;
declare function entity(opts?: PropOpts): PropDef<EntityRef>;
declare function button(method: string, opts?: PropOpts): PropDef<never>;
declare function group(...args: any[]): any;
declare function row(...args: any[]): any;
declare const Presets: Record<string, any>;