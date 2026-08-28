/**
 * `?raw` imports. Vite inlines the file's text at build time; TypeScript needs
 * telling that the specifier resolves to a string, because nothing on disk
 * matches it.
 */
declare module '*?raw' {
  const content: string
  export default content
}
