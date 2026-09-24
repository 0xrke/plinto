/**
 * A token name that never breaks inside a hyphenated word ("Co-op" stays whole). The text and the
 * accessible name are unchanged; only the wrapping differs.
 */
export function NoBreakName({ name }: { name: string }) {
  if (!name.includes("-")) return <>{name}</>;
  const words = name.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          {i > 0 ? " " : null}
          {word.includes("-") ? <span className="whitespace-nowrap">{word}</span> : word}
        </span>
      ))}
    </>
  );
}
