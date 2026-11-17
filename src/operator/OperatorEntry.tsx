/* eslint-disable react-refresh/only-export-components -- entry helper: a path predicate next to the lazy wrapper */
import { lazy, Suspense } from 'react';

// Loaded only for /operator/* (see src/main.tsx), so the console code is a separate chunk.
const OperatorRoot = lazy(() => import('./OperatorRoot'));

export const isOperatorPath = (pathname: string) => /^\/operator(?:\/|$)/.test(pathname);

export function OperatorEntry() {
  return (
    <Suspense fallback={null}>
      <OperatorRoot />
    </Suspense>
  );
}
