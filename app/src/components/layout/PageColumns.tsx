import type { ReactNode } from "react";

/**
 * Page layout inside the app window: the cloud main column and, optionally, the white right rail.
 * lg+: side by side, both filling the window height (rail 340px, 392px from xl). Below lg: stacked
 * full width on the wash, the rail after the main column unless `railFirst`.
 *
 * The rail is a plain white column on desktop; wrap each rail block in `.rail-section` so it becomes
 * a white card when the rail stacks on a phone.
 */
export function PageColumns({
  main,
  rail,
  railFirst = false,
  railLabel,
  mainClassName = "",
  railClassName = "",
}: {
  main: ReactNode;
  rail?: ReactNode;
  /** On small screens, put the rail above the main column (desktop order is unchanged). */
  railFirst?: boolean;
  /** Makes the rail an <aside> landmark with this name (e.g. "Featured floor"). Omit when the rail holds the page's main action. */
  railLabel?: string;
  mainClassName?: string;
  railClassName?: string;
}) {
  const mainCol = (
    <div
      className={`min-w-0 px-4 pb-10 pt-4 sm:px-6 lg:px-9 lg:pb-14 lg:pt-10 xl:px-11 xl:pt-11 ${
        railFirst ? "order-2 lg:order-none" : ""
      } ${mainClassName}`}
    >
      {main}
    </div>
  );
  if (!rail) {
    return <div className="flex flex-1 flex-col">{mainCol}</div>;
  }
  const railProps = {
    className: `min-w-0 px-4 pb-10 sm:px-6 lg:bg-surface lg:px-7 lg:pb-14 lg:pt-10 xl:px-8 ${
      railFirst ? "order-1 pt-4 lg:order-none" : ""
    } ${railClassName}`,
  };
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_392px]">
      {mainCol}
      {railLabel ? (
        <aside aria-label={railLabel} {...railProps}>
          {rail}
        </aside>
      ) : (
        <div {...railProps}>{rail}</div>
      )}
    </div>
  );
}
