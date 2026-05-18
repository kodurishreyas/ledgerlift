const categories = ["Housing", "Food", "Transport", "Shopping", "Health", "Entertainment", "Learning", "Income", "Investing"];
const spendCategories = categories.filter((category) => category !== "Income");
const colors = ["#0b7a53", "#ff6b5f", "#3267d6", "#e0a526", "#0f8b8d", "#8f5dd9", "#dc4f8a", "#5b7f45"];
const storageKey = "ledgerlift-public-v1";
const today = new Date();
const syncConfig = window.LEDGERLIFT_SUPABASE || {};

const defaultBudgets = {
  Housing: 0,
  Food: 0,
  Transport: 0,
  Shopping: 0,
  Health: 0,
  Entertainment: 0,
  Learning: 0,
  Investing: 0
};

const blankState = {
  settings: {
    profileName: "",
    currency: "USD",
    theme: "light",
    dailyChallenge: {
      date: "",
      done: []
    },
    quickPrefs: {
      lastExpenseCategory: "Food"
    },
    fun: {
      xp: 0,
      level: 1
    },
    onboardingDismissed: false,
    streak: {
      current: 0,
      best: 0,
      lastEntryDate: ""
    }
  },
  transactions: [],
  budgets: defaultBudgets,
  goals: []
};

let state = loadState();
let currentChart = "bar";
let syncTimer;
let isApplyingCloudState = false;

const cloud = {
  client: null,
  user: null,
  configured: Boolean(syncConfig.url && syncConfig.anonKey),
  ready: false
};

const els = {
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  profileName: document.querySelector("#profileName"),
  currency: document.querySelector("#currency"),
  emailInput: document.querySelector("#emailInput"),
  signInButton: document.querySelector("#signInButton"),
  signOutButton: document.querySelector("#signOutButton"),
  themeToggle: document.querySelector("#themeToggle"),
  themeToggleLabel: document.querySelector("#themeToggleLabel"),
  syncStatus: document.querySelector("#syncStatus"),
  category: document.querySelector("#category"),
  transactionForm: document.querySelector("#transactionForm"),
  editingId: document.querySelector("#editingId"),
  description: document.querySelector("#description"),
  amount: document.querySelector("#amount"),
  type: document.querySelector("#type"),
  date: document.querySelector("#date"),
  searchInput: document.querySelector("#searchInput"),
  filterType: document.querySelector("#filterType"),
  table: document.querySelector("#transactionTable"),
  budgetGrid: document.querySelector("#budgetGrid"),
  goalsGrid: document.querySelector("#goalsGrid"),
  goalForm: document.querySelector("#goalForm"),
  toast: document.querySelector("#toast")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(blankState);

  try {
    const parsed = JSON.parse(saved);
    return {
      settings: normalizeSettings(parsed.settings),
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      budgets: { ...defaultBudgets, ...parsed.budgets },
      goals: Array.isArray(parsed.goals) ? parsed.goals : []
    };
  } catch {
    return structuredClone(blankState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  queueCloudSave();
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.settings.currency,
    maximumFractionDigits: state.settings.currency === "JPY" ? 0 : 2
  }).format(Number(value) || 0);
}

function monthKey(dateString) {
  return dateString.slice(0, 7);
}

function currentMonthTransactions() {
  const current = today.toISOString().slice(0, 7);
  return state.transactions.filter((item) => monthKey(item.date) === current);
}

function totals(items = currentMonthTransactions()) {
  return items.reduce(
    (acc, item) => {
      acc[item.type] += Number(item.amount);
      return acc;
    },
    { income: 0, expense: 0 }
  );
}

function byCategory(items = currentMonthTransactions().filter((item) => item.type === "expense")) {
  return items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + Number(item.amount);
    return acc;
  }, {});
}

async function init() {
  els.category.innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join("");
  els.date.value = today.toISOString().slice(0, 10);
  els.profileName.value = state.settings.profileName;
  els.currency.value = state.settings.currency;
  applyTheme();
  bindEvents();
  render();
  await initCloudSync();
}

function bindEvents() {
  els.navItems.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  document.querySelector("#quickAddButton").addEventListener("click", () => {
    setView("transactions");
    els.amount.focus();
  });

  document.querySelector("#exportButton").addEventListener("click", exportCsv);
  document.querySelector("#backupButton").addEventListener("click", exportBackup);
  document.querySelector("#restoreButton").addEventListener("click", () => document.querySelector("#restoreInput").click());
  document.querySelector("#restoreInput").addEventListener("change", importBackup);
  els.themeToggle.addEventListener("click", toggleTheme);
  els.signInButton.addEventListener("click", handleSignIn);
  els.signOutButton.addEventListener("click", handleSignOut);
  document.querySelector("#startOnboardingButton").addEventListener("click", () => {
    setView("transactions");
    els.amount.focus();
  });
  document.querySelector("#dismissOnboardingButton").addEventListener("click", () => {
    state.settings.onboardingDismissed = true;
    saveState();
    renderOnboarding();
  });

  els.profileName.addEventListener("input", () => {
    state.settings.profileName = els.profileName.value.trim();
    saveState();
    renderWelcome();
  });

  els.currency.addEventListener("input", handleCurrencyInput);

  document.querySelectorAll("[data-filter-type]").forEach((button) => {
    button.addEventListener("click", () => {
      els.filterType.value = button.dataset.filterType;
      setView("transactions");
      renderTransactions();
    });
  });

  document.querySelectorAll("[data-chart]").forEach((button) => {
    button.addEventListener("click", () => {
      currentChart = button.dataset.chart;
      document.querySelectorAll("[data-chart]").forEach((item) => item.classList.toggle("is-selected", item === button));
      drawCashflow();
    });
  });

  document.querySelectorAll("[data-quick-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      els.amount.value = button.dataset.quickAmount;
      els.amount.focus();
    });
  });

  document.querySelector("#whatIfSlider")?.addEventListener("input", renderWhatIfSimulator);
  els.transactionForm.addEventListener("submit", handleTransactionSubmit);
  els.searchInput.addEventListener("input", renderTransactions);
  els.filterType.addEventListener("change", renderTransactions);
  els.type.addEventListener("change", syncCategoryWithType);
  els.goalForm.addEventListener("submit", handleGoalSubmit);
  document.addEventListener("keydown", handleGlobalShortcuts);
}

function setView(viewId) {
  els.views.forEach((view) => view.classList.toggle("is-visible", view.id === viewId));
  els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.view === viewId));
  document.querySelector("main").dataset.activeView = viewId;
}

function syncCategoryWithType() {
  if (els.type.value === "income") els.category.value = "Income";
  if (els.type.value === "expense" && els.category.value === "Income") {
    els.category.value = state.settings.quickPrefs.lastExpenseCategory || "Food";
  }
}

