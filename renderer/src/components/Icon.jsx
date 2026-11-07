const PATHS = {
  plus: "M12 5v14M5 12h14",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h11v11H9zM4 15V4h11",
  edit: "M4 20h4L20 8l-4-4L4 16v4Z",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  refresh: "M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2M14 4v4M8 10v4M14 16v4",
  book: "M6 3h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM4 17h14",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12c0-.4 0-.8-.1-1.2l2-1.6-2-3.4-2.3 1a8 8 0 0 0-2-1.2L14.2 3H9.8l-.4 2.6a8 8 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.6a9 9 0 0 0 0 2.4l-2 1.6 2 3.4 2.3-1a8 8 0 0 0 2 1.2l.4 2.6h4.4l.4-2.6a8 8 0 0 0 2-1.2l2.3 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
  check: "M5 12l5 5L20 6",
  clip: "M9 12l5-5a3.5 3.5 0 1 1 5 5l-7 7a5 5 0 0 1-7-7l7-7",
  close: "M6 6l12 12M18 6L6 18",
  chevron: "M9 6l6 6-6 6",
  download: "M12 4v10M8 11l4 4 4-4M5 20h14",
  warn: "M12 4l9 16H3L12 4ZM12 10v4M12 17h.01",
};

export default function Icon({ name, size = 16, className = "" }) {
  const path = PATHS[name] || PATHS.arrow;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}