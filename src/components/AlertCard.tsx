import { AlertTriangle } from "lucide-react";
import { Card } from "./Card";

interface AlertCardProps {
  message: string;
}

export function AlertCard({ message }: AlertCardProps) {
  return (
    <Card className="flex items-start gap-3 border-amber-200 bg-amber-50 p-4 shadow-none">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" />
      <p className="text-sm font-medium text-amber-950">{message}</p>
    </Card>
  );
}
