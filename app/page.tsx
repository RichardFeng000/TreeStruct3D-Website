import InteractiveExamples from './components/InteractiveExamples';
import ZoomableImage from './components/ZoomableImage';
import FigureCarousel from './components/FigureCarousel';
import { ArrowDown, CodeXml, FileText } from 'lucide-react';

export const dynamic = 'force-static';
const repository = 'https://github.com/RichardFeng000/TreeStruct3D';
const authors = ['Ruiding Feng', 'Sen Zhang', 'Danrui Li', 'Bingjiang Xia', 'ZHIJIN ZHU', 'Mubbasir Kapadia'];
const stages = [
  { title: 'Plan the structure', text: 'A vision-language model predicts a Part–Attachment Tree: semantic parts, parent–child connections, and the regions where they attach.' },
  { title: 'Generate the program', text: 'The description and predicted tree guide Blender code generation. Each connection is implemented with a pair of geometry-dependent anchors.' },
  { title: 'Test the edits', text: 'The validator changes the parent and child independently, rebuilds the object, and checks anchor alignment, anchors on their meshes, and surface contact.' },
  { title: 'Repair the connection', text: 'The failed part or attachment is sent back for targeted code revision. The revised program is executed and checked again.' },
];

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#method">Skip to the method</a>
      <main id="top" className="paper-page">
        <section className="hero" aria-labelledby="paper-title">
          <h1 id="paper-title">
            <span className="paper-name">TreeStruct3D:</span> Enabling Structural Editability in Agentic Procedural 3D Modeling
          </h1>
          <ul className="paper-authors" aria-label="Authors">
            {authors.map((author) => <li key={author}>{author}</li>)}
          </ul>
          <div className="hero-actions">
            <a className="button button-primary" href="papers/treestruct3d.pdf" target="_blank" rel="noopener noreferrer"><FileText aria-hidden="true" />Paper</a>
            <a className="button" href={repository} target="_blank" rel="noopener noreferrer"><CodeXml aria-hidden="true" />Code</a>
            <a className="button" href="#examples">Examples<ArrowDown aria-hidden="true" /></a>
          </div>
          <p className="hero-lead">TreeStruct3D turns text descriptions into Blender programs with explicit part hierarchies
            and geometry-derived attachment anchors. It tests whether connections survive changes to individual parts,
            then uses localized feedback to repair broken attachments.</p>
        </section>

        <section id="method" className="paper-section method-section" aria-labelledby="method-title">
          <div className="section-intro">
            <h2 id="method-title">From text to editable 3D</h2>
            <p>TreeStruct3D extends the 3DCodeBench pipeline with a predicted part structure,
              geometry-derived attachment anchors, and a validation-and-repair loop.</p>
          </div>
          <figure className="paper-figure overview-figure">
            <ZoomableImage src="paper-figures/fig_3dcodebench_vs_treestruct3d_pipeline.png" width={2600} height={1358}
              label="Method overview" priority
              alt="Figure 2 from the paper: a bird description becomes a part tree and Blender program; examples show the body reduced to 0.4× and the feet enlarged to 1.6×, with failed attachments returned to the generator for repair." />
          </figure>
          <ol className="method-steps">
            {stages.map((stage, index) => (
              <li key={stage.title}>
                <span className="step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <h3>{stage.title}</h3>
                <p>{stage.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="editing" className="paper-section" aria-labelledby="editing-title">
          <div className="section-intro">
            <h2 id="editing-title">What happens when a part changes?</h2>
            <p>A <strong>parent</strong> is the part another part attaches to; the attached part is its <strong>child</strong>.
              For example, a bird’s feet (child) attach to its body (parent).
              Default renders tell only part of the story. The paper compares what happens after the parent shrinks
              or the child grows, testing whether the intended connections remain intact.</p>
          </div>
          <FigureCarousel />
        </section>

        <section id="examples" className="paper-section examples-section" aria-label="Interactive visual validation">
          <InteractiveExamples />
        </section>
      </main>
    </>
  );
}
