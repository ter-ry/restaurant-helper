type FlowtallyMarkProps = {
  className?: string;
  title?: string;
};

export function FlowtallyMark({ className = "h-9 w-9", title = "Flowtally" }: FlowtallyMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <path d="M19 24v-2c0-8 7-13 15-13h13" fill="none" stroke="#0F766E" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 53V36c0-6 5-10 11-10h9" fill="none" stroke="#0F172A" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 35h20" fill="none" stroke="#0F172A" strokeWidth="10" strokeLinecap="round" />
      <path d="M45 23v20c0 7 5 10 11 10" fill="none" stroke="#0F172A" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M37 35h18" fill="none" stroke="#0F172A" strokeWidth="10" strokeLinecap="round" />
    </svg>
  );
}