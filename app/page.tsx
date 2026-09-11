export const dynamic = 'force-static';

export default function Home() {
  return (
    <main className="explorer-shell">
      <h1 className="sr-only">TreeStruct3D — Interactive structure explorer</h1>
      <iframe
        className="explorer-frame"
        src="explorer/index.html"
        title="TreeStruct3D interactive model, hierarchy, and shared-anchor explorer"
        allow="fullscreen; clipboard-write"
      />
    </main>
  );
}
