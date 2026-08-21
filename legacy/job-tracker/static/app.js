const state = { jobs: [], profile: {}, savedSearches: [], discoveryResults: [], generatedText: "", activeJobId: "" };

const jobFields = ["company", "title", "location", "url", "application-url", "source", "salary", "deadline", "remote-type", "role-type", "seniority-level", "status", "date-applied", "fit-score", "skills-match-score", "role-match-score", "location-score", "remote-score", "salary-score", "seniority-score", "coding-risk-score", "application-effort-score", "required-skills", "preferred-skills", "responsibilities", "notes", "job-description"];
const profileFields = ["name", "email", "phone", "location", "preferred-roles", "preferred-locations", "work-authorization", "key-skills", "projects", "education", "work-experience", "resume-text", "cover-letter-template"];

const api = {
  async get(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  },
  async send(path, method, body) {
    const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Request failed");
    }
    return response.json();
  },
  async upload(path, formData) {
    const response = await fetch(path, { method: "POST", body: formData });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "Upload failed");
    }
    return response.json();
  },
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", switchTab));
  document.getElementById("job-form").addEventListener("submit", saveJob);
  document.getElementById("profile-form").addEventListener("submit", saveProfile);
  document.getElementById("saved-search-form").addEventListener("submit", saveSavedSearch);
  document.getElementById("csv-import-form").addEventListener("submit", importCsv);
  document.getElementById("generate").addEventListener("click", generateMaterials);
  document.getElementById("reset-form").addEventListener("click", resetForm);
  document.getElementById("copy-output").addEventListener("click", copyOutput);
  document.getElementById("extract-description").addEventListener("click", extractDescription);
  document.getElementById("extract-url").addEventListener("click", extractUrl);
  document.getElementById("resume-upload").addEventListener("change", uploadResume);
  document.getElementById("reset-search").addEventListener("click", resetSavedSearchForm);
  ["result-search-filter", "result-status-filter", "result-rejection-filter"].forEach((id) => {
    document.getElementById(id).addEventListener("input", loadDiscoveryResults);
    document.getElementById(id).addEventListener("change", loadDiscoveryResults);
  });
  ["search", "status-filter", "fit-filter", "role-filter", "remote-filter", "risk-filter", "sort-by"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderJobs);
    document.getElementById(id).addEventListener("change", renderJobs);
  });
  loadAll();
});

async function loadAll() {
  try {
    const [jobs, dashboard, profile, savedSearches] = await Promise.all([api.get("/api/jobs"), api.get("/api/dashboard"), api.get("/api/profile"), api.get("/api/saved-searches")]);
    state.jobs = jobs;
    state.profile = profile;
    state.savedSearches = savedSearches;
    renderDashboard(dashboard);
    renderProfile(profile);
    renderSavedSearches();
    renderJobs();
    await loadDiscoveryResults();
  } catch (error) {
    toast(error.message);
  }
}

function switchTab(event) {
  const target = event.currentTarget.dataset.tab;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === target));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === target));
}

function renderDashboard(dashboard) {
  setText("jobs-saved", dashboard.jobs_saved);
  setText("applications-this-week", dashboard.applications_this_week);
  setText("follow-ups-needed", dashboard.follow_ups_needed);
  setText("high-fit-jobs", dashboard.high_fit);
  setText("average-fit-score", dashboard.average_fit_score);
  setText("interview-rate", `${dashboard.interview_rate}%`);
  setText("missing-salary", dashboard.missing_salary);
  setText("high-coding-risk", dashboard.high_coding_risk);
}

function renderProfile(profile) {
  profileFields.forEach((field) => setValue(`profile-${field}`, profile[toSnake(field)] || ""));
}

