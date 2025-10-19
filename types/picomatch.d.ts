declare module 'picomatch' {
  export interface PicomatchOptions {
    dot?: boolean;
    posixSlashes?: boolean;
    nocase?: boolean;
  }

  export type Matcher = (testString: string) => boolean;

  export default function picomatch(
    pattern: string | readonly string[],
    options?: PicomatchOptions
  ): Matcher;
}
