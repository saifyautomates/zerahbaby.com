/**
 * Ambient type definitions for Supabase Edge Functions in VS Code.
 * This provides type declarations for Deno runtime globals and remote HTTPS/JSR/NPM imports
 * when viewed in editors using the standard TypeScript language server.
 */

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    delete(key: string): void;
    has(key: string): boolean;
    toObject(): Record<string, string>;
  }
  export const env: Env;
  export function serve(handler: (req: Request) => Promise<Response> | Response): void;
  export function serve(
    options: {
      port?: number;
      hostname?: string;
      onListen?: (params: { port: number; hostname: string }) => void;
      onError?: (error: unknown) => Response | Promise<Response>;
    },
    handler: (req: Request) => Promise<Response> | Response,
  ): void;
}

declare module "https://*" {
  const content: any;
  export default content;
  export const serve: any;
  export const createClient: any;
  export const encode: any;
  export const decode: any;
}

declare module "npm:*" {
  const content: any;
  export default content;
  export const createClient: any;
}

declare module "jsr:*" {
  const content: any;
  export default content;
  export const createClient: any;
}