function renderJobs() {
  const tbody = document.getElementById("jobs-table");
  const search = value("search").toLowerCase();
  const status = value("status-filter");
  const fit = Number(value("fit-filter") || 0);
  const role = value("role-filter");
  const remote = value("remote-filter");
  const risk = value("risk-filter");
  const sortBy = value("sort-by");
  let jobs = state.jobs.filter((job) => {
    const content = `${job.company} ${job.title} ${job.location} ${job.notes} ${job.required_skills}`.toLowerCase();
    return (!search || content.includes(search)) && (!status || job.status === status) && (!fit || Number(job.fit_score || 0) >= fit) && (!role || job.role_type === role) && (!remote || job.remote_type === remote) && (!risk || (risk === "high" ? Number(job.coding_risk_score || 100) < 60 : Number(job.coding_risk_score || 0) >= 60));
  });
  jobs = sortJobs(jobs, sortBy);
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="muted">No applications match this view.</td></tr>`;
    return;
  }
  tbody.innerHTML = jobs.map((job) => `
    <tr>
      <td><strong>${escapeHtml(job.company)}</strong><br>${linkFor(job.url || job.application_url)}</td>
      <td>${escapeHtml(job.title)}<br><span class="muted">${escapeHtml(job.role_type || "")}</span></td>
      <td>${escapeHtml(job.location || "")}<br><span class="muted">${escapeHtml(job.remote_type || "")}</span></td>
      <td>${scorePill(job.fit_score)}<div class="mini-breakdown">${miniBreakdown(job)}</div></td>
      <td>${riskLabel(job)}</td>
      <td>${escapeHtml(job.status)}</td>
      <td>${escapeHtml(job.salary || "Missing")}</td>
      <td>${escapeHtml(job.deadline || "")}</td>
      <td><div class="row-actions"><button class="button small ghost" type="button" onclick="editJob(${job.id})">Edit</button><button class="button small ghost" type="button" onclick="generateForJob(${job.id})">Tailor</button><button class="button small ghost" type="button" onclick="followUp(${job.id})">Follow-up</button><button class="button small ghost danger" type="button" onclick="deleteJob(${job.id})">Delete</button></div></td>
    </tr>`).join("");
}

function sortJobs(jobs, sortBy) {
  const copy = [...jobs];
  const salaryNumber = (job) => Math.max(0, ...String(job.salary || "").match(/\d+/g)?.map(Number) || [0]);
  if (sortBy === "salary") return copy.sort((a, b) => salaryNumber(b) - salaryNumber(a));
  if (sortBy === "deadline") return copy.sort((a, b) => String(a.deadline || "9999").localeCompare(String(b.deadline || "9999")));
  if (sortBy === "location") return copy.sort((a, b) => String(a.location || "").localeCompare(String(b.location || "")));
  if (sortBy === "date") return copy.sort((a, b) => String(b.date_added || "").localeCompare(String(a.date_added || "")));
  return copy.sort((a, b) => Number(b.fit_score || 0) - Number(a.fit_score || 0));
}

function miniBreakdown(job) {
  return [`skills ${job.skills_match_score || 0}`, `role ${job.role_match_score || 0}`, `loc ${job.location_score || 0}`, `remote ${job.remote_score || 0}`].join(" | ");
}

function riskLabel(job) {
  const coding = Number(job.coding_risk_score || 100);
  const effort = Number(job.application_effort_score || 100);
  if (coding < 60) return `<span class="risk high">High coding</span>`;
  if (effort < 70) return `<span class="risk medium">High effort</span>`;
  return `<span class="risk low">Low</span>`;
}

function scorePill(score) {
  return `<span class="score">${Number(score || 0)}</span>`;
}

function linkFor(url) {
  if (!url) return "";
  return `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">Posting</a>`;
}

function getPayload() {
  return {
    id: value("job-id"),
    company: value("company"),
    title: value("title"),
    location: value("location"),
    url: value("url"),
    application_url: value("application-url"),
    source: value("source"),
    salary: value("salary"),
    deadline: value("deadline"),
    remote_type: value("remote-type"),
    role_type: value("role-type"),
    seniority_level: value("seniority-level"),
    status: value("status"),
    date_applied: value("date-applied"),
    fit_score: value("fit-score"),
    required_skills: value("required-skills"),
    preferred_skills: value("preferred-skills"),
    responsibilities: value("responsibilities"),
    notes: value("notes"),
    job_description: value("job-description"),
  };
}

function getProfilePayload() {
  const payload = {};
  profileFields.forEach((field) => { payload[toSnake(field)] = value(`profile-${field}`); });
  return payload;
}

