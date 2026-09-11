const BrandMark = ({ className = "" }: { readonly className?: string }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="none"
    viewBox="0 0 44 44"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect height="42" rx="12" stroke="currentColor" width="42" x="1" y="1" />
    <path
      d="M13 33V15h10.5c4 0 7 2.4 7 5.7 0 2.7-1.7 4.5-4.2 5.2 3.2.5 5.2 2.7 5.2 5.8 0 .45-.04.88-.12 1.3H13Z"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="2.6"
    />
    <path
      d="m13 21-4-2.5m4 9-4 2.5m21-8 4-2.5m-3 9 3.5 2"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
);

export const Brand = () => (
  <a aria-label="Bramble home" className="brand-lockup" href="/">
    <BrandMark className="size-9" />
    <span>Bramble</span>
  </a>
);