function handleTransactionSubmit(event) {
  event.preventDefault();
  const before = calculateDecisionMetrics();
  const description = els.description.value.trim();
  const transaction = {
    id: els.editingId.value || crypto.randomUUID(),
    description,
    amount: Number(els.amount.value),
    type: els.type.value,
    category: els.category.value,
    date: els.date.value
  };

  if (transaction.type === "income") transaction.category = "Income";
  if (!transaction.description) {
    transaction.description = transaction.type === "income" ? "Income entry" : `${transaction.category} expense`;
  }
  if (transaction.type === "expense" && transaction.category !== "Income") {
    state.settings.quickPrefs.lastExpenseCategory = transaction.category;
  }

  let reward;
  if (els.editingId.value) {
    state.transactions = state.transactions.map((item) => (item.id === transaction.id ? transaction : item));
  } else {
    state.transactions.unshift(transaction);
    updateStreak(transaction.date);
    reward = addFunXp(transaction);
  }

  els.transactionForm.reset();
  els.editingId.value = "";
  els.date.value = today.toISOString().slice(0, 10);
  els.type.value = "expense";
  syncCategoryWithType();
  saveState();
  render();
  renderQuickInsight(transaction);
  renderCheer(transaction);
  const after = calculateDecisionMetrics(transaction);
  toast(buildEmotionalFeedback(transaction, before, after));
  if (reward?.leveledUp) {
    window.setTimeout(() => toast(`Level ${reward.level} unlocked. Your money habit just got stronger.`), 650);
  }
  els.amount.focus();
}

function handleGoalSubmit(event) {
  event.preventDefault();
  state.goals.unshift({
    id: crypto.randomUUID(),
    name: document.querySelector("#goalName").value.trim(),
    target: Number(document.querySelector("#goalTarget").value),
    saved: Number(document.querySelector("#goalSaved").value)
  });
  els.goalForm.reset();
  saveState();
  renderGoals();
  toast("Goal added.");
}

function render() {
  renderWelcome();
  renderOnboarding();
  renderStreak();
  renderFun();
  renderMissionBoard();
  renderDecisionEngine();
  renderSurvivalSnapshot();
  renderWhatIfSimulator();
  renderOverview();
  renderCoach();
  renderDailyChallenge();
  renderAdvantage();
  renderIntelligenceCenter();
  renderTransactions();
  renderBudgets();
  renderGoals();
  renderQuickInsight(state.transactions[0]);
  drawCashflow();
  drawCategories();
  drawMini();
  document.body.classList.remove("app-loading");
}

function renderWelcome() {
  const name = state.settings.profileName;
  document.querySelector("#welcomeText").textContent = name ? `${name}'s survival dashboard` : "Money survival dashboard";
}

function renderOnboarding() {
  const panel = document.querySelector("#onboardingPanel");
  if (!panel) return;
  const shouldShow = !state.settings.onboardingDismissed && state.transactions.length < 2;
  panel.classList.toggle("is-hidden", !shouldShow);
}

function renderDecisionEngine() {
  const metrics = calculateDecisionMetrics(state.transactions[0]);
  const runwayEl = document.querySelector("#runwayHero");
  const runwayDaysEl = document.querySelector("#runwayDays");
  const runwayLabelEl = document.querySelector("#runwayLabel");
  const runwayTrendEl = document.querySelector("#runwayTrend");
  const titleEl = document.querySelector("#decisionTitle");
  const textEl = document.querySelector("#decisionText");
  const actionTitleEl = document.querySelector("#decisionActionTitle");
  const actionTextEl = document.querySelector("#decisionActionText");
  if (!runwayEl || !runwayDaysEl) return;

  runwayEl.classList.remove("is-safe", "is-caution", "is-danger");
  runwayEl.classList.add(`is-${metrics.status}`);
  document.body.classList.toggle("danger-mode", metrics.status === "danger" && state.transactions.length > 0);
  animateNumber(runwayDaysEl, metrics.runwayDays);
  runwayLabelEl.textContent = metrics.runwayLabel;
  runwayTrendEl.textContent = metrics.trend;

  titleEl.textContent = metrics.insightTitle;
  textEl.textContent = metrics.insightText;
  actionTitleEl.textContent = metrics.actionTitle;
  actionTextEl.textContent = metrics.actionText;
}

function renderSurvivalSnapshot() {
  const metrics = calculateDecisionMetrics(state.transactions[0]);
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const reductionPerDay = 100;
  const dayOfMonth = Math.max(1, today.getDate());
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  const dailyBurn = monthTotals.expense / dayOfMonth;
  const gainIfReduce = dailyBurn > 0 ? Math.max(0, Math.floor((reductionPerDay * daysLeft) / dailyBurn)) : 0;
  const shieldText = document.querySelector("#shieldScore")?.textContent || "0/100";
  const title = document.querySelector("#snapshotTitle");
  const text = document.querySelector("#snapshotText");
  const runway = document.querySelector("#snapshotRunway");
  const shield = document.querySelector("#snapshotShield");
  const whatIf = document.querySelector("#snapshotWhatIf");
  if (!title || !text || !runway || !shield || !whatIf) return;

  runway.textContent = `${metrics.runwayDays}d`;
  shield.textContent = shieldText.replace("/100", "");
  whatIf.textContent = `+${gainIfReduce}d`;

  if (!state.transactions.length) {
    title.textContent = "How long will your money survive?";
    text.textContent = "Add your first income and expense to generate a snapshot worth checking daily.";
    return;
  }

  title.textContent = metrics.status === "danger" ? "Your money needs a reset" : metrics.status === "caution" ? "Your runway is sensitive" : "Your money has breathing room";
  text.textContent =
    metrics.status === "danger"
      ? `${metrics.trend} Reduce ${formatMoney(reductionPerDay)}/day to regain about ${gainIfReduce} days.`
      : `${metrics.trend} Your best next move: ${metrics.actionTitle.toLowerCase()}.`;
}

function renderWhatIfSimulator() {
  const slider = document.querySelector("#whatIfSlider");
  const cutEl = document.querySelector("#whatIfCut");
  const daysEl = document.querySelector("#whatIfDays");
  const cashEl = document.querySelector("#whatIfCash");
  const moodEl = document.querySelector("#whatIfMood");
  const lab = document.querySelector(".whatif-lab");
  if (!slider || !cutEl || !daysEl || !cashEl || !moodEl || !lab) return;

  const cut = Number(slider.value) || 0;
  const now = new Date();
  const dayOfMonth = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  const monthTotals = totals(currentMonthTransactions());
  const dailyBurn = monthTotals.expense / dayOfMonth;
  const runwayGain = dailyBurn > 0 ? Math.max(0, Math.floor((cut * daysLeft) / dailyBurn)) : 0;
  const monthSaved = cut * daysLeft;

  cutEl.textContent = formatMoney(cut);
  daysEl.textContent = `+${runwayGain} days`;
  cashEl.textContent = formatMoney(monthSaved);
  const intensity = Math.min(100, Math.round((cut / 500) * 100));
  lab.style.setProperty("--whatif", `${intensity}%`);
  lab.style.setProperty("--whatif-mid", `${36 + intensity * 0.45}%`);
  lab.style.setProperty("--whatif-high", `${50 + intensity * 0.32}%`);

  if (!state.transactions.length || !monthTotals.income) {
    moodEl.textContent = "Add income and one expense to turn this into a real survival simulation.";
  } else if (runwayGain >= 7) {
    moodEl.textContent = `That tiny shift can buy about ${runwayGain} more days of breathing room.`;
  } else if (runwayGain > 0) {
    moodEl.textContent = `This move gives you about ${runwayGain} extra days. Small, but real.`;
  } else {
    moodEl.textContent = "Slide higher to find a move that visibly extends your money survival time.";
  }
}