async function saveJob(event) {
  event.preventDefault();
  try {
    const id = value("job-id");
    const saved = id ? await api.send(`/api/jobs/${id}`, "PUT", getPayload()) : await api.send("/api/jobs", "POST", getPayload());
    state.activeJobId = saved.id;
    fillJobForm(saved);
    renderScore(saved);
    toast(`${saved.company || "Job"} saved`);
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
}

async function saveProfile(event) {
  event.preventDefault();
  try {
    state.profile = await api.send("/api/profile", "POST", getProfilePayload());
    toast("Profile saved");
  } catch (error) {
    toast(error.message);
  }
}

async function uploadResume(event) {
  const file = event.target.files[0];
  if (!file) return;
  const data = new FormData();
  data.append("file", file);
  try {
    const result = await api.upload("/api/profile/upload", data);
    setValue("profile-resume-text", result.resume_text);
    toast("Resume text extracted");
  } catch (error) {
    toast(error.message);
  }
}

async function extractDescription() {
  const jobDescription = value("paste-description");
  if (!jobDescription) return toast("Paste a job description first");
  try {
    const details = await api.send("/api/jobs/from-description", "POST", { job_description: jobDescription, source: "Pasted description" });
    fillJobForm({ ...details, job_description: jobDescription, status: "Saved" });
    toast("Details extracted");
  } catch (error) {
    toast(error.message);
  }
}

async function extractUrl() {
  const url = value("import-url");
  if (!url) return toast("Enter a public job URL first");
  try {
    const details = await api.send("/api/jobs/from-url", "POST", { url });
    fillJobForm({ ...details, status: "Saved" });
    toast("Public URL fetched");
  } catch (error) {
    toast(error.message);
  }
}

async function generateMaterials() {
  try {
    const output = await api.send("/api/generate", "POST", getPayload());
    setValue("fit-score", output.fit_score);
    renderScore({ ...getPayload(), ...output.score_breakdown });
    state.generatedText = formatGeneratedText(output);
    renderGenerated(output);
  } catch (error) {
    toast(error.message);
  }
}

async function generateForJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  fillJobForm(job);
  await generateMaterials();
}

function renderGenerated(output) {
  const jobId = value("job-id");
  const exportLinks = jobId ? `<div class="export-row"><a class="button small ghost" href="/export/${jobId}/cover_letter.txt">Cover .txt</a><a class="button small ghost" href="/export/${jobId}/cover_letter.docx">Cover .docx</a><a class="button small ghost" href="/export/${jobId}/resume.txt">Resume .txt</a><a class="button small ghost" href="/export/${jobId}/resume.docx">Resume .docx</a></div>` : `<p class="muted">Save the job first to enable version history and document exports.</p>`;
  document.getElementById("generated-output").classList.remove("empty");
  document.getElementById("generated-output").innerHTML = `
    <section><h3>Score breakdown: ${output.fit_score}</h3><div class="score-grid">${scoreItem("Skills", output.score_breakdown.skills_match_score)}${scoreItem("Role", output.score_breakdown.role_match_score)}${scoreItem("Location", output.score_breakdown.location_score)}${scoreItem("Remote", output.score_breakdown.remote_score)}${scoreItem("Salary", output.score_breakdown.salary_score)}${scoreItem("Seniority", output.score_breakdown.seniority_score)}${scoreItem("Coding risk", output.score_breakdown.coding_risk_score)}${scoreItem("Effort", output.score_breakdown.application_effort_score)}</div></section>
    <section><h3>Keyword guidance</h3><p><strong>Matched:</strong> ${escapeHtml(output.matched_keywords.join(", ") || "None")}</p><p><strong>Supported by profile:</strong> ${escapeHtml(output.supported_keywords.join(", ") || "Add more profile detail")}</p><p><strong>Truthfully add:</strong> ${escapeHtml(output.missing_keywords.join(", ") || "None found")}</p><p><strong>Do not add unsupported:</strong> ${escapeHtml(output.unsupported_keywords.join(", ") || "None")}</p></section>
    <section><h3>Resume suggestions</h3><pre>${escapeHtml(output.resume_text)}</pre>${exportLinks}</section>
    <section><h3>Cover letter</h3><textarea id="cover-letter-edit" rows="12">${escapeHtml(output.cover_letter)}</textarea><div class="actions compact"><button class="button small ghost" type="button" onclick="copyElement('cover-letter-edit')">Copy cover letter</button><button class="button small ghost" type="button" onclick="saveEditedVersion('cover_letter','cover-letter-edit')">Save version</button></div></section>
    <section><h3>Application answers</h3><textarea id="answers-edit" rows="12">${escapeHtml(answersToText(output.short_answers))}</textarea><div class="actions compact"><button class="button small ghost" type="button" onclick="copyElement('answers-edit')">Copy answers</button><button class="button small ghost" type="button" onclick="saveEditedVersion('answers','answers-edit')">Save version</button></div></section>`;
}

