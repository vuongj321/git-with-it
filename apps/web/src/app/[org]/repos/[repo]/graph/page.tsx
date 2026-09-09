'use client';

import { ArchitectureGraph } from '@/components/ArchitectureGraph';

export default function GraphPage() {
  return (
    <section className="graph-page">
      <h2 className="section-title visually-hidden">Architecture graph</h2>
      <ArchitectureGraph />
    </section>
  );
}
