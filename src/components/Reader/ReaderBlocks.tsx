import type { ReaderBlock, ReaderRun } from '../../../ipc-contract';

/** Pure blocks[] → JSX, zero state. The server never sends third-party HTML (see
 * server/reader/extract.ts) — every block here is a typed union the renderer maps to real
 * elements, so all text goes through React's normal escaping and there is no
 * dangerouslySetInnerHTML anywhere in this feature. */

function Runs({ runs }: { runs: ReaderRun[] }) {
  return (
    <>
      {runs.map((run, i) => {
        let node: React.ReactNode = run.text;
        if (run.strong) node = <strong key="s">{node}</strong>;
        if (run.em) node = <em key="e">{node}</em>;
        if (run.href) {
          node = (
            <a key="a" href={run.href} target="_blank" rel="noopener noreferrer">
              {node}
            </a>
          );
        }
        // eslint-disable-next-line react/no-array-index-key -- runs have no stable identity of their own
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function ReaderBlocks({ blocks }: { blocks: ReaderBlock[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        // eslint-disable-next-line react/no-array-index-key -- server output is a stable, unreordered list per response
        const key = i;
        switch (block.type) {
          case 'p':
            return (
              <p className="reader-blocks__p" key={key}>
                <Runs runs={block.runs} />
              </p>
            );
          case 'h2':
            return (
              <h2 className="reader-blocks__h2" key={key}>
                <Runs runs={block.runs} />
              </h2>
            );
          case 'h3':
            return (
              <h3 className="reader-blocks__h3" key={key}>
                <Runs runs={block.runs} />
              </h3>
            );
          case 'blockquote':
            return (
              <blockquote className="reader-blocks__quote" key={key}>
                <Runs runs={block.runs} />
              </blockquote>
            );
          case 'li':
            return (
              <li className="reader-blocks__li" key={key}>
                <Runs runs={block.runs} />
              </li>
            );
          case 'img':
            return (
              <figure className="reader-blocks__figure" key={key}>
                <img
                  className="reader-blocks__img"
                  src={block.src}
                  alt={block.alt ?? ''}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget.closest('figure') as HTMLElement | null)?.style.setProperty('display', 'none');
                  }}
                />
                {block.caption && <figcaption className="reader-blocks__caption">{block.caption}</figcaption>}
              </figure>
            );
        }
      })}
    </>
  );
}
