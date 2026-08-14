import type { TephraBridge } from './index'
declare global {
  interface Window { readonly tephra: TephraBridge }
}
