import { Save } from "lucide-react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { PageLayout } from "../components/PageLayout";
import { SectionHeader } from "../components/SectionHeader";
import { categories, restaurantProfile } from "../data/mockData";

const packages = [
  "Supplier Price Tracker",
  "Spending Dashboard",
  "Invoice Control System",
  "Food Cost/Menu Insight",
  "Full Cost-Control System",
];

export function SettingsPage() {
  return (
    <PageLayout title="Settings / Restaurant Profile" description="Configurable restaurant details, alert thresholds, report cadence, and service package selection.">
      <div className="grid gap-6 xl:grid-cols-[1fr_0.8fr]">
        <section>
          <SectionHeader title="Restaurant Profile" />
          <Card className="p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Restaurant name" value={restaurantProfile.name} />
              <Input label="Business type" value={restaurantProfile.businessType} />
              <Input label="Main contact" value={restaurantProfile.mainContact} />
              <Input label="Email" value={restaurantProfile.email} />
              <Input label="Phone" value={restaurantProfile.phone} />
              <Input label="Default report frequency" value={restaurantProfile.reportFrequency} />
              <Input label="Alert threshold percentage" value={`${restaurantProfile.alertThreshold}%`} />
              <Input label="Currency" value={restaurantProfile.currency} />
            </div>
            <div className="mt-5">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Categories</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((category) => (
                  <Badge key={category} tone="neutral">{category}</Badge>
                ))}
              </div>
            </div>
            <Button className="mt-6" icon={<Save className="h-4 w-4" />}>Save Settings</Button>
          </Card>
        </section>

        <section>
          <SectionHeader title="Package Selection" />
          <Card className="p-5">
            <div className="space-y-3">
              {packages.map((item, index) => (
                <label key={item} className="flex items-center gap-3 rounded-lg border border-line p-4">
                  <input type="radio" name="package" defaultChecked={index === 4} className="h-4 w-4 accent-brand-600" />
                  <span>
                    <span className="block text-sm font-bold text-ink">{item}</span>
                    <span className="block text-xs text-muted">
                      {index === 4 ? "Best fit for full validation demos." : "Can be offered as a narrower setup package."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}

function Input({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-wide text-muted">{label}</span>
      <input className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" defaultValue={value} />
    </label>
  );
}
