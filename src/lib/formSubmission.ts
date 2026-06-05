export type FormSubmissionResult = {
  mode: "demo" | "endpoint";
  message: string;
};

const formEndpoint = import.meta.env.VITE_FORM_ENDPOINT?.trim();

export async function submitForm(form: HTMLFormElement, formType: "feedback" | "pilot"): Promise<FormSubmissionResult> {
  const formData = new FormData(form);
  const tools = formData.getAll("tools").map(String);
  const payload: Record<string, FormDataEntryValue | string[] | string> = {
    formType,
    submittedAt: new Date().toISOString(),
    ...Object.fromEntries(formData.entries()),
  };

  if (tools.length) {
    payload.tools = tools;
  }

  if (!formEndpoint) {
    return {
      mode: "demo",
      message: "Thanks. Demo mode is on, so this FlowTally form was not sent anywhere yet.",
    };
  }

  // Formspree works with JSON POST bodies. Supabase Edge Functions,
  // Google Apps Script, or a custom API can use this same payload shape.
  const response = await fetch(formEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Form endpoint returned ${response.status}`);
  }

  return {
    mode: "endpoint",
    message: "Thanks. Your feedback was sent.",
  };
}
