type FlowtallyMarkProps = {
  className?: string;
  title?: string;
};

export function FlowtallyMark({ className = "h-9 w-9", title = "Flowtally" }: FlowtallyMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <path d="M20 20v-2.5A5.5 5.5 0 0 1 25.5 12H39" fill="none" stroke="#0F766E" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 54V31a8 8 0 0 1 8-8h13" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 35h21" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
      <path d="M43 22v30" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
      <path d="M34 35h18" fill="none" stroke="#0F172A" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