function calculateDecisionMetrics(latestTransaction) {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = Math.max(1, now.getDate());
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1);
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const categoryTotals = byCategory(monthItems.filter((item) => item.type === "expense"));
  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const dailyBurn = monthTotals.expense / dayOfMonth;
  const available = monthTotals.income - monthTotals.expense;

  let runwayDays = 0;
  if (monthTotals.expense === 0 && monthTotals.income > 0) runwayDays = daysLeft;
  else if (available > 0 && dailyBurn > 0) runwayDays = Math.floor(available / dailyBurn);

  const status = runwayDays >= daysLeft ? "safe" : runwayDays >= Math.ceil(daysLeft * 0.45) ? "caution" : "danger";
  const top = sortedCategories[0];
  const reductionPerDay = 100;
  const gainIfReduce = dailyBurn > 0 ? Math.max(0, Math.floor((reductionPerDay * daysLeft) / dailyBurn)) : 0;
  const lastSpendGain =
    latestTransaction?.type === "expense" && dailyBurn > 0 ? Math.max(0, Math.round(Number(latestTransaction.amount) / dailyBurn)) : 0;

  let insightTitle = "You are in control";
  let insightText = `What-if: reduce ${formatMoney(reductionPerDay)}/day and gain about +${gainIfReduce} runway days.`;
  let actionTitle = "Lock today's safe limit";
  let actionText = `Keep spend under ${formatMoney(Math.max(0, available / daysLeft))} today to protect runway.`;
  let trend = `At this rate, money lasts until ${formatRunoutDate(runwayDays)}.`;
  let runwayLabel = `You have ${runwayDays} days left at your current spending pace.`;

  if (!monthTotals.income) {
    insightTitle = "Add income to unlock forecasting";
    insightText = "Runway needs at least one income entry to predict how long your money lasts.";
    actionTitle = "Add this month's main income";
    actionText = "This single step enables all decision-based guidance.";
    trend = "Decision engine needs your income baseline.";
    runwayLabel = "No runway yet. Add income first.";
  } else if (runwayDays <= 0) {
    insightTitle = "Critical zone";
    insightText = "Spending is currently moving faster than income this month.";
    actionTitle = "Emergency action: 72h essentials only";
    actionText = "Pause optional spends for 3 days to stabilize your runway.";
    trend = "At this rate, the reset needs to start today.";
    runwayLabel = "Your current pace needs a reset.";
  } else if (top) {
    insightTitle = `${top[0]} is draining runway`;
    insightText = `Reducing ${top[0]} by 15% can preserve around ${formatMoney(top[1] * 0.15)} this month.`;
    actionTitle = `Skip one ${top[0]} spend today`;
    actionText = `Skip one spend now or reduce ${formatMoney(reductionPerDay)}/day to gain about +${Math.max(lastSpendGain || 1, gainIfReduce)} days.`;
  }

  return {
    runwayDays,
    status,
    trend,
    runwayLabel,
    insightTitle,
    insightText,
    actionTitle,
    actionText
  };
}

function formatRunoutDate(runwayDays) {
  const date = new Date(today);
  date.setDate(today.getDate() + Math.max(0, Number(runwayDays) || 0));
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function animateNumber(element, nextValue) {
  const target = Number(nextValue) || 0;
  const start = Number(element.dataset.value || target);
  const startTime = performance.now();
  const duration = 320;

  function tick(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const eased = 1 - (1 - p) ** 3;
    const value = Math.round(start + (target - start) * eased);
    element.textContent = String(value);
    if (p < 1) requestAnimationFrame(tick);
    else element.dataset.value = String(target);
  }

  requestAnimationFrame(tick);
}

function buildEmotionalFeedback(transaction, before, after) {
  const topCategory = Object.entries(byCategory()).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (transaction.type === "income") {
    return after.runwayDays > before.runwayDays
      ? `Nice move. Income added +${after.runwayDays - before.runwayDays} days of runway.`
      : "Income logged. Your runway model just got sharper.";
  }

  if (after.runwayDays < before.runwayDays) {
    if (topCategory) return `Runway tightened to ${after.runwayDays} days. ${topCategory} is the best place to adjust.`;
    return `Runway tightened to ${after.runwayDays} days. Trim one optional spend today.`;
  }

  if (after.runwayDays > before.runwayDays) {
    return `You are doing better than before. Runway improved to ${after.runwayDays} days.`;
  }

  return `Logged. Keep today's pace steady to protect your ${after.runwayDays}-day runway.`;
}

async function initCloudSync() {
  if (!cloud.configured || !window.supabase) {
    renderSyncStatus("Local mode", false);
    return;
  }

  cloud.client = window.supabase.createClient(syncConfig.url, syncConfig.anonKey);
  cloud.ready = true;
  const { data } = await cloud.client.auth.getSession();
  cloud.user = data.session?.user || null;

  cloud.client.auth.onAuthStateChange(async (_event, session) => {
    cloud.user = session?.user || null;
    if (cloud.user) await loadCloudState();
    renderSyncStatus();
  });

  if (cloud.user) await loadCloudState();
  renderSyncStatus();
}

function renderSyncStatus(message, signedIn = Boolean(cloud.user)) {
  if (!cloud.configured) {
    els.syncStatus.textContent = "Cloud not configured";
    els.signInButton.disabled = true;
    els.emailInput.disabled = true;
    return;
  }

  els.syncStatus.textContent = message || (signedIn ? `Synced as ${cloud.user.email}` : "Ready to sync");
  els.signInButton.classList.toggle("is-hidden", signedIn);
  els.signOutButton.classList.toggle("is-hidden", !signedIn);
  els.emailInput.classList.toggle("is-hidden", signedIn);
}

async function handleSignIn() {
  if (!cloud.ready) {
    toast("Cloud sync is not configured yet.");
    return;
  }

  const email = els.emailInput.value.trim();
  if (!email) {
    toast("Enter an email address for sync.");
    return;
  }

  const { error } = await cloud.client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split("#")[0] }
  });

  if (error) {
    toast(error.message);
    return;
  }

  renderSyncStatus("Check your email for the sign-in link.", false);
  toast("Sign-in link sent.");
}

async function handleSignOut() {
  if (!cloud.ready) return;
  await cloud.client.auth.signOut();
  cloud.user = null;
  renderSyncStatus("Signed out", false);
  toast("Signed out.");
}

async function loadCloudState() {
  if (!cloud.user) return;
  renderSyncStatus("Loading cloud data...");
  const { data, error } = await cloud.client
    .from("ledgerlift_profiles")
    .select("data")
    .eq("user_id", cloud.user.id)
    .maybeSingle();

  if (error) {
    renderSyncStatus("Sync needs setup");
    toast(error.message);
    return;
  }

  if (data?.data) {
    isApplyingCloudState = true;
    state = normalizeState(data.data);
    localStorage.setItem(storageKey, JSON.stringify(state));
    els.profileName.value = state.settings.profileName;
    els.currency.value = state.settings.currency;
    isApplyingCloudState = false;
    render();
    renderSyncStatus("Cloud data loaded");
    return;
  }

  await saveCloudState();
  renderSyncStatus("Cloud sync enabled");
}

function queueCloudSave() {
  if (isApplyingCloudState || !cloud.user || !cloud.ready) return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(saveCloudState, 450);
}

