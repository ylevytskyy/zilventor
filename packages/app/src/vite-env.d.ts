/// <reference types="vite/client" />

// Declare the Vite ?worker suffix for the sketcher worker module.
// TypeScript doesn't understand the ?worker query suffix natively;
// this tells tsc that any import of that specific path yields a Worker constructor.
declare module '@zilventor/sketcher-worker/src/worker?worker' {
  const ctor: new () => Worker;
  export default ctor;
}
