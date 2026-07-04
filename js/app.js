const THEME_KEY = "saeedStoreTheme";
const API_URLS = ["api.php"];
const JSON_STORE_URL = "data/store.json";
const DEFAULT_IMAGE = "assets/hero-store.svg";

const clone = (value) => JSON.parse(JSON.stringify(value));
const money = (value) => `${Number(value || 0).toLocaleString("ar-EG")} جنيه`;
const byOrder = (a, b) => Number(a.order || 999) - Number(b.order || 999);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isDirectImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.hostname === "res.cloudinary.com" && parsed.pathname.includes("/upload/")) return true;
    return /\.(svg|png|jpe?g|webp|gif)(\?.*)?$/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

function imageUrl(value, width = 640) {
  const url = String(value || "").trim();
  if (!url || url.length > 500) return DEFAULT_IMAGE;
  if (url.startsWith("assets/")) {
    return /^assets\/[A-Za-z0-9._/-]+\.(svg|png|jpe?g|webp|gif)$/i.test(url) ? url : DEFAULT_IMAGE;
  }
  if (!isDirectImageUrl(url)) {
    return DEFAULT_IMAGE;
  }
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    if (/\/upload\/(?:[^/]+\/)*(?=v\d+\/)/.test(url)) {
      return url.replace(/\/upload\/(?:[^/]+\/)*(?=v\d+\/)/, `/upload/f_auto,q_auto,c_limit,w_${width}/`);
    }
    return url.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
  }
  return url;
}

const EMPTY_STORE = {
  settings: {},
  banner: {},
  contact: {},
  categories: [],
  products: [],
  visits: 0,
  changes: []
};

async function apiRequest(action, options = {}) {
  let lastError = null;
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };

  for (const apiUrl of API_URLS) {
    try {
      const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
        ...options,
        credentials: "same-origin",
        headers
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "Request failed");
      return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Request failed");
}

