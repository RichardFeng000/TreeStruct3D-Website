export default function InteractiveExamples() {
  // Public viewer modules need a new frame document to replace a running viewer.
  const explorerVersion = "native-geometry-20260911-3";
  return (
    <div className="examples-container">
      <iframe key={explorerVersion} className="examples-frame" src={`explorer/index.html?v=${explorerVersion}`} loading="lazy"
        title="TreeStruct3D Visual Validation: model controls, structure tree, and 3D model"
        allow="fullscreen; clipboard-write" />
    </div>
  );
}