async function saveCloudState() {
  if (!cloud.user || !cloud.ready) return;
  const { error } = await cloud.client.from("ledgerlift_profiles").upsert(
    {
      user_id: cloud.user.id,
      data: state,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    renderSyncStatus("Sync failed");
    toast(error.message);
    return;
  }

  renderSyncStatus("Synced");
}

function normalizeState(value) {
  return {
    settings: normalizeSettings(value.settings),
    transactions: Array.isArray(value.transactions) ? value.transactions : [],
    budgets: { ...defaultBudgets, ...value.budgets },
    goals: Array.isArray(value.goals) ? value.goals : []
  };
}

function normalizeSettings(settings = {}) {
  const merged = { ...blankState.settings, ...settings };
  merged.theme = settings?.theme === "dark" ? "dark" : "light";
  const dailyChallenge = settings?.dailyChallenge || {};
  merged.dailyChallenge = {
    date: typeof dailyChallenge.date === "string" ? dailyChallenge.date : "",
    done: Array.isArray(dailyChallenge.done) ? dailyChallenge.done.filter((item) => typeof item === "string") : []
  };
  const quickPrefs = settings?.quickPrefs || {};
  merged.quickPrefs = {
    lastExpenseCategory: quickPrefs.lastExpenseCategory && quickPrefs.lastExpenseCategory !== "Income" ? quickPrefs.lastExpenseCategory : "Food"
  };
  const fun = settings?.fun || {};
  merged.fun = {
    xp: Math.max(0, Number(fun.xp) || 0),
    level: Math.max(1, Number(fun.level) || 1)
  };
  const streak = settings?.streak || {};
  merged.streak = {
    current: Number(streak.current) || 0,
    best: Number(streak.best) || 0,
    lastEntryDate: typeof streak.lastEntryDate === "string" ? streak.lastEntryDate : ""
  };
  merged.onboardingDismissed = Boolean(settings?.onboardingDismissed);
  return merged;
}

function handleGlobalShortcuts(event) {
  const activeTag = document.activeElement?.tagName;
  const typing = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    setView("transactions");
    els.amount.focus();
    els.amount.select();
    return;
  }

  if (event.key === "/" && !typing) {
    event.preventDefault();
    setView("transactions");
    els.amount.focus();
  }
}

function handleCurrencyInput() {
  const code = els.currency.value.trim().toUpperCase();
  els.currency.value = code;
  if (code.length !== 3) return;

  if (!isValidCurrency(code)) {
    toast("Enter a valid 3-letter currency code.");
    return;
  }

  state.settings.currency = code;
  saveState();
  render();
  toast(`Currency updated to ${code}.`);
}

function isValidCurrency(code) {
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(1);
    return true;
  } catch {
    return false;
  }
}

function renderOverview() {
  const monthTotals = totals();
  const allTotals = totals(state.transactions);
  const balance = allTotals.income - allTotals.expense;
  const net = monthTotals.income - monthTotals.expense;
  const categoryTotals = byCategory();
  const sortedCategories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const savingsRate = monthTotals.income ? Math.max(0, Math.round((net / monthTotals.income) * 100)) : 0;
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const projectedExpense = monthTotals.expense ? (monthTotals.expense / today.getDate()) * daysInMonth : 0;
  const projected = monthTotals.income - projectedExpense;

  document.querySelector("#netBalance").textContent = formatMoney(balance);
  document.querySelector("#incomeTotal").textContent = formatMoney(monthTotals.income);
  document.querySelector("#expenseTotal").textContent = formatMoney(monthTotals.expense);
  document.querySelector("#projection").textContent = formatMoney(projected);
  document.querySelector("#cashflowSummary").textContent = state.transactions.length
    ? net >= 0
      ? `This month is ahead by ${formatMoney(net)}.`
      : `This month is behind by ${formatMoney(Math.abs(net))}.`
    : "Add income, expenses, budgets, and goals to build your live dashboard.";
  document.querySelector("#healthBadge").textContent = state.transactions.length
    ? savingsRate >= 25
      ? "Excellent"
      : savingsRate >= 10
        ? "Stable"
        : "Needs focus"
    : "Ready";
  document.querySelector("#topCategory").textContent = sortedCategories[0]?.[0] || "-";
  document.querySelector("#topCategoryAmount").textContent = sortedCategories[0] ? formatMoney(sortedCategories[0][1]) : "No spend yet";
  document.querySelector("#incomeDelta").textContent = `${state.transactions.filter((item) => item.type === "income").length} income entries`;
  document.querySelector("#expenseDelta").textContent = `${state.transactions.filter((item) => item.type === "expense").length} expense entries`;
  document.querySelector("#savingsMeter").style.width = `${Math.min(100, savingsRate)}%`;
  document.querySelector("#savingsCopy").textContent = `${savingsRate}% savings rate`;

  const insight = getInsight(monthTotals, sortedCategories, savingsRate);
  document.querySelector("#insightTitle").textContent = insight.title;
  document.querySelector("#insightText").textContent = insight.text;
}

