declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV: string;
    VUE_ROUTER_MODE: 'hash' | 'history' | 'abstract' | undefined;
    VUE_ROUTER_BASE: string | undefined;
  }
}

declare module 'pdfmake/build/pdfmake' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake: any;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfFonts: any;
  export default pdfFonts;
}
