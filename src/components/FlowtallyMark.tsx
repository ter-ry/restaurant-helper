type FlowtallyMarkProps = {
  className?: string;
  title?: string;
};

export function FlowtallyMark({ className = "h-9 w-9", title = "Flowtally" }: FlowtallyMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <path d="M20 18h16c3 0 5 2 5 5" fill="none" stroke="#0F766E" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 49V32c0-4 3-7 7-7h12" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 34h17" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
      <path d="M44 25v22" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
      <path d="M36 34h16" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
