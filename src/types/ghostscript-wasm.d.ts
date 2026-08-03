declare module "@jspawn/ghostscript-wasm/gs.js" {
  export interface GhostscriptModule {
    FS: {
      writeFile(path: string, data: Uint8Array): void;
      readFile(path: string, options: { encoding: "binary" }): Uint8Array<ArrayBuffer>;
      unlink(path: string): void;
    };
    callMain(args: string[]): number;
  }

  export interface GhostscriptModuleOptions {
    locateFile?: (file: string) => string;
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  }

  const factory: (
    options?: GhostscriptModuleOptions
  ) => Promise<GhostscriptModule>;

  export default factory;
}