function scoreItem(label, value) {
  return `<div><span>${Number(value || 0)}</span><p>${escapeHtml(label)}</p></div>`;
}

function formatGeneratedText(output) {
  return [`Fit score: ${output.fit_score}`, `Matched: ${output.matched_keywords.join(", ")}`, `Supported: ${output.supported_keywords.join(", ")}`, `Truthfully add: ${output.missing_keywords.join(", ")}`, `Unsupported: ${output.unsupported_keywords.join(", ")}`, "", output.resume_text, "", "Cover letter:", output.cover_letter, "", "Application answers:", answersToText(output.short_answers)].join("\n");
}

function answersToText(answers) {
  return answers.map((item) => `${item.question}\n${item.answer}`).join("\n\n");
}

function fillJobForm(job) {
  state.activeJobId = job.id || "";
  setValue("job-id", job.id || "");
  setValue("company", job.company);
  setValue("title", job.title);
  setValue("location", job.location);
  setValue("url", job.url);
  setValue("application-url", job.application_url);
  setValue("source", job.source);
  setValue("salary", job.salary);
  setValue("deadline", job.deadline);
  setValue("remote-type", job.remote_type);
  setValue("role-type", job.role_type || "other");
  setValue("seniority-level", job.seniority_level);
  setValue("status", job.status || "Saved");
  setValue("date-applied", job.date_applied);
  setValue("fit-score", job.fit_score || 0);
  setValue("required-skills", job.required_skills);
  setValue("preferred-skills", job.preferred_skills);
  setValue("responsibilities", job.responsibilities);
  setValue("notes", job.notes);
  setValue("job-description", job.job_description);
  renderScore(job);
  document.querySelector('[data-tab="workflow"]').click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderScore(job) {
  ["skills_match_score", "role_match_score", "location_score", "remote_score", "salary_score", "seniority_score", "coding_risk_score", "application_effort_score"].forEach((field) => setValue(toKebab(field), job[field] || 0));
  setValue("fit-score", job.fit_score || 0);
  const breakdown = job.score_breakdown?.breakdown || job.breakdown || job.score_breakdown || {};
  const notes = breakdown.notes || [];
  document.getElementById("score-notes").innerHTML = notes.length ? notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("") : "No score notes yet.";
}

function editJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (job) fillJobForm(job);
}

async function followUp(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job) return;
  try {
    const result = await api.send("/api/follow-up", "POST", job);
    state.generatedText = result.message;
    document.getElementById("generated-output").classList.remove("empty");
    document.getElementById("generated-output").innerHTML = `<section><h3>Follow-up message</h3><textarea id="follow-up-edit" rows="9">${escapeHtml(result.message)}</textarea><div class="actions compact"><button class="button small ghost" type="button" onclick="copyElement('follow-up-edit')">Copy follow-up</button></div></section>`;
    document.querySelector('[data-tab="workflow"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    toast(error.message);
  }
}

