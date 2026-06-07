type FlowtallyMarkProps = {
  className?: string;
  title?: string;
};

export function FlowtallyMark({ className = "h-9 w-9", title = "Flowtally" }: FlowtallyMarkProps) {
  return (
    <svg className={className} viewBox="0 0 64 64" role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill="#FFFFFF" />
      <rect x="6" y="6" width="52" height="52" rx="12" fill="#F8FAFC" stroke="#E2E8F0" strokeWidth="2" />
      <path d="M19 20c8-5 18-5.5 26 0" fill="none" stroke="#0D9488" strokeWidth="5" strokeLinecap="round" />
      <path d="M27 49V24c0-6 4-9 10-9" fill="none" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
      <path d="M20 31h17" fill="none" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
      <path d="M43 19v25c0 4 2 6 6 6" fill="none" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
      <path d="M36 31h15" fill="none" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}