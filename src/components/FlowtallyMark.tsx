type FlowtallyMarkProps = {
  className?: string;
  title?: string;
};

const logoIconSrc = `${import.meta.env.BASE_URL}logo-icon.png`;

export function FlowtallyMark({ className = "h-9 w-9", title = "Flowtally" }: FlowtallyMarkProps) {
  return <img className={className} src={logoIconSrc} alt={title} draggable={false} />;
}