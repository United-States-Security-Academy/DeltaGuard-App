import { type MdInline, parseMarkdown } from '@deltaguard/shared';

// Renders the post-order Markdown subset (see packages/shared/src/markdown.ts)
// as React elements. No HTML is ever injected.

function Inline({ parts }: { parts: MdInline[] }) {
  return parts.map((p, i) =>
    p.bold ? (
      <strong key={i}>{p.text}</strong>
    ) : p.italic ? (
      <em key={i}>{p.text}</em>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return <p className="text-sm text-slate-500">Nothing written yet.</p>;
  return (
    <div className="flex flex-col gap-3 text-sm leading-6">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const size = { 1: 'text-xl', 2: 'text-lg', 3: 'text-base' }[b.level];
          return (
            <p key={i} role="heading" aria-level={b.level + 1} className={`${size} font-semibold`}>
              <Inline parts={b.content} />
            </p>
          );
        }
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`flex flex-col gap-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {b.items.map((item, j) => (
                <li key={j}>
                  <Inline parts={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={i}>
            <Inline parts={b.content} />
          </p>
        );
      })}
    </div>
  );
}
