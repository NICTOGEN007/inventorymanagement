import { Fragment, type ReactNode } from 'react';

/** **bold** inside a line; everything else stays plain text (never parsed as HTML). */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
    piece.startsWith('**') && piece.endsWith('**') && piece.length > 4 ? (
      <strong key={i} className="font-semibold">
        {piece.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{piece}</Fragment>
    ),
  );
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

/**
 * The little Markdown a chat model writes: paragraphs, bulleted and numbered lists, and bold.
 * Built from React elements, so a reply can never inject markup.
 */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const lines = paragraph;
    blocks.push(
      <p key={blocks.length}>
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {inline(line)}
          </Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
        {items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '');
    const ordered = NUMBERED.test(line);
    if (BULLET.test(line) || ordered) {
      flushParagraph();
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(line.replace(ordered ? NUMBERED : BULLET, ''));
    } else if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return <div className="space-y-2">{blocks}</div>;
}
