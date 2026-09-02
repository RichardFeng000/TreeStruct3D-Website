import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  CircleCheckBig,
  Code2,
  Database,
  Eye,
  GitBranch,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const repositoryUrl = 'https://github.com/RichardFeng000/TreeStruct3D';

export const dynamic = 'force-static';

export default function Home() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <section className="technical-grid relative isolate min-h-screen border-b border-white/10 bg-[#0a100d] text-[#f4f2e8]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[#b7ff52]" />

        <nav className="mx-auto flex w-full max-w-[1480px] items-center justify-between px-5 py-6 sm:px-8 lg:px-12">
          <a href="#top" className="flex items-center gap-3" aria-label="TreeStruct3D home">
            <span className="grid size-9 place-items-center border border-[#b7ff52]/60 bg-[#b7ff52]/10 text-[#b7ff52]">
              <GitBranch className="size-4" aria-hidden="true" />
            </span>
            <span className="font-mono text-sm font-semibold tracking-[-0.02em]">
              TreeStruct3D
            </span>
          </a>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-6 lg:flex">
              {[
                ['Method', '#method'],
                ['Pipeline', '#pipeline'],
                ['Benchmark', '#benchmark'],
                ['Gallery', '#gallery'],
              ].map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/55 transition-colors hover:text-white"
                >
                  {label}
                </a>
              ))}
            </div>
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'h-10 rounded-none border-white/20 bg-white/5 px-4 text-[#f4f2e8] hover:bg-[#b7ff52] hover:text-[#0a100d]',
              )}
            >
              <Code2 aria-hidden="true" />
              View code
            </a>
          </div>
        </nav>

        <div id="top" className="mx-auto grid w-full max-w-[1480px] gap-12 px-5 pb-16 pt-16 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)] lg:px-12 lg:pb-20 lg:pt-24">
          <div className="max-w-4xl">
            <div className="mb-8 flex flex-wrap items-center gap-3 font-mono text-[11px] uppercase tracking-[0.15em] text-white/55">
              <span className="border border-[#b7ff52]/35 bg-[#b7ff52]/10 px-3 py-1.5 text-[#b7ff52]">
                Research code available
              </span>
              <span>Procedural 3D · Blender · Agentic AI</span>
            </div>

            <h1 className="max-w-5xl text-[clamp(4.35rem,11vw,9.5rem)] font-semibold leading-[0.76] tracking-[-0.085em]">
              TreeStruct
              <span className="text-[#b7ff52]">3D</span>
            </h1>

            <p className="mt-10 max-w-3xl text-[clamp(1.35rem,2.3vw,2.35rem)] font-medium leading-[1.08] tracking-[-0.035em] text-white/88">
              Enabling structural editability in agentic procedural 3D modeling.
            </p>

            <p className="mt-6 max-w-2xl text-base leading-7 text-white/58 sm:text-lg">
              Generate Blender programs whose semantic parts stay attached when a
              parent or child is independently resized—not just assets that look
              correct once.
            </p>

            <div className="mt-10 flex flex-wrap gap-3">
              <a
                href={repositoryUrl}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  buttonVariants({ size: 'lg' }),
                  'h-12 rounded-none bg-[#b7ff52] px-6 text-[#0a100d] hover:bg-[#d4ff9b]',
                )}
              >
                Explore the repository
                <ArrowUpRight aria-hidden="true" />
              </a>
              <a
                href="#method"
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'lg' }),
                  'h-12 rounded-none border-white/20 bg-transparent px-6 text-white hover:bg-white/10 hover:text-white',
                )}
              >
                See how it works
                <ArrowDown aria-hidden="true" />
              </a>
            </div>
          </div>

          <aside className="self-end border-l border-white/15 pl-6 lg:mb-2 lg:pl-9">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#b7ff52]">
              Structural contract
            </p>
            <dl className="mt-5 divide-y divide-white/12 border-y border-white/12">
              {[
                ['01', 'Semantic parts', 'Named, editable parameters'],
                ['02', 'Directed attachments', 'Explicit parent → child relations'],
                ['03', 'Shared anchors', 'Geometry-derived connection points'],
                ['04', 'Controlled edits', 'Parent and child perturbation checks'],
              ].map(([number, term, description]) => (
                <div key={number} className="grid grid-cols-[2.4rem_1fr] gap-3 py-4">
                  <dt className="font-mono text-xs text-white/32">{number}</dt>
                  <dd>
                    <p className="text-sm font-semibold text-white/90">{term}</p>
                    <p className="mt-1 text-sm text-white/45">{description}</p>
                  </dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>

        <div className="mx-auto w-full max-w-[1480px] px-5 pb-6 sm:px-8 lg:px-12">
          <div className="flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-white/35">
            <span>Structure-aware generation</span>
            <span>Open-source implementation</span>
          </div>
        </div>
      </section>

      <section id="method" className="bg-[#f2efe4] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1480px]">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#42631f]">
                Controlled editing at a glance
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] text-[#101612] sm:text-6xl">
                Structure that survives the edit.
              </h2>
            </div>
            <p className="max-w-2xl justify-self-end text-base leading-7 text-[#465049] sm:text-lg">
              TreeStruct3D represents each object as a directed tree of semantic
              parts, realizes every attachment with shared anchors, then verifies
              those relationships after controlled parameter changes.
            </p>
          </div>

          <figure className="mt-12 border border-[#151c17]/15 bg-[#fcfbf5] p-2 shadow-[0_20px_60px_rgba(20,30,20,0.08)] sm:p-4">
            <img
              src="images/figure-1-controlled-editing.webp"
              alt="Controlled editing comparison between 3DCodeBench and TreeStruct3D across four vision-language models"
              className="h-auto w-full"
            />
            <figcaption className="flex flex-col gap-2 border-t border-[#151c17]/10 px-2 py-4 font-mono text-[10px] uppercase tracking-[0.1em] text-[#606960] sm:flex-row sm:items-center sm:justify-between sm:px-3">
              <span>Figure 01 · Controlled editability comparison</span>
              <span>Default · parent scale · child scale</span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="pipeline" className="border-y border-[#0a100d] bg-[#b7ff52] px-5 py-20 text-[#0a100d] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1480px]">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] opacity-65">
                System pipeline
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] sm:text-6xl">
                From a prompt to a verified program.
              </h2>
            </div>
            <p className="max-w-2xl justify-self-end text-base leading-7 opacity-70 sm:text-lg">
              The system makes structure explicit before code generation and keeps
              structural verification inside the agentic loop.
            </p>
          </div>

          <ol className="mt-14 grid border-l border-t border-[#0a100d] md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                number: '01',
                title: 'Extract',
                label: 'Structure blueprint',
                body: 'Turn the object description into semantic parts, a root, directed attachments, and shared-anchor requirements.',
                icon: Braces,
              },
              {
                number: '02',
                title: 'Generate',
                label: 'Blender program',
                body: 'Condition code generation on the text prompt and the separately extracted structure blueprint.',
                icon: Terminal,
              },
              {
                number: '03',
                title: 'Validate',
                label: 'Structural behavior',
                body: 'Execute the program and check hierarchy, contact, anchors, and independent part perturbations.',
                icon: ShieldCheck,
              },
              {
                number: '04',
                title: 'Repair',
                label: 'Localized feedback',
                body: 'Return precise structural failures for repair before the final visual-refinement pass.',
                icon: CircleCheckBig,
              },
            ].map(({ number, title, label, body, icon: Icon }, index) => (
              <li
                key={number}
                className="group relative min-h-[310px] border-b border-r border-[#0a100d] p-6 sm:p-8"
              >
                <div className="flex items-start justify-between">
                  <span className="font-mono text-xs opacity-55">{number} / 04</span>
                  <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h3 className="mt-14 text-3xl font-semibold tracking-[-0.05em]">{title}</h3>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.15em] opacity-55">
                  {label}
                </p>
                <p className="mt-6 max-w-xs text-sm leading-6 opacity-70">{body}</p>
                {index < 3 ? (
                  <ArrowRight
                    className="absolute -right-3 top-1/2 z-10 hidden size-6 bg-[#b7ff52] xl:block"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-[#0d1611] px-5 py-20 text-[#f4f2e8] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1480px] gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#b7ff52]">
              Editable by construction
            </p>
            <h2 className="mt-4 max-w-2xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] sm:text-6xl">
              Appearance is a snapshot. Structure is behavior.
            </h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-white/56 sm:text-lg">
              A plausible render can still break when one part changes. TreeStruct3D
              evaluates the generated program as an editable system: each semantic
              parameter must update geometry without invalidating its attachments.
            </p>

            <div className="mt-10 grid gap-px border border-white/12 bg-white/12 sm:grid-cols-2">
              <div className="bg-[#0d1611] p-6">
                <Eye className="size-5 text-white/45" strokeWidth={1.5} aria-hidden="true" />
                <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.15em] text-white/38">
                  Static quality
                </p>
                <p className="mt-2 text-lg font-semibold">Does it look right?</p>
              </div>
              <div className="bg-[#0d1611] p-6">
                <GitBranch className="size-5 text-[#b7ff52]" strokeWidth={1.5} aria-hidden="true" />
                <p className="mt-7 font-mono text-[10px] uppercase tracking-[0.15em] text-[#b7ff52]/70">
                  Structural quality
                </p>
                <p className="mt-2 text-lg font-semibold">Does it keep working?</p>
              </div>
            </div>
          </div>

          <div className="border border-white/14 bg-[#07100a] shadow-[18px_18px_0_0_#b7ff52]">
            <div className="flex items-center justify-between border-b border-white/12 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-white/38">
              <span>Generated program protocol</span>
              <span className="text-[#b7ff52]">Python · Blender</span>
            </div>
            <pre className="overflow-x-auto p-5 text-[12px] leading-7 text-white/68 sm:p-8 sm:text-sm">
              <code>{`PART_PARAMS = {
  "trunk":  { "scale": 1.0 },
  "branch": { "scale": 1.0 },
}

SHARED_ANCHORS = {
  "trunk_to_branch": {
    "parent": "trunk",
    "child":  "branch",
    "world_position": anchor,
  }
}

# Parent and child edits are checked independently.
build_scene(PART_PARAMS, SHARED_ANCHORS)`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section id="benchmark" className="bg-[#f2efe4] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1480px]">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#42631f]">
                Reproducible input boundary
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] text-[#101612] sm:text-6xl">
                Built on a pinned benchmark snapshot.
              </h2>
            </div>

            <div className="grid gap-px border border-[#111a14] bg-[#111a14] sm:grid-cols-3">
              {[
                ['212', 'categories', '3DCodeBench evaluation split'],
                ['636', 'source files', 'Verified against one revision'],
                ['01', 'model input', 'Description or instruction text'],
              ].map(([value, label, detail]) => (
                <div key={label} className="bg-[#f7f4ea] p-6 sm:p-7">
                  <p className="font-mono text-4xl font-semibold tracking-[-0.06em] text-[#101612]">{value}</p>
                  <p className="mt-3 text-sm font-semibold text-[#101612]">{label}</p>
                  <p className="mt-1 text-xs leading-5 text-[#657067]">{detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 grid border-y border-[#111a14]/20 py-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
            <div className="flex items-start gap-4">
              <Database className="mt-1 size-5 text-[#42631f]" strokeWidth={1.5} aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-[#101612]">Upstream provenance</p>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#657067]">
                  The included 3DCodeBench split comes from the official YipengGao/3DCode dataset and is pinned to an immutable revision.
                </p>
              </div>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:mt-0">
              <a
                href="https://huggingface.co/datasets/YipengGao/3DCode"
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between border border-[#111a14]/20 bg-[#f7f4ea] p-5 text-sm font-semibold transition-colors hover:border-[#42631f]"
              >
                Dataset on Hugging Face
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <a
                href="https://github.com/gaoypeng/3dcodebench"
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between border border-[#111a14]/20 bg-[#f7f4ea] p-5 text-sm font-semibold transition-colors hover:border-[#42631f]"
              >
                3DCodeBench source
                <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[#0a100d] bg-[#dee1d4] px-5 py-20 sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto grid max-w-[1480px] gap-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#42631f]">
              Start with one object
            </p>
            <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] text-[#101612] sm:text-6xl">
              One config. Two model-facing phases.
            </h2>
            <p className="mt-7 max-w-xl text-base leading-7 text-[#526057]">
              API format, endpoint, credentials, model identity, token policy, and retries all come from the selected YAML configuration.
            </p>
            <a
              href={`${repositoryUrl}#quick-start`}
              target="_blank"
              rel="noreferrer"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'mt-9 h-12 rounded-none bg-[#111a14] px-6 text-white hover:bg-[#42631f]',
              )}
            >
              Open the quick start
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>

          <div className="border border-[#111a14] bg-[#f7f4ea]">
            <div className="flex items-center justify-between border-b border-[#111a14]/20 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#657067]">
              <span>Bird_seed0</span>
              <span>config.local.yaml</span>
            </div>
            <pre className="overflow-x-auto p-5 text-[12px] leading-7 text-[#243028] sm:p-8 sm:text-sm">
              <code>{`cp configs/config.example.yaml config.local.yaml
export TREESTRUCT3D_API_KEY=your-api-key

./extract_structure.sh \\
  --config config.local.yaml \\
  --instances Bird_seed0

./generate_3d.sh \\
  --config config.local.yaml \\
  --instances Bird_seed0`}</code>
            </pre>
          </div>
        </div>
      </section>

      <section id="gallery" className="bg-[#0a100d] px-5 py-20 text-[#f4f2e8] sm:px-8 lg:px-12 lg:py-28">
        <div className="mx-auto max-w-[1480px]">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-end">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-[#b7ff52]">
                Qualitative editing gallery
              </p>
              <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[0.95] tracking-[-0.055em] sm:text-6xl">
                Across four vision-language models.
              </h2>
            </div>
            <p className="max-w-2xl justify-self-end text-base leading-7 text-white/55 sm:text-lg">
              Each panel shows the default asset beside exaggerated 0.4× and 1.6× parent- and child-side edits. Quantitative evaluation uses 0.8× and 1.2×.
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {[
              ['a', 'GPT-5.5', 'images/appendix-figure-6a-gpt-5-5.webp'],
              ['b', 'GPT-5.6 Sol', 'images/appendix-figure-6b-gpt-5-6-sol.webp'],
              ['c', 'Gemini 3.1 Pro', 'images/appendix-figure-6c-gemini-3-1-pro.webp'],
              ['d', 'Gemini 3.5 Flash', 'images/appendix-figure-6d-gemini-3-5-flash.webp'],
            ].map(([panel, model, src]) => (
              <figure key={panel} className="border border-white/14 bg-[#111a14] p-2 sm:p-3">
                <div className="flex items-center justify-between px-2 pb-3 pt-1">
                  <figcaption className="text-sm font-semibold">({panel}) {model}</figcaption>
                  <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/35">Figure 06</span>
                </div>
                <img
                  src={src}
                  alt={`TreeStruct3D controlled editing examples generated with ${model}`}
                  loading="lazy"
                  className="h-auto w-full bg-white"
                />
              </figure>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#b7ff52] px-5 py-12 text-[#0a100d] sm:px-8 lg:px-12">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <GitBranch className="size-7" strokeWidth={1.5} aria-hidden="true" />
            <p className="mt-5 text-3xl font-semibold tracking-[-0.055em]">TreeStruct3D</p>
            <p className="mt-2 max-w-xl text-sm leading-6 opacity-65">
              Enabling Structural Editability in Agentic Procedural 3D Modeling.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-5 font-mono text-[10px] uppercase tracking-[0.14em]">
            <span>Apache-2.0</span>
            <span aria-hidden="true">·</span>
            <span>Python 3.9+</span>
            <span aria-hidden="true">·</span>
            <span>Blender 5.0</span>
            <a
              href={repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="border-b border-[#0a100d] pb-1 font-semibold"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