function renderCoach() {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(1, daysInMonth - now.getDate());
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const categoryTotals = byCategory(monthItems.filter((item) => item.type === "expense"));
  const sorted = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const monthlyBudget = Object.values(state.budgets || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const budgetLeft = Math.max(0, monthlyBudget - monthTotals.expense);
  const dailySafe = budgetLeft / daysLeft;

  const topCategory = sorted[0] || null;
  const secondCategory = sorted[1] || null;
  const potentialMonthlySave = Math.round(((topCategory?.[1] || 0) * 0.12 + (secondCategory?.[1] || 0) * 0.08) / 1) || 0;
  const currentNet = monthTotals.income - monthTotals.expense;
  const projectedNetWithCuts = currentNet + potentialMonthlySave;

  document.querySelector("#dailySafeSpend").textContent = formatMoney(dailySafe);
  document.querySelector("#dailySafeSpendHint").textContent = monthlyBudget
    ? `${daysLeft} days left from your current budget limits.`
    : "Set category budgets to get a sharper daily number.";
  document.querySelector("#potentialSavings").textContent = formatMoney(potentialMonthlySave);
  document.querySelector("#potentialSavingsHint").textContent = potentialMonthlySave
    ? `You could finish around ${formatMoney(projectedNetWithCuts)} with small habit cuts.`
    : "Add more entries this month for actionable savings estimates.";
  document.querySelector("#cutCategory").textContent = topCategory ? topCategory[0] : "-";
  document.querySelector("#cutCategoryHint").textContent = topCategory
    ? `${topCategory[0]} is ${Math.round((topCategory[1] / Math.max(1, monthTotals.expense)) * 100)}% of spending.`
    : "Track more expenses to reveal this.";

  const actions = getCoachActions({
    daysLeft,
    monthTotals,
    sorted,
    dailySafe,
    potentialMonthlySave,
    monthlyBudget
  });

  document.querySelector("#coachActions").innerHTML = actions
    .map(
      (item) => `
        <article class="action-chip">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `
    )
    .join("");
}

function getCoachActions({ daysLeft, monthTotals, sorted, dailySafe, potentialMonthlySave, monthlyBudget }) {
  if (!state.transactions.length) {
    return [
      { title: "Start with 3 entries", text: "Log at least 3 real expenses today so LedgerLift can generate precise cut-back advice." },
      { title: "Set first budget", text: "Even one budget (Food or Shopping) unlocks realistic daily safe-spend guidance." }
    ];
  }

  const actions = [];
  const topCategory = sorted[0];

  if (topCategory) {
    const cutTarget = Math.round(topCategory[1] * 0.15);
    actions.push({
      title: `Cut ${topCategory[0]} by 15%`,
      text: `Reduce ${topCategory[0]} by about ${formatMoney(cutTarget)} this month to preserve more cash.`
    });
  }

  if (monthlyBudget > 0) {
    actions.push({
      title: "Use a daily spend cap",
      text: `Try staying under ${formatMoney(dailySafe)} per day for the remaining ${daysLeft} days.`
    });
  }

  if (monthTotals.income > 0) {
    const saveAmount = Math.max(0, Math.round(monthTotals.income * 0.1));
    actions.push({
      title: "Auto-save 10% first",
      text: `Move ${formatMoney(saveAmount)} into savings as soon as income arrives, then spend the rest.`
    });
  }

  if (potentialMonthlySave > 0) {
    const dailyCut = Math.max(1, Math.round(potentialMonthlySave / Math.max(1, daysLeft)));
    actions.push({
      title: "Micro-cut plan",
      text: `Cut just ${formatMoney(dailyCut)} per day to protect about ${formatMoney(potentialMonthlySave)} this month.`
    });
  }

  if (monthTotals.expense > monthTotals.income && monthTotals.income > 0) {
    actions.unshift({
      title: "Emergency correction",
      text: "Expenses are above income this month. Pause non-essentials for 72 hours and log only needs."
    });
  }

  return actions.slice(0, 4);
}

function renderDailyChallenge() {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (state.settings.dailyChallenge.date !== todayKey) {
    state.settings.dailyChallenge = { date: todayKey, done: [] };
    saveState();
  }

  const tasks = getTodayChallengeTasks();
  const done = new Set(state.settings.dailyChallenge.done);
  const doneCount = tasks.filter((task) => done.has(task.id)).length;

  document.querySelector("#challengeProgress").textContent = `${doneCount}/${tasks.length} done`;
  document.querySelector("#challengeList").innerHTML = tasks
    .map(
      (task) => `
        <button type="button" class="challenge-item ${done.has(task.id) ? "is-done" : ""}" onclick="toggleChallengeTask('${task.id}')">
          <span>${done.has(task.id) ? "Done" : "Open"}</span>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${escapeHtml(task.hint)}</small>
        </button>
      `
    )
    .join("");
}

function getTodayChallengeTasks() {
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const topCategory = Object.entries(byCategory(monthItems.filter((item) => item.type === "expense"))).sort((a, b) => b[1] - a[1])[0];
  const topLabel = topCategory ? topCategory[0] : "top category";
  return [
    { id: "log_all", title: "Log every spend today", hint: "No blind spots means better savings decisions." },
    { id: "no_spend_window", title: "4-hour no-spend window", hint: "Build one strong no-spend block before night." },
    {
      id: "category_cut",
      title: `Cut one ${topLabel} expense`,
      hint: monthTotals.expense ? "Skip or downgrade one optional purchase today." : "Start tracking to personalize this target."
    }
  ];
}

function toggleChallengeTask(id) {
  const done = new Set(state.settings.dailyChallenge.done);
  if (done.has(id)) done.delete(id);
  else done.add(id);
  state.settings.dailyChallenge.done = [...done];
  saveState();
  renderDailyChallenge();
  renderAdvantage();
  renderMissionBoard();
  toast(done.has(id) ? "Challenge progress saved. Your mission meter moved." : "Challenge reopened.");
}

function renderAdvantage() {
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const streak = state.settings.streak?.current || 0;
  const income = monthTotals.income;
  const savingsRate = income ? Math.max(0, Math.round(((income - monthTotals.expense) / income) * 100)) : 0;
  const budgetTotal = Object.values(state.budgets || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  const budgetDiscipline = budgetTotal ? Math.max(0, 100 - Math.round((monthTotals.expense / budgetTotal) * 100)) : 0;
  const challengeDone = state.settings.dailyChallenge.done.length;
  const hasActivity = state.transactions.length > 0;

  const shield = hasActivity ? clamp(Math.round(savingsRate * 0.45 + streak * 4 + budgetDiscipline * 0.35 + challengeDone * 6), 0, 100) : 0;
  document.querySelector("#shieldScore").textContent = `${shield}/100`;
  document.querySelector("#shieldHint").textContent = hasActivity
    ? shield >= 75
      ? "Strong financial protection trend."
      : shield >= 50
        ? "Good progress. One more habit change will boost this."
        : "Early stage. Complete challenge + cut one category to raise score."
    : "Starts at 0. Add your first entries to build your shield.";

  const nextMove = getNextBestMove({ income, monthTotals, budgetTotal, streak, shield });
  document.querySelector("#nextBestMove").textContent = nextMove.title;
  document.querySelector("#nextBestMoveHint").textContent = nextMove.hint;
}

function getNextBestMove({ income, monthTotals, budgetTotal, streak, shield }) {
  if (!income) {
    return { title: "Add income entry", hint: "One income entry unlocks meaningful savings and pacing guidance." };
  }
  if (monthTotals.expense > income) {
    return { title: "Pause non-essentials 72h", hint: "Fastest move to bring this month back into control." };
  }
  if (budgetTotal === 0) {
    return { title: "Set 2 budgets", hint: "Start with Food and Shopping for immediate overspending alerts." };
  }
  if (streak < 3) {
    return { title: "Reach 3-day streak", hint: "Consistent logging improves your recommendations dramatically." };
  }
  if (shield < 70) {
    return { title: "Cut top category by 10%", hint: "Small trim here creates the biggest savings lift." };
  }
  return { title: "Auto-save tonight", hint: "Move today's leftover into goals before day ends." };
}

function renderIntelligenceCenter() {
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const last7 = transactionsBetween(0, 6);
  const previous7 = transactionsBetween(7, 13);
  const last7Spend = totals(last7).expense;
  const previous7Spend = totals(previous7).expense;
  const recurring = detectRecurringPatterns();
  const categoryTrends = buildCategoryTrends();
  const alert = buildSmartAlert(monthItems, categoryTrends);
  const now = new Date();
  const dayOfMonth = Math.max(1, now.getDate());
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedExpense = monthTotals.expense ? (monthTotals.expense / dayOfMonth) * daysInMonth : 0;
  const projectedNet = monthTotals.income - projectedExpense;

  document.querySelector("#monthlySummaryTitle").textContent = monthItems.length
    ? `${formatMoney(monthTotals.income - monthTotals.expense)} current month net`
    : "Waiting for activity";
  document.querySelector("#monthlySummaryText").textContent = monthItems.length
    ? `Projected month-end position: ${formatMoney(projectedNet)} after ${formatMoney(projectedExpense)} expected spending.`
    : "Add income and expenses to generate a monthly story.";

  const weeklyDelta = previous7Spend ? Math.round(((last7Spend - previous7Spend) / previous7Spend) * 100) : 0;
  document.querySelector("#spendingPrediction").textContent = previous7Spend
    ? weeklyDelta <= 0
      ? `Spending down ${Math.abs(weeklyDelta)}%`
      : `Spending up ${weeklyDelta}%`
    : "Building weekly baseline";
  document.querySelector("#spendingPredictionText").textContent = previous7Spend
    ? `Last 7 days: ${formatMoney(last7Spend)} vs previous 7 days: ${formatMoney(previous7Spend)}.`
    : "Log one more week of spending for sharper predictive comparisons.";

  document.querySelector("#smartAlertTitle").textContent = alert.title;
  document.querySelector("#smartAlertText").textContent = alert.text;
  document.querySelector("#recurringCount").textContent = `${recurring.length} found`;
  document.querySelector("#recurringList").innerHTML = recurring.length
    ? recurring
        .map(
          (item) => `
            <div class="intel-row">
              <strong>${escapeHtml(item.name)}</strong>
              <span>${formatMoney(item.average)} avg - every ~${item.cadence} days</span>
            </div>
          `
        )
        .join("")
    : `<div class="intel-row muted-row"><strong>No recurring bills yet</strong><span>Repeated descriptions or categories will appear here.</span></div>`;

  document.querySelector("#categoryTrendSummary").textContent = categoryTrends[0]?.summary || "No trends yet";
  document.querySelector("#categoryTrendList").innerHTML = categoryTrends.length
    ? categoryTrends
        .slice(0, 5)
        .map(
          (item) => `
            <div class="intel-row">
              <strong>${escapeHtml(item.category)}</strong>
              <span>${item.direction} ${Math.abs(item.change)}% - ${formatMoney(item.current)} this week</span>
            </div>
          `
        )
        .join("")
    : `<div class="intel-row muted-row"><strong>Track a few expenses</strong><span>Weekly category movement will show here.</span></div>`;
}

function transactionsBetween(startDaysAgo, endDaysAgo) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(today.getDate() - endDaysAgo);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);
  end.setDate(today.getDate() - startDaysAgo);
  return state.transactions.filter((item) => {
    const date = new Date(item.date);
    return date >= start && date <= end;
  });
}

