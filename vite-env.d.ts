/// <reference types="vite/client" />

// Damit TypeScript Bild-Imports (z.B. .png) akzeptiert.
declare module '*.png' {
  const src: string;
  export default src;
}

