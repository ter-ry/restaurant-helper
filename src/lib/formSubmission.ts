export type FormSubmissionResult = {
  mode: "demo" | "endpoint" | "spam";
  message: string;
};

const formEndpoint = import.meta.env.VITE_FORM_ENDPOINT?.trim();
const setupWarning =
  "[Flowtally setup] VITE_FORM_ENDPOINT is not configured. Form submissions are not being stored. Add a Formspree endpoint before outreach.";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isFormEndpointConfigured = Boolean(formEndpoint);

if (!isFormEndpointConfigured) {
  console.warn(setupWarning);
}

function getSuccessMessage(formType: "feedback" | "pilot") {
  return formType === "pilot" ? "Thanks. You're on the early pilot list." : "Thanks. Your feedback was sent.";
}

function getFormSubject(formType: "feedback" | "pilot") {
  return formType === "pilot" ? "New Flowtally pilot list lead" : "New Flowtally restaurant feedback lead";
}

export async function submitForm(form: HTMLFormElement, formType: "feedback" | "pilot"): Promise<FormSubmissionResult> {
  const formData = new FormData(form);
  const honeypotValue = String(formData.get("_gotcha") ?? "").trim();

  if (honeypotValue) {
    return {
      mode: "spam",
      message: getSuccessMessage(formType),
    };
  }

  formData.delete("_gotcha");

  const tools = formData.getAll("tools").map(String);
  const payload: Record<string, FormDataEntryValue | string[] | string> = {
    _subject: getFormSubject(formType),
    formType,
    submittedAt: new Date().toISOString(),
    pageUrl: window.location.href,
    referrer: document.referrer || "direct",
    userAgent: navigator.userAgent,
    ...Object.fromEntries(formData.entries()),
  };

  if (tools.length) {
    payload.tools = tools;
  }

  const replyContact = String(payload.email ?? payload.contact ?? "").trim();
  if (emailPattern.test(replyContact)) {
    payload._replyto = replyContact;
  }

  if (!formEndpoint) {
    console.warn(setupWarning);

    return {
      mode: "demo",
      message:
        "This preview form is not connected yet, so your note was not saved. Please email hello@flowtally.ca instead.",
    };
  }

  const response = await fetch(formEndpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.text();

  if (!response.ok) {
    console.error("[Flowtally form] Formspree submission failed", {
      status: response.status,
      statusText: response.statusText,
      responseBody,
      formType,
    });
    throw new Error(`Form endpoint returned ${response.status}: ${responseBody}`);
  }

  return {
    mode: "endpoint",
    message: getSuccessMessage(formType),
  };
}