function detectRecurringPatterns() {
  const groups = new Map();
  state.transactions
    .filter((item) => item.type === "expense")
    .forEach((item) => {
      const key = `${item.description.toLowerCase().replace(/\d+/g, "").trim()}-${item.category}`;
      const group = groups.get(key) || { name: item.description || item.category, category: item.category, amounts: [], dates: [] };
      group.amounts.push(Number(item.amount));
      group.dates.push(new Date(item.date));
      groups.set(key, group);
    });

  return [...groups.values()]
    .filter((group) => group.amounts.length >= 2)
    .map((group) => {
      const sorted = group.dates.sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((date, index) => Math.max(1, Math.round((date - sorted[index]) / 86400000)));
      return {
        name: group.name,
        average: group.amounts.reduce((sum, value) => sum + value, 0) / group.amounts.length,
        cadence: Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) || 30
      };
    })
    .sort((a, b) => b.average - a.average)
    .slice(0, 5);
}

function buildCategoryTrends() {
  const current = byCategory(transactionsBetween(0, 6).filter((item) => item.type === "expense"));
  const previous = byCategory(transactionsBetween(7, 13).filter((item) => item.type === "expense"));
  const all = [...new Set([...Object.keys(current), ...Object.keys(previous)])];
  return all
    .map((category) => {
      const currentValue = current[category] || 0;
      const previousValue = previous[category] || 0;
      const change = previousValue ? Math.round(((currentValue - previousValue) / previousValue) * 100) : currentValue ? 100 : 0;
      return {
        category,
        current: currentValue,
        previous: previousValue,
        change,
        direction: change >= 0 ? "up" : "down",
        summary: `${category} ${change >= 0 ? "up" : "down"} ${Math.abs(change)}%`
      };
    })
    .filter((item) => item.current || item.previous)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

function buildSmartAlert(monthItems, categoryTrends) {
  const expenses = monthItems.filter((item) => item.type === "expense");
  if (!expenses.length) {
    return { title: "All clear", text: "No spending alerts yet. Add expenses to activate anomaly detection." };
  }

  const average = expenses.reduce((sum, item) => sum + Number(item.amount), 0) / expenses.length;
  const largest = [...expenses].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
  if (largest && Number(largest.amount) > average * 2.2 && expenses.length >= 4) {
    return {
      title: "Unusual spend detected",
      text: `${largest.description} is ${Math.round(Number(largest.amount) / average)}x your typical expense this month.`
    };
  }

  const rising = categoryTrends.find((item) => item.change >= 50 && item.current > 0);
  if (rising) {
    return { title: `${rising.category} is rising`, text: `${rising.category} spending increased ${rising.change}% compared with last week.` };
  }

  return { title: "All clear", text: "No unusual spending patterns detected right now." };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderStreak() {
  const streak = state.settings.streak || { current: 0, best: 0 };
  const currentLabel = "day streak";
  document.querySelector("#streakCount").textContent = `${streak.current} ${currentLabel}`;
  document.querySelector("#streakHint").textContent =
    streak.current > 0 ? `Best streak: ${streak.best} days. Keep your chain alive today.` : "Add one transaction daily to keep momentum.";
}

function renderFun() {
  const fun = state.settings.fun || { xp: 0, level: 1 };
  const nextLevelXp = fun.level * 100;
  const currentLevelXp = (fun.level - 1) * 100;
  const progress = Math.min(100, Math.round(((fun.xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100));
  const xpLeft = Math.max(0, nextLevelXp - fun.xp);
  document.querySelector("#xpLevel").textContent = `Level ${fun.level} - ${fun.xp} XP`;
  document.querySelector("#xpMeter").style.width = `${progress}%`;
  document.querySelector("#xpHint").textContent = xpLeft ? `${xpLeft} XP to next level.` : "Level up!";
}

function renderMissionBoard() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayItems = state.transactions.filter((item) => item.date === todayKey);
  const hasIncome = todayItems.some((item) => item.type === "income");
  const hasExpense = todayItems.some((item) => item.type === "expense");
  const challengeDone = state.settings.dailyChallenge.done.length;
  const tasks = [
    { id: "income", done: hasIncome },
    { id: "expense", done: hasExpense },
    { id: "challenge", done: challengeDone > 0 },
    { id: "runway", done: state.transactions.length >= 3 }
  ];
  const doneCount = tasks.filter((task) => task.done).length;
  const percent = Math.round((doneCount / tasks.length) * 100);
  const missionTitle = document.querySelector("#missionTitle");
  const missionText = document.querySelector("#missionText");
  const missionPercent = document.querySelector("#missionPercent");
  const board = document.querySelector(".mission-board");

  missionPercent.textContent = `${percent}%`;
  board.style.setProperty("--mission", `${percent}%`);

  if (percent === 100) {
    missionTitle.textContent = "Survival scan complete";
    missionText.textContent = "You gave your money a full check-in today. Come back tomorrow to keep the loop alive.";
  } else if (!hasIncome) {
    missionTitle.textContent = "Add your survival baseline";
    missionText.textContent = "One income entry unlocks the money survival forecast.";
  } else if (!hasExpense) {
    missionTitle.textContent = "Log one real expense";
    missionText.textContent = "One honest expense makes your runway real.";
  } else {
    missionTitle.textContent = "Finish today's challenge";
    missionText.textContent = "Complete one challenge tile to raise your Savings Shield.";
  }

  document.querySelector("#badgeStrip").innerHTML = getBadges()
    .map(
      (badge) => `
        <span class="badge ${badge.unlocked ? "is-unlocked" : ""}" title="${escapeHtml(badge.hint)}">
          ${escapeHtml(badge.label)}
        </span>
      `
    )
    .join("");
}

function getBadges() {
  const monthTotals = totals();
  const expenseCount = state.transactions.filter((item) => item.type === "expense").length;
  const incomeCount = state.transactions.filter((item) => item.type === "income").length;
  const budgetCount = Object.values(state.budgets || {}).filter((value) => Number(value) > 0).length;
  const goalProgress = state.goals.some((goal) => Number(goal.saved) > 0);
  const streak = state.settings.streak?.current || 0;
  const savingsRate = monthTotals.income ? ((monthTotals.income - monthTotals.expense) / monthTotals.income) * 100 : 0;

  return [
    { label: "First Log", unlocked: state.transactions.length > 0, hint: "Add your first transaction." },
    { label: "Income Set", unlocked: incomeCount > 0, hint: "Add at least one income entry." },
    { label: "Expense Radar", unlocked: expenseCount >= 5, hint: "Log five expenses." },
    { label: "Budget Builder", unlocked: budgetCount >= 2, hint: "Set two category budgets." },
    { label: "Goal Starter", unlocked: goalProgress, hint: "Add progress to any goal." },
    { label: "3-Day Chain", unlocked: streak >= 3, hint: "Log transactions three days in a row." },
    { label: "Saver Mode", unlocked: savingsRate >= 20, hint: "Reach a 20% savings rate this month." }
  ];
}

function renderQuickInsight(latestTransaction) {
  const titleEl = document.querySelector("#quickInsightTitle");
  const textEl = document.querySelector("#quickInsightText");
  if (!titleEl || !textEl) return;

  if (!latestTransaction) {
    titleEl.textContent = "You are ready";
    textEl.textContent = "Your instant spending insight appears here after each entry.";
    return;
  }

  const now = new Date();
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const monthItems = currentMonthTransactions();
  const monthTotals = totals(monthItems);
  const categorySpent = byCategory(monthItems.filter((item) => item.type === "expense"));
  const budget = state.budgets[latestTransaction.category] || 0;
  const spent = categorySpent[latestTransaction.category] || 0;

  if (latestTransaction.type === "expense" && budget > 0) {
    const usage = Math.round((spent / budget) * 100);
    if (usage >= 100) {
      titleEl.textContent = "Budget crossed";
      textEl.textContent = `${latestTransaction.category} is over budget with ${daysLeft} days left. Pause this category for today.`;
      return;
    }
    if (usage >= 80) {
      titleEl.textContent = "Approaching limit";
      textEl.textContent = `${latestTransaction.category} is at ${usage}% budget usage. Keep new spends below ${formatMoney(Math.max(0, budget - spent))}.`;
      return;
    }
  }

  const net = monthTotals.income - monthTotals.expense;
  if (net < 0) {
    titleEl.textContent = "Slow down spending";
    textEl.textContent = `You are currently ${formatMoney(Math.abs(net))} behind this month with ${daysLeft} days left. Log only essentials for 48 hours.`;
    return;
  }

  titleEl.textContent = "Good pace";
  textEl.textContent = `${daysLeft} days left this month. You are ahead by ${formatMoney(net)} - keep this rhythm.`;
}

function updateStreak(entryDate) {
  const streak = state.settings.streak || { current: 0, best: 0, lastEntryDate: "" };
  const last = streak.lastEntryDate;
  const current = toDateString(entryDate);
  if (!current) return;

  if (last === current) return;

  if (!last) {
    streak.current = 1;
  } else {
    const diff = dateDiffDays(last, current);
    if (diff === 1) streak.current += 1;
    else if (diff > 1) streak.current = 1;
  }

  streak.lastEntryDate = current;
  streak.best = Math.max(streak.best, streak.current);
  state.settings.streak = streak;
}

function addFunXp(transaction) {
  const fun = state.settings.fun || { xp: 0, level: 1 };
  const previousLevel = fun.level;
  const base = transaction.type === "income" ? 8 : 10;
  const streakBonus = Math.min(12, (state.settings.streak?.current || 0) * 2);
  const quickBonus = transaction.description.length <= 24 ? 4 : 0;
  const earned = base + streakBonus + quickBonus;
  fun.xp += earned;
  fun.level = Math.max(1, Math.floor(fun.xp / 100) + 1);
  state.settings.fun = fun;
  return { earned, level: fun.level, leveledUp: fun.level > previousLevel };
}

function renderCheer(transaction) {
  const cheers = [
    "Great capture. That is one less thing to remember.",
    "Nice! Tiny logs build strong money habits.",
    "Fast entry, smart future.",
    "Momentum unlocked. Keep the streak alive."
  ];
  const cheer = cheers[Math.floor(Math.random() * cheers.length)];
  const cheerEl = document.querySelector("#quickCheer");
  if (cheerEl) {
    cheerEl.textContent = cheer;
    cheerEl.classList.remove("pop");
    void cheerEl.offsetWidth;
    cheerEl.classList.add("pop");
  }

  const insightEl = document.querySelector("#quickInsight");
  if (transaction?.type === "income" && insightEl) {
    insightEl.classList.remove("pop");
    void insightEl.offsetWidth;
    insightEl.classList.add("pop");
  }
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
  applyTheme();
  saveState();
  toast(state.settings.theme === "dark" ? "Dark mode on." : "Light mode on.");
}

function applyTheme() {
  const isDark = state.settings.theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  if (els.themeToggle && els.themeToggleLabel) {
    els.themeToggleLabel.textContent = isDark ? "Light" : "Dark";
    els.themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  }
}

function toDateString(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86400000);
}

function getInsight(monthTotals, sortedCategories, savingsRate) {
  if (!state.transactions.length) {
    return { title: "Start fresh", text: "LedgerLift starts empty so every number here comes only from the user." };
  }
  if (!monthTotals.income) {
    return { title: "Add income", text: "Track income first so LedgerLift can calculate savings rate and month-end projection." };
  }
  if (savingsRate >= 30) {
    return { title: "Strong savings", text: "The current savings rate is strong. Extra cash can be assigned to goals or long-term plans." };
  }
  if (sortedCategories[0]) {
    return { title: `${sortedCategories[0][0]} is leading`, text: `${sortedCategories[0][0]} is the largest spend category this month at ${formatMoney(sortedCategories[0][1])}.` };
  }
  return { title: "Clean month", text: "No expenses this month yet. Set budgets before spending starts." };
}

function renderTransactions() {
  const query = els.searchInput.value.toLowerCase();
  const type = els.filterType.value;
  const items = state.transactions
    .filter((item) => type === "all" || item.type === type)
    .filter((item) => `${item.description} ${item.category}`.toLowerCase().includes(query))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!items.length) {
    els.table.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          <strong>No transactions yet</strong>
          <span>Add one entry to wake up runway, trends, alerts, and your daily mission.</span>
        </td>
      </tr>
    `;
    return;
  }

  els.table.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.description)}</strong></td>
          <td><span class="chip">${escapeHtml(item.category)}</span></td>
          <td>${new Date(item.date).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</td>
          <td class="amount ${item.type}">${item.type === "income" ? "+" : "-"}${formatMoney(item.amount)}</td>
          <td>
            <div class="row-actions">
              <button type="button" title="Edit transaction" onclick="editTransaction('${item.id}')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17.2V20h2.8L18.6 9.2l-2.8-2.8L5 17.2ZM20.7 7.1c.4-.4.4-1 0-1.4l-2.4-2.4a1 1 0 0 0-1.4 0L15.2 5l3.8 3.8 1.7-1.7Z"/></svg>
              </button>
              <button type="button" title="Delete transaction" onclick="deleteTransaction('${item.id}')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12ZM8 4l1-1h6l1 1h4v2H4V4h4Z"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");
}

function editTransaction(id) {
  const item = state.transactions.find((transaction) => transaction.id === id);
  if (!item) return;
  els.editingId.value = item.id;
  els.description.value = item.description;
  els.amount.value = item.amount;
  els.type.value = item.type;
  els.category.value = item.category;
  els.date.value = item.date;
  els.description.focus();
}

function deleteTransaction(id) {
  state.transactions = state.transactions.filter((item) => item.id !== id);
  saveState();
  render();
  toast("Transaction deleted.");
}

function renderBudgets() {
  const categoryTotals = byCategory();
  els.budgetGrid.innerHTML = spendCategories
    .map((category) => {
      const spent = categoryTotals[category] || 0;
      const budget = state.budgets[category] || 0;
      const percent = budget ? Math.round((spent / budget) * 100) : 0;
      const status = percent > 95 ? "danger" : percent > 75 ? "warn" : "";
      return `
        <article class="budget-card">
          <div class="budget-top">
            <strong>${category}</strong>
            <input type="number" min="0" value="${budget}" aria-label="${category} budget" onchange="updateBudget('${category}', this.value)" />
          </div>
          <div class="progress"><span class="${status}" style="width:${Math.min(100, percent)}%"></span></div>
          <small>${formatMoney(spent)} spent of ${formatMoney(budget)} (${percent}%)</small>
        </article>
      `;
    })
    .join("");
}

function updateBudget(category, value) {
  state.budgets[category] = Number(value);
  saveState();
  render();
  toast(`${category} budget updated.`);
}

function renderGoals() {
  if (!state.goals.length) {
    els.goalsGrid.innerHTML = `<article class="goal-card empty-state"><strong>No goals yet</strong><span>Add a target above and LedgerLift will turn it into visible progress.</span></article>`;
    return;
  }

  els.goalsGrid.innerHTML = state.goals
    .map((goal) => {
      const percent = goal.target ? Math.round((goal.saved / goal.target) * 100) : 0;
      return `
        <article class="goal-card">
          <div class="goal-top">
            <strong>${escapeHtml(goal.name)}</strong>
            <span class="chip">${percent}%</span>
          </div>
          <div class="progress"><span style="width:${Math.min(100, percent)}%"></span></div>
          <small>${formatMoney(goal.saved)} saved of ${formatMoney(goal.target)}</small>
          <input type="range" min="0" max="${goal.target}" value="${goal.saved}" oninput="updateGoal('${goal.id}', this.value)" aria-label="${escapeHtml(goal.name)} saved amount" />
        </article>
      `;
    })
    .join("");
}

function updateGoal(id, value) {
  state.goals = state.goals.map((goal) => (goal.id === id ? { ...goal, saved: Number(value) } : goal));
  saveState();
  renderGoals();
}

function drawCashflow() {
  const canvas = document.querySelector("#cashflowCanvas");
  const ctx = canvas.getContext("2d");
  const data = weeklyData();
  clearCanvas(ctx, canvas);
  const pad = 42;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const max = Math.max(1, ...data.flatMap((item) => [item.income, item.expense]));

  ctx.strokeStyle = "#dfe8e4";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (h / 4) * i;
    line(ctx, pad, y, canvas.width - pad, y);
  }

  if (currentChart === "line") {
    drawLine(ctx, data.map((item) => item.income), max, pad, w, h, "#0b7a53");
    drawLine(ctx, data.map((item) => item.expense), max, pad, w, h, "#ff6b5f");
  } else {
    const groupWidth = w / data.length;
    data.forEach((item, index) => {
      const x = pad + index * groupWidth + groupWidth * 0.2;
      const incomeHeight = (item.income / max) * h;
      const expenseHeight = (item.expense / max) * h;
      roundedBar(ctx, x, pad + h - incomeHeight, groupWidth * 0.22, incomeHeight, "#0b7a53");
      roundedBar(ctx, x + groupWidth * 0.3, pad + h - expenseHeight, groupWidth * 0.22, expenseHeight, "#ff6b5f");
    });
  }

  ctx.fillStyle = "#66736f";
  ctx.font = "14px Inter, sans-serif";
  data.forEach((item, index) => {
    const x = pad + index * (w / data.length) + 6;
    ctx.fillText(item.label, x, canvas.height - 12);
  });
}

function drawCategories() {
  const canvas = document.querySelector("#categoryCanvas");
  const ctx = canvas.getContext("2d");
  const data = Object.entries(byCategory()).sort((a, b) => b[1] - a[1]);
  const total = data.reduce((sum, item) => sum + item[1], 0);
  clearCanvas(ctx, canvas);

  if (!total) {
    ctx.fillStyle = "#66736f";
    ctx.font = "18px Inter, sans-serif";
    ctx.fillText("No expenses yet", 112, 180);
    document.querySelector("#categoryLegend").innerHTML = `<div class="legend-item"><span></span><span>Add expenses to see category totals.</span><strong></strong></div>`;
    return;
  }

  let start = -Math.PI / 2;
  data.forEach(([category, amount], index) => {
    const slice = (amount / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(180, 180);
    ctx.arc(180, 180, 142, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    start += slice;
  });
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(180, 180, 82, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#17211f";
  ctx.font = "700 22px Inter, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(formatMoney(total), 180, 174);
  ctx.font = "14px Inter, sans-serif";
  ctx.fillStyle = "#66736f";
  ctx.fillText("spent", 180, 200);
  ctx.textAlign = "left";

  document.querySelector("#categoryLegend").innerHTML = data
    .map(
      ([category, amount], index) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${colors[index % colors.length]}"></span>
          <span>${category}</span>
          <strong>${formatMoney(amount)}</strong>
        </div>
      `
    )
    .join("");
}

function drawMini() {
  const canvas = document.querySelector("#miniCanvas");
  const ctx = canvas.getContext("2d");
  const data = weeklyData().map((item) => item.income - item.expense);
  clearCanvas(ctx, canvas);
  drawLine(ctx, data, Math.max(1, ...data.map(Math.abs)), 16, canvas.width - 32, canvas.height - 32, "#f8d36d", true);
}

function weeklyData() {
  const weeks = Array.from({ length: 8 }, (_, index) => {
    const start = new Date(today);
    start.setDate(today.getDate() - (7 - index) * 7);
    return { label: `W${index + 1}`, income: 0, expense: 0, start };
  });

  state.transactions.forEach((item) => {
    const date = new Date(item.date);
    const week = weeks.findLast((entry) => date >= entry.start);
    if (week) week[item.type] += Number(item.amount);
  });
  return weeks;
}

function drawLine(ctx, values, max, pad, w, h, color, fill = false) {
  const step = w / Math.max(1, values.length - 1);
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = pad + index * step;
    const y = pad + h - ((value + (fill ? max : 0)) / (fill ? max * 2 : max)) * h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
}

function roundedBar(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  const radius = Math.min(8, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, Math.max(0, height), radius);
  ctx.fill();
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function exportCsv() {
  const header = "Description,Amount,Type,Category,Date,Currency";
  const rows = state.transactions.map((item) =>
    [item.description, item.amount, item.type, item.category, item.date, state.settings.currency].map(csvEscape).join(",")
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ledgerlift-transactions.csv";
  link.click();
  URL.revokeObjectURL(url);
  toast("CSV exported.");
}

function exportBackup() {
  const backup = {
    app: "LedgerLift",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `ledgerlift-backup-${date}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast("Backup downloaded.");
}

function importBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const importedState = parsed.data ? parsed.data : parsed;
      const nextState = normalizeState(importedState);
      const shouldReplace = window.confirm("Restore this backup? This will replace the current LedgerLift data in this browser.");
      if (!shouldReplace) return;

      state = nextState;
      els.profileName.value = state.settings.profileName;
      els.currency.value = state.settings.currency;
      saveState();
      render();
      toast("Backup restored.");
    } catch {
      toast("That backup file could not be read.");
    }
  });
  reader.readAsText(file);
}

function csvEscape(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
}

window.editTransaction = editTransaction;
window.deleteTransaction = deleteTransaction;
window.updateBudget = updateBudget;
window.updateGoal = updateGoal;
window.toggleChallengeTask = toggleChallengeTask;

init();
