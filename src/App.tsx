import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

const National = lazy(() => import('./pages/National'));
const Portal = lazy(() => import('./pages/Portal'));
const Methodology = lazy(() => import('./pages/Methodology'));

function PageFallback() {
  return (
    <div
      style={{
        padding: 80,
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        color: 'var(--ink-3)',
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<National />} />
          <Route path="/methodology" element={<Methodology />} />
          <Route path="/d/:deptId" element={<Portal />} />
          <Route path="/d/:deptId/overview" element={<Portal />} />
          <Route path="/d/:deptId/by-year" element={<Portal />} />
          <Route path="/d/:deptId/programs" element={<Portal />} />
          <Route path="/d/:deptId/objects" element={<Portal />} />
          <Route path="/d/:deptId/data" element={<Portal />} />
          <Route path="/d/:deptId/methodology" element={<Portal />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