async function deleteJob(id) {
  const job = state.jobs.find((item) => item.id === id);
  if (!job || !confirm(`Delete ${job.company} - ${job.title}?`)) return;
  try {
    await api.send(`/api/jobs/${id}`, "DELETE", {});
    toast("Job deleted");
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
}

async function saveEditedVersion(kind, elementId) {
  const id = value("job-id");
  if (!id) return toast("Save the job first");
  try {
    await api.send(`/api/jobs/${id}/versions`, "POST", { kind, content: value(elementId) });
    toast("Version saved");
  } catch (error) {
    toast(error.message);
  }
}

async function saveSavedSearch(event) {
  event.preventDefault();
  try {
    const id = value("saved-search-id");
    await api.send(id ? `/api/saved-searches/${id}` : "/api/saved-searches", id ? "PUT" : "POST", getSavedSearchPayload());
    toast("Saved search stored");
    resetSavedSearchForm();
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
}

function getSavedSearchPayload() {
  return { search_name: value("search-name"), keywords: value("saved-keywords"), location: value("saved-location"), distance: value("saved-distance"), remote_preference: value("saved-remote"), minimum_salary: value("saved-min-salary"), target_roles: value("saved-target-roles"), excluded_title_keywords: value("saved-excluded"), maximum_experience: value("saved-max-exp"), posted_within_days: value("saved-days"), max_results_per_source: value("saved-max-results"), country_indeed: value("saved-country"), enabled_sources: [...document.querySelectorAll(".source-check:checked")].map((item) => item.value) };
}

function renderSavedSearches() {
  const list = document.getElementById("saved-searches-list");
  const filter = document.getElementById("result-search-filter");
  filter.innerHTML = `<option value="">All searches</option>${state.savedSearches.map((item) => `<option value="${item.id}">${escapeHtml(item.search_name)}</option>`).join("")}`;
  if (!state.savedSearches.length) {
    list.classList.add("empty");
    list.innerHTML = "No saved searches yet.";
    return;
  }
  list.classList.remove("empty");
  list.innerHTML = state.savedSearches.map((item) => `<section><h3>${escapeHtml(item.search_name)}</h3><p class="muted">${escapeHtml(item.keywords)} | ${escapeHtml(item.location)} | ${escapeHtml(item.enabled_sources)}</p><div class="actions compact"><button class="button small ghost" type="button" onclick="editSavedSearch(${item.id})">Edit</button><button class="button small" type="button" onclick="runSavedSearch(${item.id})">Run</button><button class="button small ghost danger" type="button" onclick="deleteSavedSearch(${item.id})">Delete</button></div></section>`).join("");
}

function editSavedSearch(id) {
  const item = state.savedSearches.find((search) => search.id === id);
  if (!item) return;
  setValue("saved-search-id", item.id);
  setValue("search-name", item.search_name);
  setValue("saved-keywords", item.keywords);
  setValue("saved-location", item.location);
  setValue("saved-distance", item.distance);
  setValue("saved-remote", item.remote_preference);
  setValue("saved-min-salary", item.minimum_salary);
  setValue("saved-target-roles", item.target_roles);
  setValue("saved-excluded", item.excluded_title_keywords);
  setValue("saved-max-exp", item.maximum_experience);
  setValue("saved-days", item.posted_within_days);
  setValue("saved-max-results", item.max_results_per_source);
  setValue("saved-country", item.country_indeed);
  document.querySelectorAll(".source-check").forEach((box) => { box.checked = item.enabled_sources_list.includes(box.value); });
}

function resetSavedSearchForm() {
  setValue("saved-search-id", "");
  setValue("search-name", "");
  setValue("saved-keywords", "junior software developer");
  setValue("saved-location", "Toronto, Ontario");
  setValue("saved-distance", 50);
  setValue("saved-remote", "");
  setValue("saved-min-salary", 0);
  setValue("saved-target-roles", "");
  setValue("saved-excluded", "senior,staff,principal,director,lead,architect,manager");
  setValue("saved-max-exp", 3);
  setValue("saved-days", 7);
  setValue("saved-max-results", 10);
  setValue("saved-country", "Canada");
  document.querySelectorAll(".source-check").forEach((box) => { box.checked = true; });
}

async function runSavedSearch(id) {
  try {
    toast("Running JobSpy search...");
    const summary = await api.send(`/api/saved-searches/${id}/run`, "POST", {});
    toast(`JobSpy run: ${summary.new} new, ${summary.updated} updated, ${summary.rejected} rejected, ${summary.failed} failed`);
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
}

async function deleteSavedSearch(id) {
  if (!confirm("Delete this saved search?")) return;
  await api.send(`/api/saved-searches/${id}`, "DELETE", {});
  await loadAll();
}

async function loadDiscoveryResults() {
  const params = new URLSearchParams();
  if (value("result-search-filter")) params.set("saved_search_id", value("result-search-filter"));
  if (value("result-status-filter")) params.set("status", value("result-status-filter"));
  if (value("result-rejection-filter")) params.set("rejection_reason", value("result-rejection-filter"));
  state.discoveryResults = await api.get(`/api/discovery/results?${params.toString()}`);
  renderDiscoveryResults();
}

function renderDiscoveryResults() {
  const container = document.getElementById("discovery-results");
  if (!state.discoveryResults.length) {
    container.classList.add("empty");
    container.innerHTML = "Run a saved search to collect JobSpy results.";
    return;
  }
  container.classList.remove("empty");
  container.innerHTML = state.discoveryResults.map((job) => `<section><h3>${scorePill(job.fit_score)} ${escapeHtml(job.title)} at ${escapeHtml(job.company)}</h3><p class="muted">${escapeHtml(job.source)} | ${escapeHtml(job.location)} | ${escapeHtml(job.remote_type || "remote unknown")} | ${escapeHtml(job.salary_text || "salary missing")} | posted ${escapeHtml(job.posted_date || "unknown")} | description ${job.description ? "yes" : "no"}</p><p>${job.status === "rejected" ? `<strong>Rejected:</strong> ${escapeHtml(job.rejection_reason)}` : escapeHtml(job.risk_flags || "")}</p><div class="actions compact">${linkFor(job.job_url)}<button class="button small ghost" type="button" onclick="saveDiscoveryResult(${job.id})">Save</button><button class="button small ghost" type="button" onclick="ignoreDiscoveryResult(${job.id})">Ignore</button><button class="button small ghost" type="button" onclick="generateFromDiscovery(${job.id})">Generate materials</button></div></section>`).join("");
}

async function saveDiscoveryResult(id) {
  await api.send(`/api/discovery/results/${id}/save`, "POST", {});
  toast("Saved to tracker");
  await loadAll();
}

async function ignoreDiscoveryResult(id) {
  await api.send(`/api/discovery/results/${id}/ignore`, "POST", {});
  await loadDiscoveryResults();
}

async function generateFromDiscovery(id) {
  const job = state.discoveryResults.find((item) => item.id === id);
  if (!job) return;
  fillJobForm({ company: job.company, title: job.title, location: job.location, remote_type: job.remote_type, source: job.source, salary: job.salary_text, url: job.job_url, application_url: job.application_url, required_skills: job.required_skills, preferred_skills: job.preferred_skills, job_description: job.description, status: "Saved" });
  await generateMaterials();
}

async function importCsv(event) {
  event.preventDefault();
  const file = document.getElementById("csv-file").files[0];
  if (!file) return toast("Choose a CSV file first");
  const data = new FormData();
  data.append("file", file);
  try {
    const result = await api.upload("/api/jobs/import-csv", data);
    toast(`Imported ${result.imported} jobs`);
    await loadAll();
  } catch (error) {
    toast(error.message);
  }
}

function resetForm() {
  setValue("job-id", "");
  jobFields.forEach((id) => setValue(id, ""));
  setValue("fit-score", 0);
  setValue("status", "Saved");
  setValue("role-type", "other");
  document.getElementById("score-notes").textContent = "Save or generate to calculate detailed scoring.";
}

async function copyOutput() {
  if (!state.generatedText) return toast("Nothing to copy yet");
  await navigator.clipboard.writeText(state.generatedText);
  toast("Copied");
}

async function copyElement(id) {
  await navigator.clipboard.writeText(value(id));
  toast("Copied");
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function setValue(id, nextValue) {
  const element = document.getElementById(id);
  if (element) element.value = nextValue || "";
}

function setText(id, nextValue) {
  document.getElementById(id).textContent = nextValue ?? "";
}

function toSnake(value) {
  return value.replaceAll("-", "_");
}

function toKebab(value) {
  return value.replaceAll("_", "-");
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function toast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  document.body.appendChild(item);
  setTimeout(() => item.remove(), 2600);
}