async function loadStore() {
  try {
    const payload = await apiRequest("store");
    return { ...clone(EMPTY_STORE), ...(payload.data || {}) };
  } catch (error) {
    const response = await fetch(`${JSON_STORE_URL}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw error;
    const data = await response.json();
    return { ...clone(EMPTY_STORE), ...(data || {}) };
  }
}

let store = clone(EMPTY_STORE);

const state = {
  query: "",
  category: "",
  brand: "",
  color: "",
  rating: "",
  stock: "",
  maxPrice: 3000
};

let revealObserver = null;

function setupRevealAnimations() {
  const targets = document.querySelectorAll(".section, .search-band, .category-card, .product-card, .contact-item, .filters-panel");

  if (!("IntersectionObserver" in window)) {
    targets.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -40px 0px" });
  }

  targets.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.transitionDelay = `${Math.min(index % 8, 7) * 45}ms`;
    if (!element.classList.contains("is-visible")) revealObserver.observe(element);
  });
}

function applyThemeAndSettings() {
  const s = store.settings;
  document.documentElement.style.setProperty("--primary", s.primaryColor || "#2563EB");
  document.documentElement.style.setProperty("--secondary", s.secondaryColor || "#10B981");
  document.documentElement.style.setProperty("--button", s.buttonColor || "#F97316");
  document.documentElement.style.setProperty("--bg", s.backgroundColor || "#F8FAFC");
  document.documentElement.style.setProperty("--text", s.textColor || "#1F2937");
  document.documentElement.style.setProperty("--font", s.fontFamily || "Tahoma, Arial, sans-serif");
  document.querySelectorAll("[data-site-name], [data-footer-name]").forEach((el) => { el.textContent = s.siteName; });
  document.querySelector("[data-about-text]").textContent = s.about;
  const theme = localStorage.getItem(THEME_KEY);
  document.body.classList.toggle("dark", theme === "dark");
  document.querySelector("[data-theme-toggle]").textContent = theme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
}

function renderHero() {
  const hero = document.querySelector("[data-hero]");
  hero.style.display = store.banner.visible ? "grid" : "none";
  document.querySelector("[data-hero-title]").textContent = store.banner.title;
  document.querySelector("[data-hero-subtitle]").textContent = store.banner.subtitle;
  document.querySelector("[data-hero-button]").textContent = store.banner.buttonText;
  document.querySelector("[data-hero-image]").src = imageUrl(store.banner.image, 1200);
}

function visibleProducts() {
  return store.products.filter((product) => product.visible !== false).sort(byOrder);
}

function discount(product) {
  if (!product.oldPrice || product.oldPrice <= product.price) return 0;
  return Math.round(((product.oldPrice - product.price) / product.oldPrice) * 100);
}

function galleryImages(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  const text = String(value || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function renderCategories() {
  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = store.categories.sort(byOrder).map((category) => `
    <article class="category-card" data-category="${escapeHtml(category.id)}">
      <img loading="lazy" decoding="async" src="${imageUrl(category.image, 420)}" alt="${escapeHtml(category.name)}">
      <strong>${category.icon || "□"} ${category.name}</strong>
      <span>${visibleProducts().filter((p) => p.category === category.id).length} منتج</span>
    </article>
  `).join("");
  grid.querySelectorAll("[data-category]").forEach((card) => {
    card.addEventListener("click", () => {
      state.category = card.dataset.category;
      document.getElementById("categoryFilter").value = state.category;
      renderProducts();
      document.getElementById("products").scrollIntoView({ behavior: "smooth" });
    });
  });
}

function productCard(product) {
  const sale = discount(product);
  const status = product.stock > 0 ? `<span class="stock-ok">متوفر (${product.stock})</span>` : `<span class="stock-out">غير متوفر</span>`;
  return `
    <article class="product-card">
      <div class="image-wrap">
        ${sale ? `<span class="badge">خصم ${sale}%</span>` : ""}
        <img loading="lazy" decoding="async" src="${imageUrl(product.image, 520)}" alt="${escapeHtml(product.name)}">
      </div>
      <div class="product-info">
        <div class="product-title"><strong>${product.name}</strong><span>⭐ ${product.rating || 0}</span></div>
        <div class="price"><span>${money(product.price)}</span>${product.oldPrice ? `<span class="old-price">${money(product.oldPrice)}</span>` : ""}</div>
        <div class="meta-row"><span>${categoryName(product.category)}</span>${status}</div>
        <button class="primary-button" data-open-product="${product.id}" type="button">عرض المنتج</button>
      </div>
    </article>
  `;
}

function categoryName(id) {
  return store.categories.find((cat) => cat.id === id)?.name || "بدون قسم";
}

function filteredProducts() {
  return visibleProducts().filter((product) => {
    const haystack = `${product.name} ${product.brand} ${product.color} ${product.description} ${categoryName(product.category)}`.toLowerCase();
    return (!state.query || haystack.includes(state.query.toLowerCase()))
      && (!state.category || product.category === state.category)
      && (!state.brand || product.brand === state.brand)
      && (!state.color || product.color === state.color)
      && (!state.rating || Number(product.rating || 0) >= Number(state.rating))
      && (!state.stock || (state.stock === "in" ? product.stock > 0 : product.stock <= 0))
      && Number(product.price || 0) <= Number(state.maxPrice || 999999);
  });
}

function renderProducts() {
  const products = filteredProducts();
  document.getElementById("productGrid").innerHTML = products.map(productCard).join("") || `<p>لا توجد منتجات مطابقة.</p>`;
  document.getElementById("offersGrid").innerHTML = visibleProducts().filter(discount).map(productCard).join("") || `<p>لا توجد عروض حاليا.</p>`;
  document.getElementById("productCount").textContent = `${products.length} منتج`;
  hydrateProductButtons();
  revealImages();
  setupRevealAnimations();
}

function renderFilters() {
  const products = visibleProducts();
  const fillSelect = (id, label, values) => {
    document.getElementById(id).innerHTML = `<option value="">${label}</option>${[...new Set(values.filter(Boolean))].map((v) => `<option value="${v}">${v}</option>`).join("")}`;
  };
  fillSelect("categoryFilter", "كل الأقسام", store.categories.sort(byOrder).map((cat) => cat.id));
  document.querySelectorAll("#categoryFilter option").forEach((option) => {
    if (option.value) option.textContent = categoryName(option.value);
  });
  fillSelect("brandFilter", "كل الشركات", products.map((p) => p.brand));
  fillSelect("colorFilter", "كل الألوان", products.map((p) => p.color));
  document.getElementById("ratingFilter").innerHTML = `<option value="">أي تقييم</option><option value="4">4 نجوم فأكثر</option><option value="3">3 نجوم فأكثر</option>`;
  document.getElementById("stockFilter").innerHTML = `<option value="">الكل</option><option value="in">متوفر</option><option value="out">غير متوفر</option>`;
  const max = Math.max(100, ...products.map((p) => Number(p.price || 0)));
  const price = document.getElementById("priceFilter");
  price.max = Math.ceil(max / 50) * 50;
  price.value = price.max;
  state.maxPrice = price.max;
  document.getElementById("priceValue").textContent = money(price.value);
}

function hydrateProductButtons() {
  document.querySelectorAll("[data-open-product]").forEach((button) => {
    button.addEventListener("click", () => openProduct(button.dataset.openProduct));
  });
}

function revealImages() {
  document.querySelectorAll(".product-card img").forEach((img) => {
    if (img.complete) img.classList.add("loaded");
    img.addEventListener("load", () => img.classList.add("loaded"));
  });
}

function openProduct(id) {
  const product = store.products.find((item) => item.id === id);
  if (!product) return;
  const sale = discount(product);
  const status = product.stock > 0 ? "متوفر" : "غير متوفر";
  const gallery = [product.image, ...galleryImages(product.gallery)].filter(Boolean).slice(0, 8);
  document.getElementById("productDetails").innerHTML = `
    <div class="details-grid">
      <div>
        <img class="main-product-image" loading="lazy" decoding="async" src="${imageUrl(product.image, 900)}" alt="${escapeHtml(product.name)}">
        <div class="gallery">${gallery.map((src) => `<img loading="lazy" decoding="async" src="${imageUrl(src, 240)}" alt="${escapeHtml(product.name)}">`).join("")}</div>
      </div>
      <div>
        <p class="eyebrow">${categoryName(product.category)}</p>
        <h2>${product.name}</h2>
        <div class="price"><span>${money(product.price)}</span>${product.oldPrice ? `<span class="old-price">${money(product.oldPrice)}</span>` : ""}${sale ? `<span>خصم ${sale}%</span>` : ""}</div>
        <p>${product.description || ""}</p>
        <div class="spec-list">
          <div><strong>المواصفات:</strong> ${product.specs || "غير محدد"}</div>
          <div><strong>اللون:</strong> ${product.color || "غير محدد"}</div>
          <div><strong>المقاس:</strong> ${product.size || "غير محدد"}</div>
          <div><strong>الشركة المصنعة:</strong> ${product.brand || "غير محدد"}</div>
          <div><strong>رقم المنتج:</strong> ${product.id}</div>
          <div><strong>الحالة:</strong> ${status}</div>
          <div><strong>المخزون:</strong> ${product.stock}</div>
          <div><strong>آخر تحديث:</strong> ${product.updatedAt || ""}</div>
        </div>
        <a class="primary-button" target="_blank" rel="noopener" href="${whatsappUrl(product)}">تواصل عبر واتساب</a>
      </div>
    </div>
  `;
  document.getElementById("productModal").classList.add("open");
}

function whatsappUrl(product) {
  const number = (store.settings.whatsappNumber || store.contact.whatsapp || "").replace(/[^\d]/g, "");
  const template = store.settings.whatsappMessage || "";
  const text = template.replaceAll("{name}", product.name).replaceAll("{price}", product.price);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function renderContact() {
  const labels = { phone: "الهاتف", whatsapp: "واتساب", email: "البريد الإلكتروني", address: "العنوان", facebook: "فيسبوك", instagram: "إنستجرام", tiktok: "تيك توك", youtube: "يوتيوب" };
  document.getElementById("contactGrid").innerHTML = Object.entries(store.contact).map(([key, value]) => `<div class="contact-item"><strong>${labels[key]}</strong><p>${value || "-"}</p></div>`).join("");
}

function renderQuickResults() {
  const box = document.getElementById("quickResults");
  if (!state.query) {
    box.innerHTML = "";
    return;
  }
  const hits = visibleProducts().filter((p) => p.name.toLowerCase().includes(state.query.toLowerCase())).slice(0, 6);
  box.innerHTML = hits.map((p) => `<button type="button" data-open-product="${p.id}">${p.name}</button>`).join("");
  hydrateProductButtons();
}

function bindEvents() {
  document.querySelector("[data-nav-toggle]").addEventListener("click", () => document.querySelector("[data-nav-links]").classList.toggle("open"));
  document.querySelector("[data-theme-toggle]").addEventListener("click", () => {
    const dark = !document.body.classList.contains("dark");
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    applyThemeAndSettings();
  });
  document.querySelector("[data-close-modal]").addEventListener("click", () => document.getElementById("productModal").classList.remove("open"));
  document.getElementById("productModal").addEventListener("click", (event) => {
    if (event.target.id === "productModal") event.currentTarget.classList.remove("open");
  });
  document.getElementById("globalSearch").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    renderProducts();
    renderQuickResults();
  });
  ["categoryFilter", "brandFilter", "colorFilter", "ratingFilter", "stockFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", (event) => {
      state[id.replace("Filter", "")] = event.target.value;
      renderProducts();
    });
  });
  document.getElementById("priceFilter").addEventListener("input", (event) => {
    state.maxPrice = event.target.value;
    document.getElementById("priceValue").textContent = money(event.target.value);
    renderProducts();
  });
  document.getElementById("resetFilters").addEventListener("click", () => {
    Object.assign(state, { query: "", category: "", brand: "", color: "", rating: "", stock: "" });
    document.getElementById("globalSearch").value = "";
    renderFilters();
    renderProducts();
    renderQuickResults();
  });
}

function renderSite() {
  applyThemeAndSettings();
  renderHero();
  renderFilters();
  renderCategories();
  renderProducts();
  renderContact();
  setupRevealAnimations();
}

async function initializeSite() {
  try {
    store = await loadStore();
  } catch (error) {
    console.error("Store load failed", error);
  }

  apiRequest("visit", { method: "POST", body: "{}" }).catch((error) => console.warn("Visit counter skipped", error));
  renderSite();
  bindEvents();
  document.body.classList.add("page-ready");
}

initializeSite();
