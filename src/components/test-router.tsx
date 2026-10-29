import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import type { ReactNode } from "react";

const noop = () => {};

/** Test-only: lets components that call `useRouter` render outside a Next app. */
export function TestRouter({ children }: { children: ReactNode }) {
  const router: AppRouterInstance = {
    back: noop,
    forward: noop,
    refresh: noop,
    push: noop,
    replace: noop,
    prefetch: noop,
    bfcacheId: "test",
  };
  return <AppRouterContext.Provider value={router}>{children}</AppRouterContext.Provider>;
}
